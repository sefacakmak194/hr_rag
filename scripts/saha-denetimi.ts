/**
 * SAHA DENETIMI — 100 gercek calisan sorusu, UCTAN UCA.
 *
 * `sweep.ts` bilerek LLM'i atlar: 10.000 sorguda cevapsizligi belirleyen sey
 * GETIRME oldugu icin uretimi olcmek pahali ve gereksizdi. Bu betik tam
 * tersini yapar ve bilerek yapar: 100 soru kucuk bir kume, hepsini gercekten
 * uretmek dakikalar suruyor ve sorunun IKINCI yarisini aciyor —
 *
 *     "cevap geldi" ile "cevap DOGRU" ayni sey degildir.
 *
 * Iki hata turu ayri ayri raporlanir:
 *   BOSLUK — alaka kapisi kapandi, kullanici sabit "bilgi bulunmamaktadir" aldi
 *   SAPMA  — kapi acildi, cevap uretildi ama YANLIS/ILGISIZ maddeden geldi
 *
 * Ikincisi daha tehlikelidir: kullanici yanlis oldugunu anlamaz.
 *
 * YALITILMIS KOSAR. Her soru bir denetim satiri yazar; gercek veritabanina
 * kosturulursa 100 kalici satir birakir ve denetim kaydi silinemez.
 * (Bkz. eval-sandbox.ts — ayni gerekce.)
 *
 * Kullanim:
 *   npx tsx ../scripts/saha-denetimi.ts            # yalitilmis, tam set
 *   npx tsx ../scripts/saha-denetimi.ts --hizli    # LLM yok, yalnizca kapi
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sahaSorulari, type SahaSorusu } from './saha-sorulari.js';
import { ask } from './eval-cases.js';
import { startEvalSandbox, type EvalSandbox } from './eval-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KOK = path.resolve(HERE, '..');
const CIKTI = path.join(KOK, 'data', 'saha');

const hizli = process.argv.includes('--hizli');

/** Alaka kapisinin sabit yaniti — cevapsizligin imzasi. */
const YOK_IMZASI = 'bilgi bulunmamaktadır';

interface Sonuc extends SahaSorusu {
  cevap: string;
  kaynaklar: { doc: string; section: string }[];
  saniye: number;
  /** Sabit "bilgi yok" yaniti mi dondu? */
  bosluk: boolean;
  /** Beklenen olgulardan eksik olanlar. */
  eksik: string[];
  hata?: string;
  /** Bozuk uretim kalkani devreye girdi mi? */
  kalkan?: boolean;
}

fs.mkdirSync(CIKTI, { recursive: true });

console.log(`\n  Saha denetimi — ${sahaSorulari.length} soru (uctan uca)`);

let sandbox: EvalSandbox | null = null;
console.log('  Yalitilmis kosum: veritabaninin anlik kopyasi hazirlaniyor…');
sandbox = await startEvalSandbox();
console.log(`  Hedef: ${sandbox.base} (gecici kopya)\n`);

const BASE = sandbox.base;
const cookie = sandbox.cookie;

async function cleanup(): Promise<void> {
  if (!sandbox) return;
  const s = sandbox;
  sandbox = null;
  await s.stop();
}
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => void cleanup().then(() => process.exit(130)));
}

// Isinma: ilk istek embedding modelini ve LLM yuklemesini tetikler.
console.log('  Isinma sorusu (olcume katilmaz)…');
await ask(BASE, 'Mesai saatleri nedir?', 'saha-isinma', cookie);

const sonuclar: Sonuc[] = [];
const t0 = Date.now();
let sonAlan = '';

