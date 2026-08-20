import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { clearSessionId } from '../chatSession';
import type { AuthStatus, SessionUser } from '../types';

type Role = SessionUser['role'];

/**
 * Kayit ekraninda secilebilen roller.
 *
 * Aciklamalar sus degil: secilen rol AYNI ZAMANDA hangi dokumanlarin
 * gorulecegini belirler (identity.service > VISIBLE_LABELS). Kullanici neyi
 * sectigini bilmeden secmemeli.
 */
const ROLE_OPTIONS: { value: Role; label: string; hint: string }[] = [
  {
    value: 'calisan',
    label: 'Çalışan',
    hint: 'Yalnızca "genel" etiketli dokümanları sorgular.',
  },
  {
    value: 'ik',
    label: 'İK',
    hint: 'Genel + İK dokümanları; doküman yükleme ve sürüm yönetimi.',
  },
  {
    value: 'yonetici',
    label: 'Yönetici',
    hint: 'Tüm dokümanlar; denetim kaydı, bütünlük raporu ve erişim etiketleri.',
  },
];

/** Formun hangi ucla konustugu. */
const ENDPOINT: Record<'kurulum' | 'giris' | 'kayit', string> = {
  kurulum: '/api/auth/setup',
  giris: '/api/auth/login',
  kayit: '/api/auth/register',
};

/**
 * Giris kapisi.
 *
 * Dort durum var ve sirasi onemli:
 *   1) hic hesap yok        -> ilk kurulum (tek seferlik yonetici)
 *   2) hesap var, giris yok -> giris formu
 *   3) kullanici kayit ister-> kayit formu (rol secimiyle)
 *   4) giris yapilmis       -> uygulama
 *
 * Durum sunucudan sorulur (`/api/auth/status`), istemcide tahmin edilmez:
 * kurulumun tamamlanip tamamlanmadigini yalnizca sunucu bilir. Kurulum bekleyen
 * bir sistemde kayit formu HIC gosterilmez — ilk hesabin yonetici olmasi
 * gerekiyor, sunucu da bunu 409 ile zorluyor.
 */
export default function AuthGate({
  children,
}: {
  children: (user: SessionUser, onLogout: () => void) => ReactNode;
}) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Kurulum gerekmiyorken kullanicinin sectigi sekme. */
  const [tab, setTab] = useState<'giris' | 'kayit'>('giris');

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('calisan');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus((await res.json()) as AuthStatus);
    } catch (e) {
      setError(`Sunucuya ulaşılamıyor: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const submit = async (path: string, body: Record<string, string>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error ?? `HTTP ${res.status}`);
        return;
      }
      setPassword('');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    // Sekmedeki sohbet kimligi de dusurulur; sonraki kullanici oncekinin
    // oturum kimligini tasimasin.
    clearSessionId();
    setUsername('');
    setPassword('');
    setDisplayName('');
    setTab('giris');
    await refresh();
  };

  if (status?.authenticated && status.user) {
    return <>{children(status.user, logout)}</>;
  }

  const setup = status?.needsSetup ?? false;
  const mode = setup ? 'kurulum' : tab;
  const registering = mode === 'kayit';
  /** Gorunen ad yalnizca hesap ACARKEN sorulur. */
  const creating = mode !== 'giris';

  /** Sekme degisiminde onceki denemenin hatasi ekranda kalmasin. */
  const switchTab = (next: 'giris' | 'kayit') => {
    setTab(next);
    setError(null);
    setPassword('');
  };

  return (
    <div className="auth">
      <div className="auth-aside">
        <div>
          <div className="eyebrow">Yapay zeka tabanlı</div>
          <h1>İnsan Kaynakları Asistanı</h1>
        </div>
      </div>

      <div className="auth-main">
        {!status ? (
          <p className="auth-loading">{error ?? 'Yükleniyor…'}</p>
        ) : (
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy) return;
              submit(ENDPOINT[mode], {
                username,
                password,
                ...(creating ? { displayName } : {}),
                ...(registering ? { role } : {}),
              });
            }}
          >
            <div className="label">
              {setup ? 'İlk kurulum' : registering ? 'Kayıt ol' : 'Giriş'}
            </div>

            {setup ? (
              <h2>
                Bu ekran yalnızca <strong>bir kez</strong> görünür ve yönetici hesabını
                oluşturur.
              </h2>
            ) : registering ? (
              <h2>Yeni hesap oluşturun.</h2>
            ) : (
              <h2>Devam etmek için giriş yapın.</h2>
            )}

            {setup && (
              <p className="auth-hint">
                Sonraki hesaplar kayıt ekranından açılır veya yönetici tarafından
                eklenir.
              </p>
            )}

            <label className="field">
              <span className="label">Kullanıcı adı</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </label>

            {creating && (
              <label className="field">
                <span className="label">Görünen ad</span>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Ad Soyad"
                />
              </label>
            )}

            {registering && (
              <label className="field">
                <span className="label">Rol</span>
                <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  {ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="auth-role-hint">
                  {ROLE_OPTIONS.find((o) => o.value === role)?.hint}
                </span>
              </label>
            )}

            <label className="field">
              <span className="label">Parola</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={creating ? 'new-password' : 'current-password'}
                required
              />
            </label>

            {creating && <p className="auth-hint">Parola en az 8 karakter olmalıdır.</p>}

            {error && <p className="rule-note rule-note--danger">{error}</p>}

            <button type="submit" className="btn btn--solid" disabled={busy}>
              {busy
                ? 'Gönderiliyor…'
                : setup
                  ? 'Yönetici hesabını oluştur'
                  : registering
                    ? 'Kayıt ol'
                    : 'Giriş yap'}
            </button>

            {/* Kurulum bekleyen sistemde sekme YOK: ilk hesap yonetici olmali. */}
            {!setup && (
              <p className="auth-switch">
                {registering ? 'Zaten hesabınız var mı?' : 'Hesabınız yok mu?'}{' '}
                <button
                  type="button"
                  className="auth-switch-btn"
                  onClick={() => switchTab(registering ? 'giris' : 'kayit')}
                  disabled={busy}
                >
                  {registering ? 'Giriş yapın' : 'Kayıt olun'}
                </button>
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
