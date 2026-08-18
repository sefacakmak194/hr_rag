/**
 * Korpus saglik denetimi testleri.
 *
 * Iki yon birlikte olculur ve IKISI DE zorunlu:
 *   POZITIF — kasitli olarak bozulmus bir korpusta sorunlar bulunmali
 *   NEGATIF — projenin temiz korpusunda YUKSEK oncelikli bulgu OLMAMALI
 *
 * Ikinci yon kritik: bir denetim aracinin en kolay basarisizligi her seye
 * "sorun" demektir. Ilk iki olcut tam bu yuzden geri alindi (bkz.
 * corpusAudit.service icindeki DIKKAT notu).
 *
 * Test ayri bir gecici veritabani ve gecici korpus dizini kullanir; gercek
 * indekse dokunmaz (DB_PATH / CORPUS_DIR ortam degiskenleri).
 *
 * Kullanim:  cd server && npm run test:audit
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * DIKKAT — gercek korpus yolu constants.ts'ten OKUNAMAZ: bu test CORPUS_DIR'i
 * gecici dizine ayarliyor ve sabitler modul govdesinde okundugu icin
 * constants.CORPUS_DIR de gecici dizini gosteriyor. Ilk surumde tam bu yuzden
 * "temiz korpus" asamasi bozuk korpusu yeniden olcuyordu.
 */
const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REAL_CORPUS = path.resolve(SCRIPTS_DIR, '..', 'data', 'corpus');

// DIKKAT — bu iki degisken constants.ts YUKLENMEDEN once atanmali; sabitler
// modul govdesinde okunuyor. Bu yuzden importlar dinamik.
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'phr-audit-'));
const corpus = path.join(work, 'corpus');
fs.mkdirSync(corpus, { recursive: true });

process.env.CORPUS_DIR = corpus;
process.env.DB_PATH = path.join(work, 'audit.db');

const { auditCorpus } = await import('../server/src/services/corpusAudit.service.js');
const { runIngestion } = await import('../server/src/services/ingestion.service.js');

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
};

// ---------------------------------------------------- kasitli bozuk korpus
console.log('\n  Bozuk korpus senaryolari\n');

// 1) CELISKI: ayni baslik, farkli deger (klasik "eski surum arsivde kaldi").
fs.writeFileSync(
  path.join(corpus, '01_izin_yonetmeligi.md'),
  [
    '# İzin Yönetmeliği',
    '',
    '## Madde 2: Yıllık Ücretli İzin Hakları',
    'Bir yıldan fazla kıdemi olan çalışana 14 iş günü yıllık ücretli izin verilir.',
    '',
    '## Madde 3: Mazeret İzni',
    'Evlilik halinde çalışana 3 iş günü ücretli mazeret izni verilir.',
  ].join('\n'),
  'utf-8',
);

fs.writeFileSync(
  path.join(corpus, '02_izin_yonetmeligi_2019.md'),
  [
    '# İzin Yönetmeliği (2019)',
    '',
    '## Madde 2: Yıllık Ücretli İzin Hakları',
    'Bir yıldan fazla kıdemi olan çalışana 12 iş günü yıllık ücretli izin verilir.',
  ].join('\n'),
  'utf-8',
);

// 2) TEKRAR: ayni metin baska dosya adiyla yeniden yuklenmis.
fs.writeFileSync(
  path.join(corpus, '03_kres_destegi.md'),
  ['# Kreş Desteği', '', '## Madde 1: Kreş Desteği', 'Okul öncesi çocuğu olan çalışana aylık 4.000 TL kreş desteği ödenir. Destek bordroya yansıtılır.'].join('\n'),
  'utf-8',
);
fs.writeFileSync(
  path.join(corpus, '04_kres_destegi_kopya.md'),
  ['# Kreş Desteği Kopya', '', '## Madde 1: Çocuk Bakım Ödemesi', 'Okul öncesi çocuğu olan çalışana aylık 4.000 TL kreş desteği ödenir. Destek bordroya yansıtılır.'].join('\n'),
  'utf-8',
);

// 3) YAPI: hic baslik yok -> tek parcaya duser.
fs.writeFileSync(
  path.join(corpus, '05_basliksiz.md'),
  'Şirket araçları yalnızca görev amaçlı kullanılır. Kullanım talepleri İdari İşler birimine iletilir.',
  'utf-8',
);

await runIngestion(corpus);
const broken = auditCorpus();

console.log(`  (${broken.documents} doküman · ${broken.chunks} parça)\n`);

const conflicts = broken.findings.filter((f) => f.kind === 'celiski');
const dupes = broken.findings.filter((f) => f.kind === 'tekrar');
const structure = broken.findings.filter((f) => f.kind === 'yapi');

check(
  conflicts.length >= 1 && conflicts.some((f) => f.message.includes('14') && f.message.includes('12')),
  `celiski bulundu (${conflicts.length})`,
  conflicts.map((f) => f.message).join(' / ') || 'hic celiski bulunamadi',
);
check(
  conflicts.every((f) => f.where.some((w) => w.doc.includes('2019'))),
  'celiski dogru dokumanlari isaret ediyor',
  conflicts.map((f) => f.where.map((w) => w.doc).join('+')).join(' / '),
);
check(dupes.length >= 1, `tekrar bulundu (${dupes.length})`, 'mukerrer parca yakalanamadi');
check(
  structure.some((f) => f.where[0].doc.includes('basliksiz')),
  'basliksiz dokuman yapi sorunu olarak raporlandi',
  structure.map((f) => f.where[0].doc).join(', ') || 'yapi bulgusu yok',
);

// -------------------------------------------------------- gercek korpus (negatif)
console.log('\n  Temiz korpus (yanlis alarm olmamali)\n');

if (!fs.existsSync(REAL_CORPUS)) {
  console.log('  ATLA  gercek korpus bulunamadi');
} else {
  await runIngestion(REAL_CORPUS);
  const clean = auditCorpus();

  check(
    clean.summary.yuksek === 0,
    `temiz korpusta yuksek oncelikli bulgu yok (${clean.chunks} parca)`,
    clean.findings
      .filter((f) => f.severity === 'yuksek')
      .map((f) => `${f.message} @ ${f.where.map((w) => `${w.doc}::${w.section}`).join(' + ')}`)
      .join('\n        '),
  );
  check(
    clean.summary.orta === 0,
    `temiz korpusta orta oncelikli bulgu yok`,
    clean.findings
      .filter((f) => f.severity === 'orta')
      .map((f) => `${f.message} @ ${f.where.map((w) => w.doc).join(' + ')}`)
      .join('\n        '),
  );
}

// Veritabani dosyasi hala acik olabilir; temizlik basarisiz olursa test
// sonucunu etkilememeli (gecici dizin isletim sistemine kalir).
try {
  fs.rmSync(work, { recursive: true, force: true });
} catch {
  /* yoksay */
}

console.log(`\n  ${failures === 0 ? 'TUMU GECTI' : `${failures} test BASARISIZ`}\n`);
process.exit(failures === 0 ? 0 : 1);
