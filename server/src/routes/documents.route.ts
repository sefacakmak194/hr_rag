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
import { CORPUS_DIR, PENDING_DIR } from '../config/constants.js';
import { extractChunks } from '../services/chunker.js';
import { readDocument, shadowedFiles, SUPPORTED_EXT } from '../services/documentReader.service.js';
import { countChunks, listDocuments, getDb } from '../services/vectorStore.service.js';
import { requireAuth, requireDocumentManager } from '../middleware/session.js';
import type { Principal } from '../services/identity.service.js';
import { auditCorpus } from '../services/corpusAudit.service.js';
import { reindex, listPending, discardPending } from '../services/corpusSync.service.js';
import {
  accessLabelOf,
  canSeeDocument,
  currentVersionsFor,
  normalizeEffectiveFrom,
  recordVersion,
  withdrawDocument,
} from '../services/versioning.service.js';

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

/**
 * Korpus degisince esikler yeniden kalibre edilmelidir (bkz. data/KAPSAM.md).
 * Bu uyari sessizce gecilmesin diye her degisiklik yanitinda doner.
 */
const CALIBRATION_WARNING =
  'Korpus değişti. Alaka eşiği korpus büyüklüğüne duyarlıdır — ' +
  '`npx tsx ../scripts/calibrate.ts` ile yeniden kalibre edip `npm test` ile doğrulayın.';

