/**
 * 10.000 soruluk tarama — hangi sorular CEVAPSIZ kaliyor?
 *
 * NEDEN LLM CALISTIRILMIYOR
 *
 * "Bu sorunun cevabi var mi?" karari modelden ONCE veriliyor. Sirayla: niyet
 * katmani, kapsam disi listesi, kademe hesaplayicisi, sonra alaka kapisi.
 * Kapi kapaliysa istek LLM'e HIC gitmez ve kullanici sabit "bilgi
 * bulunmamaktadir" yanitini alir. Yani cevapsizligi belirleyen sey GETIRME,
 * uretim degil.
 *
 * Bunun olcumdeki karsiligi buyuk: 10.000 uretim ~3 saat surer ve bugun
 * olculdugu gibi Foundry daemon'u o sure icinde bozuluyor (7,5 saatte 19/52).
 * Yalnizca getirme ise dakikalar suruyor ve TEKRARLANABILIR — ayni girdi her
 * zaman ayni skoru verir, model orneklemesi devrede degil.
 *
 * Uretim kalitesi ayri bir olcumdur ve `npm run eval` onu zaten yapiyor.
 *
 * VERITABANI
 *
 * Uretim veritabaninin `VACUUM INTO` ile alinmis kopyasi kullanilir. Tarama
 * salt okur, ama kullanicinin acik sunucusuyla ayni dosyaya yuklenmemek ve
 * olcumu kirletmemek icin kopya alinir (eval ile ayni disiplin).
 *
 * Kullanim:
 *   npm run sweep                 # 10.000 sorgu
 *   npm run sweep -- --ornek 500  # hizli deneme
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { bankayiUret, temelSorular, type Sorgu } from './question-bank.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KOK = path.resolve(HERE, '..');
const CIKTI = path.join(KOK, 'data', 'tarama');

// --- veritabani kopyasi: modulleri YUKLEMEDEN once DB_PATH ayarlanmali ---
const kaynakDb = process.env.DB_PATH ?? path.join(KOK, 'data', 'vectors.db');
if (!fs.existsSync(kaynakDb)) {
  console.error(`\n  Veritabani yok: ${kaynakDb}\n  Once "npm run ingest" calistirin.\n`);
  process.exit(2);
}

fs.mkdirSync(CIKTI, { recursive: true });
const kopyaDb = path.join(CIKTI, 'tarama.db');
fs.rmSync(kopyaDb, { force: true });
{
  const src = new DatabaseSync(kaynakDb, { readOnly: true });
  src.exec(`VACUUM INTO '${kopyaDb.replace(/'/g, "''")}'`);
  src.close();
}
process.env.DB_PATH = kopyaDb;

const { classifyIntent } = await import('../server/src/services/intent.service.js');
const { checkOutOfScope } = await import('../server/src/services/scope.service.js');
const { calculatePolicyAnswer } = await import('../server/src/services/policyCalculator.service.js');
const { expandQuery } = await import('../server/src/services/synonym.service.js');
const { turkceyiOnar } = await import('../server/src/services/diacritics.service.js');
const { generateQueryEmbedding, warmupEmbeddingModel } = await import(
  '../server/src/services/embedding.service.js'
);
const { retrieveWithDiagnostics, countChunks, SYSTEM_PRINCIPAL, getDb } = await import(
  '../server/src/services/vectorStore.service.js'
);
const { TOP_K, SIMILARITY_THRESHOLD } = await import('../server/src/config/constants.js');

/** Kullanicinin gercekten alacagi sonucun turu. */
type Karar =
  | 'mevzuat'      // alaka kapisi acildi, mevzuattan yanit uretilecek
  | 'hesaplanan'   // kademe tablosu — deterministik
  | 'sohbet'       // selamlama / tanitim / hatirlatma
  | 'kapsamDisi'   // KASITLI olarak disarida birakilmis konu
  | 'cevapsiz';    // alaka kapisina takildi — ASIL ARADIGIMIZ

