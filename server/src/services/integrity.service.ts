/**
 * Denetim bütünlüğü: hash zinciri ve imzalı arşiv (Sprint 3a).
 *
 * COZULEN SORUN
 *
 * Denetim kaydini bugun SQLite tetikleyicileri koruyor ve bu UYGULAMA ICINDEN
 * gelen her yolu kapatiyor. Ama `data/vectors.db` dosyasina dogrudan erisebilen
 * biri — `sqlite3` komut satiriyla — tetikleyiciyi dusurup satir silebilir ve
 * BUNU KIMSE ANLAYAMAZ. Sprint 1 tasarimi bu boslugu acikca kaydetmisti.
 *
 * ---
 *
 * DURUST SINIR — once bunu soylemek gerekiyor.
 *
 * Tek bir air-gapped makinede kurcalamayi IMKANSIZ kilamazsiniz. Dosyaya erisimi
 * olan, yeterince ugrasirsa her seye erisir; ozel anahtar da o makinede duruyor.
 * Yapilabilecek olan su:
 *
 *   1. Kurcalamayi TESPIT EDILEBILIR kilmak      → hash zinciri
 *   2. Tespit kanitini TASINABILIR kilmak        → imzali arsiv
 *
 * Asil savunma, arsivin makineden DISARI CIKARILMIS olmasidir: disari cikmis bir
 * arsiv geriye donuk degistirilemez. Bu yuzden arsiv uretmek degil, arsivi
 * saklamak onemli.
 *
 * ---
 *
 * ZINCIRIN YAKALAYAMADIGI TEK DURUM
 *
 * Zincir her satiri bir oncekine baglar; ortadan satir silmek ya da degistirmek
 * zinciri kirar. SON satirlari silmek ise kirmaz — ileriye isaret eden bir sey
 * yok. Bunun cevabi arsivdir: arsiv, o an zincirin BASINI ve son satir numarasini
 * kaydeder. Veritabani arsivin gerisine dusmusse kurcalama ortaya cikar.
 *
 * Son arsivden SONRA yazilmis satirlarin silinmesi hala tespit edilemez. Cozumu
 * sik arsivlemektir; bu sinir belgeye yazildi cunku gizlenmesi yanlis guvence
 * uretir.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  createHash,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  createPrivateKey,
  createPublicKey,
} from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ARCHIVE_DIR, AUDIT_KEY_PATH, AUDIT_PUBLIC_KEY_PATH } from '../config/constants.js';

/** Zincirin ilk halkasi. Gercek bir ozet degil; baslangic isareti. */
export const GENESIS = '0'.repeat(64);

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Anahtar sirasindan bagimsiz JSON.
 *
 * Imza, ayristirilip yeniden serilestirilen bir nesne uzerinden dogrulanacak.
 * Duz `JSON.stringify` anahtar sirasina bagli oldugu icin dogrulama, kurcalama
 * olmadan da basarisiz olabilirdi. Anahtarlar siralanarak bu belirsizlik
 * tamamen kaldiriliyor.
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`).join(',')}}`;
}

// =============================================================== hash zinciri

/** Zincire giren alanlar. Sirasi SABIT — degisirse eski arsivler dogrulanamaz. */
export interface ChainedRow {
  id: number;
  at: string;
  userId: number;
  username: string;
  role: string;
  question: string | null;
  resolvedQuery: string | null;
  /** Veritabaninda saklanan JSON metni; yeniden serilestirilmez. */
  citations: string;
  answered: number;
  durationMs: number;
}

/**
 * Bir satirin zincir ozeti.
 *
 * `id` OZETE GIRMEZ — bilincli. Satir kimligi ancak INSERT'ten sonra bilinir,
 * ama `audit_log` uzerinde UPDATE tetikleyiciyle yasak; yani "once yaz, sonra
 * ozeti doldur" mumkun degil. Kimligi tahmin etmek (MAX(id)+1) kirilgan olurdu.
 *
 * Guvenlik acisindan kayip yok: sirayi baglayan sey zaten `prevHash`. Bir satiri
 * silip kalanlari yeniden numaralandiran biri de yakalanir — silinen satirin
 * ozeti bir sonrakinin `prevHash` alaninda duruyor ve artik tutmuyor.
 */
