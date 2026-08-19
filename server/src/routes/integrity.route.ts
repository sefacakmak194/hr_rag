/**
 * Denetim bütünlüğü uçları (Sprint 3a).
 *
 * TAMAMI YONETICIYE OZEL. Zincir raporu "hangi satir kirik" bilgisini tasir ve
 * arsiv TUM denetim kaydini icerir — kendi satirini gorebilen bir kullanicinin
 * buradan herkesin kaydina ulasmasi, Sprint 1'in gorunurluk kuralini delerdi.
 */
import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../services/vectorStore.service.js';
import { requireAuth } from '../middleware/session.js';
import { ARCHIVE_DIR } from '../config/constants.js';
import {
  createSignedArchive,
  ensureKeyPair,
  lastArchiveState,
  listArchives,
  verifyArchive,
  verifyAuditChain,
} from '../services/integrity.service.js';

const router = Router();

/** Yonetici degilse hicbir sey. Bu uclarda rol ayrimi tek satirlik. */
function requireAdmin(req: Request, res: Response): boolean {
  if (req.principal?.role !== 'yonetici') {
    res.status(403).json({ error: 'Bu işlem için yönetici yetkisi gerekiyor.' });
    return false;
  }
  return true;
}

/**
 * Zincir durumu.
 *
 * Son arsivin kaydettigi durum da hesaba katilir: zincir tek basina SON
 * satirlarin silinmesini goremez, arsiv gorur.
 */
router.get('/audit/integrity', requireAuth, (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const archive = lastArchiveState();
  const chain = verifyAuditChain(
    getDb(),
    archive ? { lastRowId: archive.lastRowId, chainHead: archive.chainHead } : undefined,
  );
  const key = ensureKeyPair();

  res.json({
    ...chain,
    sonArsiv: archive ? { dosya: archive.dosya, sonSatir: archive.lastRowId } : null,
    acikAnahtarParmakIzi: key.fingerprint,
    arsivDizini: ARCHIVE_DIR,
  });
});

/** İmzalı arşiv üretir. */
router.post('/audit/archive', requireAuth, (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  try {
    res.json({ ok: true, ...createSignedArchive(getDb()) });
  } catch (error) {
    res.status(500).json({ error: `Arşiv üretilemedi: ${(error as Error).message}` });
  }
});

router.get('/audit/archives', requireAuth, (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  res.json({ arsivDizini: ARCHIVE_DIR, arsivler: listArchives() });
});

/**
 * Bir arsivi yerinde dogrular.
 *
 * DIKKAT — bu uc yalnizca KOLAYLIK icindir. Gercek denetim, arsivi bu
 * makineden cikarip `npm run verify-archive` ile BASKA bir makinede
 * dogrulamaktir: kurcalanmis bir sunucunun kendi arsivini "gecerli" demesi
 * hicbir sey kanitlamaz.
 */
router.get('/audit/archives/:dosya', requireAuth, (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  // Dizin gecisi savunmasi: yalnizca taban ad kabul edilir.
  // Express 5'te `req.params` degeri dizi de olabilir; once tipi daraltiliyor.
  const istenen = req.params.dosya;
  if (typeof istenen !== 'string') return res.status(400).json({ error: 'Geçersiz arşiv adı.' });

  const dosya = path.basename(istenen);
  if (dosya !== istenen || !dosya.endsWith('.json')) {
    return res.status(400).json({ error: 'Geçersiz arşiv adı.' });
  }

  const yol = path.join(ARCHIVE_DIR, dosya);
  if (!fs.existsSync(yol)) return res.status(404).json({ error: 'Arşiv bulunamadı.' });

  try {
    res.json({ dosya, ...verifyArchive(yol) });
  } catch (error) {
    res.status(400).json({ error: `Arşiv okunamadı: ${(error as Error).message}` });
  }
});

export default router;
