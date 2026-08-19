import type { HealthResponse } from '../types';

interface Props {
  health: HealthResponse | null;
  error: string | null;
}

/**
 * Sistem durumu — kenar cubugunun alt bolumunde okunabilir satirlar.
 *
 * Rozet yerine etiket/deger cifti: "air-gapped: aktif" bir durum bildirimi
 * degil, dogrulanabilir bir olcum gibi okunmali.
 */
export function StatusIndicator({ health, error }: Props) {
  if (error) {
    return (
      <dl className="side-status">
        <div className="side-row">
          <dt>api</dt>
          <dd className="side-row-v side-row-v--down">kapalı</dd>
        </div>
        <div className="side-row">
          <dt>çözüm</dt>
          <dd className="side-row-v">cd server &amp;&amp; npm start</dd>
        </div>
      </dl>
    );
  }

  if (!health) {
    return (
      <dl className="side-status">
        <div className="side-row">
          <dt>durum</dt>
          <dd className="side-row-v">kontrol ediliyor…</dd>
        </div>
      </dl>
    );
  }

  const { foundry, index } = health;
  const indexOk = index.indexedChunks > 0;

  return (
    <dl className="side-status">
      <div className="side-row">
        <dt>air-gapped</dt>
        <dd className={`side-row-v${health.airGapped ? ' side-row-v--ok' : ' side-row-v--warn'}`}>
          {health.airGapped ? 'aktif' : 'kapalı'}
        </dd>
      </div>

      <div className="side-row">
        <dt>indeks</dt>
        <dd className={`side-row-v${indexOk ? '' : ' side-row-v--warn'}`}>
          {indexOk ? `${index.indexedChunks} parça` : 'boş — npm run ingest'}
        </dd>
      </div>

      <div className="side-row" title={foundry.online ? `${foundry.baseUrl} (${foundry.discovery})` : undefined}>
        <dt>foundry</dt>
        <dd className={`side-row-v${foundry.online ? ' side-row-v--ok' : ' side-row-v--warn'}`}>
          {foundry.online ? (foundry.activeModel ?? 'bağlı') : 'çevrimdışı'}
        </dd>
      </div>

      <div className="side-row" title={health.embeddingModel}>
        <dt>embedding</dt>
        <dd className="side-row-v">yerel</dd>
      </div>
    </dl>
  );
}

export default StatusIndicator;
