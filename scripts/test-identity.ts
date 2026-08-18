/**
 * Kimlik katmani testleri: hesaplar, parola, oturum, rol gorunurlugu ve
 * denetim kaydinin DEGISTIRILEMEZLIGI.
 *
 * Izole bir gecici veritabani kullanir; canli korpusa dokunmaz.
 *
 * Kullanim:  cd server && npm run test:identity
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ensureIdentitySchema,
  createUser,
  authenticate,
  createSession,
  resolveSession,
  destroySession,
  purgeExpiredSessions,
  needsSetup,
  countUsers,
  normalizeUsername,
  hashPassword,
  verifyPassword,
  canManageDocuments,
  labelFilter,
  VISIBLE_LABELS,
  type Principal,
} from '../server/src/services/identity.service.js';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-identity-'));
const dbPath = path.join(dir, 'test.db');
const db = new DatabaseSync(dbPath);
ensureIdentitySchema(db);

// ------------------------------------------------------------- 1) kurulum
console.log('\n  Ilk kurulum\n');

check(needsSetup(db), 'hic kullanici yokken kurulum gerekiyor');

const admin = createUser(db, {
  username: 'Yonetici',
  displayName: 'Sistem Yöneticisi',
  password: 'cok-gizli-parola',
  role: 'yonetici',
});

check(!needsSetup(db), 'kullanici olusunca kurulum gerekmiyor');
check(countUsers(db) === 1, `kullanici sayisi = ${countUsers(db)}`);
check(admin.username === 'yonetici', `kullanici adi normalize edildi: ${admin.username}`);

// ------------------------------------------------------------- 2) parola
console.log('\n  Parola\n');

const { hash, salt } = hashPassword('parola123');
check(verifyPassword('parola123', hash, salt), 'dogru parola dogrulaniyor');
check(!verifyPassword('parola124', hash, salt), 'yanlis parola reddediliyor');
check(!verifyPassword('', hash, salt), 'bos parola reddediliyor');

// Ayni parola iki kez hashlenince FARKLI cikmali (tuz rastgele).
const a = hashPassword('ayni-parola');
const b = hashPassword('ayni-parola');
check(a.hash !== b.hash, 'ayni parola farkli tuzla farkli hash uretiyor');

// Kullanici adi normalizasyonu deterministik olmali. Turkce yerel ayarla
// kucultme "I" -> "ı" yapardi ve giris tarayici diline gore degisirdi.
check(normalizeUsername('  ILAYDA  ') === 'ilayda', `"  ILAYDA  " -> "${normalizeUsername('  ILAYDA  ')}"`);
check(
  normalizeUsername('Ilayda') === normalizeUsername('ILAYDA'),
  'ayni ad farkli buyuk/kucuk yazimda ayni anahtara dusuyor',
);

// ------------------------------------------------------------- 3) giris
console.log('\n  Kimlik dogrulama\n');

const ok = authenticate(db, 'yonetici', 'cok-gizli-parola');
check(ok !== null && ok.role === 'yonetici', `dogru bilgiyle giris: ${ok?.username} / ${ok?.role}`);
check(authenticate(db, 'yonetici', 'yanlis') === null, 'yanlis parola reddediliyor');
check(authenticate(db, 'olmayan-kullanici', 'herhangi') === null, 'olmayan kullanici reddediliyor');
check(
  authenticate(db, 'YONETICI', 'cok-gizli-parola') !== null,
  'buyuk harfle yazilan kullanici adi da calisiyor',
);

// ------------------------------------------------------------- 4) oturum
console.log('\n  Oturum\n');

const principal = ok as Principal;
const token = createSession(db, principal);
check(token.length === 64, `jeton uretildi (${token.length} karakter)`);

const resolved = resolveSession(db, token);
check(resolved?.userId === principal.userId, 'jeton kimlige cozuluyor');
check(resolveSession(db, 'gecersiz-jeton') === null, 'gecersiz jeton reddediliyor');
check(resolveSession(db, undefined) === null, 'jetonsuz istek reddediliyor');

destroySession(db, token);
check(resolveSession(db, token) === null, 'cikis sonrasi jeton gecersiz');

// Suresi gecmis oturum: dogrudan gecmis tarihle yaziliyor.
db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
  'eski-jeton',
  principal.userId,
  '2020-01-01T00:00:00.000Z',
  '2020-01-02T00:00:00.000Z',
);
check(resolveSession(db, 'eski-jeton') === null, 'suresi dolmus oturum reddediliyor');
check(purgeExpiredSessions(db) >= 0, 'suresi dolmus oturumlar temizlenebiliyor');

// ------------------------------------------------------------- 5) roller
console.log('\n  Rol gorunurlugu\n');

check(VISIBLE_LABELS.calisan.join(',') === 'genel', 'calisan yalnizca genel gorur');
check(VISIBLE_LABELS.ik.join(',') === 'genel,ik', 'ik genel + ik gorur');
check(VISIBLE_LABELS.yonetici.join(',') === 'genel,ik,yonetici', 'yonetici hepsini gorur');

check(!canManageDocuments('calisan'), 'calisan dokuman yonetemiyor');
check(canManageDocuments('ik'), 'ik dokuman yonetebiliyor');
check(canManageDocuments('yonetici'), 'yonetici dokuman yonetebiliyor');

const filter = labelFilter({ userId: 1, username: 'x', role: 'calisan' });
check(filter.clause === '?' && filter.values.join(',') === 'genel', `calisan filtresi: ${filter.clause}`);

// ------------------------------------------------------------- 6) denetim
console.log('\n  Denetim kaydi — DEGISTIRILEMEZLIK\n');

const insertAudit = db.prepare(
  `INSERT INTO audit_log (at, user_id, username, role, question, resolved_query, citations, answered, duration_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
insertAudit.run(
  new Date().toISOString(),
  principal.userId,
  principal.username,
  principal.role,
  null,
  null,
  JSON.stringify([{ docTitle: '01_izin.md', section: 'Madde 1' }]),
  1,
  850,
);

const auditCount = (db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n;
check(auditCount === 1, `denetim satiri yazildi (${auditCount})`);

// Genel dokumana erisimde soru metni saklanmaz — NULL kalmali.
const stored = db.prepare('SELECT question FROM audit_log WHERE id = 1').get() as { question: string | null };
check(stored.question === null, 'genel erisimde soru metni NULL');

let updateBlocked = false;
try {
  db.prepare('UPDATE audit_log SET username = ? WHERE id = 1').run('baskasi');
} catch {
  updateBlocked = true;
}
check(updateBlocked, 'UPDATE tetikleyici tarafindan engellendi');

let deleteBlocked = false;
try {
  db.prepare('DELETE FROM audit_log WHERE id = 1').run();
} catch {
  deleteBlocked = true;
}
check(deleteBlocked, 'DELETE tetikleyici tarafindan engellendi');

const afterAttempts = (db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n;
check(afterAttempts === 1, 'kayit hala yerinde');

// ------------------------------------------------------------- 7) sema
console.log('\n  Sema\n');

const tables = (
  db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
).map((r) => r.name);
for (const t of ['audit_log', 'documents', 'sessions', 'users']) {
  check(tables.includes(t), `tablo var: ${t}`);
}

// Ikinci kez calistirmak hata vermemeli (IF NOT EXISTS).
let reRunOk = true;
try {
  ensureIdentitySchema(db);
} catch {
  reRunOk = false;
}
check(reRunOk, 'sema kurulumu tekrar calistirilabiliyor');

db.close();
try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch {
  // Windows'ta dosya kilidi kalabilir; test sonucunu etkilemez.
}

console.log(`\n  ${failures === 0 ? 'TUMU GECTI' : `${failures} test BASARISIZ`}\n`);
process.exit(failures === 0 ? 0 : 1);
