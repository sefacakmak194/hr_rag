/**
 * Imzali arsiv uret ve DISARI CIKARILACAK paketi hazirla (Sprint 3a).
 *
 * NEDEN BU BETIK VAR
 *
 * Arsiv uretmek tek basina hicbir sey korumaz. Yol haritasinin kendi ifadesiyle:
 * "asil savunma, arsivin makineden DISARI CIKARILMIS olmasidir". Ve zincirin
 * yakalayamadigi tek durum — son satirlarin silinmesi — yalnizca SIK arsivleme
 * ile kapaniyor.
 *
 * Elle yapilan tek seferlik bir arsiv bu ikisini de saglamaz: bir ay sonra
 * kimse hangi adimlarin atildigini hatirlamaz. Bu yuzden tum is tek komutta:
 *
 *     npm run arsivle -- <hedef-klasor>
 *
 * PAKETTE NE VAR
 *
 * Denetciye giden pakette uygulama YOKTUR. Arsiv, acik anahtar ve TEK DOSYA
 * halinde bir dogrulayici bulunur.
 *
 * `scripts/verify-archive.ts` bagimsiz oldugunu soyluyor ama `integrity.service`
 * import ediyor; yani depo ve `tsx` olmadan calismiyor. Denetcinin elinde bunlar
 * olmayacak. Bu yuzden paket icin ayni kaynaktan esbuild ile tek dosyalik bir
 * `.mjs` uretiliyor: mantik kopyalanmiyor, yalnizca tasinabilir hale getiriliyor.
 * Uretilen dosya yalnizca `node:*` modullerine bagli — bos bir Node kurulumunda
 * `node dogrula.mjs <arsiv> <anahtar>` calisir.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, AUDIT_PUBLIC_KEY_PATH, moduleRequire } from '../server/src/config/constants.js';
import {
  createSignedArchive,
  verifyAuditChain,
  verifyArchive,
  lastArchiveState,
  publicKeyFingerprint,
} from '../server/src/services/integrity.service.js';

/**
 * esbuild `server/node_modules` altinda; bu betik `scripts/` altindan cozumleme
 * yaptigi icin duz `import` onu BULAMAZ (ayni sorun test-endpoints.ts'te de
 * yasandi). `moduleRequire` sunucu koku uzerinden cozumler.
 */
type EsbuildBuild = (options: {
  entryPoints: string[];
  bundle: boolean;
  platform: 'node';
  format: 'esm';
  target: string;
  outfile: string;
  logLevel: 'warning';
}) => Promise<unknown>;

const { build } = moduleRequire('esbuild') as { build: EsbuildBuild };

const HERE = path.dirname(fileURLToPath(import.meta.url));

const hedefArg = process.argv[2];
if (!hedefArg) {
  console.error(`
  Kullanim: npm run arsivle -- <hedef-klasor>

  Ornek:
    npm run arsivle -- C:/Users/<kullanici>/Documents/denetim-arsivleri
    npm run arsivle -- E:/                       (cikarilabilir surucu)

  Hedef klasor, arsivi URETEN makinenin disinda olmalidir. Ayni diskteki bir
  klasor yedek sayilir, kanit sayilmaz: diske erisen ikisini birden degistirir.
`);
  process.exit(2);
}

const hedef = path.resolve(hedefArg);
const sha256Dosya = (p: string) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');

// ---------------------------------------------------------------- 1. arsiv

const db = new DatabaseSync(DB_PATH, { readOnly: true });

const onceki = lastArchiveState();
const zincir = verifyAuditChain(db, onceki ?? undefined);

console.log(`\n  Zincir durumu`);
console.log(`    butun          : ${zincir.ok ? 'EVET' : 'HAYIR'}`);
console.log(`    zincirli satir : ${zincir.chained}`);
console.log(`    zincir oncesi  : ${zincir.preChain}`);
if (onceki) console.log(`    onceki arsiv   : ${onceki.dosya}`);

