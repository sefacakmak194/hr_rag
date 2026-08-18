/**
 * Erisim kontrolu testleri — "kilit kapida" kararinin dogrulanmasi.
 *
 * Erisim kontrolu TEST EDILMEDEN "var" sayilamaz. Bu paket tek bir soruyu
 * dort ayri yoldan soruyor: yetkisiz kullanici kisitli dokumanin icerigine
 * ULASABILIYOR MU?
 *
 *   1) arama sonuclarinda   (scoreAllChunks)
 *   2) dayanak metninde     (findSectionText)  ← en kritik
 *   3) korpus listesinde    (listDocuments)
 *   4) sozcuk indeksinde    (BM25 istatistigi)
 *
 * Gercek embedding kullanilmaz: filtre vektor degerinden bagimsizdir ve sahte
 * vektorler testi hizli ve tamamen cevrimdisi tutar.
 *
 * Kullanim:  cd server && npm run test:access
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-access-'));
process.env.DB_PATH = path.join(dir, 'access-test.db');

const { getDb, insertChunk, listDocuments, findSectionText, scoreAllChunks, resetLexicalIndex } =
  await import('../server/src/services/vectorStore.service.js');
const { EMBEDDING_DIM } = await import('../server/src/config/constants.js');
import type { Principal } from '../server/src/services/identity.service.js';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
};

const calisan: Principal = { userId: 1, username: 'calisan', role: 'calisan' };
const ik: Principal = { userId: 2, username: 'ik', role: 'ik' };
const yonetici: Principal = { userId: 3, username: 'yonetici', role: 'yonetici' };

/** Sahte ama deterministik vektor — filtre vektor degerine bakmaz. */
function fakeVector(seed: number): Float32Array {
  const v = new Float32Array(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i++) v[i] = Math.sin(seed * (i + 1)) / 20;
  return v;
}

// --------------------------------------------------------------- korpus
const db = getDb();

const GIZLI_METIN = 'Üst yönetim ikramiyesi yıllık brüt 450.000 TL olarak ödenir.';
const GENEL_METIN = 'Yıllık ücretli izin süresi 14 gündür.';

insertChunk({ docTitle: 'izin.md', section: 'Madde 1: Yıllık İzin', content: GENEL_METIN, vector: fakeVector(1) });
insertChunk({ docTitle: 'ucret_skalasi.md', section: 'Madde 1: İkramiye', content: GIZLI_METIN, vector: fakeVector(2) });
insertChunk({ docTitle: 'yonetim_kurulu.md', section: 'Madde 1: Huzur Hakkı', content: 'Huzur hakkı 90.000 TL.', vector: fakeVector(3) });

// izin.md documents tablosuna HIC yazilmiyor: Sprint 1 oncesi indekslenmis
// dokumanlarin 'genel' sayilmasi gerektigini de bu dogruluyor.
db.prepare("INSERT INTO documents (doc_title, access_label, source, indexed_at) VALUES (?, 'ik', 'markdown', ?)").run(
  'ucret_skalasi.md',
  new Date().toISOString(),
);
db.prepare("INSERT INTO documents (doc_title, access_label, source, indexed_at) VALUES (?, 'yonetici', 'markdown', ?)").run(
  'yonetim_kurulu.md',
  new Date().toISOString(),
);
resetLexicalIndex();

// --------------------------------------------------------------- 1) liste
console.log('\n  Korpus listesi\n');

const listeCalisan = listDocuments(calisan).map((d) => d.docTitle);
const listeIk = listDocuments(ik).map((d) => d.docTitle);
const listeYonetici = listDocuments(yonetici).map((d) => d.docTitle);

check(listeCalisan.join(',') === 'izin.md', `calisan: ${listeCalisan.join(', ')}`);
check(listeIk.join(',') === 'izin.md,ucret_skalasi.md', `ik: ${listeIk.join(', ')}`);
check(listeYonetici.length === 3, `yonetici: ${listeYonetici.join(', ')}`);
check(
  !listeCalisan.includes('ucret_skalasi.md'),
  'dokuman ADI bile sizmiyor',
  'dosya adi tek basina bilgi tasir',
);

