/**
 * Cumle duzeyinde kanit secimi (sentence-level evidence focusing).
 *
 * SORUN: Alaka kapisi dogru MADDEYI getirdigi halde cevap yanlis cikabiliyor.
 * Sebep parca (chunk) boyutu: bir madde birden fazla bagimsiz olgu tasidiginda
 * 1.5B model yanlis olani seciyor. Olculdu (scripts/eval-answers.ts):
 *
 *   "Dogum yardimi ne kadar?" -> Madde 3 dogru getirildi, ama madde once
 *   "10.000 TL evlilik yardimi", sonra "15.000 TL dogum yardimi" diyor.
 *   Model ilk sayiyi aliyordu.
 *
 * DENENDI VE YETMEDI: prompt'a "tam kalemi bul, benzer olanla karistirma"
 * kurallari eklendi (SYSTEM_PROMPT_RULES 6-7). Olcum degismedi — bu bir
 * talimat sorunu degil, dikkat sorunu.
 *
 * COZUM: parcayi bolmek yerine, parca ICINDE soruyla en ilgili cumleyi
 * deterministik olarak bulup baglamda isaretlemek. Model tam metni gormeye
 * devam eder (baglam kaybi yok) ama dogru cumle one cikarilir.
 *
 * NEDEN EL YAZIMI BIR "OLGU TABLOSU" DEGIL: korpusta ayni maddede >=2 sayisal
 * olgu tasiyan 25 bolum var. Hepsini elle tabloya yazmak sistemi RAG olmaktan
 * cikarip bir SSS arama motoruna cevirirdi ve KULLANICININ YUKLEDIGI yeni
 * dokumanlar icin hic calismazdi. Bu mekanizma korpustan bagimsizdir.
 */
import { tokenize as bm25Tokenize } from './lexical.service.js';

/**
 * Kanit secimi icin ince tokenizasyon.
 *
 * BM25'ten farkli olarak durak sozcukler ELENMEZ ve 2 harfli sozcukler tutulur.
 * Gerekce: burada skorlama aday kumesi ICINDEKI nadirlige dayanir, yani her
 * adayda gecen sozcuk zaten sifir agirlik alir — elemeye gerek yok. Buna
 * karsilik eleme gercek ayrimlari yok ediyordu: "az tehlikeli is yeri" ile
 * "tehlikeli is yeri" arasindaki tek fark olan "az" hem durak sozcuk hem de
 * 2 harfliydi ve iki yan cumle tamamen ayni token kumesine dusuyordu.
 */
const tokenize = (text: string) => bm25Tokenize(text, { minLength: 2, stopwords: false });

/**
 * Turkce cumle bolme.
 *
 * DIKKAT 1 — korpusta noktalar sayi icinde de geciyor ("1.500 TL", "10.000 TL").
 * Bu yuzden bolme yalnizca "noktalama + BOSLUK + buyuk harf" oruntusunde yapilir;
 * "1.500" icinde bosluk olmadigi icin bolunmez.
 *
 * DIKKAT 2 — iki nokta (":") bolme noktasi DEGILDIR. "Madde 1: Hibrit Calisma
 * Duzeni" basligini ikiye ayirir ve ortaya sahte bir aday cumle cikarirdi
 * (olculdu: "Bu madde neyi duzenler?" sorusuna "Madde 3:" secildi).
 *
 * DIKKAT 3 — Turkce buyuk harfler (Ç,Ğ,İ,Ö,Ş,Ü) sinifa acikca eklenmelidir.
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/\r?\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ])/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Nicelik soran ifadeler. Soru bunlardan birini tasiyorsa cevap neredeyse her
 * zaman SAYI iceren cumledir; bu, aday kumesini daraltmak icin kullanilir.
 *
 * Bu bir "soru tipi / cevap tipi" eslesmesidir (answer-type matching), klasik
 * soru-cevap tekniklerinden biridir. Gerekcesi olculdu: "Yemek kartina gunluk
 * ne kadar?" sorusunda hem dogru cumle hem de "Uzaktan calisilan gunler icin
 * yemek karti yuklemesi yapilmaz" cumlesi AYNI terimleri tasiyor; sozcuk
 * ortusmesi tek basina ayirt edemiyordu.
 */
