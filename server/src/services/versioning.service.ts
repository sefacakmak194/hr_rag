/**
 * Politika surumleme (Sprint 2).
 *
 * COZULEN SORUN: bugun bir dokuman guncellendiginde GECMIS YANITLARIN DAYANAGI
 * yok oluyor. Denetim kaydindaki `01_izin.md :: Madde 1` alintisi, dosya
 * degistikten sonra YENI metne cozuluyor. Yani kayit "su maddeye dayandi"
 * diyor ama o madde artik baska bir sey soyluyor. Kurumsal denetimde bu,
 * denetim kaydini degersiz kilar: gecmis bir karari savunmak icin o gunku
 * metin gerekir.
 *
 * COZUM: her icerik degisikligi bir SURUM acar. Surumun metni arsivlenir,
 * alintilar surum kimligine baglanir, indeks yalnizca YURURLUKTEKI surumu
 * gorur.
 *
 * ---
 *
 * TASARIM KARARLARI
 *
 * 1) SURUM NUMARASI OTOMATIK ARTAR (1, 2, 3 ...), elle girilmez.
 *    Elle numaralama insan hatasina acik ve denetim kaydinin ihtiyaci olan sey
 *    anlamli bir numara degil, KARARLI bir kimlik. Degisikligin ANLAMI ayri bir
 *    `note` alaninda tutulur ("yazim hatasi duzeltmesi", "yonetim kurulu karari").
 *
 * 2) SURUM TETIKLEYICISI ICERIK OZETIDIR (sha256), kullanicinin bir dugmeye
 *    basmasi degil. Boylece korpus dizinine ELLE kopyalanan bir dosya da surum
 *    acar. Surum gecmisi, arayuzden gecilmis olmasina degil, INDEKSLENMIS OLANA
 *    dayanir — tek dogruluk kaynagi budur.
 *
 * 3) KARSILASTIRMA YURURLUKTEKI SURUMLE YAPILIR, en son surumle degil.
 *    Korpus dizininde duran dosya tanimi geregi yururlukteki metindir. Ileri
 *    tarihli (bekleyen) bir surum varken en son surumle karsilastirilsaydi, her
 *    yeniden indeksleme eski icerikten sahte bir surum acardi.
 *
 * 4) SURUMLER SILINMEZ. Saklama suresi (retention) bilincli olarak YOK:
 *    KVKK'nin veri minimizasyonu KISISEL veri icindir; sirket mevzuati kisisel
 *    veri degildir. Buna karsilik denetim kaydinin degeri, gecmis metnin
 *    yeniden kurulabilmesine bagli. Disk kaygisi olursa dogru cevap sessiz
 *    silme degil, imzali arsiv (Sprint 3).
 *
 * 5) ETIKET SURUME DEGIL DOKUMANA AITTIR. Bir dokuman sonradan `ik` yapilirsa
 *    TUM GECMISI de kisitlanir. Guvenli yon budur: gecmiste `genel` diye
 *    yayinlanmis bir metnin bugun kisitli olmasi, kisitli bir metnin gecmis
 *    surumuyle sizmasindan iyidir.
 */
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { VISIBLE_LABELS, type AccessLabel, type Principal } from './identity.service.js';

/** Surumun yasam dongusundeki yeri. Saklanmaz, sorgu aninda TURETILIR. */
export type VersionState = 'yururlukte' | 'bekliyor' | 'arsiv' | 'geri-cekildi';

export interface VersionRow {
  id: number;
  docTitle: string;
  version: number;
  contentHash: string;
  source: string;
  bytes: number;
  /** Yururluk baslangici (ISO). Gelecekte olabilir — bkz. bekleyen surumler. */
  effectiveFrom: string;
  note: string | null;
  createdAt: string;
  createdBy: string;
  withdrawnAt: string | null;
}

export interface VersionWithText extends VersionRow {
  content: string;
}

// ------------------------------------------------------------------- sema

/**
 * Surum tablosu.
 *
 * `content` cikarilmis TAM METINDIR, ham dosya degil. Sebep: diff, arsiv ve
 * "o gun ne yaziyordu" sorusunun tamami metin uzerinden calisir; 5 MB'lik bir
 * PDF'i saklamak ayni soruyu cevaplamaz, yalnizca veritabanini sisirir.
 */
