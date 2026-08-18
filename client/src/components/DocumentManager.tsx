import { useCallback, useEffect, useRef, useState } from 'react';
import type { CorpusAudit, DocumentInfo, DocumentsResponse } from '../types';

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

export default function DocumentManager({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<DocumentsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [audit, setAudit] = useState<CorpusAudit | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
          body: JSON.stringify({ name: file.name, contentBase64 }),
        });
        const body = await res.json();

        if (!res.ok) {
          messages.push(`${file.name}: ${body.error ?? `HTTP ${res.status}`}`);
          continue;
        }
        messages.push(
          `${file.name} ${body.replaced ? 'güncellendi' : 'eklendi'} · indeks ${body.indexedChunks} parça` +
            (body.hint ? ` · ${body.hint}` : ''),
        );
        if (body.warning) warning = body.warning;
      } catch (e) {
        messages.push(`${file.name}: ${(e as Error).message}`);
      }
    }

    setBusy(false);
    setNotice({
      kind: warning ? 'warn' : 'ok',
      text: messages.join('\n') + (warning ? `\n\n${warning}` : ''),
    });
    await refresh();
    onChanged?.();
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

      {notice && <div className={`docs-notice docs-notice-${notice.kind}`}>{notice.text}</div>}

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
              <span className="doc-meta">
                {shadowed ? 'aynı adlı üst biçim tercih edildi' : `${doc.chunks} parça`} · {prettySize(doc.bytes)}
              </span>
              <button className="doc-remove" onClick={() => remove(doc)} disabled={busy} title="Sil">
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
