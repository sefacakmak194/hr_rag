/**
 * Kimlik katmani: yerel hesaplar, roller, oturumlar ve erisim etiketleri.
 *
 * TASARIM KARARI — "kilit kapida": erisim etiketi vektor aramasindan ONCE
 * uygulanir. Kullanicinin yetkisi olmayan dokumanin parcalari aday havuzuna
 * hic girmez. Kurumsal denetimde "sistem o belgeyi okumadi" savunulabilir,
 * "okudu ama atti" ispatlanamaz. Ayrinti: docs/SPRINT-1-TASARIM.md
 *
 * Bu dosya kimligi TANIMLAR; filtreyi uygulayan yer vectorStore'dur. Filtreyi
 * "unutmamaya" guvenmemek icin ilgili fonksiyonlar varsayilani olmayan zorunlu
 * bir Principal parametresi alir — atlayan cagri derlenmez.
 *
 * Parola: node:crypto scrypt. Dis bagimlilik yok, air-gapped calismayi bozmaz.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type Role = 'calisan' | 'ik' | 'yonetici';
export type AccessLabel = 'genel' | 'ik' | 'yonetici';

export const ROLES: Role[] = ['calisan', 'ik', 'yonetici'];
export const ACCESS_LABELS: AccessLabel[] = ['genel', 'ik', 'yonetici'];

/** Istegi yapan kimlik. Retrieval fonksiyonlari bunu ZORUNLU parametre alir. */
export interface Principal {
  userId: number;
  username: string;
  role: Role;
}

/**
 * Rolun gorebilecegi dokuman etiketleri.
 *
 * Hiyerarsik: yonetici her seyi, ik genel+ik, calisan yalnizca genel gorur.
 */
export const VISIBLE_LABELS: Record<Role, AccessLabel[]> = {
  calisan: ['genel'],
  ik: ['genel', 'ik'],
  yonetici: ['genel', 'ik', 'yonetici'],
};

/** Yukleme / silme / yeniden indeksleme yetkisi olan roller. */
export const CAN_MANAGE_DOCUMENTS: Role[] = ['ik', 'yonetici'];

export function canManageDocuments(role: Role): boolean {
  return CAN_MANAGE_DOCUMENTS.includes(role);
}

/**
 * Sorguda kullanilacak `IN (...)` yer tutucusu ve degerleri.
 *
 * Etiketler sabit kumeden geldigi icin string birlestirme guvenli olurdu; yine
 * de parametreli sorgu kullaniliyor — ileride etiket kumesi genisletilirse
 * enjeksiyon yuzeyi acilmasin.
 */
export function labelFilter(principal: Principal): { clause: string; values: AccessLabel[] } {
  const labels = VISIBLE_LABELS[principal.role];
  return { clause: labels.map(() => '?').join(', '), values: labels };
}

// ---------------------------------------------------------------- parola

const SCRYPT_KEYLEN = 64;

function derive(password: string, salt: string): Buffer {
  // NFKC: ayni gorunen ama farkli kodlanmis Turkce karakterler (ornegin
  // birlesik "İ" ile "I + nokta") ayni parolaya cozulsun.
  return scryptSync(password.normalize('NFKC'), salt, SCRYPT_KEYLEN);
}

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex');
  return { hash: derive(password, salt).toString('hex'), salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const expected = Buffer.from(hash, 'hex');
  const actual = derive(password, salt);
  // Uzunluk farkliysa timingSafeEqual firlatir; once esitligi kontrol et.
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * Kullanici adini karsilastirma bicimine cevirir.
 *
 * DIKKAT — Turkce yerel ayarla kucultme KULLANILMIYOR. `'I'.toLocaleLowerCase('tr-TR')`
 * "ı" verir, `'İ'` ise "i" verir; boylece ayni kullanici tarayici diline gore
 * farkli anahtarlara duserdi ve giris bazen calisip bazen calismazdi. Degismez
 * (invariant) kucultme deterministiktir.
 */
export function normalizeUsername(username: string): string {
  return username.normalize('NFKC').trim().toLowerCase();
}

// ---------------------------------------------------------------- sema

/**
 * Kimlik ve denetim tablolarini kurar.
 *
 * `chunks` tablosu zaten vectorStore tarafindan kuruluyor; burada yalnizca
 * Sprint 1 ile gelenler var. Hepsi IF NOT EXISTS — mevcut vectors.db dosyalari
 * silinmeden yukseltilir.
 */
export function ensureIdentitySchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT    NOT NULL UNIQUE,
      display_name  TEXT    NOT NULL,
      password_hash TEXT    NOT NULL,
      password_salt TEXT    NOT NULL,
      role          TEXT    NOT NULL CHECK (role IN ('calisan','ik','yonetici')),
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      doc_title    TEXT PRIMARY KEY,
      access_label TEXT NOT NULL DEFAULT 'genel'
                   CHECK (access_label IN ('genel','ik','yonetici')),
      source       TEXT NOT NULL,
      indexed_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS audit_log (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      at             TEXT    NOT NULL,
      user_id        INTEGER NOT NULL,
      username       TEXT    NOT NULL,
      role           TEXT    NOT NULL,
      question       TEXT,
      resolved_query TEXT,
      citations      TEXT    NOT NULL,
      answered       INTEGER NOT NULL,
      duration_ms    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, at);
  `);

  // Silinemezlik POLITIKA degil KISIT.
  //
  // "Denetim kaydi silinemez" cumlesi kodda bir kural olarak kalirsa, kurali
  // atlayan ilk sorgu onu gecersiz kilar. Veritabani duzeyinde zorlaniyor.
  // Dosyaya dogrudan erisebilen birini durdurmaz — onun cevabi imzali arsiv
  // (Sprint 3); uygulama icinden gelen her yolu kapatir.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'denetim kaydı değiştirilemez'); END;

    CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'denetim kaydı silinemez'); END;
  `);
}

