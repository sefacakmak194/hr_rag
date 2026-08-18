/**
 * Kimlik dogrulama uclari: ilk kurulum, giris, cikis, oturum bilgisi.
 *
 * Tumu YERELDIR — parola dogrulamasi node:crypto scrypt ile surec icinde
 * yapilir, hicbir istek disari cikmaz.
 */
import { Router, type Request, type Response } from 'express';
import { getDb } from '../services/vectorStore.service.js';
import {
  authenticate,
  createUser,
  createSession,
  destroySession,
  needsSetup,
  countUsers,
  purgeExpiredSessions,
  ROLES,
  SESSION_HOURS,
  type Role,
} from '../services/identity.service.js';
import {
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  attachPrincipal,
} from '../middleware/session.js';

const router = Router();

// Suresi dolmus oturumlar acilista bir kez temizlenir.
try {
  purgeExpiredSessions(getDb());
} catch {
  // Veritabani henuz hazir degilse sorun degil; ilk istekte tekrar denenir.
}

/**
 * Kurulum durumu. Istemci acilista bunu sorar: hic hesap yoksa giris yerine
 * kurulum ekrani gosterilir.
 */
router.get('/auth/status', (req: Request, res: Response) => {
  res.json({
    needsSetup: needsSetup(getDb()),
    authenticated: Boolean(req.principal),
    user: req.principal
      ? { username: req.principal.username, role: req.principal.role }
      : null,
    sessionHours: SESSION_HOURS,
  });
});

/**
 * Ilk kurulum: tek seferlik yonetici hesabi.
 *
 * DIKKAT — bu uc yalnizca HIC KULLANICI YOKKEN calisir. Aksi halde herkesin
 * kendine yonetici hesabi acabilecegi bir arka kapi olurdu. Kontrol yazma
 * anininda yapiliyor, cunku iki istek ayni anda gelirse ikisi de "kullanici
 * yok" gorebilir.
 */
router.post('/auth/setup', (req: Request, res: Response) => {
  const db = getDb();

  if (countUsers(db) > 0) {
    res.status(409).json({ error: 'Kurulum zaten tamamlanmış. Giriş yapın.' });
    return;
  }

  const { username, displayName, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Kullanıcı adı ve parola gereklidir.' });
    return;
  }

  try {
    const user = createUser(db, {
      username,
      displayName: typeof displayName === 'string' ? displayName : username,
      password,
      role: 'yonetici',
    });
    const token = createSession(db, { userId: user.id, username: user.username, role: user.role });
    setSessionCookie(res, token, SESSION_HOURS);

    res.status(201).json({ username: user.username, role: user.role, displayName: user.displayName });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

/**
 * Giris.
 *
 * Basarisizlikta sebep AYIRT EDILMEZ ("kullanici yok" ile "parola yanlis" ayni
 * yaniti alir); aksi halde uc, gecerli kullanici adlarini sayma araci olur.
 */
router.post('/auth/login', (req: Request, res: Response) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Kullanıcı adı ve parola gereklidir.' });
    return;
  }

  const db = getDb();
  const principal = authenticate(db, username, password);
  if (!principal) {
    res.status(401).json({ error: 'Kullanıcı adı veya parola hatalı.' });
    return;
  }

  const token = createSession(db, principal);
  setSessionCookie(res, token, SESSION_HOURS);
  res.json({ username: principal.username, role: principal.role });
});

router.post('/auth/logout', (req: Request, res: Response) => {
  destroySession(getDb(), req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

/** Yeni hesap — yalnizca yonetici. */
router.post('/auth/users', requireAuth, (req: Request, res: Response) => {
  if (req.principal?.role !== 'yonetici') {
    res.status(403).json({ error: 'Hesap oluşturmak için yönetici yetkisi gerekiyor.' });
    return;
  }

  const { username, displayName, password, role } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Kullanıcı adı ve parola gereklidir.' });
    return;
  }
  if (!ROLES.includes(role as Role)) {
    res.status(400).json({ error: `Rol şunlardan biri olmalı: ${ROLES.join(', ')}` });
    return;
  }

  try {
    const user = createUser(getDb(), {
      username,
      displayName: typeof displayName === 'string' ? displayName : username,
      password,
      role: role as Role,
    });
    res.status(201).json({ username: user.username, role: user.role, displayName: user.displayName });
  } catch (error) {
    const message = (error as Error).message;
    // UNIQUE kisiti: kullanici adi zaten var.
    res.status(message.includes('UNIQUE') ? 409 : 400).json({
      error: message.includes('UNIQUE') ? 'Bu kullanıcı adı zaten kayıtlı.' : message,
    });
  }
});

export { attachPrincipal };
export default router;