export function ensureVersionSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_versions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_title      TEXT    NOT NULL,
      version        INTEGER NOT NULL,
      content_hash   TEXT    NOT NULL,
      content        TEXT    NOT NULL,
      source         TEXT    NOT NULL,
      bytes          INTEGER NOT NULL,
      effective_from TEXT    NOT NULL,
      note           TEXT,
      created_at     TEXT    NOT NULL,
      created_by     TEXT    NOT NULL,
      withdrawn_at   TEXT,
      UNIQUE (doc_title, version)
    );
    CREATE INDEX IF NOT EXISTS idx_versions_doc ON document_versions(doc_title, version DESC);
  `);

  // DEGISTIRILEMEZLIK — denetim kaydiyla AYNI mantik, ama tam kilit degil.
  //
  // Surumun ICERIGI ve kimligi degistirilemez; yalnizca yasam dongusu damgasi
  // (`withdrawn_at`) yazilabilir. Tam kilit konsaydi dokuman silme islemi
  // kaydedilemezdi; icerigi serbest biraksaydik arsiv anlamsiz olurdu.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS versions_no_delete BEFORE DELETE ON document_versions
    BEGIN SELECT RAISE(ABORT, 'politika sürümü silinemez'); END;

    CREATE TRIGGER IF NOT EXISTS versions_immutable BEFORE UPDATE ON document_versions
    WHEN OLD.content        <> NEW.content
      OR OLD.content_hash   <> NEW.content_hash
      OR OLD.doc_title      <> NEW.doc_title
      OR OLD.version        <> NEW.version
      OR OLD.effective_from <> NEW.effective_from
      OR OLD.created_at     <> NEW.created_at
    BEGIN SELECT RAISE(ABORT, 'sürüm içeriği değiştirilemez'); END;
  `);
}

// --------------------------------------------------------------- yardimci

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

// `interface` DEGIL `type`: node:sqlite'in `.all()` cikisi
// `Record<string, SQLOutputValue>[]` ve interface'ler ortuk indeks imzasi
// almadigi icin dogrudan cevrilemiyor. Tip takma adi bu imzayi alir.
type RawVersion = {
  id: number;
  doc_title: string;
  version: number;
  content_hash: string;
  source: string;
  bytes: number;
  effective_from: string;
  note: string | null;
  created_at: string;
  created_by: string;
  withdrawn_at: string | null;
};

const COLUMNS =
  'id, doc_title, version, content_hash, source, bytes, effective_from, note, created_at, created_by, withdrawn_at';

function toRow(r: RawVersion): VersionRow {
  return {
    id: r.id,
    docTitle: r.doc_title,
    version: r.version,
    contentHash: r.content_hash,
    source: r.source,
    bytes: r.bytes,
    effectiveFrom: r.effective_from,
    note: r.note,
    createdAt: r.created_at,
    createdBy: r.created_by,
    withdrawnAt: r.withdrawn_at,
  };
}

/**
 * Yururluk tarihini ISO'ya cevirir.
 *
 * DIKKAT — salt tarih (`2026-09-01`) YEREL gece yarisi kabul edilir, UTC degil.
 * `new Date('2026-09-01')` UTC gece yarisini verir; Turkiye'de bu 1 Eylul saat
 * 03:00 demektir ve "1 Eylul'de yururluge girer" sozunu 3 saat geciktirirdi.
 * Kurum kendi saat diliminde calisir; yorumu da oyle yapiyoruz.
 */
export function normalizeEffectiveFrom(input: unknown, fallback: Date = new Date()): string {
  if (typeof input !== 'string' || !input.trim()) return fallback.toISOString();

  const raw = input.trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(raw);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Yürürlük tarihi anlaşılamadı: "${raw}". Beklenen biçim: 2026-09-01`);
  }

  // TASMA KONTROLU — `new Date` takvimi dogrulamaz, TASIRIR.
  //
  // "2026-02-31" NaN uretmez; sessizce 3 Mart'a kayar. Yururluk tarihi hukuki
  // bir taahhut: kullanicinin yazdigi gunde degil iki gun sonra devreye giren
  // bir mevzuat degisikligi, sessiz oldugu icin en kotu turden hatadir.
  // Ayristirilan tarihi girdiyle karsilastirmak kaymayi yakalar.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [yil, ay, gun] = raw.split('-').map(Number);
    if (date.getFullYear() !== yil || date.getMonth() + 1 !== ay || date.getDate() !== gun) {
      throw new Error(`Yürürlük tarihi takvimde yok: "${raw}".`);
    }
  }

  return date.toISOString();
}

// ---------------------------------------------------------------- okuma

/** Dokumanin en yuksek numarali surumu (yururlukte olmayabilir). */
export function latestVersion(db: DatabaseSync, docTitle: string): VersionRow | null {
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM document_versions WHERE doc_title = ? ORDER BY version DESC LIMIT 1`)
    .get(docTitle) as RawVersion | undefined;
  return row ? toRow(row) : null;
}

