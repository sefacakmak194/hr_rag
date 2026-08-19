/**
 * Kumeleme esigi kalibrasyonu (Sprint 4).
 *
 * `GAP_CLUSTER_THRESHOLD` sezgiyle secilemez: E5 kosinus skorlarini dar bir
 * banda sikistirir ve ALAKASIZ iki Turkce soru bile yuksek skor alabilir. Bu
 * betik ayni konunun farkli ifadeleri ile FARKLI konular arasindaki benzerlik
 * dagilimini olcer ve ayirim bosluğunu gosterir.
 *
 * Alaka esigi icin scripts/calibrate.ts ne yapiyorsa bu da onu yapiyor.
 *
 * Kullanim:  cd server && npx tsx ../scripts/calibrate-gap.ts
 */
import { generateQueryEmbedding, cosineSimilarity } from '../server/src/services/embedding.service.js';

/**
 * Gercekci yanitsiz sorular. Her grup AYNI bosluga isaret eder; gruplar
 * birbirinden acikca farklidir.
 */
const GRUPLAR: Record<string, string[]> = {
  kres: [
    'Kreş desteği için başvuru nasıl yapılır?',
    'Çocuk bakım yardımı almak için ne yapmalıyım?',
    'Anaokulu desteğine kimler başvurabilir?',
    'Kreş ücreti şirket tarafından karşılanıyor mu?',
  ],
  evcilHayvan: [
    'Ofise evcil hayvan getirebilir miyim?',
    'Köpeğimi işe getirmem serbest mi?',
    'İş yerinde kedi beslemek yasak mı?',
  ],
  hisse: [
    'Hisse senedi opsiyonu alabilir miyim?',
    'Çalışanlara pay opsiyonu veriliyor mu?',
    'Şirket hissesi satın alma programı var mı?',
  ],
  servis: [
    'Servis güzergahı değişikliği nasıl talep edilir?',
    'Servis durağımı değiştirebilir miyim?',
    'Yeni servis hattı açılması için kime başvurulur?',
  ],
  psikolog: [
    'Şirketin psikolojik destek hizmeti var mı?',
    'Kurumsal terapi desteği alabiliyor muyuz?',
  ],
};

const vectors = new Map<string, Float32Array>();
for (const sorular of Object.values(GRUPLAR)) {
  for (const soru of sorular) vectors.set(soru, await generateQueryEmbedding(soru));
}

const ici: number[] = [];
const disi: number[] = [];

const gruplar = Object.entries(GRUPLAR);
for (let g = 0; g < gruplar.length; g++) {
  const [, sorular] = gruplar[g];

  // Grup ICI
  for (let i = 0; i < sorular.length; i++) {
    for (let j = i + 1; j < sorular.length; j++) {
      ici.push(cosineSimilarity(vectors.get(sorular[i])!, vectors.get(sorular[j])!));
    }
  }

  // Grup DISI
  for (let h = g + 1; h < gruplar.length; h++) {
    for (const a of sorular) {
      for (const b of gruplar[h][1]) {
        disi.push(cosineSimilarity(vectors.get(a)!, vectors.get(b)!));
      }
    }
  }
}

const ozet = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return {
    min: s[0],
    p10: s[Math.floor(s.length * 0.1)],
    medyan: s[Math.floor(s.length / 2)],
    p90: s[Math.floor(s.length * 0.9)],
    maks: s[s.length - 1],
  };
};

const i = ozet(ici);
const d = ozet(disi);

console.log(`\n  Kumeleme esigi kalibrasyonu — ${ici.length} ayni-konu, ${disi.length} farkli-konu cifti\n`);
console.log(`  AYNI konu   min ${i.min.toFixed(4)}  p10 ${i.p10.toFixed(4)}  medyan ${i.medyan.toFixed(4)}  maks ${i.maks.toFixed(4)}`);
console.log(`  FARKLI konu min ${d.min.toFixed(4)}  medyan ${d.medyan.toFixed(4)}  p90 ${d.p90.toFixed(4)}  maks ${d.maks.toFixed(4)}`);
console.log('');
console.log(`  Ayirim bosluğu: ${(i.min - d.maks).toFixed(4)}  (ayni-min ${i.min.toFixed(4)} - farkli-maks ${d.maks.toFixed(4)})`);

if (i.min > d.maks) {
  const onerilen = (i.min + d.maks) / 2;
  console.log(`  AYRISIYOR. Onerilen esik: ${onerilen.toFixed(4)}`);
} else {
  console.log('  ORTUSUYOR — tek bir esik bu ornek kumesini temiz ayiramiyor.');
  // Ortusme varsa, hangi esigin en az hata verdigini goster.
  let best = { esik: 0, hata: Number.POSITIVE_INFINITY, kacan: 0, yanlis: 0 };
  for (let t = 0.7; t <= 0.99; t += 0.005) {
    const kacan = ici.filter((v) => v < t).length; // birlesmesi gerekirken ayrilan
    const yanlis = disi.filter((v) => v >= t).length; // ayrilmasi gerekirken birlesen
    // Yanlis birlesme DAHA KOTU: farkli konulari tek kumede gostermek raporu
    // yaniltir; fazladan kume yalnizca listeyi uzatir.
    const hata = kacan + yanlis * 3;
    if (hata < best.hata) best = { esik: t, hata, kacan, yanlis };
  }
  console.log(
    `  En iyi esik: ${best.esik.toFixed(3)} — ${best.kacan} ayni-konu cifti ayri kaliyor, ` +
      `${best.yanlis} farkli-konu cifti yanlis birlesiyor`,
  );
}

console.log('');
console.log('  AYNI konu ciftleri (dusukten yuksege):');
for (const v of [...ici].sort((a, b) => a - b).slice(0, 6)) console.log(`    ${v.toFixed(4)}`);
console.log('  FARKLI konu ciftleri (yuksekten dusuge):');
for (const v of [...disi].sort((a, b) => b - a).slice(0, 6)) console.log(`    ${v.toFixed(4)}`);
console.log('');