// Kirik zincir arsivlemeyi ENGELLEMEZ — tam tersine, kirikligin kendisi de
// kayda gecmelidir. Ama sessizce gecilmemeli.
if (!zincir.ok) {
  console.log(`\n  ! UYARI: zincir kirik — ${zincir.reason ?? 'sebep bildirilmedi'}`);
  console.log(`    Arsiv yine de uretiliyor; kirikligi KAYDA GECIRMEK icin.`);
}

const sonuc = createSignedArchive(db);
db.close();

console.log(`\n  Arsiv uretildi`);
console.log(`    dosya          : ${sonuc.dosya}`);
console.log(`    denetim satiri : ${sonuc.satirSayisi}`);
console.log(`    politika surumu: ${sonuc.surumSayisi}`);
console.log(`    boyut          : ${(sonuc.bayt / 1024).toFixed(1)} KB`);

// ------------------------------------------------------- 2. dogrulayici paketi

fs.mkdirSync(hedef, { recursive: true });

const dogrulayiciYolu = path.join(hedef, 'dogrula.mjs');
await build({
  entryPoints: [path.join(HERE, 'verify-archive.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: dogrulayiciYolu,
  logLevel: 'warning',
});

const arsivHedef = path.join(hedef, sonuc.dosya);
const anahtarHedef = path.join(hedef, 'acik-anahtar.pem');
fs.copyFileSync(sonuc.yol, arsivHedef);
fs.copyFileSync(AUDIT_PUBLIC_KEY_PATH, anahtarHedef);

// -------------------------------------------------- 3. kopyayi DOGRULA, sonra yaz

// Kopyalanan dosya dogrulanmadan talimat yazmak yanlis olur: pakete guvenilmesini
// istiyorsak paketin kendisi sinanmali.
const acikAnahtar = fs.readFileSync(anahtarHedef, 'utf-8');
const dogrulama = verifyArchive(arsivHedef, acikAnahtar);

if (!dogrulama.ok) {
  console.error(`\n  KOPYA DOGRULANAMADI — paket yazilmadi.`);
  for (const sorun of dogrulama.sorunlar) console.error(`    - ${sorun}`);
  process.exit(1);
}

const arsivOzeti = sha256Dosya(arsivHedef);
const parmakIzi = publicKeyFingerprint(acikAnahtar);

fs.writeFileSync(path.join(hedef, 'OKUBENI.txt'), okubeni({
  arsiv: sonuc.dosya,
  parmakIzi,
  arsivOzeti,
  uretildi: new Date().toISOString(),
  satir: sonuc.satirSayisi,
  surum: sonuc.surumSayisi,
  zincirOncesi: zincir.preChain,
}), 'utf-8');

console.log(`\n  Paket hazir: ${hedef}`);
console.log(`    ${sonuc.dosya}`);
console.log(`    acik-anahtar.pem`);
console.log(`    dogrula.mjs        (tek dosya, kurulum gerektirmez)`);
console.log(`    OKUBENI.txt`);
console.log(`\n  Kopyanin dogrulamasi : GECERLI`);
console.log(`  Anahtar parmak izi   : ${parmakIzi}`);
console.log(`  Arsiv SHA-256        : ${arsivOzeti}`);
console.log(`\n  SIRADAKI ADIM — bu klasoru makine DISINA kopyalayin.`);
console.log(`  Yukaridaki iki degeri de bilgisayar disinda bir yere kaydedin.\n`);

function okubeni(v: {
  arsiv: string;
  parmakIzi: string;
  arsivOzeti: string;
  uretildi: string;
  satir: number;
  surum: number;
  zincirOncesi: number;
}): string {
  return `DENETIM ARSIVI — DOGRULAMA TALIMATI
====================================

Bu klasor, Kurumsal IK & Mevzuat Asistani'nin denetim kaydinin imzali bir
kopyasini tasir. Amaci: kaydin sonradan degistirilip degistirilmedigini,
sistemin kendisine hic guvenmeden dogrulayabilmek.

Neden onemli: kurcalanmis bir sunucunun kendi kaydina "gecerli" demesi hicbir
sey kanitlamaz. Kanit, arsivin o makineden CIKARILMIS olmasindan gelir.
Disari cikmis bir arsiv geriye donuk degistirilemez.


ICINDEKILER
-----------
  ${v.arsiv}
      imzali arsiv (denetim satirlari + politika surumu ustverisi)
  acik-anahtar.pem
      imzayi dogrulayan Ed25519 acik anahtari
  dogrula.mjs
      bagimsiz dogrulayici — tek dosya, kurulum gerektirmez


NASIL DOGRULANIR
----------------
Node.js kurulu herhangi bir makinede, bu klasorde:

    node dogrula.mjs ${v.arsiv} acik-anahtar.pem

Cikis kodu 0  -> arsiv gecerli
Cikis kodu 1  -> arsiv DOGRULANAMADI (imza ya da zincir kirik)

Betik veritabanina dokunmaz, sunucuya baglanmaz, internete cikmaz. Yalnizca
Node'un kendi kriptografi kutuphanesini kullanir.


BU ARSIVIN PARMAK IZLERI
------------------------
Asagidaki iki degeri bu bilgisayardan BAGIMSIZ bir yere kaydedin (kagit, ayri
bir cihaz). Bir denetimde karsilastirilacak olan sey budur.

  Acik anahtar parmak izi : ${v.parmakIzi}
  Arsiv dosyasi SHA-256   : ${v.arsivOzeti}
  Uretildigi an           : ${v.uretildi}
  Kapsam                  : ${v.satir} denetim satiri, ${v.surum} politika surumu


ONEMLI: ACIK ANAHTAR BAGIMSIZ EDINILMELIDIR
-------------------------------------------
Acik anahtar arsiv dosyasinin ICINDE de gomulu durur. Dogrulamayi yalnizca o
gomulu anahtarla yaparsaniz, ogrendiginiz tek sey "dosya kendi icinde tutarli"
olur — kimin imzaladigini kanitlamaz: bir saldirgan kendi anahtariyla yeniden
imzalayip gomulu alani da degistirebilir.

Bu yuzden acik-anahtar.pem ayri bir dosya olarak burada duruyor ve yukaridaki
parmak izi ayri bir yere kaydedilmelidir. Dogrulayici, verilen anahtarla gomulu
anahtarin eslesip eslesmedigini ayrica raporlar ("Anahtar eslesti").


BU ARSIVIN DURUST SINIRLARI
---------------------------
1. ZINCIR ONCESI SATIRLAR. Hash zinciri sisteme sonradan eklendi. Bu arsivdeki
   ${v.satir} satirin ${v.zincirOncesi} tanesi zincir eklenmeden once yazilmistir ve ozetleri
   YOKTUR. Bu satirlar icin arsivin verdigi guvence yalnizca "arsiv uretildigi
   anda kayit boyleydi" demektir. Geriye donuk ozet uretmek, zaten degistirilmis
   olabilecek veri uzerinden sahte guvence yaratirdi; bilerek yapilmadi.

2. SON ARSIVDEN SONRAKI SATIRLAR. Zincir, aradan satir silinmesini ya da
   degistirilmesini yakalar. SON satirlarin silinmesini yakalayamaz — ileriye
   isaret eden bir sey yoktur. Bunun cevabi bir sonraki arsivdir: her arsiv o
   anki zincir basini ve son satir numarasini kaydeder, veritabani arsivin
   gerisine dusmusse ortaya cikar. Yani koruma SIK ARSIVLEMEYE baglidir.

3. OZEL ANAHTAR. Imzayi ureten ozel anahtar, arsivi ureten makinede durur. O
   makineye tam erisimi olan biri kendi arsivini imzalayabilir. Bu yuzden acik
   anahtar parmak izinin bagimsiz kaydi onemlidir: degismis bir anahtar hemen
   fark edilir.

4. KISISEL VERI. Arsiv, denetim satirlarindaki kullanici adlarini tasir.
   Politika surumlerinin METNI tasinmaz, yalnizca icerik ozetleri. Arsivi
   paylasirken bunu goz onunde bulundurun.
`;
}
