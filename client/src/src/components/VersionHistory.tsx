import { useCallback, useEffect, useState } from 'react';
import type {
  DiffResponse,
  DocumentVersion,
  SessionUser,
  VersionListResponse,
  VersionTextResponse,
} from '../types';

/**
 * Politika sürüm geçmişi.
 *
 * İki soruya cevap verir:
 *   1. Bu doküman ne zaman, kim tarafından, neden değişti?
 *   2. Tam olarak NE değişti?
 *
 * İkincisi kritik: "güncellendi" bilgisi tek başına işe yaramaz. Bir yönerge
 * değiştiğinde İK'nın bilmesi gereken şey hangi cümlenin değiştiğidir —
 * özellikle sayısal değerler (gün, tutar, süre) değişmişse.
 */

const STATE_LABEL: Record<DocumentVersion['state'], string> = {
  yururlukte: 'yürürlükte',
  bekliyor: 'bekliyor',
  arsiv: 'arşiv',
  'geri-cekildi': 'geri çekildi',
};

const STATE_CHIP: Record<DocumentVersion['state'], string> = {
  yururlukte: 'chip chip--ok',
  bekliyor: 'chip chip--warn',
  arsiv: 'chip',
  'geri-cekildi': 'chip chip--danger',
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });

const fmtDateTime = (iso: string) =>
  `${new Date(iso).toLocaleDateString('tr-TR')} ${new Date(iso).toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;

export default function VersionHistory({
  doc,
  user,
  accessLabel,
  onLabelChanged,
  onClose,
}: {
  doc: string;
  user: SessionUser;
  accessLabel: 'genel' | 'ik' | 'yonetici';
  onLabelChanged?: () => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<VersionListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState<VersionTextResponse | null>(null);
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [busy, setBusy] = useState(false);

  // Karsilastirma icin secilen surumler. En fazla iki tane tutulur; ucuncu
  // secim en eskisini duserur — "once temizle sonra sec" adimini kaldirir.
  const [picked, setPicked] = useState<number[]>([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(doc)}/versions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as VersionListResponse);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [doc]);

  useEffect(() => {
    load();
  }, [load]);

  function toggle(version: number) {
    setPicked((prev) =>
      prev.includes(version) ? prev.filter((v) => v !== version) : [...prev, version].slice(-2),
    );
    setDiff(null);
    setText(null);
  }

  async function compare() {
    if (picked.length !== 2) return;
    const [a, b] = [...picked].sort((x, y) => x - y);

    setBusy(true);
    setText(null);
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(doc)}/diff?a=${a}&b=${b}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setDiff(body as DiffResponse);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function showText(version: number) {
    setBusy(true);
    setDiff(null);
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(doc)}/versions/${version}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setText(body as VersionTextResponse);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function changeLabel(label: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(doc)}/label`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      onLabelChanged?.();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <div className="eyebrow">02 / Korpus / Sürüm geçmişi</div>
          <h2 className="view-title view-title--file">{doc}</h2>
        </div>

        <div className="view-actions">
          {/* Erisim etiketi yalnizca yoneticide degistirilebilir: yukleme icerik
              ekler, etiket KIMIN NEYI GORECEGINI belirler — ayri bir karar. */}
          {user.role === 'yonetici' && (
            <>
              <span className="label">Erişim</span>
              <select
                className="select select--on"
                value={accessLabel}
                onChange={(e) => changeLabel(e.target.value)}
                disabled={busy}
                title="Etiket geçmiş sürümleri de kapsar."
              >
                <option value="genel">genel — herkes</option>
                <option value="ik">ik — İK ve yönetici</option>
                <option value="yonetici">yönetici — yalnızca yönetici</option>
              </select>
            </>
          )}
          <button type="button" className="btn btn--quiet" onClick={onClose}>
            Kapat
          </button>
        </div>
      </header>

      <div className="view-body">
        {error && <p className="rule-note rule-note--danger">{error}</p>}

        <p className="eyebrow" style={{ marginBottom: 24 }}>
          {data
            ? data.versions.length
              ? `${data.versions.length} sürüm · yürürlükte: ${data.currentVersion ?? '—'}`
              : 'Bu doküman değişmedi; henüz sürüm kaydı yok.'
            : 'yükleniyor…'}
        </p>

        <div className="vh tbl">
          <div className="tbl-head">
            <span />
            <span>Sürüm</span>
            <span>Durum</span>
            <span>Yürürlük</span>
            <span>Not</span>
            <span className="tbl-right">Açan</span>
          </div>

          {data?.versions.map((v) => (
            <div key={v.id} className={`tbl-row${picked.includes(v.version) ? ' tbl-row--on' : ''}`}>
              <input
                type="checkbox"
                checked={picked.includes(v.version)}
                onChange={() => toggle(v.version)}
                title="Karşılaştırmak için seç"
              />
              <button
                type="button"
                className="vh-main"
                onClick={() => showText(v.version)}
                title="Sürüm metnini göster"
              >
                <span className="vh-no">s{v.version}</span>
                <span className={STATE_CHIP[v.state]}>{STATE_LABEL[v.state]}</span>
                <span className="vh-date">{fmtDate(v.effectiveFrom)} itibarıyla</span>
                <span className="vh-note">{v.note ?? ''}</span>
                <span className="vh-by">
                  {v.createdBy} · {fmtDateTime(v.createdAt)}
                </span>
              </button>
            </div>
          ))}
        </div>

        {data && data.versions.length > 1 && (
          <div className="vh-actions">
            <button
              type="button"
              className="btn btn--solid"
              onClick={compare}
              disabled={picked.length !== 2 || busy}
            >
              {picked.length === 2
                ? `s${Math.min(...picked)} ↔ s${Math.max(...picked)} karşılaştır`
                : 'Karşılaştırmak için iki sürüm seçin'}
            </button>
          </div>
        )}

        {(diff || text) && (
          <div className="vh-panes">
            {diff && <DiffView diff={diff} />}

            {text && (
              <div>
                <div className="pane-head">
                  <span className="label">Sürüm metni</span>
                  <span className="pane-head-meta">
                    s{text.version} · {fmtDate(text.effectiveFrom)} · {STATE_LABEL[text.state]}
                  </span>
                </div>
                <pre className="code" style={{ marginTop: 20 }}>
                  {text.content}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DiffView({ diff }: { diff: DiffResponse }) {
  return (
    <div>
      <div className="pane-head">
        <span className="label">
          Fark · s{diff.a} → s{diff.b}
        </span>
        <span className="diff-counts">
          <b className="diff-add">+{diff.added}</b>
          <b className="diff-del">−{diff.removed}</b>
        </span>
      </div>

      {diff.truncated && (
        <p className="rule-note rule-note--warn" style={{ margin: '20px 0 0' }}>
          Doküman satır satır karşılaştırma için fazla büyük; blok değişiklik olarak gösteriliyor.
        </p>
      )}

      {diff.added === 0 && diff.removed === 0 ? (
        <p className="eyebrow" style={{ marginTop: 20 }}>
          Metinde fark yok.
        </p>
      ) : (
        <div className="diff" style={{ marginTop: 20 }}>
          {diff.lines.map((l, i) => (
            <div key={i} className={`diff-line diff-line--${l.kind}`}>
              <span className="diff-sign">
                {l.kind === 'eklendi' ? '+' : l.kind === 'silindi' ? '−' : ''}
              </span>
              <span className="diff-text">{l.text || ' '}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
