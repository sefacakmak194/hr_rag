/**
 * Denetim kaydi.
 *
 * Amac: "İK verisine kim, ne zaman erisdi" sorusunun cevaplanabilir olmasi.
 * Tablo ve DEGISTIRILEMEZLIK kisiti identity.service icinde kuruluyor
 * (SQLite tetikleyicileri UPDATE ve DELETE'i reddediyor).
 *
 * SORU METNI KURALI — karar: soru metni YALNIZCA kisitli bir dokumana
 * erisildiginde saklanir. Genel dokumana erisimde `question` NULL kalir.
 *
 * Gerekce: denetim ihtiyaci zaten kisitli belgelerde. Her soruyu kaydetmek
 * calisanin ne merak ettigini kalici olarak adina yazar — mobbing sikayeti,
 * istifa sureci, saglik raporu gibi konular dahil. Bu dokumanlar `genel`
 * etiketli oldugu icin kural onlari kayit disinda birakir ve sisteme soru
 * sormaktan cekinmeyi onler.
 */
import type { DatabaseSync } from 'node:sqlite';
import { getDb } from './vectorStore.service.js';
import { chainHead, rowFingerprint } from './integrity.service.js';
import type { AccessLabel, Principal } from './identity.service.js';

export interface AuditCitation {
  doc: string;
  section: string;
  /**
   * Yanitin dayandigi POLITIKA SURUMUNUN kimligi (Sprint 2).
   *
   * DENETIMIN ASIL CIVISI BURASI. Dosya adi + madde basligi, dokuman
   * guncellendikten sonra YENI metne cozulur; yani kayit "su maddeye
   * dayandi" der ama o madde artik baska bir sey soyler. Surum kimligi
   * degismez bir arsiv satirina isaret eder.
   *
   * Istege bagli: Sprint 2 oncesi yazilmis satirlarda ve surum kaydi
   * olusmadan once indekslenmis dokumanlarda bulunmaz.
   */
  versionId?: number;
  version?: number;
}

export interface AuditEntry {
  principal: Principal;
  question: string;
  /** Takip sorusu yeniden yazildiysa cozulmus hali. */
  resolvedQuery?: string;
  citations: AuditCitation[];
  /** false = alaka kapisina takildi, mevzuattan yanit uretilmedi. */
  answered: boolean;
  durationMs: number;
}

/**
 * Dokumanlarin erisim etiketlerini doner.
 *
 * `documents` tablosunda kaydi olmayan dokuman `genel` sayilir — Sprint 1
 * oncesi indekslenmis dokumanlar icin gecerli.
 */
export function documentLabels(db: DatabaseSync, docTitles: string[]): Map<string, AccessLabel> {
  const labels = new Map<string, AccessLabel>();
  if (!docTitles.length) return labels;

  const unique = [...new Set(docTitles)];
  const rows = db
    .prepare(
      `SELECT doc_title, access_label FROM documents WHERE doc_title IN (${unique.map(() => '?').join(',')})`,
    )
    .all(...unique) as { doc_title: string; access_label: AccessLabel }[];

  for (const t of unique) labels.set(t, 'genel');
  for (const r of rows) labels.set(r.doc_title, r.access_label);
  return labels;
}

/** Alintilarin herhangi biri kisitli bir dokumandan mi geliyor? */
export function touchedRestricted(db: DatabaseSync, citations: AuditCitation[]): boolean {
  const labels = documentLabels(
    db,
    citations.map((c) => c.doc),
  );
  return [...labels.values()].some((l) => l !== 'genel');
}

/**
 * Tek bir denetim satiri yazar.
 *
 * ASLA firlatmaz: denetim yazimi basarisiz olursa kullanicinin yaniti
 * kaybolmamali. Hata konsola dusurulur — sessizce yutulmaz.
 */
