/**
 * Politika boşluğu raporu ucu (Sprint 4).
 *
 * YETKI: `ik` + `yonetici` (requireDocumentManager).
 *
 * Boslugu KAPATACAK olan, korpusu yoneten kisidir — rapor da tam olarak ona
 * "hangi yonergeyi yazmalisin" diyor. `calisan` icin bu rapor ne kullanisli ne
 * de uygun: icinde meslektaslarinin sorulari var (kimliksiz de olsa).
 */
import { Router, type Request, type Response } from 'express';
import { getDb } from '../services/vectorStore.service.js';
import { requireDocumentManager } from '../middleware/session.js';
import { buildGapReport, isoWeek } from '../services/policyGap.service.js';

const router = Router();

router.get('/reports/policy-gaps', requireDocumentManager, (req: Request, res: Response) => {
  const since = req.query.sinceWeek;
  const sinceWeek = typeof since === 'string' && /^\d{4}-W\d{2}$/.test(since) ? since : undefined;

  const threshold = Number(req.query.threshold);

  try {
    res.json({
      currentWeek: isoWeek(),
      ...buildGapReport(getDb(), {
        sinceWeek,
        // Esik disaridan verilebilir: kumelemenin dogru ayrildigini gozle
        // dogrulamak icin. Uretimde varsayilan kullanilir.
        threshold: Number.isFinite(threshold) && threshold > 0 && threshold <= 1 ? threshold : undefined,
      }),
    });
  } catch (error) {
    res.status(500).json({ error: `Rapor üretilemedi: ${(error as Error).message}` });
  }
});

export default router;