// --------------------------------------------------------------- 2) arama
console.log('\n  Arama havuzu (kilit kapida)\n');

// Gizli parcaya TAM ISABET eden bir sorgu vektoru: filtre olmasaydi birinci
// sirada cikardi. Yani bu test filtreyi gercekten zorluyor.
const gizliVektor = fakeVector(2);

const aramaCalisan = scoreAllChunks(gizliVektor, 'ikramiye brüt ödeme', calisan);
const aramaIk = scoreAllChunks(gizliVektor, 'ikramiye brüt ödeme', ik);

check(aramaCalisan.length === 1, `calisan havuzunda ${aramaCalisan.length} parca (beklenen 1)`);
check(
  !aramaCalisan.some((c) => c.content.includes('450.000')),
  'gizli tutar arama sonucunda YOK',
  aramaCalisan.map((c) => c.content).join(' | '),
);
check(
  aramaIk.some((c) => c.content.includes('450.000')),
  'ik ayni sorguda gizli tutari GORUYOR',
  'filtre fazla genis olmamali — yetkili kullanici erisebilmeli',
);
check(aramaIk.length === 2, `ik havuzunda ${aramaIk.length} parca (beklenen 2)`);

// --------------------------------------------------------------- 3) dayanak
console.log('\n  Dayanak metni — EN KRITIK\n');

check(
  findSectionText('ucret_skalasi.md', 'Madde 1: İkramiye', calisan) === null,
  'calisan kisitli maddenin tam metnini alamiyor',
  'yanit gizlense bile dayanak blogu sizdirabilir',
);
check(
  (findSectionText('ucret_skalasi.md', 'Madde 1: İkramiye', ik) ?? '').includes('450.000'),
  'ik ayni maddenin tam metnini alabiliyor',
);
check(
  (findSectionText('izin.md', 'Madde 1: Yıllık İzin', calisan) ?? '').includes('14 gün'),
  'calisan genel maddeye erisebiliyor',
);

// --------------------------------------------------------------- 4) BM25
console.log('\n  Sozcuk indeksi rol basina ayri\n');

// "ikramiye" yalnizca gizli dokumanda geciyor. Calisan icin bu sozcuk
// korpusta HIC gecmemis gibi davranmali; aksi halde IDF istatistigi
// goremedigi dokuman hakkinda bilgi tasir.
const calisanIkramiye = scoreAllChunks(fakeVector(9), 'ikramiye', calisan);
check(
  calisanIkramiye.every((c) => c.lexicalScore === 0),
  'calisan icin "ikramiye" sozcugu hicbir parcayi eslestirmiyor',
  calisanIkramiye.map((c) => `${c.docTitle}=${c.lexicalScore.toFixed(3)}`).join(' '),
);

const ikIkramiye = scoreAllChunks(fakeVector(9), 'ikramiye', ik);
check(
  ikIkramiye.some((c) => c.lexicalScore > 0),
  'ik icin ayni sozcuk eslesiyor',
  'rol basina indeks kurulmus olmali',
);

// --------------------------------------------------------------- 5) varsayilan
console.log('\n  Etiketsiz dokuman varsayilani\n');

check(
  listDocuments(calisan).some((d) => d.docTitle === 'izin.md'),
  'documents tablosunda kaydi olmayan dokuman genel sayiliyor',
  'Sprint 1 oncesi indekslenmis 20 dokuman icin gecerli',
);

db.close();
try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch {
  // Windows'ta dosya kilidi kalabilir.
}

console.log(`\n  ${failures === 0 ? 'TUMU GECTI' : `${failures} test BASARISIZ`}\n`);
process.exit(failures === 0 ? 0 : 1);
