/**
 * Dokuman yukleme ad dogrulamasi testleri.
 *
 * Bu bir GUVENLIK testidir: istemciden gelen dosya adi dogrudan dosya sistemine
 * yazilacagi icin dizin gecisi (path traversal) ve uzanti kacisi reddedilmelidir.
 * Sunucu gerektirmez — dogrulama saf bir fonksiyondur.
 *
 * Kullanim:  cd server && npm run test:documents
 */
import { safeName } from '../server/src/routes/documents.route.js';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
};

console.log('\n  Reddedilmesi gerekenler\n');

const rejected: { input: unknown; note: string }[] = [
  { input: '../../.env.local', note: 'dizin gecisi (unix)' },
  { input: '..\\..\\evil.md', note: 'dizin gecisi (windows)' },
  { input: 'sub/dir.md', note: 'alt dizin' },
  { input: 'sub\\dir.md', note: 'alt dizin (ters bolu)' },
  { input: '..', note: 'ust dizin' },
  { input: '.gizli.md', note: 'nokta ile baslayan gizli dosya' },
  { input: 'notlar.txt', note: 'izin verilmeyen uzanti' },
  { input: 'script.md.exe', note: 'cift uzanti' },
  { input: 'dosya', note: 'uzantisiz' },
  { input: 'C:\\Windows\\System32\\config.md', note: 'mutlak yol' },
  { input: 'rapor;rm -rf.md', note: 'kabuk karakteri' },
  { input: 'rapor\u0000.md', note: 'null bayt' },
  { input: '', note: 'bos' },
  { input: '   ', note: 'yalnizca bosluk' },
  { input: null, note: 'null' },
  { input: 42, note: 'sayi' },
];

for (const c of rejected) {
  const got = safeName(c.input);
  check(got === null, `${c.note}: ${JSON.stringify(c.input)}`, `reddedilmedi → "${got}"`);
}

console.log('\n  Kabul edilmesi gerekenler\n');

const accepted: { input: string; note: string }[] = [
  { input: '21_yeni_yonetmelik.md', note: 'standart markdown' },
  { input: 'IK El Kitabi.pdf', note: 'bosluklu PDF' },
  { input: 'ücretsiz_izin_çalışma.md', note: 'Turkce karakter' },
  { input: 'rapor (2).pdf', note: 'parantez' },
  { input: 'Politika-2026.MD', note: 'buyuk harfli uzanti' },
];

for (const c of accepted) {
  const got = safeName(c.input);
  check(got === c.input, `${c.note}: "${c.input}"`, `kabul edilmedi (${got})`);
}

console.log(`\n  ${failures === 0 ? 'TUMU GECTI' : `${failures} test BASARISIZ`}\n`);
process.exit(failures === 0 ? 0 : 1);
