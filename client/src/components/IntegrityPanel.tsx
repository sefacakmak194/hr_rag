import { useCallback, useEffect, useState } from 'react';
import type { ArchiveItem, ArchiveVerification, IntegrityReport } from '../types';

/**
 * Denetim bütünlüğü paneli (Sprint 3a).
 *
 * Yalnızca yöneticiye gösterilir; sunucu da öyle zorluyor.
 *
 * Bu panelin işi kullanıcıya iki şeyi aynı anda söylemek: kaydın **şu an**
 * bütün olduğunu, ve bunun **neye kadar** kanıtlanabilir olduğunu. İkincisi
 * gizlenirse panel yanlış bir güven duygusu üretir — arşivi dışarı çıkarmayan
 * bir kurulumda "her şey yolunda" yazısı çok az şey ifade eder.
 */

const fmtBytes = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);

const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('tr-TR')} ${d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`;
};

export default function IntegrityPanel() {
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [archives, setArchives] = useState<ArchiveItem[]>([]);
  const [verified, setVerified] = useState<ArchiveVerification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, a] = await Promise.all([
        fetch('/api/audit/integrity'),
        fetch('/api/audit/archives'),
      ]);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setReport((await r.json()) as IntegrityReport);
      if (a.ok) setArchives(((await a.json()) as { arsivler: ArchiveItem[] }).arsivler);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function archive() {
    setBusy(true);
    setVerified(null);
    try {
      const res = await fetch('/api/audit/archive', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setError(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function verify(dosya: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/audit/archives/${encodeURIComponent(dosya)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setVerified(body as ArchiveVerification);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  if (!report) {
    return <div className="integrity">{error ? <p className="integrity-error">{error}</p> : null}</div>;
  }

  return (
    <div className={`integrity${report.ok ? '' : ' integrity-broken'}`}>
      <button type="button" className="integrity-head" onClick={() => setOpen((v) => !v)}>
        <span className={`integrity-dot${report.ok ? ' integrity-dot-ok' : ' integrity-dot-bad'}`} />
        <span className="integrity-title">
          {report.ok ? 'Zincir bütün' : 'ZİNCİR KIRIK'}
        </span>
        <span className="integrity-sub">
          {report.chained} satır imzalı zincirde
          {report.preChain > 0 && ` · ${report.preChain} satır zincir öncesi`}
        </span>
        <span className="integrity-caret">{open ? '−' : '+'}</span>
      </button>

      {!report.ok && report.reason && <p className="integrity-alarm">{report.reason}</p>}

      {open && (
        <div className="integrity-body">
          {report.preChain > 0 && (
            <p className="integrity-note">
              <strong>{report.preChain} satır</strong> hash zinciri eklenmeden önce yazıldı ve
              doğrulanamıyor. Özetleri geriye dönük hesaplanmadı: zaten değiştirilmiş olabilecek
              veri üzerinden hash üretmek, doğrulanmamış şeye “doğrulandı” demek olurdu.
            </p>
          )}

          <dl className="integrity-facts">
            <dt>Zincir başı</dt>
            <dd className="mono">{report.chainHead.slice(0, 24)}…</dd>
            <dt>Açık anahtar</dt>
            <dd className="mono">{report.acikAnahtarParmakIzi}</dd>
            <dt>Son arşiv</dt>
            <dd>
              {report.sonArsiv
                ? `${report.sonArsiv.dosya} (${report.sonArsiv.sonSatir}. satıra kadar)`
                : 'henüz yok'}
            </dd>
          </dl>

          <div className="integrity-actions">
            <button onClick={archive} disabled={busy}>
              {busy ? 'İşleniyor…' : 'İmzalı arşiv üret'}
            </button>
            <button onClick={load} disabled={busy}>
              Yeniden denetle
            </button>
          </div>

          {/* Bu uyari gizlenemez: panelin dogru anlasilmasi buna bagli. */}
          <p className="integrity-warn">
            Arşiv üretmek tek başına yetmez — <strong>asıl koruma arşivi bu makineden
            çıkarmaktır.</strong> Dışarı çıkmış bir arşiv geriye dönük değiştirilemez. Doğrulama
            da başka bir makinede yapılmalı:
            <code>npm run verify-archive -- &lt;arşiv.json&gt; &lt;açık-anahtar.pem&gt;</code>
          </p>

          {archives.length > 0 && (
            <ul className="integrity-archives">
              {archives.map((a) => (
                <li key={a.dosya}>
                  <button type="button" onClick={() => verify(a.dosya)} disabled={busy}>
                    {a.dosya}
                  </button>
                  <span>
                    {fmtDateTime(a.olusturuldu)} · {a.satirSayisi} satır · {fmtBytes(a.bayt)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {verified && (
            <div className={`integrity-verify${verified.ok ? ' ok' : ' bad'}`}>
              <strong>{verified.ok ? 'Arşiv geçerli' : 'Arşiv doğrulanamadı'}</strong>
              <span>
                imza {verified.imzaGecerli ? '✓' : '✗'} · zincir {verified.zincirGecerli ? '✓' : '✗'} ·{' '}
                {verified.satirSayisi} satır · {verified.surumSayisi} sürüm
              </span>
              {verified.sorunlar.map((s, i) => (
                <span key={i} className="integrity-issue">
                  {s}
                </span>
              ))}
            </div>
          )}

          <p className="integrity-path">Arşiv dizini: <code>{report.arsivDizini}</code></p>
        </div>
      )}

      {error && <p className="integrity-error">{error}</p>}
    </div>
  );
}
