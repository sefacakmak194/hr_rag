/**
 * Esik + hibrit agirlik kalibrasyonu.
 *
 * Iki soruyu veriyle yanitlar:
 *   1) Sozcuk bileseninin agirligi (LEXICAL_WEIGHT) kac olmali?
 *   2) O agirlikta alaka kapisi esigi (SIMILARITY_THRESHOLD) kac olmali?
 *
 * Yontem: her sorgu icin TUM parcalarin kosinus ve BM25 bilesenleri alinir,
 * w degerleri supurulur ve her w icin "kapsam-ici min top" ile "kapsam-disi
 * maks top" arasindaki AYRIM BOSLUGU olculur. Bosluk ne kadar genisse esik
 * o kadar saglamdir.
 *
 * ONEMLI: Korpus her degistiginde yeniden calistirilmali.
 *
 * Kullanim:  cd server && npx tsx ../scripts/calibrate.ts
 */
import { generateQueryEmbedding } from '../server/src/services/embedding.service.js';
import { scoreAllChunks, countChunks } from '../server/src/services/vectorStore.service.js';

const inScope = [
  'Öğle molası saat kaçta?',
  'Hafta içi mesai saatleri nedir?',
  'Fazla mesai ücreti nasıl hesaplanır?',
  'Gece vardiyasında zam var mı?',
  'Hafta sonu nöbet tutarsam ne kadar alırım?',
  '5 yıllık çalışan kaç gün yıllık izin kullanabilir?',
  'Babalık izni kaç gün?',
  'Süt izni günde kaç saat?',
  'Analık izni ne kadar sürer?',
  'Raporumu kaç gün içinde bildirmeliyim?',
  'Ücretsiz izin en fazla kaç gün?',
  'Sınav izni alabilir miyim?',
  'Maaşlar hangi gün yatıyor?',
  'Avans talebi nasıl yapılır?',
  'Yemek kartına günlük ne kadar yükleniyor?',
  'Kreş desteği ne kadar?',
  'Doğum yardımı ne kadar ödeniyor?',
  'Bayram ikramiyesi veriliyor mu?',
  'Kıdem tazminatı nasıl hesaplanır?',
  'Deneme süresi ne kadar?',
  'İstifa edersem ihbar süresi ne kadar?',
  'Çıkışta zimmetimi kime teslim edeceğim?',
  'Referans primi var mı?',
  'Performans değerlendirmesi ne zaman yapılıyor?',
  'Terfi için kaç ay çalışmam gerekiyor?',
  'Yıllık eğitim bütçem ne kadar?',
  'Kaç gün devamsızlık yaparsam işten çıkarılırım?',
  'Disiplin cezasına itiraz edebilir miyim?',
  'İş kazasını kaç gün içinde bildirmeliyim?',
  'Mobbing bildirimini nereye yapabilirim?',
  'Özlük dosyam ne kadar süre saklanıyor?',
  'Tedarikçiden hediye kabul edebilir miyim?',
  'Haftada kaç gün uzaktan çalışabilirim?',
  'Harcırah masraf fişlerimi kaç gün içinde yüklemeliyim?',
];

const outOfScope = [
  'Şirket bana özel araç tahsisi yapıyor mu?', // sartname Soru 3 — kapsam disi KALMALI
  'Hisse senedi opsiyonu alabilir miyim?',
  'Yemekhanede bugün ne var?',
  'İstanbul hava durumu nasıl?',
  'Bitcoin fiyatı ne kadar?',
  'Şirketin bu çeyrek cirosu ne oldu?',
  'Ofise evcil hayvan getirebilir miyim?',
  'Python nasıl öğrenilir?',
  'Kaç yaşındasın?',
  'Bana bir şiir yaz',
];

if (countChunks() === 0) {
  console.error('\n  Indeks bos. Once `npm run ingest` calistirin.\n');
  process.exit(1);
}

interface Components { vec: number[]; lex: number[] }

/** Her sorgu icin tum parcalarin (kosinus, bm25) bilesenlerini toplar. */
async function components(q: string): Promise<Components> {
  const vector = await generateQueryEmbedding(q);
  const scored = scoreAllChunks(vector, q);
  return { vec: scored.map((s) => s.vectorScore), lex: scored.map((s) => s.lexicalScore) };
}

const fuse = (c: Components, w: number) => {
  let best = -Infinity;
  for (let i = 0; i < c.vec.length; i++) {
    const s = (1 - w) * c.vec[i] + w * c.lex[i];
    if (s > best) best = s;
  }
  return best;
};

console.log(`\n  Hibrit kalibrasyon — ${countChunks()} parca`);
console.log(`  ${inScope.length} kapsam-ici / ${outOfScope.length} kapsam-disi sorgu\n`);

const icComp: Components[] = [];
const disComp: Components[] = [];
for (const q of inScope) icComp.push(await components(q));
for (const q of outOfScope) disComp.push(await components(q));

const fmt = (n: number) => n.toFixed(4).padStart(8);

console.log('  w      ici-min  dis-maks bosluk   onerilen esik');
console.log('  ' + '-'.repeat(56));

let best: { w: number; gap: number; threshold: number } | null = null;

for (let w = 0; w <= 0.6001; w += 0.05) {
  const icMin = Math.min(...icComp.map((c) => fuse(c, w)));
  const disMax = Math.max(...disComp.map((c) => fuse(c, w)));
  const gap = icMin - disMax;
  const threshold = (icMin + disMax) / 2;

  const marker = gap > (best?.gap ?? -Infinity) ? '  <— en genis' : '';
  console.log(`  ${w.toFixed(2)}  ${fmt(icMin)} ${fmt(disMax)} ${fmt(gap)} ${gap > 0 ? fmt(threshold) : '     —  '}${marker}`);

  if (!best || gap > best.gap) best = { w, gap, threshold };
}

console.log('');
if (best && best.gap > 0) {
  console.log(`  SECIM: LEXICAL_WEIGHT=${best.w.toFixed(2)}  SIMILARITY_THRESHOLD=${best.threshold.toFixed(3)}`);
  console.log(`  Ayrim bosluğu: ${best.gap.toFixed(4)}`);

  const baseline = (() => {
    const icMin = Math.min(...icComp.map((c) => fuse(c, 0)));
    const disMax = Math.max(...disComp.map((c) => fuse(c, 0)));
    return icMin - disMax;
  })();
  console.log(`  Salt vektor (w=0) bosluğu: ${baseline.toFixed(4)} → ${(best.gap / Math.max(baseline, 1e-9)).toFixed(1)}x iyilesme`);
} else {
  console.log('  UYARI: Hicbir agirlikta temiz ayrim yok.');
}

// En zorlu ornekler — esigin iki yanindaki sinir vakalari
if (best) {
  const w = best.w;
  const icRanked = inScope
    .map((q, i) => ({ q, s: fuse(icComp[i], w) }))
    .sort((a, b) => a.s - b.s)
    .slice(0, 3);
  const disRanked = outOfScope
    .map((q, i) => ({ q, s: fuse(disComp[i], w) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3);

  console.log('\n  En zayif kapsam-ici (esige en yakin alttan):');
  for (const r of icRanked) console.log(`    ${r.s.toFixed(4)}  ${r.q}`);
  console.log('\n  En guclu kapsam-disi (esige en yakin ustten):');
  for (const r of disRanked) console.log(`    ${r.s.toFixed(4)}  ${r.q}`);
}
console.log('');
