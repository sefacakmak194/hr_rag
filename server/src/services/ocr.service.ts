/**
 * Taranmis PDF'ler icin yerel OCR.
 *
 * NEDEN: gercek IK arsivlerinin ciddi bir kismi taranmis belge — metin katmani
 * yok, sayfa tek buyuk bir goruntu. Bu dosyalar once "PDF icinden metin
 * cikarilamadi" diye reddediliyordu; dogru davranisti ama "dokumanlarinizi
 * atin" vaadini eksik birakiyordu.
 *
 * AIR-GAPPED KISIT: tesseract.js dil verisini varsayilan olarak bir CDN'den
 * indirir. Bu, projenin temel iddiasini (hicbir sey disari gitmez) bozar.
 * Bu yuzden `tur.traineddata` depo icinde `server/vendor/tessdata/` altinda
 * tasinir ve `langPath` oraya isaret eder. `gzip: false` sart — dosya sikistirilmamis.
 *
 * RASTERIZASYON: pdfjs sayfayi cizmek icin canvas ister; `canvas` native bir
 * pakettir ve "native bagimlilik yok" ilkesini bozar. Bu yuzden sayfanin
 * GOMULU GORUNTULERI dogrudan PDF'ten cikarilir (bkz. pdfImage.service).
 * Taranmis sayfada bu genelde tek bir buyuk goruntudur — tam olarak ihtiyacimiz
 * olan sey. Ham pikseller `sharp` ile PNG'ye cevrilir; sharp zaten bagimlilik
 * agacinda var ve paketleme betiginde external olarak ele aliniyor.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, moduleRequire } from '../config/constants.js';
import { extractPdfImages, type PdfImage } from './pdfImage.service.js';

const require = moduleRequire;

/** Dil verisinin bulundugu dizin. Paketlenmis modda exe'nin yanindan okunur. */
function tessdataDir(): string {
  const candidates = [
    process.env.TESSDATA_DIR,
    path.join(REPO_ROOT, 'vendor', 'tessdata'),
    path.join(REPO_ROOT, 'server', 'vendor', 'tessdata'),
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'tur.traineddata'))) return dir;
  }
  throw new Error(
    'OCR dil verisi bulunamadı (tur.traineddata). Beklenen konum: ' + candidates.join(' | '),
  );
}

/** Ham piksellerden ya da JPEG'den PNG uretir (OCR motoru kodlanmis goruntu bekler). */
async function toPng(image: PdfImage): Promise<Buffer> {
  const sharp = require('sharp');

  const pipeline = image.jpeg
    ? sharp(image.jpeg)
    : sharp(image.raw!.data, {
        raw: { width: image.width, height: image.height, channels: image.raw!.channels },
      });

  // Gri tonlama + kontrast normalizasyonu OCR dogrulugunu belirgin artirir.
  // Cozunurluk bilgisi (density) yazilmazsa tesseract "Invalid resolution 25 dpi"
  // uyarisi verip 70 dpi varsayiyor; 300 dpi belge taramasi icin dogru degerdir.
  return pipeline.grayscale().normalize().withMetadata({ density: 300 }).png().toBuffer();
}

export interface OcrOptions {
  /** En fazla kac sayfa okunacak. OCR yavastir; varsayilan sinirli tutulur. */
  maxPages?: number;
}

/**
 * Taranmis PDF'ten metin cikarir. Goruntu bulunamazsa bos string doner.
 *
 * Islem sirasi: gomulu goruntuleri cikar -> PNG'ye cevir -> tesseract'a ver.
 * Sonuc, sayfa metinlerinin bos satirla birlestirilmis halidir.
 */
export async function extractTextWithOcr(
  pdfPath: string,
  options: OcrOptions = {},
): Promise<string> {
  const maxPages = options.maxPages ?? Number(process.env.OCR_MAX_PAGES ?? 30);

  const images = extractPdfImages(fs.readFileSync(pdfPath), { limit: maxPages });
  if (!images.length) return '';

  const { createWorker } = require('tesseract.js');
  const worker = await createWorker('tur', 1, {
    langPath: tessdataDir(),
    gzip: false,
    // Ilerleme kaydi konsola dusmesin; cagiran taraf raporluyor.
    logger: () => {},
  });

  try {
    const pages: string[] = [];
    for (const image of images) {
      const png = await toPng(image);
      const { data } = await worker.recognize(png);
      const text = (data?.text ?? '').trim();
      if (text) pages.push(text);
    }
    return pages.join('\n\n');
  } finally {
    await worker.terminate().catch(() => {});
  }
}

/** OCR kullanilabilir mi? (dil verisi ve sharp mevcut mu) */
export function ocrAvailable(): { ok: boolean; reason?: string } {
  try {
    tessdataDir();
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
  try {
    require('sharp');
  } catch {
    return { ok: false, reason: 'Görüntü dönüştürücü (sharp) kurulu değil.' };
  }
  return { ok: true };
}
