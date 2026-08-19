/**
 * Turkce karakter onarimi testleri.
 *
 * NEDEN VAR: bu katman 10.000 soruluk taramanin (`npm run sweep`) bulgusu.
 * Duzgun Turkce ile CEVAPLANAN 114 soru, ayni soru Turkce karakter
 * kullanilmadan yazildiginda cevapsiz kaliyordu.
 *
 * Paketin iki isi var ve IKINCISI en az birincisi kadar onemli:
 *   1) diakritiksiz yazimi onarmak
 *   2) DOGRU yazilmisa dokunmamak — yanlis bir "onarim", calisan bir sorguyu
 *      bozar ve bu, onarmamaktan daha zararlidir.
 *
 * Yazilirken iki gercek hata yakalandi; ikisi de burada regresyon olarak duruyor:
 *   - Sozluk `doc_title`den de besleniyordu. Dosya adlari ASCII
 *     ("01_calisma_saatleri...") oldugu icin onarilmasi gereken sozcukler
 *     korpusta "zaten var" gorunuyor ve onarim sessizce calismiyordu.
 *   - Buyuk harfli sorguyu Turkce kurallarla kucultmek "I" harfini "ı" yapip
 *     OLMAYAN bir Turkce harf uretiyor, bu da onarimi tamamen iptal ediyordu.
 *
 * Kullanim:  cd server && npm run test:diacritics
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KOK = path.resolve(HERE, '..');

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
};

/**
 * Testin kendi veritabani. Uretim korpusuna bagimli olmamak icin sozluk
 * elle kurulan kucuk bir `chunks` tablosundan turetilir; boylece beklenen
 * onarimlar korpus degisse de sabit kalir.
 */
const dbYolu = path.join(KOK, 'data', `.test-diacritics-${process.pid}.db`);
fs.mkdirSync(path.dirname(dbYolu), { recursive: true });
fs.rmSync(dbYolu, { force: true });

const db = new DatabaseSync(dbYolu);
db.exec(`
  CREATE TABLE chunks (
    id INTEGER PRIMARY KEY,
    doc_title TEXT NOT NULL,
    section   TEXT NOT NULL,
    content   TEXT NOT NULL
  );
`);

const ekle = db.prepare('INSERT INTO chunks (doc_title, section, content) VALUES (?, ?, ?)');
ekle.run(
  // Dosya adi BILEREK ASCII: gercek korpustaki desen bu ve sozlugu zehirleyen
  // seydi. Test bu tuzagi tasimali.
  '01_calisma_saatleri_ve_izinler.md',
  'Madde 1: Çalışma Saatleri',
  'Haftalık çalışma süresi 45 saattir. Öğle molası 12:30 ile 13:30 arasındadır. ' +
    'Nöbet ücreti günlük brüt ücretin iki katıdır. Kısmi süreli çalışma mümkündür.',
);
ekle.run(
  '04_uzaktan_calisma_ve_ekipman_guvenligi.md',
  'Madde 1: Uzaktan Çalışma',
  'Uzaktan çalışma günlerini yönetici belirler. Çalışan haftada iki gün uzaktan çalışabilir. ' +
    'Şifre en az sekiz karakter olmalıdır.',
);
// "kar" hem duz hem Turkce bicimde gecebilir: "korpusta oldugu gibi var" korumasi.
ekle.run('07_ucret.md', 'Madde 2: Kâr Payı', 'Kâr payı yıl sonunda dağıtılır. Kar yağışı nedeniyle idari izin verilebilir.');
// BELIRSIZLIK fixture'i: "halihazirda" katlanmis bicimine iki yazim BENZER
// SIKLIKTA denk geliyor (2 ve 2). Tahmin yapilmamali.
ekle.run(
  '09_ek.md',
  'Madde 9: Geçiş Hükümleri',
  'Hâlihazırda yürürlükte olan uygulama korunur. Hâlihazırda görevde olanlar için geçerlidir. ' +
    'Halihazırda başlatılmış süreçler tamamlanır. Halihazırda açılmış davalar saklıdır.',
);

const { turkceyiOnar, bagirmayiYumusat, katla } = await import(
  '../server/src/services/diacritics.service.js'
);

const onar = (q: string) => turkceyiOnar(db, q);

console.log('\n  Diakritiksiz yazim ONARILMALI\n');

const onarilacak: [string, string][] = [
  ['haftalik calisma suresi', 'haftalık çalışma süresi'],
  ['ogle molasi', 'öğle molası'],
  ['nobet ucreti', 'nöbet ücreti'],
  ['kismi sureli calisma', 'kısmi süreli çalışma'],
  ['uzaktan calisma gunlerini kim belirler', 'uzaktan çalışma günlerini kim belirler'],
  ['sifre kac karakter', 'şifre kac karakter'], // "kac" korpusta yok -> dokunulmaz
];