for (const s of sahaSorulari) {
  if (s.alan !== sonAlan) {
    console.log(`\n  --- ${s.alan} ---`);
    sonAlan = s.alan;
  }

  const r = hizli
    ? { answer: '', citations: [], seconds: 0, error: undefined, replaced: false }
    : await ask(BASE, s.soru, `saha-${s.id}-${Date.now()}`, cookie);

  const dusukCevap = r.answer.toLocaleLowerCase('tr');
  const bosluk = dusukCevap.includes(YOK_IMZASI.toLocaleLowerCase('tr'));
  const eksik = (s.bekle ?? []).filter((b) => !r.answer.includes(b));

  sonuclar.push({
    ...s,
    cevap: r.answer,
    kaynaklar: r.citations,
    saniye: r.seconds,
    bosluk,
    eksik,
    hata: r.error,
    kalkan: r.replaced,
  });

  const isaret = r.error ? 'HATA ' : bosluk ? 'BOSUK' : eksik.length ? 'EKSIK' : 'CEVAP';
  const beklenenBosluk = s.beklenen === 'kapsamDisi';
  const uyum = bosluk === beklenenBosluk && !eksik.length && !r.error ? ' ' : '!';
  console.log(
    `  ${uyum} ${isaret} [${s.id}] ${s.soru.slice(0, 62)}${s.soru.length > 62 ? '…' : ''}  (${r.seconds.toFixed(1)}s)`,
  );
  if (!bosluk && r.citations.length) {
    console.log(`          → ${r.citations[0].doc} · ${r.citations[0].section}`);
  }
  if (r.error) console.log(`          hata: ${r.error}`);
}

// ------------------------------------------------------------------ ozet

const bekleniyorCevap = sonuclar.filter((s) => s.beklenen === 'cevaplanmali');
const bekleniyorRed = sonuclar.filter((s) => s.beklenen === 'kapsamDisi');

/** BOSLUK: cevaplanmasi beklenen ama sabit "bilgi yok" donen. */
const bosluklar = bekleniyorCevap.filter((s) => s.bosluk);
/** SIZINTI: kapsam disi olmasi gereken ama cevaplanan. */
const sizintilar = bekleniyorRed.filter((s) => !s.bosluk);
/** OLGU HATASI: cevap geldi ama beklenen sayi yanitta yok. */
const olguHatalari = bekleniyorCevap.filter((s) => !s.bosluk && s.eksik.length);
const hatalar = sonuclar.filter((s) => s.hata);

const cevaplanan = bekleniyorCevap.length - bosluklar.length;
const oran = ((cevaplanan / bekleniyorCevap.length) * 100).toFixed(1);

console.log('\n  ' + '='.repeat(64));
console.log(`  Cevaplanmasi beklenen : ${bekleniyorCevap.length}`);
console.log(`  Cevaplanan            : ${cevaplanan}  (%${oran})`);
console.log(`  BOSLUK (cevapsiz)     : ${bosluklar.length}`);
console.log(`  SIZINTI (kapsam disi) : ${sizintilar.length} / ${bekleniyorRed.length}`);
console.log(`  Olgu hatasi           : ${olguHatalari.length}`);
if (hatalar.length) console.log(`  Aktarim hatasi        : ${hatalar.length}`);

const alanaGore = new Map<string, { toplam: number; bosluk: number }>();
for (const s of bekleniyorCevap) {
  const a = alanaGore.get(s.alan) ?? { toplam: 0, bosluk: 0 };
  a.toplam++;
  if (s.bosluk) a.bosluk++;
  alanaGore.set(s.alan, a);
}

console.log('\n  ALANA GORE BOSLUK\n');
for (const [alan, a] of [...alanaGore.entries()].sort((x, y) => y[1].bosluk - x[1].bosluk)) {
  const bar = '█'.repeat(a.bosluk) + '·'.repeat(a.toplam - a.bosluk);
  console.log(`    ${alan.padEnd(36)} ${String(a.bosluk).padStart(2)}/${a.toplam}  ${bar}`);
}