const QUANTITY_MARKERS = [
  'ne kadar', 'kac', 'kacti', 'kactir', 'yuzde', 'tutar', 'limit', 'ucret',
  'miktar', 'oran', 'sure', 'gun', 'saat', 'hafta', 'ay ', 'yil', 'tl',
];

function normalizeQuery(text: string): string {
  return text
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isQuantityQuestion(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  return QUANTITY_MARKERS.some((m) => q.includes(` ${m}`));
}

export interface Evidence {
  sentence: string;
  score: number;
  /** Secim tam cumleden degil, cumle ICINDEKI yan cumleden yapildi mi? */
  narrowed?: boolean;
}

export interface EvidenceOptions {
  /**
   * Parcanin bolum basligi. Baslik satiri chunk metninin bir parcasidir ama
   * KANIT DEGILDIR (zaten alintida gosterilir); aday listesinden cikarilir.
   */
  heading?: string;
}

/**
 * Parca icinde soruyla en ilgili cumleyi secer.
 *
 * Secim YALNIZCA yeterince belirgin oldugunda yapilir; aksi halde null doner ve
 * baglam degistirilmeden gecer. Yanlis bir isaret isaretsizden daha zararlidir:
 * model isaretlenen cumleye guvenir.
 *
 * Adimlar:
 *   1) Cumlelere bol; bolum basligini aday listesinden cikar.
 *   2) Soru nicelik soruyorsa ve sayi iceren aday varsa, adaylari onlarla sinirla.
 *   3) Sorgu terimlerini aday kumesi ICINDEKI nadirlik agirligiyla puanla — her
 *      adayda gecen terim ayirt edici degildir, sifir agirlik alir.
 *   4) En iyi aday ikincinin >= 1.3 kati degilse SECIM YAPMA.
 *   5) Secilen cumle birden fazla sayisal deger tasiyorsa yan cumlelere in
 *      (bkz. narrowToClause).
 */
export function selectEvidence(
  chunkText: string,
  query: string,
  options: EvidenceOptions = {},
): Evidence | null {
  const all = splitSentences(chunkText);
  const headingNorm = options.heading ? normalizeQuery(options.heading) : null;

  let sentences = all.filter((s) => !headingNorm || normalizeQuery(s) !== headingNorm);
  if (sentences.length < 2) return null; // bolunecek bir sey yok

  // Nicelik sorusu: cevap sayi tasiyan cumlede olmali.
  if (isQuantityQuestion(query)) {
    const numeric = sentences.filter((s) => /\d/.test(s));
    if (numeric.length > 0) sentences = numeric;
  }
  if (sentences.length === 0) return null;

  const queryTerms = new Set(tokenize(query));
  if (queryTerms.size === 0) return null;

  const best = pickBest(sentences, queryTerms, 1.3);
  if (!best) return null;

  return narrowToClause(best, queryTerms) ?? best;
}

/**
 * Aday metinler arasindan soruyla en ilgili olani secer.
 *
 * Nadirlik agirligi ADAY KUMESI ICINDE hesaplanir: bir terim tum adaylarda
 * geciyorsa ayirt edici degildir ve sifir agirlik alir.
 *
 * `ratio` belirginlik esigidir — en iyi aday ikincinin bu kati degilse null.
 */
function pickBest(candidates: string[], queryTerms: Set<string>, ratio: number): Evidence | null {
  const tokenSets = candidates.map((s) => new Set(tokenize(s)));

  const df = new Map<string, number>();
  for (const set of tokenSets) {
    for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const n = candidates.length;
  const scored = candidates.map((sentence, i) => {
    let overlap = 0;
    let weight = 0;
    for (const term of queryTerms) {
      if (!tokenSets[i].has(term)) continue;
      overlap++;
      weight += Math.log(n / (df.get(term) ?? n));
    }
    // Uzun adaylar daha cok terim yakalar; uzunluga gore hafif normalize et.
    return { sentence, overlap, score: weight / Math.sqrt(Math.max(1, tokenSets[i].size)) };
  });

  // TEK ADAY: nicelik filtresi zaten ayrimi yapmis demektir. Nadirlik agirligi
  // burada anlamsizdir — n = df = 1 oldugundan log(n/df) = 0 cikar ve dogru
  // cumle sifir puanla elenirdi (olculdu: "Haftada kac gun uzaktan calisirim?").
  if (n === 1) {
    const only = scored[0];
    return only.overlap > 0 ? { sentence: only.sentence, score: only.overlap } : null;
  }

  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const [top, second] = ranked;

  if (!top || top.score <= 0) return null;
  if (second && second.score > 0 && top.score < second.score * ratio) return null;

  return { sentence: top.sentence, score: top.score };
}

/**
 * Yan cumleye inme (clause narrowing).
 *
 * Bazi maddelerde iki farkli olgu TEK cumlede, virgulle ayrilmis yan cumleler
 * halinde durur. Ornek (17_is_sagligi_ve_guvenligi.md):
 *
 *   "Egitim, tehlike sinifina gore az tehlikeli is yerlerinde 3 yilda bir,
 *    tehlikeli is yerlerinde 2 yilda bir tekrarlanir."
 *
 * Cumle duzeyi burada yetmez: iki deger de ayni cumlededir ve "tehlikeli",
 * "az tehlikeli" ifadesinin de icindedir. Olculdu — model "3 yilda bir"
 * diyordu.
 *
 * Bu yuzden yalnizca secilen cumle >= 2 FARKLI sayisal deger tasidiginda
 * yan cumlelere inilir. Esik daha yuksektir (1.5) ve cok kisa parcalar
 * elenir: baglamdan kopmus bir kirinti, tam cumleden daha kotudur.
 */
function narrowToClause(best: Evidence, queryTerms: Set<string>): Evidence | null {
  if (distinctNumbers(best.sentence).length < 2) return null;

  const clauses = splitClauses(best.sentence).filter((c) => tokenize(c).length >= 3);
  if (clauses.length < 2) return null;

  // SAYILAR YAN CUMLELERE DAGILMIS OLMALI. Tek bir yan cumlede toplaniyorsa
  // ortada secenek yoktur; sayilardan biri yalnizca baglam bilgisidir ve
  // daraltma zarar verir. Olculdu: "Kadin calisana, cocugu 1 yasini doldurana
  // kadar gunde toplam 1,5 saat sut izni verilir" cumlesinde "1" ile "1,5"
  // rakip degil; daraltilinca model "1 saat" cevabini verdi.
  if (clauses.filter((c) => /\d/.test(c)).length < 2) return null;

  const narrowed = pickBest(clauses, queryTerms, 1.5);
  if (!narrowed || !/\d/.test(narrowed.sentence)) return null;

  return { ...narrowed, narrowed: true };
}

/** Metindeki farkli sayisal degerler ("3", "1,5", "10.000"). */
function distinctNumbers(text: string): string[] {
  return [...new Set(text.match(/\d[\d.,]*/g) ?? [])];
}

/**
 * Yan cumle bolme.
 *
 * DIKKAT — Turkce ondalik ayraci VIRGULDUR ("1,5 saat"). Bu yuzden bolme
 * yalnizca "virgul/noktali virgul + BOSLUK" oruntusunde yapilir; "1,5"
 * icinde bosluk olmadigi icin bolunmez.
 */
export function splitClauses(sentence: string): string[] {
  return sentence
    .split(/[;,]\s+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}
