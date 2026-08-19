/**
 * Politika surumu uclari (Sprint 2).
 *
 * YETKISIZ ERISIM 404 DONER, 403 DEGIL.
 *
 * Sprint 1'in karariyla ayni: dokumanin VAR OLDUGU bilgisi bile sizmamali.
 * 403 "bu dokuman var ama goremezsin" demektir ve tek basina bir bilgidir
 * ("ust yonetim ucret skalasi diye bir belge varmis"). GitHub ozel depolarda
 * ayni sebeple 404 doner.
 *
 * Etiket degistirme YONETICIYE ozeldir (yukleme yetkisi İK'da da var).
 * Sebep: yukleme korpusa icerik ekler, etiket ise KIMIN NEYI GORECEGINI
 * belirler. Ikincisi bir yetkilendirme karari; dokuman yonetimiyle ayni
 * seviyede olmamali.
 */
import { Router, type Request, type Response } from 'express';
import { getDb, resetLexicalIndex } from '../services/vectorStore.service.js';
import { requireAuth, requireDocumentManager } from '../middleware/session.js';
import { ACCESS_LABELS, setAccessLabel, type AccessLabel, type Principal } from '../services/identity.service.js';
import {
  canSeeDocument,
  currentVersion,
  getVersion,
  getVersionById,
  listVersions,
  versionState,
} from '../services/versioning.service.js';
import { diffLines } from '../services/diff.service.js';
import { listPending, promoteDueVersions, discardPending } from '../services/corpusSync.service.js';
import { safeName } from './documents.route.js';

const router = Router();

/** Yetkisiz ya da adi gecersiz istekler AYNI yaniti alir: varlik sizmasin. */
const NOT_FOUND = { error: 'Doküman bulunamadı.' };

/**
 * Dosya adini dogrular ve kimligin gorebildigini kontrol eder.
 * Gecemezse null doner ve cagiran taraf 404 yazar.
 */
function resolveDoc(req: Request): string | null {
  const file = safeName(req.params.name);
  if (!file) return null;
  return canSeeDocument(getDb(), file, req.principal as Principal) ? file : null;
}

// ------------------------------------------------------------ surum listesi
router.get('/documents/:name/versions', requireAuth, (req: Request, res: Response) => {
  const file = resolveDoc(req);
  if (!file) return res.status(404).json(NOT_FOUND);

  const db = getDb();
  const rows = listVersions(db, file);
  if (!rows.length) {
    // Surumu olmayan dokuman: Sprint 2 oncesi indekslenmis ve o gunden beri
    // hic degismemis olabilir. Bos liste dondurmek dogru; hata degil.
    return res.json({ docTitle: file, versions: [], currentVersion: null });
  }

  const current = currentVersion(db, file);
  res.json({
    docTitle: file,
    currentVersion: current?.version ?? null,
    versions: rows.map((r) => ({
      id: r.id,
      version: r.version,
      effectiveFrom: r.effectiveFrom,
      note: r.note,
      createdAt: r.createdAt,
      createdBy: r.createdBy,
      bytes: r.bytes,
      source: r.source,
      state: versionState(db, r),
    })),
  });
});

// --------------------------------------------------------- tek surum metni
router.get('/documents/:name/versions/:version', requireAuth, (req: Request, res: Response) => {
  const file = resolveDoc(req);
  if (!file) return res.status(404).json(NOT_FOUND);

  const version = Number(req.params.version);
  if (!Number.isInteger(version)) return res.status(400).json({ error: 'Sürüm numarası geçersiz.' });

  const row = getVersion(getDb(), file, version);
  if (!row) return res.status(404).json({ error: 'Sürüm bulunamadı.' });

  res.json({
    docTitle: file,
    version: row.version,
    effectiveFrom: row.effectiveFrom,
    note: row.note,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    state: versionState(getDb(), row),
    content: row.content,
  });
});