// ---------------------------------------------------------------- dokuman

/**
 * Dokuman ustverisini yazar/gunceller (indeksleme sirasinda cagrilir).
 *
 * DIKKAT — `access_label` catisma durumunda KORUNUR. Yeniden indeksleme her
 * degisiklikte kosuyor; etiketi de yazsaydik yoneticinin verdigi her etiket
 * ilk yuklemede sessizce `genel`e donerdi.
 */
export function upsertDocumentMeta(
  db: DatabaseSync,
  docTitle: string,
  source: string,
  indexedAt: string = new Date().toISOString(),
): void {
  db.prepare(
    `INSERT INTO documents (doc_title, access_label, source, indexed_at)
     VALUES (?, 'genel', ?, ?)
     ON CONFLICT(doc_title) DO UPDATE SET source = excluded.source, indexed_at = excluded.indexed_at`,
  ).run(docTitle, source, indexedAt);
}

/**
 * Erisim etiketini degistirir.
 *
 * Sprint 1'de etiket semasi ve zorlamasi yazildi ama etiketi ATAYACAK bir yol
 * kalmadi: tablo yalnizca dogrudan SQL ile doldurulabiliyordu. Surum gecmisi
 * de ayni etikete bagli oldugu icin bu bosluk Sprint 2'de kapatiliyor.
 *
 * Cagiran taraf BM25 indeksini sifirlamalidir — havuz role gore daraldigi icin
 * etiket degisimi sozcuk istatistigini de degistirir.
 */
export function setAccessLabel(db: DatabaseSync, docTitle: string, label: AccessLabel): void {
  if (!ACCESS_LABELS.includes(label)) {
    throw new Error(`Geçersiz erişim etiketi: ${label}`);
  }
  db.prepare(
    `INSERT INTO documents (doc_title, access_label, source, indexed_at)
     VALUES (?, ?, 'bilinmiyor', ?)
     ON CONFLICT(doc_title) DO UPDATE SET access_label = excluded.access_label`,
  ).run(docTitle, label, new Date().toISOString());
}

// ---------------------------------------------------------------- kullanici

export interface UserRow {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export function countUsers(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number } | undefined;
  return row?.n ?? 0;
}

/** Hic kullanici yoksa uygulama ilk kurulum ekranini gosterir. */
export function needsSetup(db: DatabaseSync): boolean {
  return countUsers(db) === 0;
}

export function createUser(
  db: DatabaseSync,
  input: { username: string; displayName: string; password: string; role: Role },
): UserRow {
  const username = normalizeUsername(input.username);
  if (!username) throw new Error('Kullanıcı adı boş olamaz.');
  if (input.password.length < 8) throw new Error('Parola en az 8 karakter olmalıdır.');

  const { hash, salt } = hashPassword(input.password);
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO users (username, display_name, password_hash, password_salt, role, active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
  ).run(username, input.displayName.trim() || username, hash, salt, input.role, createdAt);

  return {
    id: Number((db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number } | undefined)?.id ?? 0),
    username,
    displayName: input.displayName.trim() || username,
    role: input.role,
    active: true,
    createdAt,
  };
}

interface RawUser {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
  role: Role;
  active: number;
  created_at: string;
}

export function findUser(db: DatabaseSync, username: string): RawUser | null {
  return (
    (db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(normalizeUsername(username)) as RawUser | undefined) ?? null
  );
}

/** Parola dogrulamasi. Basarisizsa null — sebep AYIRT EDILMEZ. */
export function authenticate(db: DatabaseSync, username: string, password: string): Principal | null {
  const user = findUser(db, username);

  // Kullanici yoksa da sahte bir dogrulama yapilir: aksi halde yanit suresi
  // "bu kullanici adi var mi" sorusunu ele verir (kullanici sayimi sizintisi).
  if (!user) {
    verifyPassword(password, '00'.repeat(SCRYPT_KEYLEN), 'tuz');
    return null;
  }
  if (!user.active) return null;
  if (!verifyPassword(password, user.password_hash, user.password_salt)) return null;

  return { userId: user.id, username: user.username, role: user.role };
}

// ---------------------------------------------------------------- oturum

/** Oturum omru. Kurumsal denetimde suresiz oturum kabul edilmez. */
export const SESSION_HOURS = 8;

export function createSession(db: DatabaseSync, principal: Principal): string {
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_HOURS * 3600_000);

  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    principal.userId,
    now.toISOString(),
    expires.toISOString(),
  );
  return token;
}

export function resolveSession(db: DatabaseSync, token: string | undefined): Principal | null {
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT s.expires_at, u.id, u.username, u.role, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`,
    )
    .get(token) as
    | { expires_at: string; id: number; username: string; role: Role; active: number }
    | undefined;

  if (!row) return null;
  if (!row.active) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }

  return { userId: row.id, username: row.username, role: row.role };
}

export function destroySession(db: DatabaseSync, token: string | undefined): void {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** Suresi dolmus oturumlari temizler (acilista cagrilir). */
export function purgeExpiredSessions(db: DatabaseSync): number {
  const result = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  return Number(result.changes ?? 0);
}
