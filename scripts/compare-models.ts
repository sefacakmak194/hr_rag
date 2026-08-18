/**
 * Model karsilastirma matrisi.
 *
 * NEDEN: "su modeli kullandim" demek ile "modeli olcup sectim" demek ayni sey
 * degil. Bu script AYNI degerlendirme vakalarini (eval-cases.ts) birden cok
 * Foundry Local modeliyle kosturur ve dogruluk/gecikme tablosunu uretir.
 *
 * NASIL: her model icin AYRI bir sunucu sureci ayaga kaldirilir (kendi portu,
 * FOUNDRY_MODEL degiskeni sabitlenmis olarak), hazir olmasi beklenir, vakalar
 * kosturulur, surec kapatilir. Boylece modeller birbirine karismaz.
 *
 * DIKKAT: `npm start` .env.local dosyasini yukler ve FOUNDRY_MODEL'i ezebilir.
 * Bu yuzden burada tsx dogrudan cagrilir ve ortam degiskeni acikca verilir.
 *
 * Kullanim:
 *   cd server && npm run compare
 *   npm run compare -- qwen2.5-1.5b-instruct-cuda-gpu qwen2.5-7b-instruct-generic-cpu
 *   COMPARE_LLM_ONLY=1 npm run compare      # yalnizca LLM'e giden vakalar
 *
 * Sure uyarisi: CPU varyantlarinda tek yanit 20-60 sn surebilir. Tam liste ile
 * bir kosum yarim saati bulabilir.
 */
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cases, runCase, isLlmCase, type EvalCase } from './eval-cases.js';

const execFileAsync = promisify(execFile);
const FOUNDRY_BIN = process.platform === 'win32' ? 'foundry.exe' : 'foundry';

/**
 * Modeli daemon'a yukler / bellekten atar.
 *
 * DIKKAT — bu adim ZORUNLU. /v1/models onbellekteki TUM varyantlari listeler,
 * yuklu olanlari degil. Yuklenmemis bir modele istek gonderildiginde Foundry
 * hemen hata donuyor ve karsilastirma "model kotu" gibi yanlis bir sonuc
 * uretiyor: ilk kosumda uc model de 0.1 sn'de 15/48 ile ayni sekilde coktu —
 * hicbiri aslinda calistirilmamisti.
 *
 * Unload ayrica bellegi de bosaltir; art arda dort model olcerken RAM'in
 * dolmasini engeller.
 */
async function foundryModel(action: 'load' | 'unload', model: string): Promise<string | null> {
  try {
    await execFileAsync(FOUNDRY_BIN, ['model', action, model], {
      timeout: 10 * 60_000,
      windowsHide: true,
    });
    return null;
  } catch (error) {
    return (error as Error).message.split('\n')[0];
  }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'server');

/** Varsayilan aday listesi — bu makinede onbellekte bulunan varyantlar. */
const DEFAULT_MODELS = [
  'qwen2.5-1.5b-instruct-cuda-gpu',
  'qwen2.5-7b-instruct-generic-cpu',
  'Phi-3.5-mini-instruct-cuda-gpu',
];

const models = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_MODELS;
const llmOnly = process.env.COMPARE_LLM_ONLY === '1';
const selected: EvalCase[] = llmOnly ? cases.filter(isLlmCase) : cases;

