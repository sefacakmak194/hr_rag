/**
 * Politika boşluğu raporu (Sprint 4).
 *
 * SORU: çalışanlar neyi soruyor ama mevzuatta karşılığı yok?
 *
 * Bu, asistanın kendisinden daha değerli olabilir: İK'ya hangi yönergeyi
 * yazması gerektiğini tahminle değil VERIYLE söyler.
 *
 * ---
 *
 * SPRINT 1 ILE CAKISMA — ve cozumu
 *
 * Sprint 4 "denetim kaydindaki answered=0 satirlarindan rapor uret" diye
 * planlanmisti. Kodlarken cikti ki BU MUMKUN DEGIL: Sprint 1 karari geregi soru
 * metni yalnizca KISITLI bir dokumana erisildiginde saklaniyor. Alaka kapisina
 * takilan soruda hicbir dokumana erisilmez, dolayisiyla `question` NULL kalir.
 * Olculdu: 20 yanitsiz satirin 20'sinde de soru metni yok.
 *
 * Sprint 1 karari YANLIS DEGIL, korunmali: her soruyu kullanicinin adina
 * yazmak, calisanin ne merak ettigini kalici kayda gecirir (mobbing sikayeti,
 * istifa sureci, saglik durumu...) ve sisteme soru sormaktan cekindirir.
 *
 * COZUM: ayri bir tablo — soru metni saklanir, KIM SORDUGU SAKLANMAZ.
 * Sprint 1'in korumak istedigi sey metnin kendisi degil, METIN ILE KISI
 * ARASINDAKI BAGDIR. O bag burada hic kurulmuyor:
 *
 *   - user_id / username YOK
 *   - zaman damgasi HAFTA cozunurlugunde (tam saat saklansa, denetim
 *     kaydindaki `answered=0` satiriyla saniye saniye eslestirilebilirdi)
 *
 * ARTIK RISK: dusuk hacimli bir kurulumda, bir hafta icinde tek bir yanitsiz
 * soru varsa denetim kaydindaki tek `answered=0` satiriyla eslestirilebilir.
 * Bu gizlenmiyor; kurum hacmi buyudukce kayboluyor.
 *
 * ---
 *
 * BU TABLO SILINEBILIR — denetim kaydinin aksine.
 *
 * Denetim kaydi degistirilemez, cunku degeri tam olarak orada. Burada saklanan
 * ise serbest metin ve icine kisisel ayrinti girebilir ("3 cocugum var, kres
 * destegi..."). Bu yuzden saklama suresi VAR ve varsayilan olarak aciktir.
 */
import type { DatabaseSync } from 'node:sqlite';
import { cosineSimilarity } from './embedding.service.js';
import {
  EMBEDDING_DIM,
  GAP_CLUSTER_THRESHOLD,
  GAP_NEAR_MISS_FLOOR,
  GAP_RELATED_THRESHOLD,
  GAP_RETENTION_WEEKS,
} from '../config/constants.js';

