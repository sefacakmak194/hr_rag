/**
 * Dokuman yonetimi — korpusu arayuzden yonetmek icin.
 *
 * NEDEN: korpus bugune kadar elle (dosya kopyalayip `npm run ingest` calistirarak)
 * yonetiliyordu. Bu, sistemi "20 sabit dokumanlik bir gosteri" olarak sinirliyor.
 * Kendi IK dokumanlarini yukleyip aninda soru sorabilmek, projeyi urune cevirir.
 *
 * TASARIM KARARLARI:
 *  - Dosya multipart yerine base64 JSON ile gelir. Air-gapped kurulumda yeni
 *    bagimlilik (multer vb.) eklememek icin; korpus dokumanlari kucuk oldugundan
 *    base64'un %33 sismesi onemsizdir.
 *  - Her degisiklikten sonra korpus BASTAN indekslenir. Artimli guncelleme daha
 *    hizli olurdu ama BM25 indeksi ve belge frekanslari korpusun tamamina bagli;
 *    kismi guncelleme sessizce tutarsiz skorlar uretirdi.
 *  - Yeniden indeksleme tek seferde bir tane calisir (mutex). Es zamanli iki
 *    yukleme resetStore() uzerinde yarisir ve indeksi yarim birakirdi.
 */
import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CORPUS_DIR } from '../config/constants.js';
import { runIngestion } from '../services/ingestion.service.js';
import { extractChunks } from '../services/chunker.js';
import { readDocument, shadowedFiles, SUPPORTED_EXT } from '../services/documentReader.service.js';
import { countChunks, listDocuments, resetStore, resetLexicalIndex } from '../services/vectorStore.service.js';
import { requireAuth, requireDocumentManager } from '../middleware/session.js';
import type { Principal } from '../services/identity.service.js';
import { auditCorpus } from '../services/corpusAudit.service.js';

const router = Router();

/** Korpus dokumanlari kucuktur; sinir yine de acik konur. */
const MAX_BYTES = 10 * 1024 * 1024;
/**
 * Tek dokumanin uretebilecegi azami parca sayisi.
 *
 * Olcek icin: mevcut korpusta 20 dokuman toplam 94 parca uretiyor (~5/dokuman);
 * 150 sayfalik gercek bir IK el kitabi ~300 parcaya denk gelir. 500 bu nedenle
 * bol bir tavandir. Ustunde kalan dokumanlar reddedilir cunku embedding surec
 * ICINDE hesaplanir ve istek dakikalarca asili kalir — kullaniciya bozulmus
 * gibi gorunur (olculdu: 1.6 MB'lik metin ~1100 parca uretti ve istek 10
 * dakikada bitmedi). Bu boyut icin dogru cozum arka plan isi + ilerleme
 * bildirimi olurdu; kapsamda degil, bu yuzden acikca reddediliyor.
 */
const MAX_CHUNKS_PER_DOC = 500;
const ALLOWED_EXT = new Set<string>(SUPPORTED_EXT);

// Govde ayristirici (20 MB sinirla) index.ts icinde bu yola AYRICA baglanir;
// global 1 MB'lik ayristiricidan once calismasi gerekiyor.

/**
 * Dosya adi dogrulamasi.
 *
 * DIKKAT — bu bir dizin gecisi (path traversal) savunmasidir. Istemciden gelen
 * ad dogrudan dosya sistemine yazilacagi icin yalnizca taban ad alinir ve
 * ayrica beyaz liste ile dogrulanir. "../../.env" gibi bir ad reddedilir.
 */
export function safeName(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  const base = path.basename(raw.trim());
  if (base !== raw.trim()) return null; // ayirici iceriyordu
  if (base.startsWith('.')) return null;
  if (!/^[\w\-. ()çğıöşüÇĞİÖŞÜ]+$/u.test(base)) return null;
  if (!ALLOWED_EXT.has(path.extname(base).toLowerCase())) return null;

  return base;
}

// ------------------------------------------------------------------ mutex
let reindexing: Promise<void> | null = null;