interface Sonuc extends Sorgu {
  karar: Karar;
  top: number;
  belge: string | null;
  bolum: string | null;
}

const ornekArg = process.argv.indexOf('--ornek');
const ornek = ornekArg > -1 ? Number(process.argv[ornekArg + 1]) : 0;

let banka = bankayiUret();
if (ornek > 0) {
  // Her temel sorudan esit sayida almak icin adim atlanir; bastan kesmek
  // yalnizca ilk alanlari olcerdi.
  const adim = Math.max(1, Math.floor(banka.length / ornek));
  banka = banka.filter((_, i) => i % adim === 0).slice(0, ornek);
}

console.log(`\n  Tarama — ${banka.length} sorgu / ${temelSorular.length} temel soru`);
console.log(`  Indeks : ${countChunks()} parca · esik ${SIMILARITY_THRESHOLD} · TOP_K ${TOP_K}`);
console.log(`  Kopya  : ${path.relative(KOK, kopyaDb)}\n`);

await warmupEmbeddingModel();

const sonuclar: Sonuc[] = [];
const t0 = Date.now();

for (let i = 0; i < banka.length; i++) {
  const s = banka[i];
  const mesaj = s.metin;

  let karar: Karar = 'cevapsiz';
  let top = 0;
  let belge: string | null = null;
  let bolum: string | null = null;

  const intent = classifyIntent(mesaj, SYSTEM_PRINCIPAL);
  if (intent.kind !== 'rag') {
    karar = 'sohbet';
  } else if (checkOutOfScope(mesaj)) {
    karar = 'kapsamDisi';
  } else {
    const policy = calculatePolicyAnswer(mesaj);
    if (policy) {
      karar = 'hesaplanan';
      belge = policy.citation.doc;
      bolum = policy.citation.section;
    } else {
      const arama = expandQuery(turkceyiOnar(getDb(), mesaj));
      const vec = await generateQueryEmbedding(arama);
      const { chunks, diagnostics } = retrieveWithDiagnostics(
        vec, SYSTEM_PRINCIPAL, TOP_K, SIMILARITY_THRESHOLD, arama,
      );
      top = diagnostics.top;
      if (chunks.length) {
        karar = 'mevzuat';
        belge = chunks[0].docTitle;
        bolum = chunks[0].section;
      }
    }
  }

  sonuclar.push({ ...s, karar, top, belge, bolum });

  if ((i + 1) % 500 === 0 || i + 1 === banka.length) {
    const gecen = (Date.now() - t0) / 1000;
    const hiz = (i + 1) / gecen;
    const kalan = (banka.length - i - 1) / hiz;
    process.stdout.write(
      `\r  ${i + 1}/${banka.length}  ·  ${hiz.toFixed(0)} sorgu/sn  ·  kalan ~${kalan.toFixed(0)} sn   `,
    );
  }
}
console.log('\n');

// ------------------------------------------------------------------ ozet

const say = (k: Karar) => sonuclar.filter((s) => s.karar === k).length;
const yuzde = (n: number) => ((n / sonuclar.length) * 100).toFixed(1);

console.log('  SONUC DAGILIMI\n');
for (const k of ['mevzuat', 'hesaplanan', 'sohbet', 'kapsamDisi', 'cevapsiz'] as Karar[]) {
  console.log(`    ${k.padEnd(12)} ${String(say(k)).padStart(6)}  %${yuzde(say(k))}`);
}

// --- asil bulgu: cevaplanmasi BEKLENEN ama cevapsiz kalanlar ---
const bosluklar = sonuclar.filter((s) => s.beklenen === 'cevaplanmali' && s.karar === 'cevapsiz');

// --- ters hata: kapsam disi olmasi gereken ama cevaplanan ---
const sizanlar = sonuclar.filter(
  (s) => s.beklenen === 'kapsamDisi' && (s.karar === 'mevzuat' || s.karar === 'hesaplanan'),
);

