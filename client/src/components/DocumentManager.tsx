import { useCallback, useEffect, useRef, useState } from 'react';
import VersionHistory from './VersionHistory';
import type { CorpusAudit, DocumentInfo, DocumentsResponse, SessionUser } from '../types';

/**
 * Korpus yonetimi paneli.
 *
 * Dosyalar base64 JSON ile gonderilir (sunucuda multipart bagimliligi yok).
 * Her degisiklikten sonra sunucu korpusu bastan indeksler; panel donen
 * uyariyi (esik kalibrasyonu) oldugu gibi gosterir — sessizce gecilmemeli.
 */

const ACCEPT = '.md,.docx,.pdf';

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Dosyayi base64'e cevirir (data URL onekini atarak). */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Dosya okunamadı'));
    reader.readAsDataURL(file);
  });
}

export default function DocumentManager({
  user,
  onChanged,
}: {
  user: SessionUser;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<DocumentsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [audit, setAudit] = useState<CorpusAudit | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Yuklemeye eslik eden surum ustverisi (Sprint 2).
  //
  // Bos birakilabilir: not istege bagli, tarih bossa yukleme ani kullanilir.
  // Tarih GELECEKTE ise dosya korpusa girmez, yururluk tarihini bekler.
  const [note, setNote] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/documents');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as DocumentsResponse);

      // Korpus sagligi: celiski / tekrar / yapi sorunlari. Gercek arsivlerde
      // bunlar sessizce yanlis cevap uretir; panelde gorunur olmasi gerekiyor.
      const a = await fetch('/api/corpus/audit');
      if (a.ok) setAudit((await a.json()) as CorpusAudit);
    } catch (e) {
      setNotice({ kind: 'error', text: `Doküman listesi alınamadı: ${(e as Error).message}` });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length || busy) return;

    setBusy(true);
    setNotice(null);

    const messages: string[] = [];
    let warning: string | null = null;

    for (const file of list) {
      try {
        const contentBase64 = await toBase64(file);
        const res = await fetch('/api/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: file.name,
            contentBase64,
            note: note.trim() || undefined,
            effectiveFrom: effectiveFrom || undefined,
          }),
        });
        const body = await res.json();

        if (!res.ok) {
          messages.push(`${file.name}: ${body.error ?? `HTTP ${res.status}`}`);
          continue;
        }

        // Ileri tarihli yuklemede korpus DEGISMEZ; mesaji ayirmak sart,
        // aksi halde kullanici degisikligin hemen yururlukte oldugunu sanir.
        if (body.scheduled) {
          messages.push(`${file.name} · ${body.message}`);
        } else {
          messages.push(
            `${file.name} ${body.replaced ? 'güncellendi' : 'eklendi'} · sürüm ${body.version ?? '—'}` +
              `${body.versionCreated ? ' (yeni)' : ' (içerik aynı, sürüm açılmadı)'}` +
              ` · indeks ${body.indexedChunks} parça` +
              (body.hint ? ` · ${body.hint}` : ''),
          );
          if (body.warning) warning = body.warning;
        }
      } catch (e) {
        messages.push(`${file.name}: ${(e as Error).message}`);
      }
    }

    setBusy(false);
    setNotice({
      kind: warning ? 'warn' : 'ok',
      text: messages.join('\n') + (warning ? `\n\n${warning}` : ''),
    });
    // Ustveri tek yukleme icindir; birakilirsa bir sonraki dosyaya sessizce
    // yanlis not/tarih yapisirdi.
    setNote('');
    setEffectiveFrom('');
    await refresh();
    onChanged?.();
  }

  /** Planlanmis (bekleyen) bir sürümden vazgeçme. */
  async function cancelPending(name: string) {
    if (!confirm(`"${name}" için planlanmış sürüm iptal edilecek. Onaylıyor musunuz?`)) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(name)}/pending`, {
        method: 'DELETE',
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setNotice({ kind: 'warn', text: `${name} için planlanmış sürüm geri çekildi.` });
    } catch (e) {
      setNotice({ kind: 'error', text: (e as Error).message });
    }
    setBusy(false);
    await refresh();
  }

  async function remove(doc: DocumentInfo) {
    if (busy) return;
    if (!confirm(`"${doc.name}" korpustan silinecek ve indeks yeniden kurulacak. Onaylıyor musunuz?`)) return;

    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(doc.name)}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setNotice({
        kind: 'warn',
        text: `${doc.name} silindi · indeks ${body.indexedChunks} parça\n\n${body.warning ?? ''}`.trim(),
      });
    } catch (e) {
      setNotice({ kind: 'error', text: (e as Error).message });
    }
    setBusy(false);
    await refresh();
    onChanged?.();
  }

  async function reindex() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/documents/reindex', { method: 'POST' });
      const body = await res.json();
      setNotice({
        kind: body.indexError ? 'error' : 'ok',
        text: body.indexError ?? `İndeks yeniden kuruldu · ${body.indexedChunks} parça`,
      });
    } catch (e) {
      setNotice({ kind: 'error', text: (e as Error).message });
    }
    setBusy(false);
    await refresh();
    onChanged?.();
  }

  return (
    <section className="docs">
      <div className="docs-head">
        <div>
          <h2>Korpus</h2>
          <p>
            {data ? `${data.documents.length} doküman · ${data.indexedChunks} parça` : 'yükleniyor…'}
          </p>
        </div>
        <button className="docs-reindex" onClick={reindex} disabled={busy}>
          Yeniden indeksle
        </button>
      </div>

      <div
        className={`dropzone${dragging ? ' dropzone-active' : ''}${busy ? ' dropzone-busy' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          upload(e.dataTransfer.files);
        }}
        onClick={() => !busy && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) upload(e.target.files);
            e.target.value = '';
          }}
        />
        {busy ? 'İndeks kuruluyor…' : 'Markdown, Word veya PDF dosyalarını buraya sürükleyin · ya da tıklayın'}
      </div>

      {/* Sürüm üstverisi. Yükleme öncesinde doldurulur; boş bırakılabilir. */}
      <div className="docs-meta">
        <label>
          <span>Değişiklik notu</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="örn. yazım hatası düzeltmesi"
            disabled={busy}
          />
        </label>
        <label>
          <span>Yürürlük tarihi</span>
          <input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            disabled={busy}
          />
        </label>
        <small>
          Tarih ileri bir gün ise doküman korpusa <strong>o gün</strong> alınır; o zamana kadar
          yanıtlar yürürlükteki sürüme dayanmayı sürdürür.
        </small>
      </div>

      {notice && <div className={`docs-notice docs-notice-${notice.kind}`}>{notice.text}</div>}

      {data && data.pending.length > 0 && (
        <div className="docs-pending">
          <h3>Yürürlüğe girmeyi bekleyen sürümler</h3>
          <ul>
            {data.pending.map((p) => (
              <li key={p.name} className={p.conflict ? 'pending-conflict' : undefined}>
                <span className="pending-name">{p.name}</span>
                <span className="pending-date">
                  s{p.version} · {new Date(p.effectiveFrom).toLocaleDateString('tr-TR')}
                </span>
                {p.note && <span className="pending-note">{p.note}</span>}
                {p.conflict && (
                  <span className="pending-warn">
                    çakışma: doküman bu arada değişti, planlanmış sürüm uygulanamaz
                  </span>
                )}
                <button onClick={() => cancelPending(p.name)} disabled={busy} title="İptal et">
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {audit && audit.findings.length > 0 && (
        <div className="audit">
          <button
            type="button"
            className={`audit-head${audit.summary.yuksek ? ' audit-head-alert' : ''}`}
            onClick={() => setAuditOpen((v) => !v)}
          >
            <span>Korpus sağlığı</span>
            <span className="audit-counts">
              {audit.summary.yuksek > 0 && <b className="audit-high">{audit.summary.yuksek} çelişki</b>}
              {audit.summary.orta > 0 && <b className="audit-mid">{audit.summary.orta} uyarı</b>}
              {audit.summary.bilgi > 0 && <b className="audit-low">{audit.summary.bilgi} bilgi</b>}
            </span>
          </button>

          {auditOpen && (
            <ul className="audit-list">
              {audit.findings.slice(0, 20).map((f, i) => (
                <li key={i} className={`audit-item audit-${f.severity}`}>
                  <p>{f.message}</p>
                  <ul>
                    {f.where.map((w, j) => (
                      <li key={j}>
                        {w.doc} · {w.section}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ul className="docs-list">
        {data?.documents.map((doc) => {
          const shadowed = data.shadowed.includes(doc.name);
          return (
            <li key={doc.name} className={shadowed ? 'doc doc-shadowed' : 'doc'}>
              <span className={`doc-ext doc-ext-${doc.ext}`}>{doc.ext}</span>
              <span className="doc-name" title={doc.name}>
                {doc.name}
              </span>
              {doc.version !== null && <span className="doc-version">s{doc.version}</span>}
              {doc.accessLabel !== 'genel' && (
                <span className={`doc-label doc-label-${doc.accessLabel}`}>{doc.accessLabel}</span>
              )}
              <span className="doc-meta">
                {shadowed ? 'aynı adlı üst biçim tercih edildi' : `${doc.chunks} parça`} · {prettySize(doc.bytes)}
              </span>
              <button
                className="doc-history"
                onClick={() => setHistoryFor(historyFor === doc.name ? null : doc.name)}
                title="Sürüm geçmişi"
              >
                Geçmiş
              </button>
              <button className="doc-remove" onClick={() => remove(doc)} disabled={busy} title="Sil">
                ×
              </button>
            </li>
          );
        })}
      </ul>

      {historyFor && (
        <VersionHistory
          doc={historyFor}
          user={user}
          accessLabel={
            data?.documents.find((d) => d.name === historyFor)?.accessLabel ?? 'genel'
          }
          onLabelChanged={() => {
            refresh();
            onChanged?.();
          }}
          onClose={() => setHistoryFor(null)}
        />
      )}
    </section>
  );
}