/**
 * Korpusu bastan indeksler. Ayni anda yalnizca bir kosum olur; ikinci cagri
 * devam eden kosumu bekler ve ardindan kendi kosumunu yapar.
 */
async function reindex(): Promise<{ chunks: number; error?: string }> {
  while (reindexing) await reindexing.catch(() => {});

  let done!: () => void;
  reindexing = new Promise<void>((r) => (done = r));

  try {
    await runIngestion(CORPUS_DIR);
    return { chunks: countChunks() };
  } catch (error) {
    // Korpus bosaldiysa runIngestion hata atar; depo zaten sifirlanmis olur.
    resetStore();
    resetLexicalIndex();
    return { chunks: 0, error: (error as Error).message };
  } finally {
    done();
    reindexing = null;
  }
}

/**
 * Korpus degisince esikler yeniden kalibre edilmelidir (bkz. data/KAPSAM.md).
 * Bu uyari sessizce gecilmesin diye her degisiklik yanitinda doner.
 */
const CALIBRATION_WARNING =
  'Korpus değişti. Alaka eşiği korpus büyüklüğüne duyarlıdır — ' +
  '`npx tsx ../scripts/calibrate.ts` ile yeniden kalibre edip `npm test` ile doğrulayın.';

// ------------------------------------------------------------------- liste
router.get('/documents', requireAuth, (req: Request, res: Response) => {
  // Liste kimlige gore filtrelenir: dokuman ADI bile bilgi tasir.
  const indexed = new Map(listDocuments(req.principal as Principal).map((d) => [d.docTitle, d.chunks]));

  const files = fs.existsSync(CORPUS_DIR)
    ? fs
        .readdirSync(CORPUS_DIR)
        .filter((f) => ALLOWED_EXT.has(path.extname(f).toLowerCase()))
        .sort()
    : [];

  const documents = files.map((name) => {
    const stat = fs.statSync(path.join(CORPUS_DIR, name));
    return {
      name,
      ext: path.extname(name).toLowerCase().slice(1),
      bytes: stat.size,
      modified: stat.mtime.toISOString(),
      chunks: indexed.get(name) ?? 0,
    };
  });

  res.json({
    corpusDir: CORPUS_DIR,
    documents,
    indexedChunks: countChunks(),
    // Ayni taban ada sahip birden fazla bicim varsa yalnizca en yuksek
    // oncelikli olan indekslenir (.md > .docx > .pdf); digerleri golgelenir.
    shadowed: shadowedFiles(files),
  });
});

// ------------------------------------------------------- korpus saglik raporu
/**
 * Celiski, tekrar ve yapi sorunlarini raporlar. Gercek bir IK arsivi temiz
 * degildir; bu ucu sessizce yanlis cevap uretir (bkz. corpusAudit.service).
 */
router.get('/corpus/audit', requireDocumentManager, (_req: Request, res: Response) => {
  try {
    res.json(auditCorpus());
  } catch (error) {
    res.status(500).json({ error: `Denetim başarısız: ${(error as Error).message}` });
  }
});

