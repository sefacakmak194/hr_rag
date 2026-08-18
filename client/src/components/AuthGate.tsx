import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AuthStatus, SessionUser } from '../types';

/**
 * Giris kapisi.
 *
 * Uc durum var ve sirasi onemli:
 *   1) hic hesap yok      -> ilk kurulum (tek seferlik yonetici)
 *   2) hesap var, giris yok -> giris formu
 *   3) giris yapilmis     -> uygulama
 *
 * Durum sunucudan sorulur (`/api/auth/status`), istemcide tahmin edilmez:
 * kurulumun tamamlanip tamamlanmadigini yalnizca sunucu bilir.
 */
export default function AuthGate({
  children,
}: {
  children: (user: SessionUser, onLogout: () => void) => ReactNode;
}) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');

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

  const submit = async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, displayName, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
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
    setUsername('');
    setPassword('');
    await refresh();
  };

  if (!status) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <p className="auth-loading">{error ?? 'Yükleniyor…'}</p>
        </div>
      </div>
    );
  }

  if (status.authenticated && status.user) {
    return <>{children(status.user, logout)}</>;
  }

  const setup = status.needsSetup;

  return (
    <div className="auth-screen">
      <form
        className="auth-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) submit(setup ? '/api/auth/setup' : '/api/auth/login');
        }}
      >
        <h1>Kurumsal İK &amp; Mevzuat Asistanı</h1>

        {setup ? (
          <p className="auth-lead">
            İlk kurulum. Bu ekran yalnızca <strong>bir kez</strong> görünür ve
            yönetici hesabını oluşturur. Sonraki hesaplar yönetici panelinden eklenir.
          </p>
        ) : (
          <p className="auth-lead">Devam etmek için giriş yapın.</p>
        )}

        <label>
          Kullanıcı adı
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>

        {setup && (
          <label>
            Görünen ad
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Ad Soyad"
            />
          </label>
        )}

        <label>
          Parola
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={setup ? 'new-password' : 'current-password'}
            required
          />
        </label>

        {setup && <p className="auth-hint">Parola en az 8 karakter olmalıdır.</p>}

        {error && <p className="auth-error">{error}</p>}

        <button type="submit" disabled={busy}>
          {busy ? 'Gönderiliyor…' : setup ? 'Yönetici hesabını oluştur' : 'Giriş yap'}
        </button>

        <p className="auth-foot">
          Kimlik doğrulaması bu makinede yapılır. Parolanız hiçbir yere gönderilmez.
        </p>
      </form>
    </div>
  );
}
