import { useCallback, useEffect, useState } from 'react';
import ChatWindow from './components/ChatWindow';
import StatusIndicator from './components/StatusIndicator';
import DocumentManager from './components/DocumentManager';
import type { HealthResponse } from './types';

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDocs, setShowDocs] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHealth((await res.json()) as HealthResponse);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setHealth(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="app">
      <header>
        <div className="brand">
          <h1>Kurumsal İK &amp; Mevzuat Asistanı</h1>
          <p>%100 yerel · sıfır veri sızıntısı · kaynak gösterimli</p>
        </div>
        <div className="header-right">
          <StatusIndicator health={health} error={error} />
          <button
            className={`docs-toggle${showDocs ? ' docs-toggle-on' : ''}`}
            onClick={() => setShowDocs((v) => !v)}
            title="Korpus dokümanlarını yönet"
          >
            Korpus
          </button>
        </div>
      </header>

      <main className={showDocs ? 'with-docs' : undefined}>
        <ChatWindow onActivity={refresh} />
        {showDocs && <DocumentManager onChanged={refresh} />}
      </main>

      <footer>
        Microsoft Foundry Local · yerel vektör indeksi · KVKK / GDPR uyumlu air-gapped çalışma
      </footer>
    </div>
  );
}
