import { useCallback, useEffect, useState } from 'react';
import ChatWindow from './components/ChatWindow';
import DocumentManager from './components/DocumentManager';
import AuthGate from './components/AuthGate';
import AuditPanel from './components/AuditPanel';
import PolicyGapPanel from './components/PolicyGapPanel';
import Sidebar, { type ViewKey } from './components/Sidebar';
import { SideStatsContext, type SideStat } from './sideStats';
import type { HealthResponse, SessionUser } from './types';

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewKey>('sohbet');
  // Kenar cubugunun alt bolumu: acik ekran ne olcuyorsa onu yazar.
  const [sideStats, setSideStats] = useState<SideStat[]>([]);

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
      {(user, onLogout) => {
        const items = views(user);
        // Rol degisirse (cikis/giris) gecerli olmayan ekranda kalinmasin.
        const active = items.some((i) => i.key === view) ? view : 'sohbet';

        return (
          <SideStatsContext.Provider value={setSideStats}>
            <div className="shell">
              <Sidebar
                view={active}
                onView={setView}
                items={items}
                user={user}
                onLogout={onLogout}
                stats={sideStats}
              />

              {active === 'sohbet' && (
                <ChatWindow health={health} healthError={error} onActivity={refresh} />
              )}
              {active === 'korpus' && <DocumentManager user={user} onChanged={refresh} />}
              {active === 'bosluklar' && <PolicyGapPanel />}
              {active === 'denetim' && <AuditPanel user={user} />}
            </div>
          </SideStatsContext.Provider>
        );
      }}
    </AuthGate>
  );
}

/**
 * Gezinme, role gore kisalir.
 *
 * Sunucu zaten 403 donuyor; bu yalnizca kullaniciya calismayacak bir ekran
 * gostermemek icin. Guvenlik istemciye BIRAKILMIYOR.
 */
function views(user: SessionUser): { key: ViewKey; label: string }[] {
  const manage = user.role === 'ik' || user.role === 'yonetici';
  return [
    { key: 'sohbet', label: 'Sohbet' },
    ...(manage
      ? ([
          { key: 'korpus', label: 'Kaynaklar' },
          { key: 'bosluklar', label: 'Cevaplanamayanlar' },
        ] as const)
      : []),
    { key: 'denetim', label: 'Denetim' },
  ];
}