export function rowFingerprint(prevHash: string, row: ChainedRow): string {
  return sha256(
    canonical([
      prevHash,
      row.at,
      row.userId,
      row.username,
      row.role,
      row.question,
      row.resolvedQuery,
      row.citations,
      row.answered,
      row.durationMs,
    ]),
  );
}

/** Zincirin su anki basi. Hic zincirli satir yoksa GENESIS. */
export function chainHead(db: DatabaseSync): string {
  const row = db
    .prepare('SELECT row_hash FROM audit_log WHERE row_hash IS NOT NULL ORDER BY id DESC LIMIT 1')
    .get() as { row_hash: string } | undefined;
  return row?.row_hash ?? GENESIS;
}

export interface ChainReport {
  ok: boolean;
  /** Zincire dahil satir sayisi. */
  chained: number;
  /**
   * Zincir eklenmeden ONCE yazilmis satir sayisi.
   *
   * Bunlarin ozeti GERIYE DONUK HESAPLANMADI: zaten degistirilmis olabilecek
   * veri uzerinden hash uretmek, dogrulanmamis seye "dogrulandi" demek olurdu.
   */
  preChain: number;
  chainHead: string;
  lastRowId: number | null;
  /** Ilk kirik halkanin satir kimligi. */
  brokenAt?: number;
  reason?: string;
}

/**
 * Zinciri bastan sona yurur ve ilk kirik halkayi bildirir.
 *
 * `expected` verilirse (son arsivin kaydettigi durum) SON SATIRLARIN silinmesi
 * de yakalanir — zincirin tek basina goremedigi durum budur.
 */
export function verifyAuditChain(
  db: DatabaseSync,
  expected?: { lastRowId: number; chainHead: string },
): ChainReport {
  const rows = db
    .prepare(
      `SELECT id, at, user_id AS userId, username, role, question,
              resolved_query AS resolvedQuery, citations, answered,
              duration_ms AS durationMs, prev_hash AS prevHash, row_hash AS rowHash
       FROM audit_log ORDER BY id`,
    )
    .all() as unknown as (ChainedRow & { prevHash: string | null; rowHash: string | null })[];

  const preChain = rows.filter((r) => !r.rowHash).length;
  const chainedRows = rows.filter((r) => r.rowHash);

  const report: ChainReport = {
    ok: true,
    chained: chainedRows.length,
    preChain,
    chainHead: chainHead(db),
    lastRowId: rows.length ? rows[rows.length - 1].id : null,
  };

  let prev = GENESIS;
  for (const row of chainedRows) {
    if (row.prevHash !== prev) {
      return {
        ...report,
        ok: false,
        brokenAt: row.id,
        reason: `${row.id} numaralı satırın önceki özeti uyuşmuyor — araya giren satır silinmiş ya da değiştirilmiş olabilir.`,
      };
    }

    const computed = rowFingerprint(prev, row);
    if (computed !== row.rowHash) {
      return {
        ...report,
        ok: false,
        brokenAt: row.id,
        reason: `${row.id} numaralı satırın içeriği kayıtlı özetle uyuşmuyor — satır değiştirilmiş.`,
      };
    }
    prev = computed;
  }

  // SON SATIR SILME kontrolu: zincir kendi basina goremez, arsiv gorur.
  if (expected) {
    if (report.lastRowId !== null && report.lastRowId < expected.lastRowId) {
      return {
        ...report,
        ok: false,
        reason:
          `Son arşiv ${expected.lastRowId} numaralı satıra kadar imzalanmıştı; ` +
          `veritabanında yalnızca ${report.lastRowId} numaralı satıra kadar kayıt var. Sondan satır silinmiş.`,
      };
    }
    if (expected.lastRowId > 0 && report.lastRowId === null) {
      return { ...report, ok: false, reason: 'Arşivde kayıt var ama veritabanı boş — denetim kaydı silinmiş.' };
    }
  }

  return report;
}

// ================================================================== anahtar