/** ISO hafta etiketi: `2026-W34`. Tam zaman damgasi BILEREK saklanmiyor. */
export function isoWeek(date: Date = new Date()): string {
  // ISO 8601: haftanin ilk gunu pazartesi, 1. hafta 4 Ocak'i iceren haftadir.
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7; // pazar = 7
  d.setUTCDate(d.getUTCDate() + 4 - day); // haftanin persembesi
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function ensureGapSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS unanswered_questions (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      week      TEXT    NOT NULL,
      question  TEXT    NOT NULL,
      resolved  TEXT,
      dim       INTEGER NOT NULL,
      vector    BLOB    NOT NULL,
      top_score REAL    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gap_week ON unanswered_questions(week);
  `);
}

const toBlob = (v: Float32Array): Uint8Array =>
  new Uint8Array(v.buffer, v.byteOffset, v.byteLength);

const fromBlob = (b: Uint8Array): Float32Array => {
  const copy = new Uint8Array(b);
  return new Float32Array(copy.buffer, 0, copy.byteLength / 4);
};

export interface RecordGapInput {
  question: string;
  /** Takip sorusu cozumlendiyse birlestirilmis hali. */
  resolved?: string;
  /**
   * Sorgu vektoru. Zaten hesaplanmis durumda geliyor (arama icin uretildi),
   * bu yuzden saklamanin ek maliyeti yok — ve rapor zamaninda kumeleme saf
   * matematige indirgeniyor, LLM'e hic gidilmiyor.
   */
  vector: Float32Array;
  /** Alaka kapisinda alinan en iyi skor. */
  topScore: number;
}

/**
 * Yanitlanamayan bir soruyu kaydeder.
 *
 * ASLA firlatmaz: rapor icin veri toplamak, kullanicinin yanitini
 * kaybettirmemeli (denetim kaydiyla ayni kural).
 */
export function recordGap(db: DatabaseSync, input: RecordGapInput, now = new Date()): void {
  try {
    const question = input.question.trim();
    if (!question) return;

    db.prepare(
      'INSERT INTO unanswered_questions (week, question, resolved, dim, vector, top_score) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      isoWeek(now),
      question,
      input.resolved?.trim() || null,
      input.vector.length,
      toBlob(input.vector),
      input.topScore,
    );
  } catch (error) {
    console.error('[bosluk] kayit yazilamadi:', (error as Error).message);
  }
}

/**
 * Saklama suresi dolmus kayitlari siler.
 *
 * Denetim kaydinin aksine bu tablo SILINEBILIR — gerekcesi dosya basinda.
 * `GAP_RETENTION_WEEKS = 0` sinirsiz demektir.
 */
export function purgeOldGaps(db: DatabaseSync, now = new Date()): number {
  if (GAP_RETENTION_WEEKS <= 0) return 0;

  const cutoff = new Date(now.getTime() - GAP_RETENTION_WEEKS * 7 * 86_400_000);
  const result = db.prepare('DELETE FROM unanswered_questions WHERE week < ?').run(isoWeek(cutoff));
  return Number(result.changes ?? 0);
}

// ------------------------------------------------------------------ rapor

interface GapRow {
  id: number;
  week: string;
  question: string;
  resolved: string | null;
  vector: Uint8Array;
  top_score: number;
}

export interface GapCluster {
  /** Kumeye merkezine EN YAKIN soru; kume basligi olarak kullanilir. */
  label: string;
  count: number;
  /** Kumedeki sorular (en yeniden eskiye). */
  questions: { question: string; week: string; topScore: number }[];
  /** Kumedeki en yuksek skor: esige ne kadar yaklasildi. */
  bestScore: number;
  /**
   * Esige cok yakin mi? Yakinsa mevzuat konuyu ANLATIYOR ama yeterince acik
   * degil demektir — yeni yonerge degil, mevcut maddenin netlestirilmesi
   * gerekir. Uzaksa konu gercekten kapsam disidir.
   */
  nearMiss: boolean;
  /** Kumenin ilk ve son gorulduğu hafta. */
  firstWeek: string;
  lastWeek: string;
  /**
   * EN BENZER diger kumenin basligi.
   *
   * Kumeleme esigi olculdu ve dagilimlarin ORTUSTUGU gorildi (bkz. constants);
   * secim bilincli olarak FAZLA BOLME yonunde yapildi. Bu alan o secimin
   * telafisi: ayni bosluga isaret eden iki kume ayri dusmusse, okuyan kisi
   * bunu gorebilsin.
   */
  relatedTo?: string;
}

export interface GapReport {
  totalQuestions: number;
  weeks: number;
  clusters: GapCluster[];
  /** Hafta bazinda toplam yanitsiz soru — egilim icin. */
  byWeek: { week: string; count: number }[];
  threshold: number;
  retentionWeeks: number;
}

/**
 * Yanitsiz sorulari konu kumelerine ayirir.
 *
 * ALGORITMA: acgozlu birlesimsel kumeleme. Her soru, merkezine yeterince yakin
 * oldugu ILK kumeye katilir; hicbirine yakin degilse yeni kume acar.
 *
 * NEDEN EMBEDDING, NEDEN SOZCUK DEGIL: "kres var mi" ile "cocuk bakim destegi
 * aliyor muyum" tek bir ortak sozcuk tasimaz ama ayni bosluga isaret eder.
 * Sozcuk temelli kumeleme bunlari ayirirdi. Vektorler zaten kayitli oldugu icin
 * maliyeti de yok.
 *
 * NEDEN LLM DEGIL: rapor deterministik olmali — ayni veri ayni raporu
 * uretmeli. Ayrica bu bir arka plan isi ve kucuk modelde Turkce kumeleme
 * guvenilir degil.
 *
 * SINIRI ACIKCA: esik olculdu ve ayni-konu / farkli-konu dagilimlarinin
 * ORTUSTUGU gorildi (bkz. constants.ts, GAP_CLUSTER_THRESHOLD). Bu bir
 * siniflandirici degil, gruplama yardimcisi. Fazla bolme yonunde taraf
 * tutuluyor ve her kumeye en benzer diger kume `relatedTo` olarak ekleniyor.
 */
export function buildGapReport(
  db: DatabaseSync,
  options: { sinceWeek?: string; threshold?: number } = {},
): GapReport {
  const threshold = options.threshold ?? GAP_CLUSTER_THRESHOLD;

  const rows = (
    options.sinceWeek
      ? db
          .prepare(
            'SELECT id, week, question, resolved, vector, top_score FROM unanswered_questions WHERE week >= ? ORDER BY id DESC',
          )
          .all(options.sinceWeek)
      : db
          .prepare(
            'SELECT id, week, question, resolved, vector, top_score FROM unanswered_questions ORDER BY id DESC',
          )
          .all()
  ) as unknown as GapRow[];

  const clusters: {
    centroid: Float32Array;
    members: { row: GapRow; vector: Float32Array }[];
  }[] = [];

  for (const row of rows) {
    const vector = fromBlob(row.vector);
    // Embedding modeli degistiyse eski vektorler karsilastirilamaz; sessizce
    // atlanir — rapor bozuk sayilar uretmektense eksik uretsin.
    if (vector.length !== EMBEDDING_DIM) continue;

    let best = -1;
    let bestIndex = -1;
    for (let i = 0; i < clusters.length; i++) {
      const sim = cosineSimilarity(vector, clusters[i].centroid);
      if (sim > best) {
        best = sim;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0 && best >= threshold) {
      const cluster = clusters[bestIndex];
      cluster.members.push({ row, vector });
      // Merkez yeniden hesaplanir (uyeler uzerinden ortalama).
      const next = new Float32Array(EMBEDDING_DIM);
      for (const m of cluster.members) {
        for (let d = 0; d < EMBEDDING_DIM; d++) next[d] += m.vector[d];
      }
      for (let d = 0; d < EMBEDDING_DIM; d++) next[d] /= cluster.members.length;
      cluster.centroid = next;
    } else {
      clusters.push({ centroid: vector, members: [{ row, vector }] });
    }
  }

  const built: GapCluster[] = clusters.map((c) => {
    // Baslik: merkeze EN YAKIN soru. Uretilmis bir ozet degil, gercek bir soru.
    let label = c.members[0].row.question;
    let bestSim = -1;
    for (const m of c.members) {
      const sim = cosineSimilarity(m.vector, c.centroid);
      if (sim > bestSim) {
        bestSim = sim;
        label = m.row.question;
      }
    }

    const weeks = c.members.map((m) => m.row.week).sort();
    const bestScore = Math.max(...c.members.map((m) => m.row.top_score));

    return {
      label,
      count: c.members.length,
      questions: c.members.map((m) => ({
        question: m.row.question,
        week: m.row.week,
        topScore: Number(m.row.top_score.toFixed(4)),
      })),
      bestScore: Number(bestScore.toFixed(4)),
      // "Az kaldi" tabani KALIBRASYONDAN gelir: bilinen hicbir kapsam disi
      // sorgunun ulasamadigi skor. Bkz. constants.ts, GAP_NEAR_MISS_FLOOR.
      nearMiss: bestScore >= GAP_NEAR_MISS_FLOOR,
      firstWeek: weeks[0],
      lastWeek: weeks[weeks.length - 1],
    };
  });

  // BENZER KUME baglantisi: fazla bolunmus konular okuyana gorunur olsun.
  for (let i = 0; i < clusters.length; i++) {
    let best = -1;
    let bestIndex = -1;
    for (let j = 0; j < clusters.length; j++) {
      if (i === j) continue;
      const sim = cosineSimilarity(clusters[i].centroid, clusters[j].centroid);
      if (sim > best) {
        best = sim;
        bestIndex = j;
      }
    }
    if (bestIndex >= 0 && best >= GAP_RELATED_THRESHOLD) {
      built[i].relatedTo = built[bestIndex].label;
    }
  }

  // En cok sorulan konu basta; esitlikte esige yakin olan one gecer.
  built.sort((a, b) => b.count - a.count || b.bestScore - a.bestScore);

  const weekCounts = new Map<string, number>();
  for (const row of rows) weekCounts.set(row.week, (weekCounts.get(row.week) ?? 0) + 1);

  return {
    totalQuestions: rows.length,
    weeks: weekCounts.size,
    clusters: built,
    byWeek: [...weekCounts.entries()]
      .map(([week, count]) => ({ week, count }))
      .sort((a, b) => a.week.localeCompare(b.week)),
    threshold,
    retentionWeeks: GAP_RETENTION_WEEKS,
  };
}
