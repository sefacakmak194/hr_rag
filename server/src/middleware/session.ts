/**
 * Oturum ara katmani.
 *
 * Her istekte cerezden oturum jetonunu okur ve `req.principal` olarak kimligi
 * takar. Kimlik yoksa istek REDDEDILMEZ — reddetme karari `requireAuth` ve
 * `requireDocumentManager` korumalarinda, yani ucun kendisinde verilir.
 *
 * Cerez okuma elle yapiliyor: `cookie-parser` tek is icin bir bagimlilik daha
 * demek olurdu ve bu projede her bagimlilik air-gapped paketleme yukudur.
 */
import type { NextFunction, Request, Response } from 'express';
import { getDb } from '../services/vectorStore.service.js';
import {
  resolveSession,
  canManageDocuments,
  type Principal,
} from '../services/identity.service.js';

export const SESSION_COOKIE = 'hr_session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
      sessionToken?: string;
    }
  }
}

/**
 * Cookie basligindan tek bir cerezi okur.
 *
 * Deger `decodeURIComponent` ile cozulur; jetonlarimiz hex oldugu icin
 * gerekli degil, ama baskasi baska bir cerez eklerse dogru davransin.
 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

/**
 * Oturum cerezini yazar.
 *
 * HttpOnly: JavaScript okuyamaz, XSS ile jeton calinamaz.
 * SameSite=Strict: baska sitenin tetikledigi istekte cerez gonderilmez.
 * Secure YOK: uygulama http://localhost uzerinde calisiyor; Secure eklenirse
 * cerez hic yazilmaz ve giris sessizce basarisiz olur.
 */
export function setSessionCookie(res: Response, token: string, maxAgeHours: number): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeHours * 3600}`,
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

/** Kimligi cozup istege takar. Kimlik yoksa da akis devam eder. */
export function attachPrincipal(req: Request, _res: Response, next: NextFunction): void {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE);
  req.sessionToken = token;
  req.principal = resolveSession(getDb(), token) ?? undefined;
  next();
}

/** Giris yapilmamis istekleri reddeder. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.principal) {
    res.status(401).json({ error: 'Bu işlem için giriş yapmanız gerekiyor.' });
    return;
  }
  next();
}

/**
 * Dokuman yonetimi yetkisi ister (ik veya yonetici).
 *
 * Karar: `calisan` rolu yukleme, silme ve yeniden indeksleme uclarina
 * erisemez. Bugun bu uclar herkese acikti.
 */
export function requireDocumentManager(req: Request, res: Response, next: NextFunction): void {
  if (!req.principal) {
    res.status(401).json({ error: 'Bu işlem için giriş yapmanız gerekiyor.' });
    return;
  }
  if (!canManageDocuments(req.principal.role)) {
    res.status(403).json({ error: 'Doküman yönetimi için İK veya yönetici yetkisi gerekiyor.' });
    return;
  }
  next();
}
