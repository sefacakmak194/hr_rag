/**
 * Cevap kalitesi degerlendirme paketi.
 *
 * test-rag.ts yalnizca RETRIEVAL'i olcer (dogru madde bulundu mu). Bu script
 * uctan uca CEVABI olcer: uretilen metin dogru sayiyi/olguyu iceriyor mu.
 *
 * Neden gerekli: retrieval kusursuz calisirken cevap yanlis olabilir. Ornek —
 * "Dogum yardimi ne kadar?" sorusunda dogru madde getirildigi halde model,
 * ayni maddede once gecen EVLILIK yardimi tutarini veriyordu. Model/prompt
 * degisikligini gozle karsilastirmak yerine bu paketle olcun.
 *
 * Vakalar ve sorgu yardimcilari eval-cases.ts icindedir (compare-models.ts ile
 * paylasilir). Bu dosya yalnizca kosturma ve raporlamadan sorumludur.
 *
 * Kullanim:
 *   cd server && npm run eval                 # calisan sunucuya karsi
 *   npm run eval -- http://localhost:5273     # farkli adres
 *   EVAL_GROUP=Ayrım npm run eval             # tek grup
 */
import { cases, runCase } from './eval-cases.js';

const BASE = process.argv[2] ?? 'http://localhost:5273';

const onlyGroup = process.env.EVAL_GROUP;
const selected = onlyGroup ? cases.filter((c) => c.group === onlyGroup) : cases;

console.log(`\n  Cevap kalitesi degerlendirmesi — ${selected.length} vaka`);
console.log(`  Hedef: ${BASE}\n`);

let pass = 0;
let fail = 0;
let knownFail = 0;
const failures: string[] = [];
const durations: number[] = [];
let lastGroup = '';

for (const c of selected) {
  if (c.group !== lastGroup) {
    console.log(`  --- ${c.group} ---`);
    lastGroup = c.group;
  }

  const r = await runCase(BASE, c);
  durations.push(r.seconds);

  if (r.ok) pass++;
  else if (c.known) knownFail++;
  else fail++;

  const tag = r.ok ? 'PASS' : c.known ? 'KNOWN' : 'FAIL';
  console.log(`  ${tag.padEnd(5)} [${c.id}] ${c.question}  (${r.seconds.toFixed(1)}s)`);

  if (!r.ok) {
    console.log(`        ${r.why.join(' | ')}`);
    console.log(`        yanit: ${r.answer.trim().replace(/\n+/g, ' ').slice(0, 160)}`);
    if (c.known) console.log(`        bilinen: ${c.known}`);
    failures.push(`[${c.id}] ${c.question}`);
  }
}

const total = selected.length;
const avg = durations.reduce((s, v) => s + v, 0) / (durations.length || 1);
const sorted = [...durations].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
const slowest = Math.max(...durations, 0);

console.log('\n  ' + '='.repeat(60));
console.log(`  Skor    : ${pass}/${total} gecti` + (knownFail ? ` (+${knownFail} bilinen zor vaka)` : ''));
console.log(`  Basarim : %${((pass / total) * 100).toFixed(1)}`);
console.log(`  Sure    : ortalama ${avg.toFixed(1)}s · medyan ${median.toFixed(1)}s · en yavas ${slowest.toFixed(1)}s`);
if (failures.length) {
  console.log(`\n  Basarisiz:`);
  for (const f of failures) console.log(`    - ${f}`);
}
console.log('');

process.exit(fail === 0 ? 0 : 1);
