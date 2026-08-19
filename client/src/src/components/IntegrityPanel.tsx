import { useCallback, useEffect, useState } from 'react';
import type { ArchiveFile, IntegrityResponse, VerifyResponse } from '../types';

/**
 * Denetim kaydinin butunlugu.
 *
 * Iki ayri sey gosterilir:
 *   1. Hash zinciri butun mu (yerel kontrol — satirlar birbirine bagli mi)
 *   2. Imzali arsiv (disari cikarilabilir kanit — asil koruma bu)
 *
 * Ikisini ayirmak onemli: zincirin butun olmasi "kimse dokunmadi" demez,
 * "dokunulduysa gorunur" der. Arsivi bu makineden CIKARMAK, geriye donuk
 * degistirmeyi imkansiz kilan tek adimdir.
 */
export default function IntegrityPanel() {
  const [data, setData] = useState<IntegrityResponse | null>(null);
  const [archives, setArchives] = useState<ArchiveFile[]>([]);
  const [verify, setVerify] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);

  const load = useCallback(async () => {
    try {
      const [i, a] = await Promise.all([
        fetch('/api/audit/integrity'),
        fetch('/api/audit/archives'),
      ]);
      if (!i.ok) throw new Error(`HTTP ${i.status}`);
      setData((await i.json()) as IntegrityResponse);
      if (a.ok) setArchives(((await a.json()).archives ?? []) as ArchiveFile[]);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createArchive() {
    setBusy(true);
    setVerify(null);
    try {
      const res = await fetch('/api/audit/archive', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function verifyArchive(file: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/audit/archives/${encodeURIComponent(file)}/verify`, {
        method: 'POST',
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setVerify(body as VerifyResponse);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  if (!data) {
    return (
      <div className="integrity">
        <div className="integrity-head" style={{ cursor: 'default' }}>
          <span className="integrity-dot" />
          <span className="integrity-title">Bütünlük</span>
          <span className="integrity-sub">{error ?? 'kontrol ediliyor…'}</span>
        </div>
      </div>
    );
  }

  const ok = data.intact;

  return (
    <div className={`integrity${ok ? '' : ' integrity--broken'}`}>
      <button type="button" className="integrity-head" onClick={() => setOpen((v) => !v)}>
        <span className={`integrity-dot integrity-dot--${ok ? 'ok' : 'bad'}`} />
        <span className="integrity-title">{ok ? 'Zincir bütün' : 'Zincir kırılmış'}</span>
        <span className="integrity-sub">
          {data.chained} satır imzalı zincirde
          {data.unchained > 0 ? ` · ${data.unchained} satır zincir öncesi` : ''}
          {data.firstBrokenId ? ` · ilk kırık satır #${data.firstBrokenId}` : ''}
        </span>
        <span className="integrity-caret">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="integrity-body">
          <div>
            <dl className="integrity-facts">
              <dt>Zincir başı</dt>
              <dd>{data.headHash ?? '—'}</dd>
              <dt>Açık anahtar</dt>
              <dd>{data.publicKeyFingerprint ?? '—'}</dd>
              <dt>Son arşiv</dt>
              <dd>
                {data.lastArchive
                  ? `${data.lastArchive.file} (${data.lastArchive.throughId}. satıra kadar)`
                  : 'henüz üretilmedi'}
              </dd>
              <dt>Arşiv dizini</dt>
              <dd>
                <code>{data.archiveDir ?? 'data/denetim-arsivleri'}</code>
              </dd>
            </dl>

            <div className="integrity-actions">
              <button type="button" className="btn btn--solid" onClick={createArchive} disabled={busy}>
                İmzalı arşiv üret
              </button>
              <button type="button" className="btn" onClick={load} disabled={busy}>
                Yeniden denetle
              </button>
            </div>

            {verify && (
              <div className={`integrity-verify${verify.valid ? '' : ' integrity-verify--bad'}`}>
                <strong>{verify.valid ? 'Arşiv geçerli' : 'Arşiv doğrulanamadı'}</strong>
                <span>
                  imza {verify.signatureValid ? '✓' : '✗'} · zincir {verify.chainValid ? '✓' : '✗'}
                  {verify.rows !== undefined ? ` · ${verify.rows} satır` : ''}
                  {verify.versions !== undefined ? ` · ${verify.versions} sürüm` : ''}
                </span>
              </div>
            )}

            {error && <p className="integrity-error">{error}</p>}
          </div>

          <div>
            {data.unchained > 0 && (
              <p className="rule-note rule-note--warn">
                <strong>{data.unchained} satır</strong> hash zinciri eklenmeden önce yazıldı ve
                doğrulanamıyor. Özetleri geriye dönük hesaplanmadı: zaten değiştirilmiş
                olabilecek veri üzerinden hash üretmek, doğrulanmamış şeye “doğrulandı” demek
                olurdu.
              </p>
            )}

            {!ok && (
              <p className="rule-note rule-note--danger">
                Zincir kırıldı: bir satır silinmiş ya da değiştirilmiş. Son geçerli imzalı
                arşivle karşılaştırın.
              </p>
            )}

            <p className="rule-note" style={{ marginTop: 24 }}>
              Arşiv üretmek tek başına yetmez —{' '}
              <strong>asıl koruma arşivi bu makineden çıkarmaktır.</strong> Dışarı çıkmış bir
              arşiv geriye dönük değiştirilemez. Doğrulama da başka bir makinede yapılmalı:
            </p>
            <code className="integrity-code code">
              npm run verify-archive -- &lt;arşiv.json&gt; &lt;açık-anahtar.pem&gt;
            </code>

            {archives.length > 0 && (
              <div style={{ marginTop: 28 }}>
                <div className="label">Arşivler</div>
                <ul className="integrity-archives">
                  {archives.map((a) => (
                    <li key={a.file}>
                      <button
                        type="button"
                        onClick={() => verifyArchive(a.file)}
                        disabled={busy}
                        title="Bu arşivi doğrula"
                      >
                        {a.file}
                      </button>
                      <span>
                        {a.rows} satır · {(a.bytes / 1024).toFixed(0)} KB
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
