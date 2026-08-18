/**
 * PDF metin cikarimi testleri.
 *
 * Uretilen PDF'lerden cikarilan metnin, kaynak markdown ile AYNI OLGULARI
 * tasidigini dogrular. Sadece "hata vermedi" degil; sayilar ve madde basliklari
 * korunmus mu ona bakar — PDF'e cevrim sirasinda veri kaybi olursa yakalanir.
 *
 * Kullanim:  cd server && npm run test:pdf
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractTextFromPdf } from '../server/src/services/pdfExtract.service.js';
import { extractChunks } from '../server/src/services/chunker.js';
import { CORPUS_DIR } from '../server/src/config/constants.js';

const PDF_DIR = path.join(path.dirname(CORPUS_DIR), 'corpus-pdf');

if (!fs.existsSync(PDF_DIR)) {
  console.error(`\n  PDF dizini yok: ${PDF_DIR}\n  Once: node scripts/md-to-pdf.mjs\n`);
  process.exit(1);
}

/** Metinden sayisal olgulari cikarir (tutar, gun, saat, yuzde). */
function numbers(text: string): string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => m[0]).filter((n) => n.length > 0);
}

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
};

const pdfs = fs.readdirSync(PDF_DIR).filter((f) => f.endsWith('.pdf')).sort();
console.log(`\n  PDF metin cikarimi — ${pdfs.length} dokuman\n`);

for (const pdf of pdfs) {
  const mdPath = path.join(CORPUS_DIR, pdf.replace(/\.pdf$/, '.md'));
  if (!fs.existsSync(mdPath)) continue;

  const md = fs.readFileSync(mdPath, 'utf-8');
  const extracted = await extractTextFromPdf(path.join(PDF_DIR, pdf));

  // 1) Metin bos olmamali
  if (!extracted.trim()) {
    check(false, `${pdf}: metin cikarildi`, 'bos sonuc');
    continue;
  }

  // 2) Kaynak markdown'daki TUM sayilar PDF metninde de bulunmali
  const mdNums = new Set(numbers(md));
  const pdfNums = new Set(numbers(extracted));
  const missing = [...mdNums].filter((n) => !pdfNums.has(n));

  // 3) Baslik yapisi korunmus mu (chunker calisabiliyor mu)
  const chunks = extractChunks(extracted);
  const mdChunks = extractChunks(md);

  const numsOk = missing.length === 0;
  const chunkOk = chunks.length >= Math.max(1, mdChunks.length - 1);

  check(
    numsOk && chunkOk,
    `${pdf.replace(/\.pdf$/, '').padEnd(46)} ${chunks.length} bolum, ${pdfNums.size} sayi`,
    [
      numsOk ? '' : `eksik sayilar: ${missing.slice(0, 8).join(', ')}`,
      chunkOk ? '' : `bolum sayisi dustu: PDF ${chunks.length} vs MD ${mdChunks.length}`,
    ].filter(Boolean).join(' | '),
  );
}

console.log(`\n  ${failures === 0 ? 'TUMU GECTI' : `${failures} dokuman BASARISIZ`}\n`);
process.exit(failures === 0 ? 0 : 1);
