/**
 * Cumle duzeyinde kanit secimi testleri.
 *
 * Iki sey dogrulanir:
 *   1) Turkce cumle bolme — sayi icindeki nokta ("1.500 TL") cumle sonu SAYILMAZ.
 *   2) Secim dogrulugu — coklu olgu tasiyan gercek korpus maddelerinde dogru
 *      cumle secilir, ayirt edilemeyen durumlarda ise HIC secim yapilmaz.
 *
 * Vakalar korpustan CANLI okunur; korpus degisirse test de degisir.
 *
 * Kullanim:  cd server && npm run test:evidence
 */
import fs from 'node:fs';
import path from 'node:path';
import { selectEvidence, splitSentences, splitClauses } from '../server/src/services/evidence.service.js';
import { extractChunks } from '../server/src/services/chunker.js';
import { CORPUS_DIR } from '../server/src/config/constants.js';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
};

// ------------------------------------------------------- 1) cumle bolme
console.log('\n  Cumle bolme\n');

const splitCases: { text: string; expect: number; note: string }[] = [
  {
    text: 'Aylık 1.500 TL yol desteği ödenir. Yükleme ilk hafta yapılır.',
    expect: 2,
    note: 'sayi icindeki nokta bolmemeli',
  },
  {
    text: 'Öğle molası 12:30-13:30 arasındadır. Mola süresi 1 saattir.',
    expect: 2,
    note: 'saat formati bolmemeli',
  },
  { text: 'Tek cümlelik bir madde metnidir.', expect: 1, note: 'tek cumle' },
  {
    text: 'Madde 1: Hibrit Çalışma Düzeni\nŞirketimiz haftada 2 gün destekler.',
    expect: 2,
    note: 'satir sonu de bolme noktasidir',
  },
];
for (const c of splitCases) {
  const got = splitSentences(c.text);
  check(got.length === c.expect, `${c.note} → ${got.length} cümle`, `beklenen ${c.expect}: ${JSON.stringify(got)}`);
}

// ------------------------------------------------------- 1b) yan cumle bolme
console.log('\n  Yan cumle bolme\n');

const clauseCases: { text: string; expect: number; note: string }[] = [
  {
    text: 'Her fazla mesai saati için 1,5 saat serbest zaman hak edilir ve 6 ay içinde kullanılır.',
    expect: 1,
    note: 'Turkce ondalik virgulu ("1,5") bolmemeli',
  },
  {
    text: 'Az tehlikeli iş yerlerinde 3 yılda bir, tehlikeli iş yerlerinde 2 yılda bir tekrarlanır.',
    expect: 2,
    note: 'virgul + bosluk bolme noktasidir',
  },
  {
    text: 'Mazeretsiz olarak; ardı ardına 2 iş günü, bir ayda toplam 3 iş günü.',
    expect: 3,
    note: 'noktali virgul de bolme noktasidir',
  },
];
for (const c of clauseCases) {
  const got = splitClauses(c.text);
  check(got.length === c.expect, `${c.note} → ${got.length} parça`, `beklenen ${c.expect}: ${JSON.stringify(got)}`);
}

// ------------------------------------------- 2) gercek korpus uzerinde secim
console.log('\n  Kanit secimi (canli korpus)\n');

/** Korpustaki tum parcalari (dosya + bolum + metin) uretir. */
function corpusChunks(): { file: string; section: string; text: string }[] {
  const out: { file: string; section: string; text: string }[] = [];
  for (const f of fs.readdirSync(CORPUS_DIR).sort()) {
    if (!f.toLowerCase().endsWith('.md')) continue;
    const content = fs.readFileSync(path.join(CORPUS_DIR, f), 'utf-8');
    for (const c of extractChunks(content)) {
      out.push({ file: f, section: c.sectionHeading, text: c.text });
    }
  }
  return out;
}

const chunks = corpusChunks();
const bySection = (needle: string) => {
  const hit = chunks.find((c) => c.section.includes(needle));
  if (!hit) throw new Error(`Korpusta "${needle}" bolumu bulunamadi`);
  return hit;
};

const selectCases: { section: string; query: string; must: string | null; note: string }[] = [
  // --- coklu olgu tasiyan maddeler: dogru kalem secilmeli ---
  { section: 'Doğum ve Evlilik Yardımı', query: 'Doğum yardımı ne kadar?', must: '15.000', note: 'dogum yardimi' },
  { section: 'Doğum ve Evlilik Yardımı', query: 'Evlilik yardımı ne kadar?', must: '10.000', note: 'evlilik yardimi' },
  { section: 'Yemek ve Yol Desteği', query: 'Yemek kartına günlük ne kadar yükleniyor?', must: '250 TL', note: 'yemek karti' },
  { section: 'Yemek ve Yol Desteği', query: 'Yol desteği aylık ne kadar?', must: '1.500 TL', note: 'yol destegi' },
  { section: 'Hibrit Çalışma', query: 'Haftada kaç gün uzaktan çalışabilirim?', must: '2 gün', note: 'uzaktan calisma gunu' },

  // --- ayni CUMLE icinde iki olgu: yan cumleye inilmeli ---
  // "tehlikeli", "az tehlikeli" ifadesinin de icinde gectigi icin bu vaka
  // sozcuk duzeyinde en zorudur.
  { section: 'İSG Eğitimleri', query: 'Tehlikeli iş yerlerinde eğitim kaç yılda bir tekrarlanır?', must: '2 yıl', note: 'tehlikeli is yeri' },
  { section: 'Devamsızlık', query: 'Bir ayda toplam kaç iş günü devamsızlık fesih sebebidir?', must: '3 iş günü', note: 'aylik toplam devamsizlik' },
  // Sayilar TEK yan cumlede toplaniyorsa daraltma YAPILMAMALI: "1 yaşını" ile
  // "1,5 saat" rakip degil. Daraltilirsa model "1 saat" diyordu.
  { section: 'Süt İzni', query: 'Süt izni günde kaç saat?', must: '1,5 saat', note: 'sut izni — daraltma yapilmamali' },

  // --- ayirt edilemeyen durumda secim YAPILMAMALI ---
  {
    section: 'Doğum ve Evlilik Yardımı',
    query: 'Bu madde neyi düzenler?',
    must: null,
    note: 'ayirt edici terim yok → secim yok',
  },
];

for (const c of selectCases) {
  const hit = bySection(c.section);
  const got = selectEvidence(hit.text, c.query, { heading: hit.section });

  if (c.must === null) {
    check(got === null, `${c.note}`, got ? `secim yapildi: ${got.sentence}` : '');
  } else {
    check(
      !!got && got.sentence.includes(c.must),
      `${c.note} → "${c.must}"`,
      got ? `secilen: ${got.sentence}` : 'secim yapilmadi',
    );
  }
}

// ------------------------------------------- 3) guvenlik: yanlis secim taramasi
// Secim yapildiginda, secilen cumle parcanin GERCEK bir parcasi olmali.
console.log('\n  Butunluk (secilen cumle parcanin icinde mi)\n');
let integrity = 0;
let selected = 0;
for (const c of chunks.slice(0, 40)) {
  const e = selectEvidence(c.text, c.section, { heading: c.section });
  if (!e) continue;
  selected++;
  if (c.text.includes(e.sentence)) integrity++;
}
check(integrity === selected, `${selected} secimin ${integrity} tanesi parca metninde birebir var`);

console.log(`\n  ${failures === 0 ? 'TUMU GECTI' : `${failures} test BASARISIZ`}\n`);
process.exit(failures === 0 ? 0 : 1);
