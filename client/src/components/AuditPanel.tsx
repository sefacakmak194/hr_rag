import { useCallback, useEffect, useState } from 'react';
import type { AuditResponse, AuditRow, SessionUser } from '../types';

/**
 * Denetim kaydi ekrani.
 *
 * Kapsam SUNUCU tarafindan belirlenir: yonetici tum satirlari, diger roller
 * yalnizca kendi satirlarini alir. Istemci bunu ne secer ne de zorlar; gelen
 * `scope` alanini yalnizca kullaniciya ACIKLAMAK icin kullanir.
 *
 * Kullanicinin kendi kaydini gorebilmesi bilincli bir karardir: KVKK kisiye
 * kendi verisine erisim hakki tanir ve bu ekran o hakki dogrudan karsilar.
 */
export default function AuditPanel({ user }: { user: SessionUser }) {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (username?: string) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: '200' });
      if (username) qs.set('username', username);
      const res = await fetch(`/api/audit?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as AuditResponse);
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

  /**
   * CSV disa aktarim.
   *
   * Alanlar tirnaklanir ve icerideki tirnak ikilenir; soru metni virgul ya da
   * satir sonu tasiyabilir ve tirnaklanmazsa sutunlar kayar.
   *
   * BOM (﻿) ekleniyor: Excel BOM'suz UTF-8'i Windows kod sayfasi sanip
   * Turkce karakterleri bozuk gosteriyor.
   */
  const exportCsv = () => {
    if (!data) return;
    const esc = (v: string | number | null) =>
      `"${String(v ?? '').replace(/"/g, '""')}"`;

    const lines = [
      ['zaman', 'kullanici', 'rol', 'soru', 'alintilar', 'yanitlandi', 'sure_ms']
        .map(esc)
        .join(','),
      ...data.rows.map((r) =>
        [
          r.at,
          r.username,
          r.role,
          r.question ?? '',
          r.citations.map((c) => `${c.doc} :: ${c.section}`).join(' | '),
          r.answered ? 'evet' : 'hayir',
          r.durationMs,
        ]
          .map(esc)
          .join(','),
      ),
    ];

    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `denetim-kaydi-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside className="audit-panel">
      <div className="audit-head">
        <h2>Denetim kaydı</h2>
        <span className="audit-scope">
          {data?.scope === 'tumu' ? 'tüm kullanıcılar' : 'yalnızca kendi kayıtlarınız'}
        </span>
      </div>

      {data && (
        <div className="audit-summary">
          <Stat label="Toplam" value={data.summary.total} />
          <Stat label="Yanıtsız" value={data.summary.unanswered} tone={data.summary.unanswered > 0 ? 'warn' : undefined} />
          {user.role === 'yonetici' && <Stat label="Kullanıcı" value={data.summary.users} />}
        </div>
      )}

      {user.role === 'yonetici' && (
        <div className="audit-filter">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Kullanıcı adına göre süz"
            onKeyDown={(e) => {
              if (e.key === 'Enter') load(filter.trim() || undefined);
            }}
          />
          <button onClick={() => load(filter.trim() || undefined)} disabled={loading}>
            Ara
          </button>
        </div>
      )}

      <div className="audit-actions">
        <button onClick={() => load(filter.trim() || undefined)} disabled={loading}>
          {loading ? 'Yükleniyor…' : 'Yenile'}
        </button>
        <button onClick={exportCsv} disabled={!data?.rows.length}>
          CSV indir
        </button>
      </div>

      {error && <p className="audit-error">{error}</p>}

      {data && data.rows.length === 0 && (
        <p className="audit-empty">Henüz kayıt yok. Bir soru sorulduğunda burada görünecek.</p>
      )}

      <ul className="audit-list">
        {data?.rows.map((r) => (
          <Row key={r.id} row={r} />
        ))}
      </ul>

      <p className="audit-note">
        Kayıtlar <strong>değiştirilemez ve silinemez</strong>; bu kısıt veritabanı
        düzeyinde zorlanır. Soru metni yalnızca kısıtlı bir dokümana erişildiğinde
        saklanır.
      </p>
    </aside>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' }) {
  return (
    <div className={`audit-stat${tone ? ` audit-stat-${tone}` : ''}`}>
      <span className="audit-stat-value">{value}</span>
      <span className="audit-stat-label">{label}</span>
    </div>
  );
}

function Row({ row }: { row: AuditRow }) {
  const time = new Date(row.at);
  return (
    <li className={`audit-row${row.answered ? '' : ' audit-row-unanswered'}`}>
      <div className="audit-row-top">
        <span className="audit-time">
          {time.toLocaleDateString('tr-TR')} {time.toLocaleTimeString('tr-TR')}
        </span>
        <span className="audit-user">{row.username}</span>
        <span className={`user-role user-role-${row.role}`}>{row.role}</span>
        <span className="audit-duration">{(row.durationMs / 1000).toFixed(1)}s</span>
      </div>

      <div className="audit-row-body">
        {row.question ? (
          <p className="audit-question">{row.question}</p>
        ) : (
          <p className="audit-question audit-question-hidden">
            soru metni saklanmadı (genel doküman)
          </p>
        )}

        {row.citations.length > 0 ? (
          <ul className="audit-citations">
            {row.citations.map((c, i) => (
              <li key={i}>
                {c.doc} <span className="audit-section">{c.section}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="audit-nocite">
            {row.answered ? 'doküman erişimi yok' : 'ilgili doküman bulunamadı'}
          </p>
        )}
      </div>
    </li>
  );
}
