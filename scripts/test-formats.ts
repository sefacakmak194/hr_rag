/**
 * Dokuman bicimi testleri: DOCX okuma ve taranmis PDF icin OCR.
 *
 * Ornek dosyalar `node scripts/make-fixtures.mjs` ile uretilir; yoksa ilgili
 * blok atlanir (testler kirmizi yanmaz, ama neden atlandigi yazilir).
 *
 * Kullanim:  cd server && npm run test:formats
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDocument, selectIndexableFiles, shadowedFiles } from '../server/src/services/documentReader.service.js';
import { extractTextFromPdf } from '../server/src/services/pdfExtract.service.js';
import { ocrAvailable } from '../server/src/services/ocr.service.js';
import { extractChunks } from '../server/src/services/chunker.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

let failures = 0;
let skipped = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
};
const skip = (label: string, why: string) => {
  skipped++;
  console.log(`  ATLA  ${label}\n        ${why}`);
};

// ------------------------------------------------- 1) bicim onceligi
console.log('\n  Bicim onceligi (.md > .docx > .pdf)\n');

const listing = [
  '01_izin.md',
  '01_izin.pdf',
  '02_ucret.docx',
  '02_ucret.pdf',
  '03_isg.pdf',
  '04_kvkk.docx',
  'notlar.txt',
];
const indexable = selectIndexableFiles(listing);
const shadowed = shadowedFiles(listing);

check(
  indexable.join(',') === '01_izin.md,02_ucret.docx,03_isg.pdf,04_kvkk.docx',
  `indekslenecek: ${indexable.join(', ')}`,
  'beklenen: 01_izin.md, 02_ucret.docx, 03_isg.pdf, 04_kvkk.docx',
);
check(
  shadowed.sort().join(',') === '01_izin.pdf,02_ucret.pdf',
  `golgelenen: ${shadowed.join(', ')}`,
  'beklenen: 01_izin.pdf, 02_ucret.pdf',
);
check(!indexable.includes('notlar.txt'), 'desteklenmeyen uzanti listeye girmiyor');

// ------------------------------------------------- 2) DOCX okuma
console.log('\n  DOCX okuma\n');

const docxPath = path.join(FIXTURES, 'ornek_yonetmelik.docx');
if (!fs.existsSync(docxPath)) {
  skip('DOCX', 'ornek dosya yok — `node scripts/make-fixtures.mjs` calistirin');
} else {
  const read = await readDocument(docxPath);
  check(read.source === 'docx', `kaynak = ${read.source}`);
  check(read.text.includes('Madde 1: Yıllık İzin Talebi'), 'madde basligi metinde var');
  check(read.text.includes('7 gün'), 'sayisal deger korundu (7 gün)');
  check(read.text.includes('4 iş günü'), 'sayisal deger korundu (4 iş günü)');

  // Word basliklari markdown basligina cevrilmis olmali; chunker maddelere bolmeli.
  const chunks = extractChunks(read.text);
  const sections = chunks.map((c) => c.sectionHeading);
  check(
    chunks.length >= 3,
    `${chunks.length} parca uretildi`,
    'Word basliklari markdown basligina cevrilmemis olabilir',
  );
  check(
    sections.some((s) => s.includes('Madde 2')),
    `bolum basliklari: ${[...new Set(sections)].join(' | ')}`,
    'alintilar madde duzeyinde olmali',
  );
}

// ------------------------------------------------- 3) taranmis PDF + OCR
console.log('\n  Taranmis PDF (OCR)\n');

const scanPath = path.join(FIXTURES, 'taranmis_belge.pdf');
const ocr = ocrAvailable();

if (!fs.existsSync(scanPath)) {
  skip('OCR', 'ornek dosya yok — `node scripts/make-fixtures.mjs` calistirin');
} else if (!ocr.ok) {
  skip('OCR', ocr.reason ?? 'OCR kullanilamiyor');
} else {
  // Once dogrula: bu PDF gercekten METIN KATMANSIZ olmali, yoksa test OCR'i
  // olcmez, sadece metin cikarimini olcer.
  const layer = await extractTextFromPdf(scanPath);
  check(layer.trim().length === 0, 'ornek PDF metin katmani TASIMIYOR', `bulunan: "${layer.slice(0, 60)}"`);

  const started = Date.now();
  const read = await readDocument(scanPath);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  check(read.source === 'pdf-ocr', `kaynak = ${read.source} (${seconds}s)`, read.ocrNote ?? '');

  // OCR birebir dogru olmaz; ayirt edici parcalar araniyor.
  const text = read.text.replace(/\s+/g, ' ');
  const expect = ['Servis', 'Madde 1', '07:30', '18:00', '1.250'];
  for (const token of expect) {
    check(text.includes(token), `OCR metninde "${token}" var`, `okunan: ${text.slice(0, 200)}`);
  }

  // OCR metni duz gelir; "Madde N: ..." satirlari basliga yukseltilmezse
  // dokuman tek parcaya duser ve alinti "Genel" olur (olculdu).
  const chunks = extractChunks(read.text);
  const sections = [...new Set(chunks.map((c) => c.sectionHeading))];
  check(
    chunks.length >= 2 && sections.some((s) => s.includes('Madde')),
    `OCR metni ${chunks.length} parcaya bolundu: ${sections.join(' | ')}`,
    'madde basliklari yukseltilmemis — alinti madde duzeyinde olmayacak',
  );
}

console.log(
  `\n  ${failures === 0 ? 'TUMU GECTI' : `${failures} test BASARISIZ`}` +
    (skipped ? ` · ${skipped} blok atlandi` : '') +
    '\n',
);
process.exit(failures === 0 ? 0 : 1);