console.log(`\n  Cevapsiz kalan (cevaplanmasi beklenen) : ${bosluklar.length}`);
console.log(`  Kapsam disi olup CEVAPLANAN            : ${sizanlar.length}`);

/** Temel soru bazinda: 20 ifadenin kaci cevapsiz kaldi? */
interface TemelOzet {
  id: string;
  alan: string;
  temel: string;
  cevapsiz: number;
  toplam: number;
  enIyiSkor: number;
  belge: string | null;
}

const temelHarita = new Map<string, TemelOzet>();
for (const s of sonuclar) {
  if (s.beklenen !== 'cevaplanmali') continue;
  let t = temelHarita.get(s.temelId);
  if (!t) {
    t = { id: s.temelId, alan: s.alan, temel: s.temel, cevapsiz: 0, toplam: 0, enIyiSkor: 0, belge: null };
    temelHarita.set(s.temelId, t);
  }
  t.toplam++;
  if (s.karar === 'cevapsiz') t.cevapsiz++;
  if (s.top > t.enIyiSkor) {
    t.enIyiSkor = s.top;
    t.belge = s.belge;
  }
}

const temelOzetler = [...temelHarita.values()];

/** TAM boslugu: hicbir ifadesi cevaplanmadi — korpusta gercekten yok. */
const tamBosluk = temelOzetler.filter((t) => t.cevapsiz === t.toplam);
/** KISMI: bazi ifadeler geciyor, bazilari gecmiyor — DAYANIKLILIK sorunu. */
const kismiBosluk = temelOzetler.filter((t) => t.cevapsiz > 0 && t.cevapsiz < t.toplam);

console.log(`\n  Temel soru durumu (${temelOzetler.length} soru):`);
console.log(`    tamamen cevapsiz  : ${tamBosluk.length}   ← korpusta konu YOK`);
console.log(`    kismen cevapsiz   : ${kismiBosluk.length}   ← IFADEYE gore degisiyor`);
console.log(`    tamamen cevaplanan: ${temelOzetler.length - tamBosluk.length - kismiBosluk.length}`);

/** Hangi donusum ne kadar kirilma uretiyor? */
const donusumKirilma = new Map<string, number>();
for (const s of sonuclar) {
  if (s.beklenen !== 'cevaplanmali') continue;
  if (s.karar === 'cevapsiz') donusumKirilma.set(s.donusum, (donusumKirilma.get(s.donusum) ?? 0) + 1);
}
const kirilmaSirali = [...donusumKirilma.entries()].sort((a, b) => b[1] - a[1]);

if (kirilmaSirali.length) {
  console.log('\n  IFADE DONUSUMUNE GORE KIRILMA (cevapsiz sayisi)\n');
  for (const [d, n] of kirilmaSirali.slice(0, 20)) {
    console.log(`    ${d.padEnd(22)} ${String(n).padStart(4)}`);
  }
}

// ------------------------------------------------------------------ dosyalar

const zaman = new Date().toISOString().replace(/[:.]/g, '-');

fs.writeFileSync(
  path.join(CIKTI, 'tarama-ham.json'),
  JSON.stringify({ zaman, esik: SIMILARITY_THRESHOLD, parca: countChunks(), sonuclar }, null, 1),
  'utf-8',
);

const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
fs.writeFileSync(
  path.join(CIKTI, 'tarama.csv'),
  ['﻿' + ['temel_id', 'alan', 'temel_soru', 'donusum', 'sorgu', 'beklenen', 'karar', 'top_skor', 'belge', 'bolum'].map(esc).join(',')]
    .concat(
      sonuclar.map((s) =>
        [s.temelId, s.alan, s.temel, s.donusum, s.metin, s.beklenen, s.karar, s.top.toFixed(4), s.belge, s.bolum]
          .map(esc)
          .join(','),
      ),
    )
    .join('\r\n'),
  'utf-8',
);