// ------------------------------------------------------------------ yukleme
router.post('/documents', requireDocumentManager, async (req: Request, res: Response) => {
  const { name, contentBase64 } = req.body ?? {};

  const file = safeName(name);
  if (!file) {
    return res.status(400).json({
      error: 'Geçersiz dosya adı. Yalnızca .md, .docx ve .pdf uzantılı, dizin ayırıcı içermeyen adlar kabul edilir.',
    });
  }
  if (typeof contentBase64 !== 'string' || !contentBase64) {
    return res.status(400).json({ error: 'Dosya içeriği boş.' });
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(contentBase64, 'base64');
  } catch {
    return res.status(400).json({ error: 'İçerik base64 olarak çözülemedi.' });
  }
  if (buffer.byteLength === 0) return res.status(400).json({ error: 'Dosya boş.' });
  if (buffer.byteLength > MAX_BYTES) {
    return res.status(413).json({ error: `Dosya çok büyük (üst sınır ${MAX_BYTES / 1024 / 1024} MB).` });
  }

  // ONCE DOGRULA, SONRA YAZ.
  //
  // Dosya once gecici dizine yazilip cozumlenir; ancak butun kontrolleri gecerse
  // korpusa alinir. Boylece bozuk ya da asiri buyuk bir dosya korpusu kirletmez
  // ve gereksiz bir yeniden indeksleme tetiklenmez. (Dogrulanmis: 1.6 MB'lik
  // dolgu metni 0.2 sn'de reddedildi ve korpusa hic yazilmadi.)
  const tmpPath = path.join(os.tmpdir(), `phr-upload-${Date.now()}-${file}`);
  let hint: string | undefined;

  try {
    fs.writeFileSync(tmpPath, buffer);

    const ext = path.extname(file).toLowerCase();
    const read = await readDocument(tmpPath);
    const text = read.text;

    if (!text.trim()) {
      return res.status(400).json({
        error:
          ext === '.pdf'
            ? `PDF içinden metin çıkarılamadı${read.ocrNote ? ` (${read.ocrNote})` : ''}. ` +
              'Taranmış PDF ise OCR denendi; metin katmanı içeren bir sürüm gerekebilir.'
            : 'Dosyadan metin okunamadı.',
      });
    }
    if (read.source === 'pdf-ocr') {
      hint = 'Metin katmanı bulunamadı; içerik OCR ile okundu. Tanıma hatalarına karşı yanıtları örneklem üzerinden doğrulayın.';
    }

    const chunkCount = extractChunks(text).length;
    if (chunkCount > MAX_CHUNKS_PER_DOC) {
      return res.status(413).json({
        error:
          `Doküman çok büyük: ${chunkCount} parça üretiyor (üst sınır ${MAX_CHUNKS_PER_DOC}). ` +
          'Dokümanı bölerek yükleyin — her parça için ayrı embedding hesaplandığından ' +
          'bu boyutta indeksleme dakikalarca sürer.',
      });
    }

    // Markdown ise en az bir baslik bekleriz: chunker basliklara gore boluyor,
    // basliksiz metin tek parcaya duser ve alinti "Genel" olur.
    if (ext !== '.pdf' && !hint && !/^#\s+/m.test(text)) {
      hint = 'Markdown dosyasında `#` başlık satırı bulunamadı. Doküman tek parçaya düşecek ve kaynak gösterimi zayıflayacak.';
    }
  } catch (error) {
    return res.status(400).json({ error: `Dosya çözümlenemedi: ${(error as Error).message}` });
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }

  try {
    fs.mkdirSync(CORPUS_DIR, { recursive: true });
    const replaced = fs.existsSync(path.join(CORPUS_DIR, file));
    fs.writeFileSync(path.join(CORPUS_DIR, file), buffer);

    const result = await reindex();
    res.json({
      ok: true,
      name: file,
      replaced,
      bytes: buffer.byteLength,
      indexedChunks: result.chunks,
      indexError: result.error,
      hint,
      warning: CALIBRATION_WARNING,
    });
  } catch (error) {
    res.status(500).json({ error: `Yükleme başarısız: ${(error as Error).message}` });
  }
});

// -------------------------------------------------------------------- silme
router.delete('/documents/:name', requireDocumentManager, async (req: Request, res: Response) => {
  const file = safeName(req.params.name);
  if (!file) return res.status(400).json({ error: 'Geçersiz dosya adı.' });

  const full = path.join(CORPUS_DIR, file);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Doküman bulunamadı.' });

  try {
    fs.unlinkSync(full);
    const result = await reindex();
    res.json({
      ok: true,
      name: file,
      indexedChunks: result.chunks,
      indexError: result.error,
      warning: CALIBRATION_WARNING,
    });
  } catch (error) {
    res.status(500).json({ error: `Silme başarısız: ${(error as Error).message}` });
  }
});

// ------------------------------------------------------- elle yeniden indeks
router.post('/documents/reindex', requireDocumentManager, async (_req: Request, res: Response) => {
  const result = await reindex();
  res.json({ ok: !result.error, indexedChunks: result.chunks, indexError: result.error });
});

export default router;
