import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  DB_PATH,
  EMBEDDING_DIM,
  TOP_K,
  SIMILARITY_THRESHOLD,
  RELEVANCE_MARGIN,
  CONTEXT_BAND,
  LEXICAL_WEIGHT,
} from '../config/constants.js';
import { cosineSimilarity } from './embedding.service.js';
import { Bm25Index } from './lexical.service.js';
import { ensureIdentitySchema, labelFilter, type Principal, type Role } from './identity.service.js';

export interface ChunkRecord {
  docTitle: string;
  section: string;
  content: string;
  vector: Float32Array;
}

export interface RetrievedChunk {
  id: number;
  docTitle: string;
  section: string;
  content: string;
  /** Fuzyon sonrasi nihai skor (esik bununla karsilastirilir). */
  score: number;
  /** Kosinus benzerligi bileseni. */
  vectorScore: number;
  /** BM25'ten turetilmis [0,1] sozcuk bileseni. */
  lexicalScore: number;
}

let db: DatabaseSync | null = null;

/**
 * Yerel vektor deposu.
 *
 * Sartname sqlite-vss oneriyor; ancak sqlite-vss Windows'ta on-derlenmis ikili
 * saglamadigi (ve bakimi durdugu) icin burada Node 24'un yerlesik `node:sqlite`
 * modulu kullanilir: vektorler BLOB olarak saklanir, kosinus benzerligi surec
 * icinde hesaplanir. Native bagimlilik yoktur, %100 yerel calisir ve bu
 * korpus buyuklugunde (onlarca parca) brute-force arama milisaniyeler surer.
 */
