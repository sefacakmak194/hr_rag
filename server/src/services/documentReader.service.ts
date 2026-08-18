/**
 * Tek giris noktasi: desteklenen her dokuman bicimini metne cevirir.
 *
 * Hem indeksleme (ingestion.service) hem yukleme dogrulamasi
 * (routes/documents.route) buradan gecer; boylece "hangi bicimler destekleniyor"
 * sorusunun tek bir yaniti olur ve iki yer birbirinden kaymaz.
 *
 * Bicim onceligi: ayni ada sahip birden fazla dosya varsa .md > .docx > .pdf.
 * Gerekce: markdown kaynak metindir, DOCX bicimli ama yapisi korunmus metindir,
 * PDF ise en cok bilgi kaybeden bicimdir (baslikler punto sezgisiyle tahmin
 * edilir).
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractTextFromPdf } from './pdfExtract.service.js';
import { extractTextFromDocx, promoteMaddeHeadings } from './docxExtract.service.js';
import { extractTextWithOcr, ocrAvailable } from './ocr.service.js';

export const SUPPORTED_EXT = ['.md', '.docx', '.pdf'] as const;

/** Ayni ada sahip dosyalarda tercih sirasi (kucuk indeks = yuksek oncelik). */
const PRIORITY: Record<string, number> = { '.md': 0, '.docx': 1, '.pdf': 2 };

export function isSupported(fileName: string): boolean {
  return (SUPPORTED_EXT as readonly string[]).includes(path.extname(fileName).toLowerCase());
}

/**
 * Dizindeki dosyalari indekslenecek kumeye indirger: ayni taban ada sahip
 * dosyalardan yalnizca en yuksek oncelikli olan kalir.
 */
export function selectIndexableFiles(fileNames: string[]): string[] {
  const best = new Map<string, string>();

  for (const name of fileNames.filter(isSupported)) {
    const ext = path.extname(name).toLowerCase();
    const stem = name.slice(0, -ext.length).toLowerCase();
    const current = best.get(stem);

    if (!current) {
      best.set(stem, name);
      continue;
    }
    const currentExt = path.extname(current).toLowerCase();
    if (PRIORITY[ext] < PRIORITY[currentExt]) best.set(stem, name);
  }

  return [...best.values()].sort();
}

/**
 * Ayni taban ada sahip daha yuksek oncelikli bir dosya oldugu icin
 * indekslenmeyen dosyalari doner (arayuzde "golgelenmis" olarak gosterilir).
 */
export function shadowedFiles(fileNames: string[]): string[] {
  const selected = new Set(selectIndexableFiles(fileNames));
  return fileNames.filter((n) => isSupported(n) && !selected.has(n));
}

export interface ReadResult {
  text: string;
  /** Metin nasil elde edildi — kullaniciya raporlanir. */
  source: 'markdown' | 'docx' | 'pdf-text' | 'pdf-ocr';
  /** OCR denenip basarisiz olduysa sebep. */
  ocrNote?: string;
}

/**
 * Dosyayi metne cevirir.
 *
 * PDF'te ONCE metin katmani denenir; bos gelirse (taranmis belge) OCR'a
 * dusulur. Bu sira onemli: OCR yavastir ve metin katmani her zaman daha
 * dogrudur, dolayisiyla yalnizca gercekten gerektiginde calismali.
 */
export async function readDocument(filePath: string): Promise<ReadResult> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.md') {
    return { text: fs.readFileSync(filePath, 'utf-8'), source: 'markdown' };
  }

  if (ext === '.docx') {
    return { text: await extractTextFromDocx(filePath), source: 'docx' };
  }

  if (ext === '.pdf') {
    const text = await extractTextFromPdf(filePath);
    if (text.trim()) return { text, source: 'pdf-text' };

    const availability = ocrAvailable();
    if (!availability.ok) {
      return { text: '', source: 'pdf-text', ocrNote: availability.reason };
    }

    try {
      const ocrText = await extractTextWithOcr(filePath);
      if (ocrText.trim()) {
        // OCR duz metin uretir; punto bilgisi yoktur, dolayisiyla pdfExtract'in
        // baslik sezgisi burada calismaz ve dokuman tek parcaya duser (olculdu:
        // taranmis belge "Genel" bolumu olarak indekslendi, alintilar madde
        // duzeyini kaybetti). "Madde N: ..." satirlarini basliga yukseltmek
        // DOCX tarafinda zaten var; ayni yardimci burada da kullanilir.
        return { text: promoteMaddeHeadings(ocrText), source: 'pdf-ocr' };
      }
      return { text: '', source: 'pdf-ocr', ocrNote: 'PDF içinde OCR yapılabilir görüntü bulunamadı.' };
    } catch (error) {
      return { text: '', source: 'pdf-ocr', ocrNote: `OCR başarısız: ${(error as Error).message}` };
    }
  }

  throw new Error(`Desteklenmeyen dosya biçimi: ${ext}`);
}