export function recordAudit(entry: AuditEntry): void {
  try {
    const db = getDb();
    const restricted = touchedRestricted(db, entry.citations);

    const row = {
      id: 0, // zincir ozetine girmez (bkz. integrity.service, rowFingerprint)
      at: new Date().toISOString(),
      userId: entry.principal.userId,
      username: entry.principal.username,
      role: entry.principal.role as string,
      question: restricted ? entry.question : null,
      resolvedQuery: restricted ? (entry.resolvedQuery ?? null) : null,
      citations: JSON.stringify(entry.citations),
      answered: entry.answered ? 1 : 0,
      durationMs: Math.round(entry.durationMs),
    };

    // HASH ZINCIRI (Sprint 3a): satir bir oncekinin ozetini tasir. Aradan satir
    // silmek ya da bir satiri degistirmek zinciri kirar ve tespit edilebilir
    // olur — tetikleyiciler yalnizca UYGULAMA icinden gelen yollari kapatiyordu.
    const prevHash = chainHead(db);
    const rowHash = rowFingerprint(prevHash, row);

    db.prepare(
      `INSERT INTO audit_log
         (at, user_id, username, role, question, resolved_query, citations, answered,
          duration_ms, prev_hash, row_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.at,
      row.userId,
      row.username,
      row.role,
      row.question,
      row.resolvedQuery,
      row.citations,
      row.answered,
      row.durationMs,
      prevHash,
      rowHash,
    );
  } catch (error) {
    console.error('[denetim] kayit yazilamadi:', (error as Error).message);
  }
}

export interface AuditRow {
  id: number;
  at: string;
  username: string;
  role: string;
  question: string | null;
  citations: AuditCitation[];
  answered: boolean;
  durationMs: number;
}

export interface AuditQuery {
  /** Kullanici adina gore suzme (yalnizca yonetici kullanabilir). */
  username?: string;
  limit?: number;
}

/**
 * Denetim kaydini okur.
 *
 * GORUNURLUK KURALI — karar: `yonetici` tum satirlari gorur, diger roller
 * YALNIZCA kendi satirlarini. KVKK kisiye kendi verisine erisim hakki
 * taniyor; kendi kaydini gorebilmek bu hakki dogrudan karsilar.
 *
 * Kural burada, cagiran tarafta degil: uc bunu atlayamasin.
 */
export function listAudit(principal: Principal, query: AuditQuery = {}): AuditRow[] {
  const db = getDb();
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 1000);

  const where: string[] = [];
  const values: (string | number)[] = [];

  if (principal.role !== 'yonetici') {
    where.push('user_id = ?');
    values.push(principal.userId);
  } else if (query.username) {
    where.push('username = ?');
    values.push(query.username.toLowerCase());
  }

  const rows = db
    .prepare(
      `SELECT id, at, username, role, question, citations, answered, duration_ms
       FROM audit_log
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY id DESC LIMIT ?`,
    )
    .all(...values, limit) as {
    id: number;
    at: string;
    username: string;
    role: string;
    question: string | null;
    citations: string;
    answered: number;
    duration_ms: number;
  }[];

  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    username: r.username,
    role: r.role,
    question: r.question,
    citations: safeParse(r.citations),
    answered: r.answered === 1,
    durationMs: r.duration_ms,
  }));
}

function safeParse(json: string): AuditCitation[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Yonetici ekrani icin ozet sayilar. */
export function auditSummary(principal: Principal): {
  total: number;
  unanswered: number;
  users: number;
} {
  const db = getDb();
  const scope = principal.role === 'yonetici' ? '' : 'WHERE user_id = ?';
  const values = principal.role === 'yonetici' ? [] : [principal.userId];

  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN answered = 0 THEN 1 ELSE 0 END) AS unanswered,
              COUNT(DISTINCT user_id) AS users
       FROM audit_log ${scope}`,
    )
    .get(...values) as { total: number; unanswered: number | null; users: number };

  return { total: row.total, unanswered: row.unanswered ?? 0, users: row.users };
}