export function getDb(): DatabaseSync {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new DatabaseSync(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_title TEXT NOT NULL,
        section   TEXT NOT NULL,
        content   TEXT NOT NULL,
        dim       INTEGER NOT NULL,
        vector    BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_title);
    `);

    // Kimlik, erisim etiketi ve denetim tablolari (Sprint 1). Ayri dosyada
    // tutuluyor; burasi vektor deposu, orasi kimlik katmani.
    ensureIdentitySchema(db);
  }
  return db;
}

const toBlob = (v: Float32Array): Uint8Array =>
  new Uint8Array(v.buffer, v.byteOffset, v.byteLength);

const fromBlob = (b: Uint8Array): Float32Array => {
  const copy = new Uint8Array(b);            // hizali (aligned) kopya
  return new Float32Array(copy.buffer, 0, copy.byteLength / 4);
};

/** Tum indeksi temizler (yeniden indeksleme oncesi). */
export function resetStore(): void {
  const database = getDb();
  database.exec('DELETE FROM chunks;');
  database.exec("DELETE FROM sqlite_sequence WHERE name='chunks';");
}

/** Tek bir parcayi vektoruyle birlikte kaydeder. */
export function insertChunk(record: ChunkRecord): void {
  if (record.vector.length !== EMBEDDING_DIM) {
    throw new Error(`Beklenmeyen vektor boyutu: ${record.vector.length}`);
  }
  getDb()
    .prepare(
      'INSERT INTO chunks (doc_title, section, content, dim, vector) VALUES (?, ?, ?, ?, ?)',
    )
    .run(record.docTitle, record.section, record.content, record.vector.length, toBlob(record.vector));
}

export function countChunks(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number } | undefined;
  return row?.n ?? 0;
}

export function listDocuments(principal: Principal): { docTitle: string; chunks: number }[] {
  // Korpus listesi de filtrelenir: dokuman ADI bile bilgi tasir
  // ("ust_yonetim_ucret_skalasi.md" gibi bir baslik tek basina sizintidir).
  const { clause, values } = labelFilter(principal);
  const rows = getDb()
    .prepare(
      `SELECT c.doc_title AS docTitle, COUNT(*) AS chunks ${VISIBLE_CHUNKS} (${clause})
       GROUP BY c.doc_title ORDER BY c.doc_title`,
    )
    .all(...values) as { docTitle: string; chunks: number }[];
  return rows;
}

/**
 * Bir maddenin tam metnini dondurur.
 *
 * Yanit altinda gosterilen "dayanak" blogu icin gerekli: deterministik yollarla
 * (kademe hesaplayicisi) uretilen yanitlarda elimizde yalnizca dosya adi ve
 * bolum basligi oluyor, metnin kendisi olmuyor.
 *
 * Bolum birden fazla parcaya bolunmusse (uzun maddeler) parcalar sirayla
 * birlestirilir; overlap nedeniyle olusan tekrarlar kabul edilir, metin
 * kullaniciya bilgi olarak gosterilir, yeniden indekslenmez.
 */
export function findSectionText(
  docTitle: string,
  section: string,
  principal: Principal,
): string | null {
  // EN KRITIK FILTRE. "Dayanak" blogu maddenin TAM METNINI birebir gosteriyor;
  // arama filtrelense bile burasi filtrelenmezse yetkisiz maddenin metni
  // dogrudan ekrana duser. Yanit gizlenir ama dayanak sizar.
  const { clause, values } = labelFilter(principal);
  const rows = getDb()
    .prepare(
      `SELECT c.content ${VISIBLE_CHUNKS} (${clause})
         AND c.doc_title = ? AND c.section = ? ORDER BY c.id`,
    )
    .all(...values, docTitle, section) as { content: string }[];

  if (!rows.length) return null;
  return rows.map((r) => r.content).join('\n');
}

/**
 * Indeksleme ve bakim islerinin kimligi.
 *
 * DIKKAT — bu bir arka kapi DEGIL, bilincli bir istisnadir: korpusu kuran
 * betikler (ingest, kalibrasyon, testler) tanimi geregi tum dokumanlari
 * gormelidir. HTTP uclari bunu ASLA kullanmaz; onlar oturumdan gelen kimligi
 * gecirir. Ayrimin gorunur olmasi icin ad bilerek dikkat cekici.
 */
export const SYSTEM_PRINCIPAL: Principal = {
  userId: 0,
  username: 'sistem',
  role: 'yonetici',
};

/**
 * Kimligin gorebilecegi parcalari secen SQL parcasi.
 *
 * LEFT JOIN + COALESCE onemli: `documents` tablosuna kaydi olmayan dokumanlar
 * (Sprint 1 oncesi indekslenmis 20 dokuman) `genel` sayilir. Karar boyleydi —
 * mevcut dokumanlari sessizce kisitlamak bugunku davranisi bozardi.
 */
const VISIBLE_CHUNKS = `
  FROM chunks c
  LEFT JOIN documents d ON d.doc_title = c.doc_title
  WHERE COALESCE(d.access_label, 'genel') IN`;

/**
 * Sozcuk indeksi (BM25) tembel kurulur ve surec omru boyunca yeniden kullanilir.
 * Indeks yeniden olusturuldugunda resetLexicalIndex() cagrilmalidir.
 *
 * ROL BASINA AYRI INDEKS — kararin gercek bedeli burada.
 *
 * BM25 skoru korpus istatistigine baglidir: bir sozcugun KAC dokumanda gectigi
 * (IDF). Havuz role gore daralinca bu istatistik kayar. Tek bir kuresel indeks
 * kullansaydik, kullanicinin goremedigi dokumanlar onun skorlarini etkilerdi —
 * cok zayif da olsa bir bilgi sizintisi, ve "sistem o belgeyi okumadi"
 * iddiasini delerdi.
 *
 * Maliyeti onemsiz: 3 rol x ~100 parca.
 */
const bm25ByRole = new Map<Role, Bm25Index>();

export function resetLexicalIndex(): void {
  bm25ByRole.clear();
}

function getLexicalIndex(principal: Principal): Bm25Index {
  const cached = bm25ByRole.get(principal.role);
  if (cached) return cached;

  const { clause, values } = labelFilter(principal);
  const rows = getDb()
    .prepare(`SELECT c.id, c.doc_title, c.section, c.content ${VISIBLE_CHUNKS} (${clause})`)
    .all(...values) as { id: number; doc_title: string; section: string; content: string }[];

  // Baslik da indekslenir: konu sinyali govdede gecmeyebilir.
  const index = new Bm25Index(
    rows.map((r) => ({ id: r.id, text: `${r.doc_title} ${r.section} ${r.content}` })),
  );
  bm25ByRole.set(principal.role, index);
  return index;
}

/**
 * Kalibrasyon/hata ayiklama icin: kapi uygulamadan tum skorlari dondurur.
 *
 * HIBRIT SKOR: (1 - w) * kosinus + w * bm25_normalize
 * Salt vektor skoru kapsam disi sorgulara da 0.80+ verebiliyor; sozcuk bileseni
 * bu durumda ~0 kalarak fuzyon skorunu asagi ceker ve ayrim bosluğunu genisletir.
 */
export function scoreAllChunks(
  queryVector: Float32Array,
  query: string | undefined,
  principal: Principal,
): RetrievedChunk[] {
  // KILIT KAPIDA: filtre burada, skorlamadan ONCE. Yetkisiz parcalar aday
  // havuzuna hic girmez — ne baglama, ne alintiya, ne kanit secimine.
  // `principal` bilincli olarak varsayilansiz: atlayan cagri derlenmez.
  const { clause, values } = labelFilter(principal);
  const rows = getDb()
    .prepare(`SELECT c.id, c.doc_title, c.section, c.content, c.vector ${VISIBLE_CHUNKS} (${clause})`)
    .all(...values) as {
    id: number;
    doc_title: string;
    section: string;
    content: string;
    vector: Uint8Array;
  }[];

  const lex = query ? getLexicalIndex(principal).normalizedScore(query) : null;
  const w = query ? LEXICAL_WEIGHT : 0;

  return rows
    .map((row) => {
      const vectorScore = cosineSimilarity(queryVector, fromBlob(row.vector));
      const lexicalScore = lex?.get(row.id) ?? 0;
      return {
        id: row.id,
        docTitle: row.doc_title,
        section: row.section,
        content: row.content,
        vectorScore,
        lexicalScore,
        score: (1 - w) * vectorScore + w * lexicalScore,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export interface GateDiagnostics {
  top: number;
  mean: number;
  margin: number;
  passedAbsolute: boolean;
  passedMargin: boolean;
}

/**
 * En alakali K parcayi alaka kapisindan gecirerek dondurur.
 *
 * 1) Mutlak taban : en iyi skor SIMILARITY_THRESHOLD'u gecmeli. (asil kapi)
 * 2) Goreli marj  : RELEVANCE_MARGIN > 0 ise ek kosul olarak uygulanir.
 *                   Varsayilan 0 = kapali; gerekcesi icin bkz. constants.ts —
 *                   olcut korpus buyuklugune duyarli oldugu icin bu korpusta
 *                   ayirici degil.
 *
 * Kapi acilirsa, en iyi skora CONTEXT_BAND icinde kalan parcalar (en fazla K adet)
 * baglama alinir. Aksi halde bos dizi doner ve cagiran taraf LLM'e HIC GITMEDEN
 * sabit "bilgi bulunmamaktadir" yanitina duser.
 */
export function queryTopKChunks(
  queryVector: Float32Array,
  principal: Principal,
  k: number = TOP_K,
  threshold: number = SIMILARITY_THRESHOLD,
  query?: string,
): RetrievedChunk[] {
  return retrieveWithDiagnostics(queryVector, principal, k, threshold, query).chunks;
}

/**
 * `principal` bilincli olarak IKINCI parametre — sona eklenemezdi (zorunlu
 * parametre istege bagli olanlari izleyemez) ve sona eklenebilseydi bile
 * yanlis olurdu: bu sirayla her cagri yerinin guncellenmesi ZORUNLU hale
 * geliyor, yani filtreyi atlayan bir cagri derlenmiyor.
 */
export function retrieveWithDiagnostics(
  queryVector: Float32Array,
  principal: Principal,
  k: number = TOP_K,
  threshold: number = SIMILARITY_THRESHOLD,
  query?: string,
): { chunks: RetrievedChunk[]; diagnostics: GateDiagnostics } {
  const scored = scoreAllChunks(queryVector, query, principal);

  if (!scored.length) {
    return {
      chunks: [],
      diagnostics: { top: 0, mean: 0, margin: 0, passedAbsolute: false, passedMargin: false },
    };
  }

  const top = scored[0].score;
  const mean = scored.reduce((s, c) => s + c.score, 0) / scored.length;
  const margin = top - mean;

  const passedAbsolute = top >= threshold;
  const passedMargin = margin >= RELEVANCE_MARGIN;
  const diagnostics: GateDiagnostics = { top, mean, margin, passedAbsolute, passedMargin };

  if (!passedAbsolute || !passedMargin) {
    return { chunks: [], diagnostics };
  }

  const chunks = scored.filter((c) => c.score >= top - CONTEXT_BAND).slice(0, k);
  return { chunks, diagnostics };
}