/** Korpus duzenlemesi icin asil girdi: tam bosluklar, alana gore. */
const alanaGore = new Map<string, TemelOzet[]>();
for (const t of tamBosluk) {
  const l = alanaGore.get(t.alan) ?? [];
  l.push(t);
  alanaGore.set(t.alan, l);
}

const satirlar: string[] = [
  '# Tarama raporu — cevapsiz kalan sorular',
  '',
  `Tarih: ${zaman}`,
  `Sorgu: ${sonuclar.length} (${temelSorular.length} temel soru × ${sonuclar.length / temelSorular.length} ifade)`,
  `İndeks: ${countChunks()} parça · eşik ${SIMILARITY_THRESHOLD}`,
  '',
  '## Özet',
  '',
  '| Sonuç | Adet | Oran |',
  '|---|---:|---:|',
  ...(['mevzuat', 'hesaplanan', 'sohbet', 'kapsamDisi', 'cevapsiz'] as Karar[]).map(
    (k) => `| ${k} | ${say(k)} | %${yuzde(say(k))} |`,
  ),
  '',
  `- Tamamen cevapsız temel soru: **${tamBosluk.length}**`,
  `- Kısmen cevapsız (ifadeye göre değişen): **${kismiBosluk.length}**`,
  `- Kapsam dışı olup cevaplanan: **${sizanlar.length}**`,
  '',
  '## Tamamen cevapsız konular — korpus düzenlemesi buradan',
  '',
];

for (const [alan, liste] of [...alanaGore.entries()].sort((a, b) => b[1].length - a[1].length)) {
  satirlar.push(`### ${alan} (${liste.length})`, '');
  satirlar.push('| Soru | En iyi skor | En yakın belge |');
  satirlar.push('|---|---:|---|');
  for (const t of liste.sort((a, b) => b.enIyiSkor - a.enIyiSkor)) {
    satirlar.push(`| ${t.temel} | ${t.enIyiSkor.toFixed(4)} | ${t.belge ?? '—'} |`);
  }
  satirlar.push('');
}

if (kismiBosluk.length) {
  satirlar.push(
    '## Kısmen cevapsız — bu bir korpus eksiği değil, DAYANIKLILIK sorunu',
    '',
    'Bu sorular bazı ifadelerle cevaplanıyor, bazılarıyla cevaplanmıyor. Korpusa',
    'içerik eklemek bunu çözmez; sorun ifade değişimine karşı kırılganlık.',
    '',
    '| Soru | Kırılan ifade | En iyi skor |',
    '|---|---:|---:|',
  );
  for (const t of kismiBosluk.sort((a, b) => b.cevapsiz - a.cevapsiz).slice(0, 60)) {
    satirlar.push(`| ${t.temel} | ${t.cevapsiz}/${t.toplam} | ${t.enIyiSkor.toFixed(4)} |`);
  }
  satirlar.push('');
}

if (kirilmaSirali.length) {
  satirlar.push('## Hangi ifade biçimi kırıyor?', '', '| Dönüşüm | Cevapsız |', '|---|---:|');
  for (const [d, n] of kirilmaSirali) satirlar.push(`| ${d} | ${n} |`);
  satirlar.push('');
}

if (sizanlar.length) {
  satirlar.push(
    '## Kapsam dışı olup cevaplanan — halüsinasyon riski',
    '',
    '| Sorgu | Karar | Skor | Belge |',
    '|---|---|---:|---|',
  );
  for (const s of sizanlar) {
    satirlar.push(`| ${s.metin} | ${s.karar} | ${s.top.toFixed(4)} | ${s.belge ?? '—'} |`);
  }
  satirlar.push('');
}

fs.writeFileSync(path.join(CIKTI, 'TARAMA-RAPORU.md'), satirlar.join('\n'), 'utf-8');

const sure = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`\n  Sure: ${sure} sn`);
console.log(`  Yazildi: data/tarama/TARAMA-RAPORU.md · tarama.csv · tarama-ham.json\n`);