if (bosluklar.length) {
  console.log('\n  CEVAPSIZ KALANLAR\n');
  for (const s of bosluklar) console.log(`    [${s.id}] ${s.soru}`);
}
if (sizintilar.length) {
  console.log('\n  KAPSAM DISI OLUP CEVAPLANANLAR (halusinasyon riski)\n');
  for (const s of sizintilar) {
    console.log(`    [${s.id}] ${s.soru}`);
    console.log(`           → ${s.kaynaklar.map((k) => k.doc).join(', ') || '(kaynaksiz)'}`);
  }
}
if (olguHatalari.length) {
  console.log('\n  OLGU HATALARI (cevap geldi, beklenen deger yok)\n');
  for (const s of olguHatalari) {
    console.log(`    [${s.id}] eksik: ${s.eksik.join(', ')}`);
    console.log(`           ${s.cevap.replace(/\n+/g, ' ').slice(0, 140)}`);
  }
}

// ------------------------------------------------------------------ dosyalar

const zaman = new Date().toISOString().replace(/[:.]/g, '-');

fs.writeFileSync(
  path.join(CIKTI, 'saha-ham.json'),
  JSON.stringify({ zaman, sonuclar }, null, 1),
  'utf-8',
);

const satirlar: string[] = [
  '# Saha denetimi — 100 gerçek çalışan sorusu',
  '',
  `Tarih: ${zaman}`,
  `Ölçüm: uçtan uca (alaka kapısı + üretim), yalıtılmış sunucu`,
  '',
  '## Özet',
  '',
  '| Ölçüt | Değer |',
  '|---|---:|',
  `| Cevaplanması beklenen | ${bekleniyorCevap.length} |`,
  `| Cevaplanan | ${cevaplanan} (%${oran}) |`,
  `| **Boşluk — cevapsız** | **${bosluklar.length}** |`,
  `| Kapsam dışı sızıntı | ${sizintilar.length} / ${bekleniyorRed.length} |`,
  `| Olgu hatası | ${olguHatalari.length} |`,
  '',
  '## Alana göre boşluk',
  '',
  '| Alan | Cevapsız | Toplam |',
  '|---|---:|---:|',
  ...[...alanaGore.entries()]
    .sort((x, y) => y[1].bosluk - x[1].bosluk)
    .map(([alan, a]) => `| ${alan} | ${a.bosluk} | ${a.toplam} |`),
  '',
];

if (bosluklar.length) {
  satirlar.push('## Cevapsız kalan sorular — korpus düzenlemesi buradan', '');
  const grup = new Map<string, Sonuc[]>();
  for (const s of bosluklar) {
    const l = grup.get(s.alan) ?? [];
    l.push(s);
    grup.set(s.alan, l);
  }
  for (const [alan, liste] of [...grup.entries()].sort((a, b) => b[1].length - a[1].length)) {
    satirlar.push(`### ${alan} (${liste.length})`, '');
    for (const s of liste) satirlar.push(`- \`${s.id}\` ${s.soru}`);
    satirlar.push('');
  }
}

if (sizintilar.length) {
  satirlar.push('## Kapsam dışı olup cevaplanan', '', '| Soru | Kaynak |', '|---|---|');
  for (const s of sizintilar) {
    satirlar.push(`| ${s.soru} | ${s.kaynaklar.map((k) => k.doc).join(', ') || '—'} |`);
  }
  satirlar.push('');
}

satirlar.push('## Tüm sonuçlar', '', '| # | Soru | Sonuç | Kaynak |', '|---|---|---|---|');
for (const s of sonuclar) {
  const sonuc = s.hata ? 'hata' : s.bosluk ? '**cevapsız**' : s.eksik.length ? 'olgu hatası' : 'cevaplandı';
  satirlar.push(
    `| \`${s.id}\` | ${s.soru} | ${sonuc} | ${s.kaynaklar[0] ? `${s.kaynaklar[0].doc} · ${s.kaynaklar[0].section}` : '—'} |`,
  );
}
satirlar.push('');

fs.writeFileSync(path.join(CIKTI, 'SAHA-RAPORU.md'), satirlar.join('\n'), 'utf-8');

const sure = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`\n  Sure: ${sure} sn`);
console.log(`  Yazildi: data/saha/SAHA-RAPORU.md · saha-ham.json\n`);

await cleanup();
process.exit(0);
