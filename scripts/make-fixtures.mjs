/**
 * Bicim testleri icin ornek dosyalar uretir:
 *   fixtures/ornek_yonetmelik.docx  — Word basliklariyla (Heading 1/2)
 *   fixtures/taranmis_belge.pdf     — METIN KATMANI OLMAYAN PDF (OCR testi)
 *
 * Taranmis PDF su sekilde uretilir: metin once Chrome ile PNG'ye cekilir,
 * sonra o PNG bir HTML sayfasina gomulup PDF'e basilir. Sonuc, gercek bir
 * taranmis belge gibi yalnizca goruntu tasir — pdfjs'in metin katmani bostur.
 *
 * Kullanim:  node scripts/make-fixtures.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'fixtures');
const serverRequire = createRequire(path.join(ROOT, 'server', 'package.json'));

fs.mkdirSync(OUT, { recursive: true });

const log = (m) => console.log(`  ${m}`);

// --------------------------------------------------------------- 1) DOCX
const JSZip = serverRequire('jszip');

const paragraphs = [
  ['Heading1', 'Yıllık İzin ve Mazeret İzinleri Yönetmeliği'],
  ['Heading2', 'Madde 1: Yıllık İzin Talebi'],
  ['Normal', 'Yıllık izin talepleri kullanılacak tarihten en az 7 gün önce İK Portalı üzerinden oluşturulur. Talep, birim yöneticisinin onayına tabidir.'],
  ['Heading2', 'Madde 2: Mazeret İzni'],
  ['Normal', 'Çalışana bir takvim yılı içinde toplam 4 iş günü ücretli mazeret izni verilir. Mazeret izni yıllık izin hakkından düşülmez.'],
  ['Heading2', 'Madde 3: İzin Devri'],
  ['Normal', 'Kullanılmayan yıllık izinlerden en fazla 5 iş günü bir sonraki yıla devredilebilir.'],
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const body = paragraphs
  .map(
    ([style, text]) =>
      `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`,
  )
  .join('');

const documentXml =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  `<w:body>${body}<w:sectPr/></w:body></w:document>`;

const stylesXml =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>' +
  '</w:styles>';

const contentTypes =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '</Types>';

const rootRels =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

const docRels =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>';

const zip = new JSZip();
zip.file('[Content_Types].xml', contentTypes);
zip.folder('_rels').file('.rels', rootRels);
const word = zip.folder('word');
word.file('document.xml', documentXml);
word.file('styles.xml', stylesXml);
word.folder('_rels').file('document.xml.rels', docRels);

const docxPath = path.join(OUT, 'ornek_yonetmelik.docx');
fs.writeFileSync(docxPath, await zip.generateAsync({ type: 'nodebuffer' }));
log(`DOCX yazildi: ${path.relative(ROOT, docxPath)}`);

// ------------------------------------------------- 2) taranmis (goruntu) PDF
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

const chrome = findChrome();
if (!chrome) {
  log('Chrome/Edge bulunamadi — taranmis PDF uretilemedi.');
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phr-fixture-'));

// OCR'in okumasi gereken metin. Buyuk punto ve sade serif: taranmis belge benzetimi.
const scanHtml = [
  '<!doctype html><meta charset="utf-8">',
  '<style>',
  "  body { margin: 0; padding: 70px 80px; font-family: Georgia, 'Times New Roman', serif;",
  '         background: #fff; color: #000; }',
  '  h1 { font-size: 34px; margin: 0 0 34px; }',
  '  h2 { font-size: 27px; margin: 30px 0 12px; }',
  '  p  { font-size: 23px; line-height: 1.6; margin: 0 0 18px; }',
  '</style>',
  '<h1>Servis ve Ulasim Yonetmeligi</h1>',
  '<h2>Madde 1: Servis Guzergahlari</h2>',
  '<p>Sirket servisleri sabah 07:30 ve aksam 18:00 saatlerinde kalkar.',
  'Guzergah degisiklikleri en az 3 gun onceden duyurulur.</p>',
  '<h2>Madde 2: Servis Ucreti</h2>',
  '<p>Servis kullanimi ucretsizdir. Servis disinda kalan calisanlara aylik',
  '1.250 TL ulasim destegi odenir.</p>',
].join('\n');

const htmlPath = path.join(tmp, 'scan.html');
fs.writeFileSync(htmlPath, scanHtml, 'utf-8');

const pngPath = path.join(tmp, 'scan.png');
execFileSync(
  chrome,
  [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-device-scale-factor=2',
    '--window-size=1000,900',
    `--screenshot=${pngPath}`,
    `file:///${htmlPath.replace(/\\/g, '/')}`,
  ],
  { stdio: 'ignore' },
);

if (!fs.existsSync(pngPath)) {
  log('PNG uretilemedi — taranmis PDF atlandi.');
  process.exit(0);
}
log(`Goruntu uretildi (${(fs.statSync(pngPath).size / 1024).toFixed(0)} KB)`);

// Goruntuyu data URI olarak gom: PDF'te SADECE goruntu olsun, metin katmani olmasin.
const dataUri = `data:image/png;base64,${fs.readFileSync(pngPath).toString('base64')}`;
const wrapPath = path.join(tmp, 'wrap.html');
fs.writeFileSync(
  wrapPath,
  [
    '<!doctype html><meta charset="utf-8">',
    '<style>@page{margin:0} html,body{margin:0;padding:0} img{width:100%;display:block}</style>',
    `<img src="${dataUri}">`,
  ].join('\n'),
  'utf-8',
);

const pdfPath = path.join(OUT, 'taranmis_belge.pdf');
execFileSync(
  chrome,
  [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--no-pdf-header-footer',
    `--print-to-pdf=${pdfPath}`,
    `file:///${wrapPath.replace(/\\/g, '/')}`,
  ],
  { stdio: 'ignore' },
);

fs.rmSync(tmp, { recursive: true, force: true });

if (fs.existsSync(pdfPath)) {
  log(
    `Taranmis PDF yazildi: ${path.relative(ROOT, pdfPath)} (${(fs.statSync(pdfPath).size / 1024).toFixed(0)} KB)`,
  );
} else {
  log('Taranmis PDF uretilemedi.');
}
