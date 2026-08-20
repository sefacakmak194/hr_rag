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
import { listAudit, auditSummary } from '../services/audit.service.js';
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

/**
 * Hesap olusturma govdesini dogrular.
 *
 * Iki uc paylasiyor (`/auth/register` ve `/auth/users`); kural tek yerde
 * dursun ki biri sikilastirilirken digeri geride kalmasin.
 */
function readAccountInput(
  body: unknown,
): { username: string; displayName: string; password: string; role: Role } | string {
  const { username, displayName, password, role } = (body ?? {}) as Record<string, unknown>;

  if (typeof username !== 'string' || typeof password !== 'string') {
    return 'Kullanıcı adı ve parola gereklidir.';
  }
  if (!ROLES.includes(role as Role)) {
    return `Rol şunlardan biri olmalı: ${ROLES.join(', ')}`;
  }

  return {
    username,
    displayName: typeof displayName === 'string' ? displayName : username,
    password,
    role: role as Role,
  };
}

/** createUser hatasini HTTP yanitina cevirir. UNIQUE kisiti = kullanici adi dolu. */
function sendAccountError(res: Response, error: unknown): void {
  const message = (error as Error).message;
  const duplicate = message.includes('UNIQUE');
  res.status(duplicate ? 409 : 400).json({
    error: duplicate ? 'Bu kullanıcı adı zaten kayıtlı.' : message,
  });
}

/**
 * Kendi kendine kayit — giris ekranindaki "Kayit ol".
 *
 * ROL KULLANICI TARAFINDAN SECILIR. Bu bilincli bir urun karari ve guvenlik
 * acisindan `/auth/users`ten ZAYIFTIR: rolu secen kisi, o rolun gordugu
 * dokumanlari da secmis olur (bkz. VISIBLE_LABELS). Yani kayit ekrani, erisim
 * etiketi sistemini kendi kendine beyana dayali hale getirir. Kurumsal bir
 * kurulumda dogru olan, kaydin yonetici onayindan gecmesidir; bu uc, hesap
 * acmanin yoneticiye bagimli olmadigi kurulumlar icindir.
 *
 * ILK HESAP BURADAN ACILAMAZ: `needsSetup` dogruyken istek reddedilir. Aksi
 * halde sistemin ilk kullanicisi kendini `calisan` yapabilir, hic yonetici
 * olusmaz ve dokuman yonetimi ile denetim ekranlari kalici olarak kapali
 * kalirdi — geri donusu elle SQL gerektiren bir durum.
 */
router.post('/auth/register', (req: Request, res: Response) => {
  const db = getDb();

  if (needsSetup(db)) {
    res.status(409).json({ error: 'Önce ilk kurulumu tamamlayın: ilk hesap yönetici olmalıdır.' });
    return;
  }

  const input = readAccountInput(req.body);
  if (typeof input === 'string') {
    res.status(400).json({ error: input });
    return;
  }

  try {
    const user = createUser(db, input);
    // Kayit biter bitmez oturum acilir: kullanici az once verdigi parolayi
    // hemen tekrar yazmak zorunda kalmasin.
    const token = createSession(db, { userId: user.id, username: user.username, role: user.role });
    setSessionCookie(res, token, SESSION_HOURS);

    res.status(201).json({ username: user.username, role: user.role, displayName: user.displayName });
  } catch (error) {
    sendAccountError(res, error);
  }
});

/** Yeni hesap — yalnizca yonetici. Rolu ATAYAN taraf burada yoneticidir. */
router.post('/auth/users', requireAuth, (req: Request, res: Response) => {
  if (req.principal?.role !== 'yonetici') {
    res.status(403).json({ error: 'Hesap oluşturmak için yönetici yetkisi gerekiyor.' });
    return;
  }

  const input = readAccountInput(req.body);
  if (typeof input === 'string') {
    res.status(400).json({ error: input });
    return;
  }

  try {
    const user = createUser(getDb(), input);
    res.status(201).json({ username: user.username, role: user.role, displayName: user.displayName });
  } catch (error) {
    sendAccountError(res, error);
  }
});

/**
 * Denetim kaydi.
 *
 * Gorunurluk kurali servis icinde uygulanir (yonetici tumunu, diger roller
 * kendi satirlarini): uc bunu atlayamasin diye.
 */
router.get('/audit', requireAuth, (req: Request, res: Response) => {
  const principal = req.principal as NonNullable<Request['principal']>;
  const limit = Number(req.query.limit ?? 100);
  const username = typeof req.query.username === 'string' ? req.query.username : undefined;

  res.json({
    summary: auditSummary(principal),
    scope: principal.role === 'yonetici' ? 'tumu' : 'kendi',
    rows: listAudit(principal, { limit: Number.isFinite(limit) ? limit : 100, username }),
  });
});

export { attachPrincipal };
export default router;