export interface KeyPairInfo {
  publicKeyPem: string;
  /** Acik anahtarin sha256 ozetinin ilk 16 hanesi — elle karsilastirmak icin. */
  fingerprint: string;
  created: boolean;
}

export function publicKeyFingerprint(publicKeyPem: string): string {
  return sha256(publicKeyPem.replace(/\s+/g, '')).slice(0, 16);
}

/**
 * Imza anahtar cifti. Yoksa uretilir.
 *
 * Ed25519 secildi: node:crypto icinde, dis bagimlilik yok, imzasi kisa ve
 * dogrulamasi hizli. RSA da calisirdi ama anahtar uretimi saniyeler suruyor ve
 * imza dosyalari gereksiz buyuk olurdu.
 *
 * OZEL ANAHTAR bu makinede duruyor — bunun ne anlama geldigi dosya basinda
 * yaziyor. Yolu `AUDIT_KEY_PATH` ile disari alinabilir (ornegin cikarilabilir
 * bir surucuye), ki arsivi ureten makinede anahtar durmasin.
 */
export function ensureKeyPair(): KeyPairInfo {
  if (fs.existsSync(AUDIT_KEY_PATH) && fs.existsSync(AUDIT_PUBLIC_KEY_PATH)) {
    const publicKeyPem = fs.readFileSync(AUDIT_PUBLIC_KEY_PATH, 'utf-8');
    return { publicKeyPem, fingerprint: publicKeyFingerprint(publicKeyPem), created: false };
  }

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  fs.mkdirSync(path.dirname(AUDIT_KEY_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(AUDIT_PUBLIC_KEY_PATH), { recursive: true });
  // mode 0600: Windows'ta tam karsiligi yok ama POSIX kurulumda anlamli.
  fs.writeFileSync(AUDIT_KEY_PATH, privateKeyPem, { mode: 0o600 });
  fs.writeFileSync(AUDIT_PUBLIC_KEY_PATH, publicKeyPem);

  return { publicKeyPem, fingerprint: publicKeyFingerprint(publicKeyPem), created: true };
}

function loadPrivateKey() {
  if (!fs.existsSync(AUDIT_KEY_PATH)) ensureKeyPair();
  return createPrivateKey(fs.readFileSync(AUDIT_KEY_PATH, 'utf-8'));
}

// =================================================================== arsiv

export interface ArchiveContent {
  sema: 1;
  olusturuldu: string;
  aralik: { ilkSatir: number | null; sonSatir: number | null };
  zincirBasi: string;
  zincirOncesiSatir: number;
  /** Bir onceki arsivin dosya adi ve ozeti; arsivler de zincirlenir. */
  oncekiArsiv: { dosya: string; ozet: string } | null;
  satirlar: (ChainedRow & { prevHash: string | null; rowHash: string | null })[];
  /**
   * Surum USTVERISI — tam metin degil, icerik ozeti.
   *
   * Metni saklamak arsivi devasa yapardi; ozet, "o gun yururlukteki metin bu
   * muydu" sorusunu yine cevaplar: veritabanindaki metin degistiyse ozeti tutmaz.
   */
  surumler: {
    id: number;
    docTitle: string;
    version: number;
    contentHash: string;
    effectiveFrom: string;
    createdAt: string;
    createdBy: string;
    withdrawnAt: string | null;
  }[];
}

export interface SignedArchive {
  icerik: ArchiveContent;
  algoritma: 'ed25519';
  /**
   * Imzayi ureten acik anahtar. KOLAYLIK icin gomulu; dogrulamada TEK BASINA
   * kullanilmaz — saldirgan kendi anahtariyla yeniden imzalayip bu alani da
   * degistirebilir. Dogrulayan taraf anahtari BAGIMSIZ edinmeli (bkz.
   * scripts/verify-archive.ts).
   */
  acikAnahtar: string;
  acikAnahtarParmakIzi: string;
  imza: string;
}

function latestArchiveFile(): string | null {
  if (!fs.existsSync(ARCHIVE_DIR)) return null;
  const files = fs
    .readdirSync(ARCHIVE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
  return files.length ? files[files.length - 1] : null;
}

/** Son arsivin kaydettigi durum — zincir dogrulamasinda beklenen deger. */
export function lastArchiveState(): { lastRowId: number; chainHead: string; dosya: string } | null {
  const file = latestArchiveFile();
  if (!file) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, file), 'utf-8')) as SignedArchive;
    const last = parsed.icerik.aralik.sonSatir;
    if (last === null) return null;
    return { lastRowId: last, chainHead: parsed.icerik.zincirBasi, dosya: file };
  } catch {
    return null;
  }
}

