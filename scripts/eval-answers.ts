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
 * VARSAYILAN OLARAK YALITILMIS KOSAR: veritabaninin anlik kopyasi uzerinde
 * kendi sunucusunu ayaga kaldirir. Sebep — her vaka bir denetim satiri yaziyor
 * ve calisan sunucuya karsi kosturuldugunda bunlar KULLANICININ gercek denetim
 * kaydina dusuyordu (olculdu: tek kosum 70+ kalici satir birakti; denetim
 * kaydi silinemez oldugu icin bu gurultu kalicidir). Bkz. eval-sandbox.ts.
 *
 * Kullanim:
 *   npm run eval                              # yalitilmis (onerilen)
 *   npm run eval -- http://localhost:5273     # BELIRLI bir sunucuya karsi
 *   EVAL_GROUP=Ayrım npm run eval             # tek grup
 */
import { cases, runCase, isLlmCase } from './eval-cases.js';
import { openEvalSession } from './eval-auth.js';
import { startEvalSandbox, type EvalSandbox } from './eval-sandbox.js';

/** Acikca adres verildiyse O sunucuya gidilir; verilmediyse yalitilmis kosum. */
const explicitBase = process.argv[2];

const onlyGroup = process.env.EVAL_GROUP;
const selected = onlyGroup ? cases.filter((c) => c.group === onlyGroup) : cases;

console.log(`\n  Cevap kalitesi degerlendirmesi — ${selected.length} vaka`);

let sandbox: EvalSandbox | null = null;
let BASE: string;
let cookie: string;

if (explicitBase) {
  // Belirli bir sunucuya karsi kosum: denetim satirlari O SUNUCUNUN
  // veritabanina yazilir ve silinemez. Sessizce yapilmamali.
  console.log(`  Hedef: ${explicitBase}`);
  console.log('  UYARI: bu sunucunun denetim kaydina kalici satirlar yazilacak.\n');
  // Kimlik ONCE alinir: aksi halde tum vakalar 401 yer ve cikti "cevap
  // kalitesi kotu" gibi gorunur. Bkz. eval-auth.ts.
  const session = await openEvalSession(explicitBase);
  process.on('exit', () => session.close());
  BASE = explicitBase;
  cookie = session.cookie;
} else {
  console.log('  Yalitilmis kosum: veritabaninin anlik kopyasi hazirlaniyor…');
  sandbox = await startEvalSandbox();
  console.log(`  Hedef: ${sandbox.base} (gecici kopya)\n`);
  BASE = sandbox.base;
  cookie = sandbox.cookie;
}

/** Yalitilmis sunucu ve gecici kopya her cikista temizlenir. */
async function cleanup(): Promise<void> {
  if (!sandbox) return;
  const s = sandbox;
  sandbox = null;
  await s.stop();
}
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void cleanup().then(() => process.exit(130));
  });
}

// ISINMA: ilk istek embedding modelini ve LLM yuklemesini tetikler. Olcume
// katilirsa ortalama ve "en yavas" degerleri yaniltir. Yalnizca yalitilmis
// kosumda gerekli; calisan sunucu zaten isinmis olur.
if (!explicitBase) {
  console.log('  Isinma vakasi kosuluyor (olcume katilmaz)…\n');
  await runCase(BASE, selected.find(isLlmCase) ?? selected[0], cookie);
}

const session = { cookie };

let pass = 0;
let fail = 0;
let knownFail = 0;
const failures: string[] = [];
const durations: number[] = [];
/** Bozuk yanit kalkaninin devreye girdigi vaka sayisi — model saglik gostergesi. */
let replacedCount = 0;
let lastGroup = '';

for (const c of selected) {
  if (c.group !== lastGroup) {
    console.log(`  --- ${c.group} ---`);
    lastGroup = c.group;
  }

  const r = await runCase(BASE, c, session.cookie);
  durations.push(r.seconds);
  if (r.replaced) replacedCount++;

  if (r.ok) pass++;
  else if (c.known) knownFail++;
  else fail++;

  const tag = r.ok ? 'PASS' : c.known ? 'KNOWN' : 'FAIL';
  const mark = r.replaced ? ' [kalkan]' : '';
  console.log(`  ${tag.padEnd(5)} [${c.id}] ${c.question}  (${r.seconds.toFixed(1)}s)${mark}`);

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
if (replacedCount) {
  // Kalkan sik devreye giriyorsa sorun cevap kalitesi degil MODEL SAGLIGI:
  // Foundry daemon'i uzun sure ayakta kalinca bozuk jeton uretmeye basliyor.
  console.log(`  Kalkan  : ${replacedCount} vakada bozuk uretim yakalandi (foundry server restart deneyin)`);
}
if (failures.length) {
  console.log(`\n  Basarisiz:`);
  for (const f of failures) console.log(`    - ${f}`);
}
console.log('');

await cleanup();
process.exit(fail === 0 ? 0 : 1);
