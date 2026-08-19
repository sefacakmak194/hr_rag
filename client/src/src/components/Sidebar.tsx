import type { HealthResponse, SessionUser } from '../types';
import { ThemeToggle, type Theme } from '../theme';
import StatusIndicator from './StatusIndicator';

export type ViewKey = 'sohbet' | 'korpus' | 'bosluklar' | 'denetim';

const ROLE_LABEL: Record<SessionUser['role'], string> = {
  calisan: 'Çalışan',
  ik: 'İK',
  yonetici: 'Yönetici',
};

/**
 * Kalici kenar cubugu.
 *
 * Panel ac/kapa dugmeleri yerine tek bir gezinme var: her ekran tam genislik
 * kullanir. Durum bilgisi ust baslikta rozet olarak degil, burada okunabilir
 * satirlar halinde durur — sorulacak soru "sistem hazir mi", cevabi bir
 * yerde sabit durmali.
 */
export default function Sidebar({
  view,
  onView,
  items,
  user,
  onLogout,
  health,
  error,
  theme,
  onTheme,
}: {
  view: ViewKey;
  onView: (v: ViewKey) => void;
  items: { key: ViewKey; label: string }[];
  user: SessionUser;
  onLogout: () => void;
  health: HealthResponse | null;
  error: string | null;
  theme: Theme;
  onTheme: (t: Theme) => void;
}) {
  return (
    <aside className="side">
      <div className="side-brand">
        <div className="eyebrow">Kurumsal</div>
        <div className="side-brand-name">
          İK &amp; Mevzuat
          <br />
          Asistanı
        </div>
      </div>

      <nav className="side-nav">
        {items.map((item, i) => (
          <button
            key={item.key}
            type="button"
            className={`side-link${view === item.key ? ' side-link--on' : ''}`}
            onClick={() => onView(item.key)}
          >
            <span className="side-link-no">{String(i + 1).padStart(2, '0')}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="side-foot">
        <StatusIndicator health={health} error={error} />

        <div className="side-user">
          <div>
            <div className="side-user-name">{user.username}</div>
            <div className="side-user-role">{ROLE_LABEL[user.role]}</div>
          </div>
          <button type="button" className="btn btn--quiet btn--sm" onClick={onLogout}>
            Çıkış
          </button>
        </div>

        <ThemeToggle theme={theme} onChange={onTheme} />
      </div>
    </aside>
  );
}
