/**
 * Denetim butunlugu testleri (Sprint 3a).
 *
 * Bu paketin isi TEK BIR SORUYU cevaplamak: veritabani dosyasina dogrudan
 * erisen biri denetim kaydini kurcalarsa YAKALANIR MI?
 *
 * Bu yuzden testler tetikleyicileri BILEREK DUSURUP satirlari degistiriyor —
 * yani gercek saldirganin yapacagi seyi yapiyor. Tetikleyicilerin calistigini
 * dogrulamak (bunu test-identity zaten yapiyor) burada yeterli degil; kritik
 * olan, tetikleyici ATLANDIGINDA ne olacagi.
 *
 * Ayrica arsivin BAGIMSIZ dogrulanabildigi test ediliyor: dogrulama
 * veritabanina hic dokunmadan calismali.
 *
 * Kullanim:  cd server && npm run test:integrity
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-integrity-'));
process.env.DB_PATH = path.join(dir, 'integrity-test.db');
process.env.ARCHIVE_DIR = path.join(dir, 'arsiv');
process.env.AUDIT_KEY_PATH = path.join(dir, 'audit-signing.key');
process.env.AUDIT_PUBLIC_KEY_PATH = path.join(dir, 'audit-public.pem');

const { getDb } = await import('../server/src/services/vectorStore.service.js');
const { recordAudit } = await import('../server/src/services/audit.service.js');
const {
  verifyAuditChain,
  chainHead,
  createSignedArchive,
  verifyArchive,
  listArchives,
  lastArchiveState,
  ensureKeyPair,
  canonical,
  GENESIS,
} = await import('../server/src/services/integrity.service.js');
import type { Principal } from '../server/src/services/identity.service.js';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
};

const db = getDb();
const ayse: Principal = { userId: 1, username: 'ayse', role: 'calisan' };
const admin: Principal = { userId: 2, username: 'admin', role: 'yonetici' };

/** Tetikleyicileri dusurur — SALDIRGANIN yapacagi sey. */
const disableTriggers = () => {
  db.exec('DROP TRIGGER IF EXISTS audit_no_update');
  db.exec('DROP TRIGGER IF EXISTS audit_no_delete');
};
const restoreTriggers = () => {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'denetim kaydı değiştirilemez'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'denetim kaydı silinemez'); END;
  `);
};

// ================================================================ 1) zincir
console.log('\n  Hash zinciri\n');

const bos = verifyAuditChain(db);
check(bos.ok && bos.chained === 0, 'bos denetim kaydi gecerli sayiliyor');
check(chainHead(db) === GENESIS, 'bos kayitta zincir basi GENESIS');

for (let i = 1; i <= 6; i++) {
  recordAudit({
    principal: i % 2 ? ayse : admin,
    question: `soru ${i}`,
    citations: [{ doc: 'izin.md', section: `Madde ${i}`, versionId: i }],
    answered: i !== 4,
    durationMs: 100 + i,
  });
}

const saglam = verifyAuditChain(db);
check(saglam.ok, 'alti satirlik zincir butun', saglam.reason);
check(saglam.chained === 6, `alti satir zincire girdi (${saglam.chained})`);
check(saglam.preChain === 0, 'zincir oncesi satir yok');
check(chainHead(db) !== GENESIS, 'zincir basi ilerledi');

const ilkSatir = db.prepare('SELECT prev_hash, row_hash FROM audit_log ORDER BY id LIMIT 1').get() as {
  prev_hash: string;
  row_hash: string;
};
check(ilkSatir.prev_hash === GENESIS, 'ilk satirin oncesi GENESIS');
check(/^[0-9a-f]{64}$/.test(ilkSatir.row_hash), 'ozet sha256 biciminde', ilkSatir.row_hash);

// -------------------------------------------- 2) icerik degistirme yakalaniyor
console.log('\n  Kurcalama tespiti (tetikleyiciler DUSURULEREK)\n');

disableTriggers();

db.prepare("UPDATE audit_log SET username = 'baskasi' WHERE id = 3").run();
const degistirilmis = verifyAuditChain(db);
check(!degistirilmis.ok, 'satir icerigi degistirilince zincir kiriliyor');
check(degistirilmis.brokenAt === 3, `kirilma dogru satirda bildiriliyor (${degistirilmis.brokenAt})`);

db.prepare("UPDATE audit_log SET username = 'ayse' WHERE id = 3").run();
check(verifyAuditChain(db).ok, 'eski deger geri konunca zincir yeniden butun');

// Sessiz degisiklik: yalnizca sureyi oynatmak da yakalanmali.
db.prepare('UPDATE audit_log SET duration_ms = 9999 WHERE id = 5').run();
const sureli = verifyAuditChain(db);
check(!sureli.ok && sureli.brokenAt === 5, 'yalnizca sure degistirilse bile yakalaniyor');
db.prepare('UPDATE audit_log SET duration_ms = 105 WHERE id = 5').run();
check(verifyAuditChain(db).ok, 'geri alindi');

// Alinti listesini degistirmek — "hangi dokumana erisildi" izini silmek.
const eskiAlinti = (db.prepare('SELECT citations FROM audit_log WHERE id = 2').get() as { citations: string })
  .citations;
db.prepare("UPDATE audit_log SET citations = '[]' WHERE id = 2").run();
const alintili = verifyAuditChain(db);
check(!alintili.ok && alintili.brokenAt === 2, 'alinti listesi silinince yakalaniyor');
db.prepare('UPDATE audit_log SET citations = ? WHERE id = 2').run(eskiAlinti);
check(verifyAuditChain(db).ok, 'geri alindi');

// -------------------------------------------- 3) ARADAN satir silme yakalaniyor
db.prepare('DELETE FROM audit_log WHERE id = 4').run();
const aradanSilinmis = verifyAuditChain(db);
check(!aradanSilinmis.ok, 'aradan satir silinince zincir kiriliyor');
check(aradanSilinmis.brokenAt === 5, `kirilma silinen satirin ARDINDAN bildiriliyor (${aradanSilinmis.brokenAt})`);
check(
  (aradanSilinmis.reason ?? '').includes('silinmiş'),
  'gerekce kullaniciya anlasilir',
  aradanSilinmis.reason,
);

// Silinen satiri geri koyamayiz (ozeti yeniden uretmek gerekirdi); temiz
// baslamak icin tabloyu bosaltip yeniden yaziyoruz.
db.exec('DELETE FROM audit_log');
db.exec("DELETE FROM sqlite_sequence WHERE name='audit_log'");
restoreTriggers();

for (let i = 1; i <= 5; i++) {
  recordAudit({
    principal: ayse,
    question: `yeni soru ${i}`,
    citations: [{ doc: 'ucret.md', section: `Madde ${i}` }],
    answered: true,
    durationMs: 200 + i,
  });
}
check(verifyAuditChain(db).ok, 'yeni zincir butun');

// ================================================================== 4) arsiv
console.log('\n  Imzali arsiv\n');

const anahtar = ensureKeyPair();
check(anahtar.publicKeyPem.includes('BEGIN PUBLIC KEY'), 'acik anahtar PEM uretildi');
check(/^[0-9a-f]{16}$/.test(anahtar.fingerprint), `parmak izi (${anahtar.fingerprint})`);
check(fs.existsSync(process.env.AUDIT_KEY_PATH!), 'ozel anahtar diske yazildi');
check(
  ensureKeyPair().fingerprint === anahtar.fingerprint,
  'ikinci cagri AYNI anahtari donuyor (her acilista yeniden uretmiyor)',
);

const arsiv = createSignedArchive(db);
check(arsiv.satirSayisi === 5, `arsiv bes satir icerdi (${arsiv.satirSayisi})`);
check(fs.existsSync(arsiv.yol), 'arsiv dosyasi yazildi');

const dogrulama = verifyArchive(arsiv.yol, anahtar.publicKeyPem);
check(dogrulama.ok, 'arsiv dogrulandi', dogrulama.sorunlar.join(' | '));
check(dogrulama.imzaGecerli, 'imza gecerli');
check(dogrulama.zincirGecerli, 'arsivdeki zincir butun');
check(dogrulama.anahtarEslesti === true, 'acik anahtar eslesti');
check(dogrulama.sorunlar.length === 0, 'sorun bildirilmedi', dogrulama.sorunlar.join(' | '));

// Anahtar verilmezse ACIKCA uyarilmali: imza gomulu anahtarla dogrulanir ve bu
// "kim imzaladi" sorusunu cevaplamaz.
const anahtarsiz = verifyArchive(arsiv.yol);
check(anahtarsiz.imzaGecerli, 'anahtarsiz dogrulamada imza yine gecerli');
check(
  anahtarsiz.sorunlar.some((s) => s.includes('kimin imzaladığını kanıtlamaz')),
  'anahtarsiz dogrulama ACIKCA uyariyor',
  anahtarsiz.sorunlar.join(' | '),
);

// ---------------------------------------------- 5) arsiv kurcalanirsa
console.log('\n  Arsiv kurcalama tespiti\n');

const bozuk = path.join(dir, 'bozuk-arsiv.json');
const parsed = JSON.parse(fs.readFileSync(arsiv.yol, 'utf-8'));
parsed.icerik.satirlar[2].username = 'baskasi';
fs.writeFileSync(bozuk, JSON.stringify(parsed, null, 2));

const bozukSonuc = verifyArchive(bozuk, anahtar.publicKeyPem);
check(!bozukSonuc.ok, 'arsiv icerigi degistirilince dogrulama basarisiz');
check(!bozukSonuc.imzaGecerli, 'imza gecersiz oldu');
check(
  bozukSonuc.sorunlar.some((s) => s.includes('İMZA GEÇERSİZ')),
  'gerekce acik',
  bozukSonuc.sorunlar.join(' | '),
);

// Saldirgan KENDI anahtariyla yeniden imzalarsa: imza kendi icinde tutarli olur
// ama gomulu anahtar beklenenle eslesmez. Dogrulamanin bagimsiz anahtar
// istemesinin sebebi tam olarak bu.
const { generateKeyPairSync, sign: cryptoSign } = await import('node:crypto');
const sahte = generateKeyPairSync('ed25519');
const sahteArsiv = path.join(dir, 'sahte-arsiv.json');
const sahteIcerik = JSON.parse(fs.readFileSync(arsiv.yol, 'utf-8'));
sahteIcerik.icerik.satirlar = sahteIcerik.icerik.satirlar.slice(0, 2);
sahteIcerik.icerik.aralik.sonSatir = 2;
sahteIcerik.acikAnahtar = sahte.publicKey.export({ type: 'spki', format: 'pem' }).toString();
sahteIcerik.imza = cryptoSign(
  null,
  Buffer.from(canonical(sahteIcerik.icerik), 'utf-8'),
  sahte.privateKey,
).toString('base64');
fs.writeFileSync(sahteArsiv, JSON.stringify(sahteIcerik, null, 2));

const sahteBagimsiz = verifyArchive(sahteArsiv, anahtar.publicKeyPem);
check(!sahteBagimsiz.ok, 'baska anahtarla yeniden imzalanan arsiv REDDEDILIYOR');
check(sahteBagimsiz.anahtarEslesti === false, 'anahtar uyusmazligi bildiriliyor');

const sahteGomulu = verifyArchive(sahteArsiv);
check(
  sahteGomulu.imzaGecerli,
  'gomulu anahtarla bakildiginda sahte arsiv "gecerli" gorunuyor — anahtarin BAGIMSIZ edinilmesi bu yuzden sart',
);

// ------------------------------------------- 6) son satirlarin silinmesi
console.log('\n  Sondan satir silme (zincirin tek basina goremedigi durum)\n');

const durum = lastArchiveState();
check(durum?.lastRowId === 5, `arsiv son satiri kaydetti (${durum?.lastRowId})`);

disableTriggers();
db.prepare('DELETE FROM audit_log WHERE id = 5').run();

const arsivsiz = verifyAuditChain(db);
check(arsivsiz.ok, 'zincir TEK BASINA sondan silmeyi goremiyor (bilinen sinir)');

const arsivli = verifyAuditChain(db, { lastRowId: durum!.lastRowId, chainHead: durum!.chainHead });
check(!arsivli.ok, 'arsivle karsilastirilinca sondan silme YAKALANIYOR');
check(
  (arsivli.reason ?? '').includes('Sondan satır silinmiş'),
  'gerekce dogru',
  arsivli.reason,
);
restoreTriggers();

// ----------------------------------------------------- 7) arsiv zinciri
console.log('\n  Arsivler birbirine baglaniyor\n');

recordAudit({ principal: admin, question: 'yeni', citations: [], answered: true, durationMs: 10 });
const ikinci = createSignedArchive(db);
const ikinciParsed = JSON.parse(fs.readFileSync(ikinci.yol, 'utf-8'));
check(ikinciParsed.icerik.oncekiArsiv !== null, 'ikinci arsiv oncekine baglandi');
check(
  ikinciParsed.icerik.oncekiArsiv.dosya === arsiv.dosya,
  `onceki arsivin adi dogru (${ikinciParsed.icerik.oncekiArsiv?.dosya})`,
);
check(/^[0-9a-f]{64}$/.test(ikinciParsed.icerik.oncekiArsiv.ozet), 'onceki arsivin ozeti kayitli');

const liste = listArchives();
check(liste.length === 2, `iki arsiv listeleniyor (${liste.length})`);
check(liste[0].dosya === ikinci.dosya, 'en yeni arsiv basta');

// ------------------------------------------------------ 8) zincir oncesi
console.log('\n  Zincir oncesi satirlar\n');

disableTriggers();
db.prepare(
  `INSERT INTO audit_log (at, user_id, username, role, question, resolved_query, citations, answered, duration_ms)
   VALUES (?, 1, 'eski', 'calisan', NULL, NULL, '[]', 1, 5)`,
).run('2020-01-01T00:00:00.000Z');
restoreTriggers();

const karisik = verifyAuditChain(db);
check(karisik.preChain === 1, `zincir oncesi satir sayiliyor (${karisik.preChain})`);
const toplam = (db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n;
check(karisik.chained === toplam - 1, `kalan ${karisik.chained} satir zincirde (toplam ${toplam})`);

// ------------------------------------------------------ 9) canonical JSON
console.log('\n  Anahtar sirasindan bagimsiz JSON\n');

check(canonical({ b: 1, a: 2 }) === canonical({ a: 2, b: 1 }), 'anahtar sirasi ozeti degistirmiyor');
check(canonical([1, 2]) !== canonical([2, 1]), 'dizi sirasi ONEMLI (oyle olmali)');
check(canonical({ a: { d: 1, c: 2 } }) === canonical({ a: { c: 2, d: 1 } }), 'ic ice nesnelerde de siralaniyor');
check(canonical(null) === 'null', 'null');
// `JSON.stringify(undefined)` string DEGIL undefined doner; canonical bunu
// 'null'a cevirmezse ozet "{\"a\":undefined}" gibi gecersiz JSON uretirdi.
check(canonical({ a: undefined }) === '{"a":null}', 'tanimsiz alan null olarak seriliyor', canonical({ a: undefined }));

// ---------------------------------------------------------------- sonuc
try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch {
  // Windows'ta SQLite dosya kilidi surec kapanana kadar kalabilir.
}

console.log(`\n  ${failures === 0 ? 'TUMU GECTI' : `${failures} test BASARISIZ`}\n`);
process.exit(failures === 0 ? 0 : 1);
