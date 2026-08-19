import { useCallback, useEffect, useState } from 'react';
import type { GapCluster, GapReport } from '../types';

/**
 * Politika boşluğu raporu (Sprint 4).
 *
 * Şu soruyu cevaplıyor: **çalışanlar neyi soruyor ama mevzuatta karşılığı yok?**
 *
 * Panelin iki şeyi aynı anda söylemesi gerekiyor: hangi konuların eksik
 * olduğunu, ve bu gruplamanın **ne kadar güvenilir** olduğunu. İkincisi
 * gizlenirse rapor olduğundan kesin görünür — ölçüldü, kümeleme eşiği
 * konuları temiz ayıramıyor (bkz. `constants.ts`).
 */

const fmtWeek = (w: string) => w.replace('-W', ' · ') + '. hafta';

export default function PolicyGapPanel() {
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

  /** CSV: BOM'lu, alanlar tırnaklı (denetim dışa aktarımıyla aynı kurallar). */
  const exportCsv = () => {
    if (!data) return;
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

    const lines = [
      ['konu', 'soru_sayisi', 'en_iyi_skor', 'az_kaldi', 'ilk_hafta', 'son_hafta', 'soru'].map(esc).join(','),
      ...data.clusters.flatMap((c) =>
        c.questions.map((q) =>
          [c.label, c.count, c.bestScore, c.nearMiss ? 'evet' : 'hayir', c.firstWeek, c.lastWeek, q.question]
            .map(esc)
            .join(','),
        ),
      ),
    ];

    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `politika-bosluklari-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const maxWeek = Math.max(1, ...(data?.byWeek.map((w) => w.count) ?? [1]));

  return (
    <aside className="gaps">
      <div className="gaps-head">
        <div>
          <h2>Politika boşlukları</h2>
          <p>
            {data
              ? `${data.totalQuestions} yanıtsız soru · ${data.clusters.length} konu · ${data.weeks} hafta`
              : 'yükleniyor…'}
          </p>
        </div>
        <button onClick={load} disabled={loading}>
          {loading ? '…' : 'Yenile'}
        </button>
      </div>

      {error && <p className="gaps-error">{error}</p>}

      {data && data.totalQuestions === 0 && (
        <p className="gaps-empty">
          Henüz yanıtsız soru yok. Bir soru mevzuatta karşılık bulamadığında burada görünecek.
        </p>
      )}

      {data && data.byWeek.length > 1 && (
        <div className="gaps-trend">
          <span className="gaps-trend-label">Haftalık</span>
          <div className="gaps-bars">
            {data.byWeek.map((w) => (
              <div key={w.week} className="gaps-bar" title={`${fmtWeek(w.week)}: ${w.count} soru`}>
                <div className="gaps-bar-fill" style={{ height: `${(w.count / maxWeek) * 100}%` }} />
                <span>{w.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data && data.clusters.length > 0 && (
        <>
          <div className="gaps-actions">
            <button onClick={exportCsv}>CSV indir</button>
          </div>

          <ul className="gaps-list">
            {data.clusters.map((c) => (
              <Cluster
                key={c.label}
                cluster={c}
                open={open === c.label}
                onToggle={() => setOpen(open === c.label ? null : c.label)}
              />
            ))}
          </ul>
        </>
      )}

      {/* Bu not gizlenemez: raporun dogru okunmasi buna bagli. */}
      {data && data.totalQuestions > 0 && (
        <p className="gaps-note">
          Konu gruplaması bir <strong>yardımcıdır, sınıflandırıcı değil</strong>. Ölçüldü: aynı
          konunun farklı ifadeleri ile farklı konular arasındaki benzerlik dağılımları örtüşüyor.
          Eşik <strong>fazla bölme</strong> yönünde seçildi — aynı boşluğa işaret eden iki konu
          ayrı satırda görünebilir, bu yüzden “benzer” bağlantısı gösteriliyor. Kayıtlar{' '}
          <strong>kim sorduğu bilgisini taşımaz</strong> ve {data.retentionWeeks} hafta sonra
          silinir.
        </p>
      )}
    </aside>
  );
}

function Cluster({
  cluster,
  open,
  onToggle,
}: {
  cluster: GapCluster;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li className={`gap${cluster.nearMiss ? ' gap-near' : ''}`}>
      <button type="button" className="gap-head" onClick={onToggle}>
        <span className="gap-count">{cluster.count}</span>
        <span className="gap-label">{cluster.label}</span>
        {cluster.nearMiss && (
          <span
            className="gap-chip"
            title="Skor eşiğe çok yakın: konu mevzuatta geçiyor olabilir ama yeterince açık yazılmamış."
          >
            az kaldı
          </span>
        )}
        <span className="gap-score">{cluster.bestScore.toFixed(3)}</span>
      </button>

      {open && (
        <div className="gap-body">
          <ul className="gap-questions">
            {cluster.questions.map((q, i) => (
              <li key={i}>
                <span>{q.question}</span>
                <em>{q.week}</em>
              </li>
            ))}
          </ul>

          {cluster.relatedTo && (
            <p className="gap-related">
              Benzer konu: <strong>{cluster.relatedTo}</strong> — aynı boşluğa işaret ediyor
              olabilir.
            </p>
          )}

          <p className="gap-advice">
            {cluster.nearMiss
              ? 'Eşiğe yakın: mevzuat bu konuya değiniyor olabilir ama arama eşiğini geçemiyor. Yeni yönerge yerine mevcut maddeyi netleştirmek yeterli olabilir.'
              : 'Eşikten uzak: konu mevzuatta gerçekten yok görünüyor. Yeni bir madde gerekebilir.'}
          </p>
        </div>
      )}
    </li>
  );
}