interface ModelResult {
  model: string;
  started: boolean;
  activeModel?: string;
  pass: number;
  total: number;
  llmPass: number;
  llmTotal: number;
  durations: number[];
  failures: { id: string; question: string; why: string; answer: string }[];
  /** Vaka basina ham sonuc — tabloyu yeniden uretebilmek icin saklanir. */
  perCase: { id: string; ok: boolean; seconds: number }[];
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sunucu hazir olana kadar bekler; hazirsa saglik govdesini doner. */
async function waitForReady(port: number, timeoutMs: number): Promise<any | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`, {
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const body: any = await res.json();
        if (body?.index?.indexedChunks > 0 && body?.foundry?.online) return body;
      }
    } catch {
      /* henuz ayakta degil */
    }
    await sleep(1500);
  }
  return null;
}

/**
 * Sunucuyu ayri bir surecte baslatir.
 *
 * DIKKAT — Windows'ta `npx.cmd` spawn edilemez: Node 20+ .cmd icin `shell: true`
 * ister, o da DEP0190 uyarisi uretir (bu projede bilerek kacinilan bir sey).
 * Bunun yerine tsx'in JS giris noktasi node ile dogrudan calistirilir.
 */
const TSX_CLI = path.join(SERVER_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');

function startServer(model: string, port: number): ChildProcess {
  return spawn(process.execPath, [TSX_CLI, 'src/index.ts'], {
    cwd: SERVER_DIR,
    env: { ...process.env, FOUNDRY_MODEL: model, PORT: String(port) },
    stdio: 'ignore',
    windowsHide: true,
  });
}

async function stopServer(child: ChildProcess, port: number): Promise<void> {
  child.kill();
  // Windows'ta npx ara surec dogurur; port serbest kalana kadar bekle.
  for (let i = 0; i < 20; i++) {
    try {
      await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
    } catch {
      return;
    }
    await sleep(500);
  }
}

// ------------------------------------------------------------------ kosum
console.log(`\n  Model karsilastirmasi — ${models.length} model x ${selected.length} vaka`);
if (llmOnly) console.log("  (yalnizca LLM'e giden vakalar)");
console.log('');

const results: ModelResult[] = [];
let port = 5390;

for (const model of models) {
  port++;
  const r: ModelResult = {
    model,
    started: false,
    pass: 0,
    total: selected.length,
    llmPass: 0,
    llmTotal: selected.filter(isLlmCase).length,
    durations: [],
    failures: [],
    perCase: [],
  };

  console.log(`  --- ${model} (port ${port})`);

  process.stdout.write('      model yukleniyor... ');
  const loadError = await foundryModel('load', model);
  console.log(loadError ? `HATA: ${loadError}` : 'tamam');

  if (loadError) {
    r.error = `model yuklenemedi: ${loadError}`;
    results.push(r);
    console.log('');
    continue;
  }

  const child = startServer(model, port);
  const health = await waitForReady(port, 120_000);

  if (!health) {
    r.error = 'sunucu hazir olmadi (Foundry cevrimdisi ya da model yuklenemedi)';
    console.log(`      HATA: ${r.error}\n`);
    await stopServer(child, port);
    results.push(r);
    continue;
  }

  r.started = true;
  r.activeModel = health.foundry?.activeModel;
  if (r.activeModel !== model) {
    console.log(`      UYARI: istenen "${model}", etkin olan "${r.activeModel}"`);
  }

  const base = `http://localhost:${port}`;

  // Isinma: ilk istek model yuklemesini tetikler, olcume katilmaz.
  await runCase(base, selected.find(isLlmCase) ?? selected[0]);

  for (const c of selected) {
    const res = await runCase(base, c);
    r.durations.push(res.seconds);
    r.perCase.push({ id: c.id, ok: res.ok, seconds: res.seconds });
    if (res.ok) {
      r.pass++;
      if (isLlmCase(c)) r.llmPass++;
    } else {
      r.failures.push({
        id: c.id,
        question: c.question,
        why: res.why.join(' | '),
        answer: res.answer.trim().replace(/\s+/g, ' ').slice(0, 120),
      });
    }
    process.stdout.write(res.ok ? '.' : 'x');
  }

  console.log(`\n      ${r.pass}/${r.total} gecti`);
  await stopServer(child, port);

  // Bellegi bosalt: dort model art arda olculurken yuklu kalmalari gereksiz.
  const unloadError = await foundryModel('unload', model);
  console.log(unloadError ? `      bellekten atilamadi: ${unloadError}\n` : '      bellekten atildi\n');

  results.push(r);
}

// ------------------------------------------------------------------ rapor
const stats = (d: number[]) => {
  if (!d.length) return { avg: 0, median: 0, max: 0 };
  const s = [...d].sort((a, b) => a - b);
  return {
    avg: d.reduce((x, y) => x + y, 0) / d.length,
    median: s[Math.floor(s.length / 2)],
    max: s[s.length - 1],
  };
};

