import { useCallback, useEffect, useState } from 'react';
import IntegrityPanel from './IntegrityPanel';
import { useSideStats } from '../sideStats';
import type { AuditResponse, AuditRow, IntegrityReport, SessionUser } from '../types';

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
  // IntegrityPanel'den yukari verilir; kenar cubugu zincirin durumunu yazar.
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);

  useSideStats([
    ...(integrity
      ? [
          {
            k: 'zincir',
            v: integrity.ok ? 'bütün' : 'kırık',
            tone: integrity.ok ? ('ok' as const) : ('down' as const),
          },
        ]
      : []),
    ...(data ? [{ k: 'kapsam', v: data.scope === 'tumu' ? 'tümü' : 'kendi' }] : []),
  ]);

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
   * BOM ekleniyor: Excel BOM'suz UTF-8'i Windows kod sayfasi sanip Turkce
   * karakterleri bozuk gosteriyor.
   */
  const exportCsv = () => {
    if (!data) return;
    const esc = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    const lines = [
      ['zaman', 'kullanici', 'rol', 'soru', 'alintilar', 'yanitlandi', 'sure_ms'].map(esc).join(','),
      ...data.rows.map((r) =>
        [
          r.at,
          r.username,
          r.role,
          r.question ?? '',
          // Surum numarasi CSV'ye de girer: disa aktarilan kayit, dokuman
          // sonradan degistiginde de hangi metne dayandigini soylemeli.
          r.citations
            .map((c) => `${c.doc} :: ${c.section}${c.version ? ` :: s${c.version}` : ''}`)
            .join(' | '),
          r.answered ? 'evet' : 'hayir',
          r.durationMs,
        ]
          .map(esc)
          .join(','),
      ),
    ];

    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `denetim-kaydi-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <div className="eyebrow">
            {user.role === 'ik' || user.role === 'yonetici' ? '04 / Denetim' : '02 / Denetim'}
          </div>
          <h2 className="view-title">Denetim kaydı</h2>
        </div>

        <div className="view-actions">
          <span className="audit-scope">
            {data?.scope === 'tumu' ? 'tüm kullanıcılar' : 'yalnızca kendi kayıtlarınız'}
          </span>
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => load(filter.trim() || undefined)}
            disabled={loading}
          >
            {loading ? 'Yükleniyor…' : 'Yenile'}
          </button>
          <button type="button" className="btn" onClick={exportCsv} disabled={!data?.rows.length}>
            CSV indir
          </button>
        </div>
      </header>

      <div className="view-body">
        {/* Butunluk paneli yalnizca yoneticide; sunucu da 403 ile zorluyor. */}
        {user.role === 'yonetici' && <IntegrityPanel onReport={setIntegrity} />}

        {data && (
          <div className="stats">
            <Stat label="Toplam" value={data.summary.total} />
            <Stat
              label="Yanıtsız"
              value={data.summary.unanswered}
              tone={data.summary.unanswered > 0 ? 'warn' : undefined}
            />
            {user.role === 'yonetici' && <Stat label="Kullanıcı" value={data.summary.users} />}
          </div>
        )}

        {user.role === 'yonetici' && (
          <div className="audit-filter">
            <input
              className="input"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Kullanıcı adına göre süz"
              onKeyDown={(e) => {
                if (e.key === 'Enter') load(filter.trim() || undefined);
              }}
            />
            <button
              type="button"
              className="btn"
              onClick={() => load(filter.trim() || undefined)}
              disabled={loading}
            >
              Ara
            </button>
          </div>
        )}

        {error && (
          <p className="rule-note rule-note--danger" style={{ marginTop: 32 }}>
            {error}
          </p>
        )}

        {data && data.rows.length === 0 && (
          <p className="audit-empty">Henüz kayıt yok. Bir soru sorulduğunda burada görünecek.</p>
        )}

        {data && data.rows.length > 0 && (
          <div className="audit tbl">
            <div className="tbl-head">
              <span>Zaman</span>
              <span>Kullanıcı</span>
              <span>Rol</span>
              <span>Soru ve kaynak</span>
              <span className="tbl-right">Süre</span>
            </div>
            {data.rows.map((r) => (
              <Row key={r.id} row={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' }) {
  return (
    <div className={`stat${tone ? ` stat--${tone}` : ''}`}>
      <div className="stat-value">{value}</div>
      <div className="label stat-label">{label}</div>
    </div>
  );
}

/**
 * Denetim satırındaki alıntının dayandığı sürüm metni.
 *
 * DENETİMİN ASIL DEĞERİ BURADA. "01_izin.md · Madde 1" bugünkü dosyayı işaret
 * eder; doküman değiştiyse o yanıtın dayandığı metin artık orada değildir.
 * Sürüm kimliği ise değişmez bir arşiv satırına gider: o gün ne yazdığı
 * aynen okunur.
 */
function VersionPeek({ versionId, label }: { versionId: number; label: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    if (text || error) return;

    try {
      const res = await fetch(`/api/versions/${versionId}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setText(body.content as string);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <button type="button" className="audit-version" onClick={toggle} title="O günkü metni göster">
        {label}
      </button>
      {open && (
        <pre className="code audit-version-text">
          {error ? `Okunamadı: ${error}` : (text ?? 'yükleniyor…')}
        </pre>
      )}
    </>
  );
}

function Row({ row }: { row: AuditRow }) {
  const time = new Date(row.at);
  return (
    <div className={`audit-row${row.answered ? '' : ' audit-row--unanswered'}`}>
      <span className="audit-time">
        {time.toLocaleDateString('tr-TR')}
        <br />
        {time.toLocaleTimeString('tr-TR')}
      </span>

      <span className="audit-user">{row.username}</span>

      <span className={`chip${row.role === 'yonetici' ? ' chip--fill-accent' : row.role === 'ik' ? ' chip--accent' : ''}`}>
        {row.role}
      </span>

      <div>
        {row.question ? (
          <p className="audit-question">{row.question}</p>
        ) : (
          <p className="audit-question audit-question--hidden">
            soru metni saklanmadı (genel doküman)
          </p>
        )}

        {row.citations.length > 0 ? (
          <ul className="audit-cites">
            {row.citations.map((c, i) => (
              <li key={i}>
                <span>{c.doc}</span>
                <span className="audit-section">{c.section}</span>
                {c.versionId ? (
                  <VersionPeek versionId={c.versionId} label={`s${c.version ?? '?'}`} />
                ) : (
                  <span className="audit-noversion" title="Bu satır sürümleme öncesine ait">
                    sürümsüz
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="audit-nocite">
            {row.answered ? 'doküman erişimi yok' : 'ilgili doküman bulunamadı'}
          </p>
        )}
      </div>

      <span className="audit-duration">{(row.durationMs / 1000).toFixed(1)}s</span>
    </div>
  );
}
