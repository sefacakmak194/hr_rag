import { useCallback, useEffect, useState } from 'react';
import type {
  DiffResponse,
  DocumentVersion,
  SessionUser,
  VersionListResponse,
  VersionTextResponse,
} from '../types';

/**
 * Politika sürüm geçmişi (Sprint 2).
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
      prev.includes(version)
        ? prev.filter((v) => v !== version)
        : [...prev, version].slice(-2),
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
      const res = await fetch(
        `/api/documents/${encodeURIComponent(doc)}/diff?a=${a}&b=${b}`,
      );
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
      const res = await fetch(
        `/api/documents/${encodeURIComponent(doc)}/versions/${version}`,
      );
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
    <div className="vh">
      <div className="vh-head">
        <div>
          <h3>{doc}</h3>
          <p>
            {data
              ? data.versions.length
                ? `${data.versions.length} sürüm · yürürlükte: ${data.currentVersion ?? '—'}`
                : 'Bu doküman değişmedi; henüz sürüm kaydı yok.'
              : 'yükleniyor…'}
          </p>
        </div>
        <button className="vh-close" onClick={onClose} title="Kapat">
          ×
        </button>
      </div>

      {/* Erisim etiketi yalnizca yoneticide degistirilebilir: yukleme icerik
          ekler, etiket KIMIN NEYI GORECEGINI belirler — ayri bir karar. */}
      {user.role === 'yonetici' && (
        <div className="vh-label">
          <span>Erişim</span>
          <select value={accessLabel} onChange={(e) => changeLabel(e.target.value)} disabled={busy}>
            <option value="genel">genel — herkes</option>
            <option value="ik">ik — İK ve yönetici</option>
            <option value="yonetici">yönetici — yalnızca yönetici</option>
          </select>
          <small>Etiket geçmiş sürümleri de kapsar.</small>
        </div>
      )}

      {error && <p className="vh-error">{error}</p>}

      <ul className="vh-list">
        {data?.versions.map((v) => (
          <li key={v.id} className={`vh-item vh-${v.state}`}>
            <label className="vh-pick">
              <input
                type="checkbox"
                checked={picked.includes(v.version)}
                onChange={() => toggle(v.version)}
              />
            </label>

            <button type="button" className="vh-main" onClick={() => showText(v.version)}>
              <span className="vh-no">s{v.version}</span>
              <span className="vh-state">{STATE_LABEL[v.state]}</span>
              <span className="vh-date">{fmtDate(v.effectiveFrom)} itibarıyla</span>
              {v.note && <span className="vh-note">{v.note}</span>}
              <span className="vh-by">
                {v.createdBy} · {fmtDateTime(v.createdAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {data && data.versions.length > 1 && (
        <div className="vh-actions">
          <button onClick={compare} disabled={picked.length !== 2 || busy}>
            {picked.length === 2
              ? `s${Math.min(...picked)} ↔ s${Math.max(...picked)} karşılaştır`
              : 'Karşılaştırmak için iki sürüm seçin'}
          </button>
        </div>
      )}

      {diff && <DiffView diff={diff} />}

      {text && (
        <div className="vh-text">
          <div className="vh-text-head">
            s{text.version} · {fmtDate(text.effectiveFrom)} · {STATE_LABEL[text.state]}
          </div>
          <pre>{text.content}</pre>
        </div>
      )}
    </div>
  );
}

function DiffView({ diff }: { diff: DiffResponse }) {
  return (
    <div className="vh-diff">
      <div className="vh-diff-head">
        <span>
          s{diff.a} → s{diff.b}
        </span>
        <span className="vh-diff-counts">
          <b className="vh-add">+{diff.added}</b>
          <b className="vh-del">−{diff.removed}</b>
        </span>
      </div>

      {diff.truncated && (
        <p className="vh-diff-warn">
          Doküman satır satır karşılaştırma için fazla büyük; blok değişiklik olarak
          gösteriliyor.
        </p>
      )}

      {diff.added === 0 && diff.removed === 0 ? (
        <p className="vh-diff-empty">Metinde fark yok.</p>
      ) : (
        <ol className="vh-diff-lines">
          {diff.lines.map((l, i) => (
            <li key={i} className={`vh-line vh-line-${l.kind}`}>
              <span className="vh-sign">
                {l.kind === 'eklendi' ? '+' : l.kind === 'silindi' ? '−' : ''}
              </span>
              <span className="vh-line-text">{l.text || ' '}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