const rows = results.map((r) => {
  const st = stats(r.durations);
  return {
    model: r.model,
    score: r.started ? `${r.pass}/${r.total}` : '—',
    rate: r.started ? `%${((r.pass / r.total) * 100).toFixed(1)}` : '—',
    llm: r.started ? `${r.llmPass}/${r.llmTotal}` : '—',
    avg: r.started ? `${st.avg.toFixed(1)}s` : '—',
    median: r.started ? `${st.median.toFixed(1)}s` : '—',
    max: r.started ? `${st.max.toFixed(1)}s` : '—',
    note: r.error ?? '',
  };
});

console.log('\n  ' + '='.repeat(78));
console.log(
  '  ' + 'Model'.padEnd(34) + 'Skor'.padEnd(9) + 'LLM'.padEnd(9) +
  'Ort.'.padEnd(8) + 'Medyan'.padEnd(9) + 'En yavas',
);
for (const row of rows) {
  console.log(
    '  ' + row.model.padEnd(34) + row.score.padEnd(9) + row.llm.padEnd(9) +
    row.avg.padEnd(8) + row.median.padEnd(9) + row.max + (row.note ? `  (${row.note})` : ''),
  );
}
console.log('');

for (const r of results) {
  if (!r.failures.length) continue;
  console.log(`  ${r.model} — basarisiz vakalar:`);
  for (const f of r.failures) {
    console.log(`    [${f.id}] ${f.question}\n        ${f.why}\n        yanit: ${f.answer}`);
  }
  console.log('');
}

// ------------------------------------------------------- markdown ciktisi
const out = path.join(ROOT, 'data', 'MODEL-KARSILASTIRMA.md');
const lines: string[] = [
  '# Model Karşılaştırma Matrisi',
  '',
  `Üretim: \`npm run compare\` · ${new Date().toISOString().slice(0, 10)}`,
  `Vaka sayısı: ${selected.length}${llmOnly ? " (yalnızca LLM'e giden vakalar)" : ''}`,
  '',
  'Tüm modeller **aynı** değerlendirme vakalarıyla, **aynı** korpus ve eşiklerle ölçüldü.',
  "Kademe hesaplayıcısı, niyet katmanı ve alaka kapısı LLM çağırmadığından o vakalar",
  'her modelde aynıdır; modeller arasında ayırt edici olan "LLM vakaları" sütunudur.',
  '',
  '| Model | Skor | Başarım | LLM vakaları | Ortalama | Medyan | En yavaş |',
  '|---|---|---|---|---|---|---|',
  ...rows.map(
    (r) =>
      `| \`${r.model}\` | ${r.score} | ${r.rate} | ${r.llm} | ${r.avg} | ${r.median} | ${r.max} |` +
      (r.note ? ` <!-- ${r.note} -->` : ''),
  ),
  '',
];

for (const r of results) {
  if (!r.started) {
    lines.push(`## \`${r.model}\``, '', `Çalıştırılamadı: ${r.error}`, '');
    continue;
  }
  if (!r.failures.length) {
    lines.push(`## \`${r.model}\``, '', 'Tüm vakalar geçti.', '');
    continue;
  }
  lines.push(`## \`${r.model}\` — başarısız vakalar`, '');
  lines.push('| Vaka | Soru | Neden | Yanıt |', '|---|---|---|---|');
  for (const f of r.failures) {
    lines.push(`| ${f.id} | ${f.question} | ${f.why} | ${f.answer} |`);
  }
  lines.push('');
}

fs.writeFileSync(out, lines.join('\n'), 'utf-8');

// Ham sonuclar da yazilir: tablo bicimini ya da "LLM vakasi" tanimini
// degistirmek icin saatler suren kosumu tekrarlamak gerekmesin.
const raw = path.join(ROOT, 'data', 'model-karsilastirma.json');
fs.writeFileSync(
  raw,
  JSON.stringify({ date: new Date().toISOString(), llmOnly, cases: selected.map((c) => c.id), results }, null, 2),
  'utf-8',
);

console.log(`  Matris yazildi: ${path.relative(ROOT, out)}`);
console.log(`  Ham sonuclar  : ${path.relative(ROOT, raw)}\n`);

process.exit(0);