/**
 * YURURLUKTEKI surum: yururluk tarihi gelmis, geri cekilmemis EN YUKSEK surum.
 *
 * "En yuksek numarali" olmasi bilincli — geriye donuk duzeltmeye izin verir:
 * gecmis tarihli yeni bir surum yuklenirse o gecerli olur, cunku en son
 * YAZILAN metin odur.
 */
export function currentVersion(db: DatabaseSync, docTitle: string, now = new Date()): VersionRow | null {
  const row = db
    .prepare(
      `SELECT ${COLUMNS} FROM document_versions
       WHERE doc_title = ? AND withdrawn_at IS NULL AND effective_from <= ?
       ORDER BY version DESC LIMIT 1`,
    )
    .get(docTitle, now.toISOString()) as RawVersion | undefined;
  return row ? toRow(row) : null;
}

/** Yururluk tarihi HENUZ GELMEMIS surum (varsa). */
export function pendingVersion(db: DatabaseSync, docTitle: string, now = new Date()): VersionRow | null {
  const row = db
    .prepare(
      `SELECT ${COLUMNS} FROM document_versions
       WHERE doc_title = ? AND withdrawn_at IS NULL AND effective_from > ?
       ORDER BY version DESC LIMIT 1`,
    )
    .get(docTitle, now.toISOString()) as RawVersion | undefined;
  return row ? toRow(row) : null;
}

export function listVersions(db: DatabaseSync, docTitle: string): VersionRow[] {
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM document_versions WHERE doc_title = ? ORDER BY version DESC`)
    .all(docTitle) as RawVersion[];
  return rows.map(toRow);
}

export function getVersion(db: DatabaseSync, docTitle: string, version: number): VersionWithText | null {
  const row = db
    .prepare(`SELECT ${COLUMNS}, content FROM document_versions WHERE doc_title = ? AND version = ?`)
    .get(docTitle, version) as (RawVersion & { content: string }) | undefined;
  return row ? { ...toRow(row), content: row.content } : null;
}

export function getVersionById(db: DatabaseSync, id: number): VersionWithText | null {
  const row = db.prepare(`SELECT ${COLUMNS}, content FROM document_versions WHERE id = ?`).get(id) as
    | (RawVersion & { content: string })
    | undefined;
  return row ? { ...toRow(row), content: row.content } : null;
}

/** Bir surumun yasam dongusundeki yeri — saklanmaz, buradan turetilir. */
export function versionState(db: DatabaseSync, row: VersionRow, now = new Date()): VersionState {
  if (row.withdrawnAt) return 'geri-cekildi';
  if (row.effectiveFrom > now.toISOString()) return 'bekliyor';
  const current = currentVersion(db, row.docTitle, now);
  return current?.id === row.id ? 'yururlukte' : 'arsiv';
}

/**
 * Birden fazla dokumanin yururlukteki surumu — sohbet yanitindaki alintilar icin.
 * Tek sorgu: alinti basina ayri sorgu atmak sicak yolda gereksiz.
 */
export function currentVersionsFor(
  db: DatabaseSync,
  docTitles: string[],
  now = new Date(),
): Map<string, VersionRow> {
  const result = new Map<string, VersionRow>();
  const unique = [...new Set(docTitles)];
  if (!unique.length) return result;

  const iso = now.toISOString();
  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM document_versions v
       WHERE v.doc_title IN (${unique.map(() => '?').join(',')})
         AND v.withdrawn_at IS NULL
         AND v.effective_from <= ?
         AND v.version = (
           SELECT MAX(v2.version) FROM document_versions v2
           WHERE v2.doc_title = v.doc_title AND v2.withdrawn_at IS NULL AND v2.effective_from <= ?
         )`,
    )
    .all(...unique, iso, iso) as RawVersion[];

  for (const r of rows) result.set(r.doc_title, toRow(r));
  return result;
}

