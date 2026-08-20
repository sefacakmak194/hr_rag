import type { SessionUser } from '../types';
import type { SideStat } from '../sideStats';

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
 * kullanir. Altta duran olcu satirlari sabit degil, ACIK EKRANIN olcusu —
 * hangi ekranda olursa olsun sorulacak soru "burada durum ne", cevabi ayni
 * yerde durmali.
 */
export default function Sidebar({
  view,
  onView,
  items,
  user,
  onLogout,
  stats,
}: {
  view: ViewKey;
  onView: (v: ViewKey) => void;
  items: { key: ViewKey; label: string }[];
  user: SessionUser;
  onLogout: () => void;
  stats: SideStat[];
}) {
  return (
    <aside className="side">
      <div className="side-brand">
        <div className="side-brand-name">İnsan Kaynakları Asistanı</div>
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
        {stats.map((s) => (
          <div className="side-row" key={s.k}>
            <span className="side-row-k">{s.k}</span>
            <span className={`side-row-v${s.tone ? ` side-row-v--${s.tone}` : ''}`}>{s.v}</span>
          </div>
        ))}

        <div className="side-user">
          <div>
            <div className="side-user-name">{user.username}</div>
            <div className="side-user-role">{ROLE_LABEL[user.role]}</div>
          </div>
          <button type="button" className="btn btn--quiet btn--sm" onClick={onLogout}>
            Çıkış
          </button>
        </div>
      </div>
    </aside>
  );
}