for (const [girdi, beklenen] of onarilacak) {
  const alinan = onar(girdi);
  check(alinan === beklenen, `"${girdi}" → "${beklenen}"`, `alinan: "${alinan}"`);
}

console.log('\n  DOGRU yazilmisa DOKUNULMAMALI\n');

const dokunma = [
  'Haftalık çalışma süresi kaç saat?',
  'Öğle molası kaç saat?',
  'Uzaktan çalışma günlerini kim belirliyor?',
  'KVKK kapsamında hangi verilerim işleniyor?',
  'İSG eğitimi zorunlu mu?',
];
for (const q of dokunma) {
  check(onar(q) === q, `"${q}" değişmedi`, `alinan: "${onar(q)}"`);
}

console.log('\n  Belirsiz ve bilinmeyen sozcukler\n');

// BELIRSIZLIK KORUMASI: "halihazirda" katlanmis bicimine korpusta iki farkli
// yazim BENZER SIKLIKTA denk geliyor. Bu durumda tahmin yapilmamali — yanlis
// bir onarim, onarmamaktan zararlidir.
check(
  onar('halihazirda durum nedir') === 'halihazirda durum nedir',
  'belirsiz sozcuk TAHMIN EDILMEZ (iki yazim benzer siklikta)',
  `alinan: "${onar('halihazirda durum nedir')}"`,
);
check(
  onar('kar').startsWith('kar'),
  '"kar" korpusta oldugu gibi var → degistirilmez',
  `alinan: "${onar('kar')}"`,
);
check(onar('zebra fiyati nedir') === 'zebra fiyati nedir', 'korpusta olmayan sozcuk degistirilmez');
check(onar('') === '', 'bos sorgu');
check(onar('ab') === 'ab', 'cok kisa sozcuk (3 harften az) atlanir');

console.log('\n  Buyuk harf yumusatma\n');

check(
  bagirmayiYumusat('YILLIK İZİN KAÇ GÜN?', true) === 'yıllık izin kaç gün?',
  'tamami buyuk Turkce sorgu kucultulur',
);
check(
  bagirmayiYumusat('HAFTALIK CALISMA', false) === 'haftalık calisma'.replace('haftalık', 'haftalik'),
  'tamami buyuk ASCII sorgu ASCII kurallarla kucultulur',
  `alinan: "${bagirmayiYumusat('HAFTALIK CALISMA', false)}"`,
);
check(
  bagirmayiYumusat('KVKK kapsamında', false) === 'KVKK kapsamında',
  'kismi buyuk harf (kisaltma) korunur',
);
check(bagirmayiYumusat('SGK', false) === 'sgk', 'tek basina kisaltma da kucultulur (sorgunun tamami)');
check(bagirmayiYumusat('A', false) === 'A', 'tek harf dokunulmaz');

// EN ONEMLI REGRESYON: ASCII buyuk harfli sorgu Turkce kurallarla
// kucultulurse "I" -> "ı" olur ve onarim iptal olurdu.
const asciiBagirma = onar('HAFTALIK CALISMA SURESI KAC SAAT?');
check(
  asciiBagirma.includes('çalışma') && asciiBagirma.includes('süresi'),
  'ASCII buyuk harfli sorgu ONARILIYOR (I -> ı tuzagi)',
  `alinan: "${asciiBagirma}"`,
);
check(!asciiBagirma.includes('calısma'), 'yanlis melez yazim ("calısma") uretilmiyor', `alinan: "${asciiBagirma}"`);

console.log('\n  katla()\n');
check(katla('çalışma') === 'calisma', 'çalışma → calisma');
check(katla('ĞÜŞİÖÇ') === 'gusioc', 'buyuk harfler de katlanir');
check(katla('kâr') === 'kar', 'inceltme isareti kaldirilir');

console.log('\n  Dosya adi tuzagi (gercek hata)\n');
// Sozluk doc_title'dan beslenseydi "izinler" ve "saatleri" korpusta var
// gorunur ve onarim durur; asagidaki iki sozcuk bunu yakalar.
check(onar('calisma saatleri') === 'çalışma saatleri', 'dosya adindaki ASCII sozcukler sozlugu zehirlemiyor', `alinan: "${onar('calisma saatleri')}"`);

db.close();
try {
  fs.rmSync(dbYolu, { force: true });
} catch {
  /* Windows'ta kilit birakabiliyor; kalintiyi sonraki kosum siler. */
}

console.log(`\n  ${failures === 0 ? 'TUMU GECTI' : `${failures} test BASARISIZ`}\n`);
process.exit(failures === 0 ? 0 : 1);