// ------------------------------------------------------------------- liste
router.get('/documents', requireAuth, (req: Request, res: Response) => {
  const principal = req.principal as Principal;
  const indexed = new Map(listDocuments(principal).map((d) => [d.docTitle, d.chunks]));

  /**
   * SIZINTI DUZELTMESI (Sprint 2'de bulundu, Sprint 1'den kalma).
   *
   * Liste DOSYA SISTEMINDEN kuruluyor, `listDocuments`ten degil — cunku korpusta
   * durup henuz indekslenmemis dosyalar da gorunmeli. Ama etiket filtresi
   * YALNIZCA parca sayisina uygulaniyordu; dosya ADLARI herkese gidiyordu.
   *
   * Bu, Sprint 1'in cikis olcutunu ("korpus listesinde yok") HTTP duzeyinde
   * deliyordu. Servis katmani testleri `listDocuments`i dogruluyor ve geciyordu;
   * ucun kendisi test edilmemisti. Dokuman adi tek basina bilgidir —
   * "ust_yonetim_ucret_skalasi.md" gorulen bir baslik zaten sizintidir.
   */
  const files = (
    fs.existsSync(CORPUS_DIR)
      ? fs.readdirSync(CORPUS_DIR).filter((f) => ALLOWED_EXT.has(path.extname(f).toLowerCase()))
      : []
  )
    .filter((name) => canSeeDocument(getDb(), name, principal))
    .sort();

  // Yururlukteki surum tek sorguda gelir; dosya basina sorgu atmak gereksiz.
  const versions = currentVersionsFor(getDb(), files);

  const documents = files.map((name) => {
    const stat = fs.statSync(path.join(CORPUS_DIR, name));
    const version = versions.get(name);
    return {
      name,
      ext: path.extname(name).toLowerCase().slice(1),
      bytes: stat.size,
      modified: stat.mtime.toISOString(),
      chunks: indexed.get(name) ?? 0,
      version: version?.version ?? null,
      effectiveFrom: version?.effectiveFrom ?? null,
      accessLabel: accessLabelOf(getDb(), name),
    };
  });

  // Bekleyen surumler de kimlige gore suzulur: bir dokumanin DEGISECEK olmasi
  // tek basina bilgi tasir.
  const pending = listPending().filter((p) => canSeeDocument(getDb(), p.name, principal));

  res.json({
    corpusDir: CORPUS_DIR,
    pendingDir: PENDING_DIR,
    documents,
    pending,
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
router.get('/corpus/audit', requireDocumentManager, (req: Request, res: Response) => {
  try {
    // Rapor kimlige gore daraltilir: bulgular dokuman adini, madde basligini
    // ve celisen sayisal degerleri tasir — yani icerik sizdirabilir.
    res.json(auditCorpus(req.principal as Principal));
  } catch (error) {
    res.status(500).json({ error: `Denetim başarısız: ${(error as Error).message}` });
  }
});

// ------------------------------------------------------------------ yukleme
router.post('/documents', requireDocumentManager, async (req: Request, res: Response) => {
  const { name, contentBase64, note, effectiveFrom } = req.body ?? {};

  const file = safeName(name);
  if (!file) {
    return res.status(400).json({
      error: 'Geçersiz dosya adı. Yalnızca .md, .docx ve .pdf uzantılı, dizin ayırıcı içermeyen adlar kabul edilir.',
    });
  }
  if (typeof contentBase64 !== 'string' || !contentBase64) {
    return res.status(400).json({ error: 'Dosya içeriği boş.' });
  }

  // GORMEDIGINI EZEMEZSIN. `ik` rolu yukleme yetkisine sahip; ama `yonetici`
  // etiketli bir dokumanin uzerine ayni adla yazabilseydi, hem iceriginin
  // yerini alir hem de dosyanin VARLIGINI ogrenirdi. Yanit, olmayan dosyayla
  // ayni: 404.
  if (fs.existsSync(path.join(CORPUS_DIR, file)) && !canSeeDocument(getDb(), file, req.principal as Principal)) {
    return res.status(404).json({ error: 'Doküman bulunamadı.' });
  }

  // Yururluk tarihi ONCE dogrulanir: gecersiz tarihle dosya yazmak, korpusu
  // surum kaydi olmayan bir metinle basbasa birakirdi.
  let effective: string;
  try {
    effective = normalizeEffectiveFrom(effectiveFrom);
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
  const scheduled = effective > new Date().toISOString();

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
  // Cikarilmis metin surum arsivine gider; ileri tarihli yuklemede korpus hic
  // degismedigi icin metnin TEK kaynagi burasidir.
  let extracted = '';
  let sourceKind = 'markdown';

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

    extracted = text;
    sourceKind = read.source;

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

  const actor = (req.principal as Principal).username;

  try {
    // ------------------------------------------------- ileri tarihli yukleme
    //
    // Yururluk tarihi gelecekteyse korpus DEGISMEZ. Dosya bekleme dizinine
    // yazilir, surum kaydi hemen acilir (planlanmis degisiklik de bir olaydir)
    // ve tarihi geldiginde corpusSync tasir. Indeks yeniden kurulmaz: sistem
    // henuz yururlukte olmayan bir kurala gore cevap vermemelidir.
    if (scheduled) {
      fs.mkdirSync(PENDING_DIR, { recursive: true });
      fs.writeFileSync(path.join(PENDING_DIR, file), buffer);

      const { row } = recordVersion(getDb(), {
        docTitle: file,
        content: extracted,
        source: sourceKind,
        bytes: buffer.byteLength,
        actor,
        note: typeof note === 'string' ? note : undefined,
        effectiveFrom: effective,
      });

      return res.json({
        ok: true,
        name: file,
        scheduled: true,
        version: row.version,
        effectiveFrom: row.effectiveFrom,
        bytes: buffer.byteLength,
        indexedChunks: countChunks(),
        hint,
        message:
          `Sürüm ${row.version} kaydedildi ve ${new Date(row.effectiveFrom).toLocaleDateString('tr-TR')} ` +
          'tarihinde yürürlüğe girecek. O tarihe kadar yanıtlar mevcut sürüme dayanmaya devam eder.',
      });
    }

    // ------------------------------------------------------ hemen yururluge
    fs.mkdirSync(CORPUS_DIR, { recursive: true });
    const replaced = fs.existsSync(path.join(CORPUS_DIR, file));
    fs.writeFileSync(path.join(CORPUS_DIR, file), buffer);

    // Surum kaydini indeksleme acar (bkz. ingestion.service); not ve tarih
    // oraya tasinir ki elle kopyalanan dosyayla ayni yoldan gecsin.
    const result = await reindex({
      actor,
      versionMeta: {
        [file]: { note: typeof note === 'string' ? note : undefined, effectiveFrom: effective },
      },
    });

    const version = currentVersionsFor(getDb(), [file]).get(file);

    res.json({
      ok: true,
      name: file,
      replaced,
      scheduled: false,
      version: version?.version ?? null,
      effectiveFrom: version?.effectiveFrom ?? null,
      versionCreated: result.changed.includes(file),
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
  // Gormedigini silemezsin — yoklugu ile yetkisizligi AYNI yanit alir.
  if (!fs.existsSync(full) || !canSeeDocument(getDb(), file, req.principal as Principal)) {
    return res.status(404).json({ error: 'Doküman bulunamadı.' });
  }

  try {
    fs.unlinkSync(full);

    // Surum satirlari SILINMEZ, geri cekilir: gecmis yanitlarin dayanagi
    // dokuman korpustan cikinca da okunabilir kalmali. Bekleyen bir surum
    // varsa dosyasi da temizlenir — dayanagi kalmadi.
    const withdrawn = withdrawDocument(getDb(), file);
    discardPending(file);

    const result = await reindex({ actor: (req.principal as Principal).username });
    res.json({
      ok: true,
      name: file,
      withdrawnVersions: withdrawn,
      indexedChunks: result.chunks,
      indexError: result.error,
      warning: CALIBRATION_WARNING,
    });
  } catch (error) {
    res.status(500).json({ error: `Silme başarısız: ${(error as Error).message}` });
  }
});

// ------------------------------------------------------- elle yeniden indeks
router.post('/documents/reindex', requireDocumentManager, async (req: Request, res: Response) => {
  const result = await reindex({ actor: (req.principal as Principal).username });
  res.json({
    ok: !result.error,
    indexedChunks: result.chunks,
    indexError: result.error,
    changed: result.changed,
  });
});

export default router;
