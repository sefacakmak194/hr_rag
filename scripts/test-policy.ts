/**
 * Kademeli politika hesaplayicisi testleri.
 *
 * Iki sey dogrulanir:
 *   1) Hesaplama dogru kademeyi seciyor mu (sinir degerleri dahil).
 *   2) Tablodaki degerler KORPUS metniyle tutarli mi — tablo kodda tanimli
 *      oldugu icin korpus degistiginde sessizce kaymasin.
 *
 * Kullanim:  cd server && npm run test:policy
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  calculatePolicyAnswer,
  extractTenure,
  POLICY_TABLES,
} from '../server/src/services/policyCalculator.service.js';
import { CORPUS_DIR } from '../server/src/config/constants.js';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
};

// --------------------------------------------------- 1) kidem ayristirma
console.log('\n  Kidem ayristirma\n');
const tenureCases: { input: string; months: number | null }[] = [
  { input: '5 yıllık çalışan', months: 60 },
  { input: '18 aylık çalışan', months: 18 },
  { input: '1,5 yıl kıdemi olan', months: 18 },
  { input: 'beş yıllık personel', months: 60 },
  { input: 'altı ay çalışan', months: 6 },
  { input: 'yıllık izin kaç gün', months: null }, // somut kidem yok
  // TAKIP SORUSU: birlestirilmis sorguda EN SON kidem kazanmali
  { input: '5 yıllık çalışanın yıllık izni kaç gün? peki 10 yıllık olsaydı?', months: 120 },
  { input: '5 yıllık çalışanın izni? ya 20 yıllık?', months: 240 },
  { input: 'İstifa edersem ihbar süresi ne kadar? 2 yıllık olsam?', months: 24 },
];
for (const c of tenureCases) {
  const got = extractTenure(c.input);
  check(
    (got?.months ?? null) === c.months,
    `"${c.input}" → ${got ? got.months + ' ay' : 'kidem yok'}`,
    `beklenen ${c.months === null ? 'kidem yok' : c.months + ' ay'}`,
  );
}

// --------------------------------------------------- 2) kademe secimi
console.log('\n  Kademe secimi (sinir degerleri dahil)\n');
const calcCases: { q: string; expect: string | null }[] = [
  // yillik izin — sinirlar kritik
  { q: '1 yıllık çalışanın yıllık izni kaç gün?', expect: '14 iş günü' },
  { q: '3 yıllık çalışanın yıllık izni kaç gün?', expect: '14 iş günü' },
  { q: '5 yıllık çalışan kaç gün yıllık izin kullanabilir?', expect: '14 iş günü' }, // 5 DAHIL
  { q: '6 yıllık çalışanın yıllık izni kaç gün?', expect: '20 iş günü' },
  { q: '10 yıllık çalışanın yıllık izni kaç gün?', expect: '20 iş günü' },
  { q: '14 yıllık çalışanın yıllık izni kaç gün?', expect: '20 iş günü' },
  { q: '15 yıllık çalışanın yıllık izni kaç gün?', expect: '26 iş günü' }, // 15 DAHIL
  { q: '20 yıllık çalışanın yıllık izni kaç gün?', expect: '26 iş günü' },
  // ihbar suresi
  { q: '3 aylık çalışanın ihbar süresi ne kadar?', expect: '2 hafta' },
  { q: '5 aylık çalışanın ihbar süresi ne kadar?', expect: '2 hafta' },
  { q: '6 aylık çalışanın ihbar süresi ne kadar?', expect: '4 hafta' },
  { q: '1 yıllık çalışanın ihbar süresi kaç hafta?', expect: '4 hafta' },
  { q: '2 yıllık çalışanın ihbar süresi kaç hafta?', expect: '6 hafta' },
  { q: '5 yıllık çalışanın ihbar süresi kaç hafta?', expect: '8 hafta' },
  // kidem verilmeyen genel sorular hesaplayiciya GIRMEMELI
  { q: 'Yıllık izin hakları nasıl belirlenir?', expect: null },
  { q: 'İhbar süresi nedir?', expect: null },
  // ilgisiz
  { q: 'Kreş desteği ne kadar?', expect: null },
  // takip sorulari — en son kidem kazanir
  { q: '5 yıllık çalışanın yıllık izni kaç gün? peki 10 yıllık olsaydı?', expect: '20 iş günü' },
  { q: '5 yıllık çalışanın yıllık izni? ya 20 yıllık?', expect: '26 iş günü' },
  { q: 'İstifa edersem ihbar süresi ne kadar? 2 yıllık olsam?', expect: '6 hafta' },
];
for (const c of calcCases) {
  const got = calculatePolicyAnswer(c.q);
  if (c.expect === null) {
    check(got === null, `"${c.q}" → RAG'e gitmeli`, got ? `hesaplayici devreye girdi: ${got.answer}` : '');
  } else {
    check(
      !!got && got.answer.includes(c.expect),
      `"${c.q}" → ${c.expect}`,
      got ? `alinan: ${got.answer}` : 'hesaplayici devreye girmedi',
    );
  }
}

// --------------------------------------------------- 3) korpus tutarliligi
console.log('\n  Korpus tutarliligi (tablodaki degerler korpusta geciyor mu)\n');
for (const table of POLICY_TABLES) {
  const file = path.join(CORPUS_DIR, table.sourceDoc);
  if (!fs.existsSync(file)) {
    check(false, `${table.sourceDoc} bulunamadi`);
    continue;
  }
  const text = fs.readFileSync(file, 'utf-8');

  for (const tier of table.tiers) {
    // "14 iş günü" -> "14", "2 hafta" -> "2"
    const num = tier.value.split(' ')[0];
    const unit = tier.value.split(' ').slice(1).join(' ');
    const pattern = new RegExp(`${num}\\s*${unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    check(
      pattern.test(text),
      `${table.id}: "${tier.value}" (${tier.label}) korpusta var`,
      `${table.sourceDoc} icinde "${tier.value}" bulunamadi — tablo korpustan kaymis olabilir`,
    );
  }
}

console.log(`\n  ${failures === 0 ? 'TUMU GECTI' : `${failures} test BASARISIZ`}\n`);
process.exit(failures === 0 ? 0 : 1);