// ---------------------------------------------------------------- yazma

export interface RecordVersionInput {
  docTitle: string;
  /** Cikarilmis TAM METIN (ham dosya degil). */
  content: string;
  source: string;
  bytes: number;
  actor: string;
  note?: string;
  effectiveFrom?: string;
}

/**
 * Icerik degistiyse yeni bir surum acar; degismediyse hicbir sey yapmaz.
 *
 * Karsilastirma YURURLUKTEKI surumle yapilir (bkz. dosya basi, karar 3).
 */
export function recordVersion(
  db: DatabaseSync,
  input: RecordVersionInput,
  now = new Date(),
): { row: VersionRow; created: boolean } {
  const hash = sha256(input.content);
  const current = currentVersion(db, input.docTitle, now);

  if (current && current.contentHash === hash) {
    return { row: current, created: false };
  }

  const latest = latestVersion(db, input.docTitle);
  const version = (latest?.version ?? 0) + 1;
  const effectiveFrom = normalizeEffectiveFrom(input.effectiveFrom, now);
  const createdAt = now.toISOString();
  const note = input.note?.trim() || null;

  db.prepare(
    `INSERT INTO document_versions
       (doc_title, version, content_hash, content, source, bytes, effective_from, note, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.docTitle,
    version,
    hash,
    input.content,
    input.source,
    input.bytes,
    effectiveFrom,
    note,
    createdAt,
    input.actor,
  );

  const id = Number(
    (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number } | undefined)?.id ?? 0,
  );

  return {
    row: {
      id,
      docTitle: input.docTitle,
      version,
      contentHash: hash,
      source: input.source,
      bytes: input.bytes,
      effectiveFrom,
      note,
      createdAt,
      createdBy: input.actor,
      withdrawnAt: null,
    },
    created: true,
  };
}

/**
 * Dokuman korpustan silindiginde TUM canli surumlerini geri ceker.
 *
 * Satirlar SILINMEZ — tetikleyici zaten buna izin vermez. Geri cekilen bir
 * dokuman yeniden yuklenirse numaralandirma kaldigi yerden devam eder ve yeni
 * surum canli olarak acilir.
 */
/**
 * Tek bir surumu geri ceker — planlanmis (bekleyen) bir degisiklikten
 * vazgecildiginde kullanilir.
 *
 * Satir SILINMEZ: denetimde "planlanmisti, vazgecildi" izi kalmalidir.
 */
export function withdrawVersion(
  db: DatabaseSync,
  docTitle: string,
  version: number,
  now = new Date(),
): boolean {
  const result = db
    .prepare(
      'UPDATE document_versions SET withdrawn_at = ? WHERE doc_title = ? AND version = ? AND withdrawn_at IS NULL',
    )
    .run(now.toISOString(), docTitle, version);
  return Number(result.changes ?? 0) > 0;
}

export function withdrawDocument(db: DatabaseSync, docTitle: string, now = new Date()): number {
  const result = db
    .prepare('UPDATE document_versions SET withdrawn_at = ? WHERE doc_title = ? AND withdrawn_at IS NULL')
    .run(now.toISOString(), docTitle);
  return Number(result.changes ?? 0);
}

// ---------------------------------------------------------------- erisim

/**
 * Dokumanin erisim etiketi. `documents` tablosunda kaydi olmayan dokuman
 * `genel` sayilir (Sprint 1 karari: mevcut korpusu sessizce kisitlama).
 */
export function accessLabelOf(db: DatabaseSync, docTitle: string): AccessLabel {
  const row = db.prepare('SELECT access_label FROM documents WHERE doc_title = ?').get(docTitle) as
    | { access_label: AccessLabel }
    | undefined;
  return row?.access_label ?? 'genel';
}

/**
 * Surum uclarinin kapisi.
 *
 * "Kilit kapida" kurali burada da gecerli: yetkisi olmayan kullanici surum
 * LISTESINI bile alamaz. Surum sayisi ve tarihleri tek baslarina bilgi tasir
 * ("ucret skalasi gecen hafta degismis").
 */
export function canSeeDocument(db: DatabaseSync, docTitle: string, principal: Principal): boolean {
  return VISIBLE_LABELS[principal.role].includes(accessLabelOf(db, docTitle));
}
