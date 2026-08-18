/**
 * Sozcuk temelli (lexical) arama — BM25.
 *
 * NEDEN: Salt vektor aramasi kapsam-ici / kapsam-disi ayrimini cok dar bir
 * boslukla yapiyordu (0.0096). Sebebi, E5'in her sorguya "makul" bir yakinlik
 * skoru vermesi. Sozcuk ortusmesi bu bosluğu buyutur: "ofise evcil hayvan"
 * sorgusunun korpusla ANLAMLI sozcuk ortusmesi SIFIRDIR, oysa vektor skoru
 * 0.82 gibi aldatici bir deger verir.
 *
 * Turkce sondan eklemeli oldugu icin tam bir govdeleyici gerekmez; amac
 * mukemmel eslesme degil, "hic ortusme yok" sinyalini yakalamaktir.
 */

/** Her yerde gecen, ayirt edici olmayan sozcukler. Elenmezse her sorgu her parcayla eslesir. */
const STOPWORDS = new Set([
  'ne', 'kadar', 'kac', 'nasil', 'nedir', 'mi', 'mu', 'mü', 'mı', 'midir',
  've', 'veya', 'ile', 'icin', 'gibi', 'ama', 'fakat', 'ancak',
  'bir', 'bu', 'su', 'o', 'her', 'hangi', 'kim', 'nerede', 'nereye', 'ne',
  'var', 'yok', 'olan', 'olarak', 'oldugu', 'olur', 'olabilir', 'edebilir',
  'benim', 'bana', 'ben', 'sen', 'biz', 'siz',
  'da', 'de', 'ki', 'daha', 'en', 'cok', 'az',
  'calisan', 'calisanlar', 'sirket', 'sirketin', 'sirkette',
]);

/**
 * Turkce icin hafif sonek kirpma.
 * Tam dogru govde uretmez; ayni kokun varyantlarini ayni sepete koymaya calisir.
 * Uzun sonekler once denenir ki "izinlerin" -> "izin" olsun.
 */
const SUFFIXES = [
  'lerinden', 'larindan', 'lerine', 'larina', 'lerini', 'larini',
  'lerin', 'larin', 'ninki', 'siniz', 'sinin',
  'ler', 'lar', 'den', 'dan', 'ten', 'tan', 'nin', 'nun', 'nın',
  'ini', 'ini', 'ine', 'ina', 'imiz', 'iniz',
  'de', 'da', 'te', 'ta', 'in', 'un', 'im', 'um', 'si', 'su', 'yi', 'yu',
  'e', 'a', 'i', 'u',
];

function normalizeText(text: string): string {
  return text
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stem(token: string): string {
  // Kisa sozcuklerde kirpma anlami bozar.
  if (token.length <= 4) return token;
  for (const suffix of SUFFIXES) {
    if (token.length - suffix.length >= 4 && token.endsWith(suffix)) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

export interface TokenizeOptions {
  /** Bu uzunlugun altindaki sozcukler elenir. Varsayilan 3. */
  minLength?: number;
  /** Durak sozcukler elensin mi? Varsayilan true. */
  stopwords?: boolean;
}

/**
 * BM25 varsayilanlari: durak sozcukler elenir, 3 harften kisa token atilir.
 *
 * Kanit secimi (evidence.service) bunlari GEVSETIR: orada skorlama zaten
 * "aday kumesi icinde nadirlik" agirligi kullandigindan her adayda gecen
 * sozcuk kendiliginden sifir agirlik alir — ayrica elemeye gerek yoktur.
 * Ustelik eleme orada ZARARLIDIR: "az tehlikeli" ile "tehlikeli" arasindaki
 * tek fark, hem durak sozcuk hem de 2 harfli olan "az"dir.
 */
export function tokenize(text: string, options: TokenizeOptions = {}): string[] {
  const minLength = options.minLength ?? 3;
  const useStopwords = options.stopwords ?? true;

  return normalizeText(text)
    .split(' ')
    .filter((t) => t.length >= 2 && (!useStopwords || !STOPWORDS.has(t)))
    .map(stem)
    .filter((t) => t.length >= minLength);
}

interface Doc {
  id: number;
  tokens: string[];
  length: number;
  freq: Map<string, number>;
}

const K1 = 1.5;
const B = 0.75;

export class Bm25Index {
  private docs: Doc[] = [];
  private df = new Map<string, number>();
  private avgLength = 0;

  constructor(entries: { id: number; text: string }[]) {
    for (const entry of entries) {
      const tokens = tokenize(entry.text);
      const freq = new Map<string, number>();
      for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
      for (const t of new Set(tokens)) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ id: entry.id, tokens, length: tokens.length, freq });
    }
    this.avgLength =
      this.docs.reduce((s, d) => s + d.length, 0) / Math.max(1, this.docs.length);
  }

  private idf(term: string): number {
    const n = this.docs.length;
    const df = this.df.get(term) ?? 0;
    if (df === 0) return 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  /** Ham BM25 skorlari (id -> skor). Eslesme yoksa 0. */
  score(query: string): Map<number, number> {
    const terms = tokenize(query);
    const out = new Map<number, number>();

    for (const doc of this.docs) {
      let score = 0;
      for (const term of terms) {
        const tf = doc.freq.get(term);
        if (!tf) continue;
        const denom = tf + K1 * (1 - B + (B * doc.length) / this.avgLength);
        score += this.idf(term) * ((tf * (K1 + 1)) / denom);
      }
      out.set(doc.id, score);
    }
    return out;
  }

  /**
   * [0,1] araligina sikistirilmis skor: bm25 / (bm25 + saturation).
   * Mutlak esik ile birlestirilebilmesi icin sinirli olmasi gerekir.
   */
  normalizedScore(query: string, saturation = 4): Map<number, number> {
    const raw = this.score(query);
    const out = new Map<number, number>();
    for (const [id, s] of raw) out.set(id, s / (s + saturation));
    return out;
  }
}
