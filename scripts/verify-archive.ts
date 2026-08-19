/**
 * Bagimsiz arsiv dogrulayici (Sprint 3a).
 *
 * BU BETIGIN TUM DEGERI BAGIMSIZ OLMASINDA.
 *
 * Kurcalanmis bir sunucunun kendi arsivini "gecerli" demesi hicbir sey
 * kanitlamaz. Denetim, arsivi o makineden CIKARIP baska bir yerde dogrulamaktir.
 * Bu yuzden betik:
 *
 *   - veritabanina DOKUNMAZ
 *   - sunucuya BAGLANMAZ
 *   - yalnizca `node:crypto` kullanir (dis bagimlilik yok)
 *
 * Yani arsiv dosyasi + acik anahtar, herhangi bir Node kurulumuna kopyalanip
 * dogrulanabilir.
 *
 * Kullanim:
 *   npm run verify-archive -- <arsiv.json> [acik-anahtar.pem]
 *
 * Acik anahtar VERILMELIDIR. Verilmezse imza arsive gomulu anahtarla dogrulanir
 * ve bu yalnizca "dosya kendi icinde tutarli" demektir — kimin imzaladigini
 * kanitlamaz. Betik bu durumda acikca uyarir.
 */
import fs from 'node:fs';
import path from 'node:path';

const [fileArg, keyArg] = process.argv.slice(2);

if (!fileArg) {
  console.error('\n  Kullanim: npm run verify-archive -- <arsiv.json> [acik-anahtar.pem]\n');
  process.exit(2);
}

const archivePath = path.resolve(fileArg);
if (!fs.existsSync(archivePath)) {
  console.error(`\n  Arsiv bulunamadi: ${archivePath}\n`);
  process.exit(2);
}

let expectedKey: string | undefined;
if (keyArg) {
  const keyPath = path.resolve(keyArg);
  if (!fs.existsSync(keyPath)) {
    console.error(`\n  Acik anahtar bulunamadi: ${keyPath}\n`);
    process.exit(2);
  }
  expectedKey = fs.readFileSync(keyPath, 'utf-8');
}

const { verifyArchive } = await import('../server/src/services/integrity.service.js');

console.log(`\n  Arsiv dogrulamasi`);
console.log(`  Dosya : ${archivePath}`);
console.log(`  Anahtar: ${keyArg ? path.resolve(keyArg) : '(verilmedi — bkz. uyari)'}\n`);

let result;
try {
  result = verifyArchive(archivePath, expectedKey);
} catch (error) {
  console.error(`  ARSIV OKUNAMADI: ${(error as Error).message}\n`);
  process.exit(1);
}

const yes = (v: boolean) => (v ? 'EVET' : 'HAYIR');

console.log(`  Olusturuldu       : ${result.olusturuldu}`);
console.log(`  Denetim satiri    : ${result.satirSayisi}`);
console.log(`  Politika surumu   : ${result.surumSayisi}`);
console.log(`  Anahtar parmak izi: ${result.parmakIzi}`);
console.log('');
console.log(`  Imza gecerli      : ${yes(result.imzaGecerli)}`);
console.log(`  Zincir butun      : ${yes(result.zincirGecerli)}`);
if (result.anahtarEslesti !== undefined) {
  console.log(`  Anahtar eslesti   : ${yes(result.anahtarEslesti)}`);
}

if (result.sorunlar.length) {
  console.log('\n  Notlar:');
  for (const s of result.sorunlar) console.log(`    - ${s}`);
}

console.log(`\n  SONUC: ${result.ok ? 'ARSIV GECERLI' : 'ARSIV DOGRULANAMADI'}\n`);
process.exit(result.ok ? 0 : 1);