export interface ArchiveResult {
  dosya: string;
  yol: string;
  satirSayisi: number;
  surumSayisi: number;
  parmakIzi: string;
  bayt: number;
}

/**
 * Imzali arsiv uretir.
 *
 * Arsiv TUM denetim kaydini icerir, yalnizca son arsivden beri gelenleri degil.
 * Sebep: denetci elinde TEK bir dosyayla calisabilmeli. Bu korpus olceginde
 * (yillik binlerce satir) dosya birkac megabayti gecmez.
 */
export function createSignedArchive(db: DatabaseSync): ArchiveResult {
  const key = ensureKeyPair();

  const satirlar = db
    .prepare(
      `SELECT id, at, user_id AS userId, username, role, question,
              resolved_query AS resolvedQuery, citations, answered,
              duration_ms AS durationMs, prev_hash AS prevHash, row_hash AS rowHash
       FROM audit_log ORDER BY id`,
    )
    .all() as unknown as ArchiveContent['satirlar'];

  const surumler = db
    .prepare(
      `SELECT id, doc_title AS docTitle, version, content_hash AS contentHash,
              effective_from AS effectiveFrom, created_at AS createdAt,
              created_by AS createdBy, withdrawn_at AS withdrawnAt
       FROM document_versions ORDER BY id`,
    )
    .all() as unknown as ArchiveContent['surumler'];

  const previousFile = latestArchiveFile();
  const oncekiArsiv = previousFile
    ? {
        dosya: previousFile,
        ozet: sha256(fs.readFileSync(path.join(ARCHIVE_DIR, previousFile), 'utf-8')),
      }
    : null;

  const icerik: ArchiveContent = {
    sema: 1,
    olusturuldu: new Date().toISOString(),
    aralik: {
      ilkSatir: satirlar.length ? satirlar[0].id : null,
      sonSatir: satirlar.length ? satirlar[satirlar.length - 1].id : null,
    },
    zincirBasi: chainHead(db),
    zincirOncesiSatir: satirlar.filter((r) => !r.rowHash).length,
    oncekiArsiv,
    satirlar,
    surumler,
  };

  const imza = cryptoSign(null, Buffer.from(canonical(icerik), 'utf-8'), loadPrivateKey()).toString('base64');

  const signed: SignedArchive = {
    icerik,
    algoritma: 'ed25519',
    acikAnahtar: key.publicKeyPem,
    acikAnahtarParmakIzi: key.fingerprint,
    imza,
  };

  const stamp = icerik.olusturuldu.replace(/[:.]/g, '-');
  const dosya = `denetim-arsivi-${stamp}.json`;
  const yol = path.join(ARCHIVE_DIR, dosya);

  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const body = `${JSON.stringify(signed, null, 2)}\n`;
  fs.writeFileSync(yol, body, 'utf-8');

  return {
    dosya,
    yol,
    satirSayisi: satirlar.length,
    surumSayisi: surumler.length,
    parmakIzi: key.fingerprint,
    bayt: Buffer.byteLength(body),
  };
}

export interface ArchiveVerification {
  ok: boolean;
  /** Imza gecerli mi? */
  imzaGecerli: boolean;
  /** Arsivin ICINDEKI zincir tutarli mi? */
  zincirGecerli: boolean;
  satirSayisi: number;
  surumSayisi: number;
  olusturuldu: string;
  parmakIzi: string;
  /** Verilen acik anahtar, arsive gomulu olanla ayni mi? */
  anahtarEslesti?: boolean;
  sorunlar: string[];
}