// ---------------------------------------------------- surum karsilastirmasi
router.get('/documents/:name/diff', requireAuth, (req: Request, res: Response) => {
  const file = resolveDoc(req);
  if (!file) return res.status(404).json(NOT_FOUND);

  const db = getDb();
  const a = Number(req.query.a);
  const b = Number(req.query.b);
  if (!Number.isInteger(a) || !Number.isInteger(b)) {
    return res.status(400).json({ error: 'Karşılaştırma için iki sürüm numarası gerekir (a ve b).' });
  }

  const oldRow = getVersion(db, file, a);
  const newRow = getVersion(db, file, b);
  if (!oldRow || !newRow) return res.status(404).json({ error: 'Sürüm bulunamadı.' });

  const result = diffLines(oldRow.content, newRow.content);
  res.json({
    docTitle: file,
    a: oldRow.version,
    b: newRow.version,
    aEffectiveFrom: oldRow.effectiveFrom,
    bEffectiveFrom: newRow.effectiveFrom,
    ...result,
  });
});

// ------------------------------------------------- surum kimligiyle dogrudan
/**
 * Denetim kaydindaki alintilar surum KIMLIGI tasir; bu uc o kimligi metne
 * cevirir. "O gun bu yanit neye dayaniyordu?" sorusunun cevabi burasi.
 */
router.get('/versions/:id', requireAuth, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Sürüm kimliği geçersiz.' });

  const db = getDb();
  const row = getVersionById(db, id);
  if (!row) return res.status(404).json({ error: 'Sürüm bulunamadı.' });

  // Erisim kontrolu surumun DOKUMANINA gore yapilir; etiket surumlenmiyor.
  if (!canSeeDocument(db, row.docTitle, req.principal as Principal)) {
    return res.status(404).json({ error: 'Sürüm bulunamadı.' });
  }

  res.json({
    id: row.id,
    docTitle: row.docTitle,
    version: row.version,
    effectiveFrom: row.effectiveFrom,
    note: row.note,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    state: versionState(db, row),
    content: row.content,
  });
});

// ------------------------------------------------------------ erisim etiketi
router.patch('/documents/:name/label', requireAuth, (req: Request, res: Response) => {
  if (req.principal?.role !== 'yonetici') {
    return res.status(403).json({ error: 'Erişim etiketini yalnızca yönetici değiştirebilir.' });
  }

  const file = safeName(req.params.name);
  if (!file) return res.status(404).json(NOT_FOUND);

  const label = req.body?.label as AccessLabel;
  if (!ACCESS_LABELS.includes(label)) {
    return res.status(400).json({ error: `Etiket şunlardan biri olmalı: ${ACCESS_LABELS.join(', ')}` });
  }

  setAccessLabel(getDb(), file, label);
  // BM25 istatistigi rol basina tutuluyor ve havuz etikete bagli; etiket
  // degisince onbellek gecersizdir.
  resetLexicalIndex();

  res.json({ ok: true, name: file, accessLabel: label });
});

// --------------------------------------------------------- bekleyen surumler
router.get('/documents/pending', requireDocumentManager, (_req: Request, res: Response) => {
  res.json({ pending: listPending() });
});

/**
 * Bekleyen surumleri elle yururluge alir.
 *
 * Zamanlayici zaten saatlik kosuyor; bu uc hem gosterim hem de "tarihi geldi
 * ama bir sonraki kontrolu bekleyemem" durumu icin var. Tarihi GELMEMIS
 * surumleri tasimaz — erken yururluk diye bir sey yok.
 */
router.post('/documents/pending/promote', requireDocumentManager, async (_req: Request, res: Response) => {
  const result = await promoteDueVersions();
  res.json(result);
});

/** Planlanmis degisiklikten vazgecme. */
router.delete('/documents/:name/pending', requireDocumentManager, (req: Request, res: Response) => {
  const file = safeName(req.params.name);
  if (!file) return res.status(404).json(NOT_FOUND);

  const removed = discardPending(file);
  if (!removed) return res.status(404).json({ error: 'Bekleyen sürüm bulunamadı.' });

  res.json({ ok: true, name: file });
});

export default router;
