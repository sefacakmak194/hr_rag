import { useCallback, useEffect, useState } from 'react';
import { useSideStats } from '../sideStats';
import type { GapCluster, GapReport } from '../types';

/**
 * Politika bosluklari.
 *
 * Yanitsiz sorular konu bazinda gruplanir: tek tek sorular gurultudur, ayni
 * boslugu isaret eden bir yigin ise politika ihtiyacidir.
 *
 * Gruplama bir YARDIMCIDIR, siniflandirici degil — esik fazla bolme yonunde
 * secildi; ayni boslugu isaret eden iki konu ayri satirda gorunebilir, bu
 * yuzden "benzer" baglantisi gosterilir. Ekran bu belirsizligi saklamiyor.
 */
export default function GapClusterPanel() {
  const [data, setData] = useState<GapReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/reports/policy-gaps');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as GapReport);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = () => {
    if (!data) return;
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [
      ['konu', 'soru_sayisi', 'en_yuksek_skor', 'esige_yakin', 'ornek_sorular'].map(esc).join(','),
      ...data.clusters.map((g) =>
        [
          g.label,
          g.count,
          g.bestScore.toFixed(3),
          g.nearMiss ? 'evet' : 'hayir',
          g.questions.map((q) => q.question).join(' | '),
        ]
          .map(esc)
          .join(','),
      ),
    ];
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `politika-bosluklari-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const weeks = data?.byWeek ?? [];
  const max = Math.max(1, ...weeks.map((w) => w.count));

  useSideStats(
    data
      ? [
          { k: 'yanıtsız', v: String(data.totalQuestions) },
          { k: 'saklama', v: `${data.retentionWeeks} hafta` },
        ]
      : [],
  );

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <div className="eyebrow">03 / Cevaplanamayanlar</div>
          <h2 className="view-title">
            {data
              ? `${data.totalQuestions} yanıtsız soru · ${data.clusters.length} konu · ${weeks.length} hafta`
              : 'Politika boşlukları'}
          </h2>
        </div>
        <div className="view-actions">
          <button type="button" className="btn btn--quiet" onClick={load} disabled={loading}>
            {loading ? 'Yükleniyor…' : 'Yenile'}
          </button>
          <button type="button" className="btn" onClick={exportCsv} disabled={!data?.clusters.length}>
            CSV indir
          </button>
        </div>
      </header>

      <div className="view-body">
        {error && <p className="rule-note rule-note--danger">{error}</p>}

        {weeks.length > 0 && (
          <>
            <div className="trend">
              {weeks.map((w) => (
                <div
                  key={w.week}
                  className={`trend-bar${w.count === max ? ' trend-bar--max' : ''}`}
                  title={`${w.week}: ${w.count} yanıtsız soru`}
                >
                  <span className="trend-count">{w.count}</span>
                  <div
                    className="trend-fill"
                    style={{ height: `${Math.round((w.count / max) * 100)}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="trend-axis">
              <span>{weeks[0]?.week}</span>
              <span>{weeks[weeks.length - 1]?.week}</span>
            </div>
          </>
        )}

        {data && data.clusters.length === 0 && (
          <p className="gaps-empty">
            Yanıtsız soru yok. Korpus sorulan sorulara yetiyor.
          </p>
        )}

        {data && data.clusters.length > 0 && (
          <div className="gaps tbl">
            <div className="tbl-head">
              <span>Soru</span>
              <span>Konu</span>
              <span>Durum</span>
              <span className="tbl-right">Skor</span>
            </div>
            {data.clusters.map((gap) => (
              <Gap
                key={gap.label}
                gap={gap}
                open={open === gap.label}
                onToggle={() => setOpen(open === gap.label ? null : gap.label)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Gap({
  gap,
  open,
  onToggle,
}: {
  gap: GapCluster;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`gap${open ? ' gap--open' : ''}`}>
      <button type="button" className="gap-head" onClick={onToggle}>
        <span className="gap-count">{gap.count}</span>
        <span className="gap-label">{gap.label}</span>
        {gap.nearMiss ? (
          <span className="chip chip--warn">az kaldı</span>
        ) : (
          <span />
        )}
        <span className="gap-score">{gap.bestScore.toFixed(3)}</span>
      </button>

      {open && (
        <div className="gap-body">
          <ul className="gap-questions">
            {gap.questions.map((q, i) => (
              <li key={i}>
                <span>{q.question}</span>
                <em>{q.week}</em>
              </li>
            ))}
          </ul>

          <div className="gap-cols">
            {gap.relatedTo && (
              <p className="paper-block gap-related">
                Benzer konu: <strong>{gap.relatedTo}</strong> — aynı boşluğa işaret ediyor olabilir.
              </p>
            )}
            {gap.nearMiss && (
              <p className="paper-block gap-advice">
                Eşiğe yakın: mevzuat bu konuya değiniyor olabilir ama arama eşiğini geçemiyor.
                Yeni yönerge yerine mevcut maddeyi netleştirmek yeterli olabilir.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