/**
 * Bir arsiv dosyasini dogrular. VERITABANI GEREKTIRMEZ — denetci baska bir
 * makinede, yalnizca dosya ve acik anahtarla calisabilmeli.
 *
 * `expectedPublicKeyPem` verilmezse imza yalnizca GOMULU anahtarla dogrulanir;
 * bu, dosyanin kendi icinde tutarli oldugunu gosterir ama BASKASININ imzalamis
 * olma ihtimalini disllamaz. Gercek dogrulama icin anahtar bagimsiz edinilmeli.
 */
export function verifyArchive(filePath: string, expectedPublicKeyPem?: string): ArchiveVerification {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as SignedArchive;
  const sorunlar: string[] = [];

  const embedded = parsed.acikAnahtar;
  let anahtarEslesti: boolean | undefined;

  if (expectedPublicKeyPem) {
    anahtarEslesti = publicKeyFingerprint(expectedPublicKeyPem) === publicKeyFingerprint(embedded);
    if (!anahtarEslesti) {
      sorunlar.push(
        'Arşive gömülü açık anahtar, verilen anahtarla AYNI DEĞİL. Arşiv başka bir anahtarla imzalanmış.',
      );
    }
  } else {
    sorunlar.push(
      'Açık anahtar verilmedi; imza yalnızca arşivin kendi içindeki anahtarla doğrulandı. ' +
        'Bu, dosyanın tutarlı olduğunu gösterir ama kimin imzaladığını kanıtlamaz.',
    );
  }

  const keyForVerify = expectedPublicKeyPem ?? embedded;
  let imzaGecerli = false;
  try {
    imzaGecerli = cryptoVerify(
      null,
      Buffer.from(canonical(parsed.icerik), 'utf-8'),
      createPublicKey(keyForVerify),
      Buffer.from(parsed.imza, 'base64'),
    );
  } catch (error) {
    sorunlar.push(`İmza doğrulanamadı: ${(error as Error).message}`);
  }
  if (!imzaGecerli) sorunlar.push('İMZA GEÇERSİZ — arşiv içeriği imzalandıktan sonra değiştirilmiş.');

  // Arsivin icindeki zincir de yeniden hesaplanir: imza gecerli olsa bile
  // (ornegin saldirgan kendi anahtariyla yeniden imzaladiysa) zincir kirikligi
  // gorunur kalir.
  let zincirGecerli = true;
  let prev = GENESIS;
  for (const row of parsed.icerik.satirlar) {
    if (!row.rowHash) continue; // zincir oncesi satir
    if (row.prevHash !== prev || rowFingerprint(prev, row) !== row.rowHash) {
      zincirGecerli = false;
      sorunlar.push(`Arşivdeki zincir ${row.id} numaralı satırda kırık.`);
      break;
    }
    prev = row.rowHash;
  }

  return {
    ok: imzaGecerli && zincirGecerli && anahtarEslesti !== false,
    imzaGecerli,
    zincirGecerli,
    satirSayisi: parsed.icerik.satirlar.length,
    surumSayisi: parsed.icerik.surumler.length,
    olusturuldu: parsed.icerik.olusturuldu,
    parmakIzi: parsed.acikAnahtarParmakIzi,
    anahtarEslesti,
    sorunlar,
  };
}

export interface ArchiveListItem {
  dosya: string;
  bayt: number;
  olusturuldu: string;
  satirSayisi: number;
}

export function listArchives(): ArchiveListItem[] {
  if (!fs.existsSync(ARCHIVE_DIR)) return [];

  return fs
    .readdirSync(ARCHIVE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
    .map((dosya) => {
      const yol = path.join(ARCHIVE_DIR, dosya);
      const stat = fs.statSync(yol);
      let olusturuldu = stat.mtime.toISOString();
      let satirSayisi = 0;
      try {
        const parsed = JSON.parse(fs.readFileSync(yol, 'utf-8')) as SignedArchive;
        olusturuldu = parsed.icerik.olusturuldu;
        satirSayisi = parsed.icerik.satirlar.length;
      } catch {
        // Bozuk dosya listeden dusmesin; dogrulama zaten yakalar.
      }
      return { dosya, bayt: stat.size, olusturuldu, satirSayisi };
    });
}
