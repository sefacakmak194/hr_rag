import { useState } from 'react';
import ChatWindow from './components/ChatWindow';
import DocumentManager from './components/DocumentManager';
import AuthGate from './components/AuthGate';
import AuditPanel from './components/AuditPanel';
import PolicyGapPanel from './components/PolicyGapPanel';
import Sidebar, { type ViewKey } from './components/Sidebar';
import { SideStatsContext, type SideStat } from './sideStats';
import type { SessionUser } from './types';

export default function App() {
  const [view, setView] = useState<ViewKey>('sohbet');
  // Kenar cubugunun alt bolumu: acik ekran ne olcuyorsa onu yazar. Sohbet
  // ekrani bilerek bos birakir — orada okunacak bir olcu yok.
  const [sideStats, setSideStats] = useState<SideStat[]>([]);

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

              {active === 'sohbet' && <ChatWindow />}
              {active === 'korpus' && <DocumentManager user={user} />}
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
