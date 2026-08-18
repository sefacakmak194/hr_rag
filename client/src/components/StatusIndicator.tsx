import type { HealthResponse } from '../types';

interface Props {
  health: HealthResponse | null;
  error: string | null;
}

export function StatusIndicator({ health, error }: Props) {
  if (error) {
    return (
      <div className="status status-down">
        <span className="dot" />
        API kapalı — <code>cd server &amp;&amp; npm start</code>
      </div>
    );
  }

  if (!health) {
    return (
      <div className="status status-pending">
        <span className="dot" />
        Durum kontrol ediliyor…
      </div>
    );
  }

  const { foundry, index } = health;
  const indexOk = index.indexedChunks > 0;
  const level = foundry.online && indexOk ? 'ok' : 'warn';

  return (
    <div className={`status status-${level}`}>
      <span className="dot" />
      <div className="status-items">
        <span className="pill pill-locked">Air-gapped</span>

        <span className={`pill ${indexOk ? 'pill-ok' : 'pill-warn'}`}>
          İndeks: {indexOk ? `${index.indexedChunks} parça` : 'boş — npm run ingest'}
        </span>

        <span
          className={`pill ${foundry.online ? 'pill-ok' : 'pill-warn'}`}
          title={foundry.online ? `${foundry.baseUrl} (${foundry.discovery})` : undefined}
        >
          Foundry Local: {foundry.online ? (foundry.activeModel ?? 'bağlı') : 'çevrimdışı'}
        </span>

        <span className="pill pill-muted" title={health.embeddingModel}>
          Embedding: yerel
        </span>
      </div>
    </div>
  );
}

export default StatusIndicator;
