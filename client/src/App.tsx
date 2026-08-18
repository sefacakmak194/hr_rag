import { useCallback, useEffect, useState } from 'react';
import ChatWindow from './components/ChatWindow';
import StatusIndicator from './components/StatusIndicator';
import DocumentManager from './components/DocumentManager';
import AuthGate from './components/AuthGate';
import type { HealthResponse, SessionUser } from './types';

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
    <AuthGate>
      {(user, onLogout) => (
    <div className="app">
      <header>
        <div className="brand">
          <h1>Kurumsal İK &amp; Mevzuat Asistanı</h1>
          <p>%100 yerel · sıfır veri sızıntısı · kaynak gösterimli</p>
        </div>
        <div className="header-right">
          <StatusIndicator health={health} error={error} />
          {canManage(user) && (
            <button
              className={`docs-toggle${showDocs ? ' docs-toggle-on' : ''}`}
              onClick={() => setShowDocs((v) => !v)}
              title="Korpus dokümanlarını yönet"
            >
              Korpus
            </button>
          )}
          <div className="user-chip" title={`Rol: ${ROLE_LABEL[user.role]}`}>
            <span className="user-name">{user.username}</span>
            <span className={`user-role user-role-${user.role}`}>{ROLE_LABEL[user.role]}</span>
            <button className="logout" onClick={onLogout} title="Oturumu kapat">
              Çıkış
            </button>
          </div>
        </div>
      </header>

      <main className={showDocs ? 'with-docs' : undefined}>
        <ChatWindow onActivity={refresh} />
        {showDocs && canManage(user) && <DocumentManager onChanged={refresh} />}
      </main>

      <footer>
        Microsoft Foundry Local · yerel vektör indeksi · KVKK / GDPR uyumlu air-gapped çalışma
      </footer>
    </div>
      )}
    </AuthGate>
  );
}

const ROLE_LABEL: Record<SessionUser['role'], string> = {
  calisan: 'Çalışan',
  ik: 'İK',
  yonetici: 'Yönetici',
};

/**
 * Korpus panelini yalnizca yetkili roller gorur.
 *
 * Sunucu zaten 403 donuyor; bu yalnizca kullaniciya calismayacak bir dugme
 * gostermemek icin. Guvenlik istemciye BIRAKILMIYOR.
 */
function canManage(user: SessionUser): boolean {
  return user.role === 'ik' || user.role === 'yonetici';
}
