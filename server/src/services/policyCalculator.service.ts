/**
 * Kademeli politika hesaplayicisi — cevabi LLM'e sormak yerine KODLA hesaplar.
 *
 * NEDEN: Kucuk dil modelleri kademeli araliklarda ("5 yila kadar, 5 yil dahil")
 * sistematik olarak hata yapiyor. Olculdu (scripts/eval-answers.ts):
 *   qwen2.5-1.5b GPU  : 5 kademe sorusunun 4'u yanlis
 *   qwen2.5-7b  CPU   : sinir degerinde ("tam 5 yil") yine yanlis
 * Bu bir prompt sorunu degil, bir muhakeme zayifligi. Cozum: sayisal kademeleri
 * yapilandirilmis tabloya alip cevabi deterministik uretmek. Model devreye hic
 * girmez; yanit her seferinde ayni ve dogrudur.
 *
 * Tablolar korpustan TURETILMEZ, burada acikca tanimlanir; korpusla tutarliligi
 * scripts/test-policy.ts dogrular (sayilar korpus metninde geciyor mu).
 */

export interface Tier {
  /** Alt sinir (dahil), ay cinsinden. */
  minMonths: number;
  /** Ust sinir (dahil), ay cinsinden; sinirsiz ise null. */
  maxMonths: number | null;
  value: string;
  /** Kademeyi insan diliyle aciklayan ibare. */
  label: string;
}

export interface PolicyTable {
  id: string;
  /** Soruyu bu tabloya baglayan anahtar kelimeler (sadelestirilmis metinde aranir). */
  keywords: string[];
  sourceDoc: string;
  sourceSection: string;
  tiers: Tier[];
  /** Deterministik yanit cumlesini kurar. */
  render: (tenureLabel: string, tier: Tier) => string;
}

const Y = (years: number) => years * 12;

export const POLICY_TABLES: PolicyTable[] = [
  {
    id: 'yillik-izin',
    // DIKKAT — Turkce unlu dusmesi: "izin" + iyelik = "izni" (i-z-n-i).
    // Yani "yillik izni" metni "yillik izin" anahtarini ICERMEZ; her iki bicim
    // de acikca listelenmelidir.
    keywords: [
      'yillik izin', 'yillik izni', 'yillik ucretli izin',
      'izin hakki', 'izin haklari', 'izni kac gun', 'izin kac gun', 'izin suresi',
    ],
    sourceDoc: '01_calisma_saatleri_ve_izinler.md',
    sourceSection: 'Madde 2: Yıllık Ücretli İzin Hakları',
    tiers: [
      { minMonths: Y(1), maxMonths: Y(5), value: '14 iş günü', label: '1 yıldan 5 yıla kadar (5 yıl dahil)' },
      { minMonths: Y(5) + 1, maxMonths: Y(15) - 1, value: '20 iş günü', label: '5 yıldan fazla, 15 yıldan az' },
      { minMonths: Y(15), maxMonths: null, value: '26 iş günü', label: '15 yıl (dahil) ve daha fazla' },
    ],
    render: (tenure, tier) =>
      `${tenure} kıdemi olan bir çalışan ${tier.value} yıllık ücretli izin kullanabilir. ` +
      `Bu süre "${tier.label}" kademesi için geçerlidir.`,
  },
  {
    id: 'ihbar-suresi',
    keywords: ['ihbar suresi', 'ihbar sure', 'ihbar onel', 'ihbar kac hafta'],
    sourceDoc: '15_istifa_fesih_ve_cikis_sureci.md',
    sourceSection: 'Madde 2: İhbar Süreleri',
    tiers: [
      { minMonths: 0, maxMonths: 5, value: '2 hafta', label: '6 aydan az' },
      { minMonths: 6, maxMonths: 17, value: '4 hafta', label: '6 aydan 1,5 yıla kadar' },
      { minMonths: 18, maxMonths: 35, value: '6 hafta', label: '1,5 yıldan 3 yıla kadar' },
      { minMonths: 36, maxMonths: null, value: '8 hafta', label: '3 yıldan fazla' },
    ],
    render: (tenure, tier) =>
      `${tenure} kıdemi olan bir çalışan için ihbar süresi ${tier.value}dır. ` +
      `Bu süre "${tier.label}" kademesi için geçerlidir.`,
  },
];

/** Turkce metni eslesme icin sadelestirir (intent.service ile ayni yaklasim). */
function normalize(text: string): string {
  return text
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s,.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NUMBER_WORDS: Record<string, number> = {
  bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9,
  on: 10, onbes: 15, yirmi: 20, otuz: 30,
};

export interface Tenure {
  months: number;
  label: string;
}

/**
 * Sorgudan kidem suresini cikarir: "5 yillik", "18 aylik", "bes yil", "1,5 yil".
 * Bulunamazsa null doner ve hesaplayici devreye girmez.
 *
 * EN SON gecen sure kazanir. Bu, takip sorulari icin kritiktir: takip sorusu
 * onceki soruyla birlestirilerek geldiginden ("5 yillik ... peki 10 yillik
 * olsaydi?") ilk eslesme alinirsa kullanici eski cevabi tekrar alir.
 */
export function extractTenure(text: string): Tenure | null {
  const t = normalize(text);

  const words = Object.keys(NUMBER_WORDS).join('|');
  const pattern = new RegExp(
    `(?:(\\d+)[.,](\\d+)\\s*(?:yil|sene))` +   // 1: yil, 2: ondalik
      `|(?:(\\d+)\\s*(?:yil|sene))` +           // 3: tam yil
      `|(?:(\\d+)\\s*ay)` +                     // 4: ay
      `|(?:\\b(${words})\\s*(?:yil|sene))` +    // 5: sozcukle yil
      `|(?:\\b(${words})\\s*ay)`,               // 6: sozcukle ay
    'g',
  );

  let last: RegExpExecArray | null = null;
  for (const m of t.matchAll(pattern)) last = m as RegExpExecArray;
  if (!last) return null;

  const [, decInt, decFrac, intYear, intMonth, wordYear, wordMonth] = last;

  if (decInt !== undefined) {
    const years = Number(`${decInt}.${decFrac}`);
    return { months: Math.round(years * 12), label: `${decInt},${decFrac} yıl` };
  }
  if (intYear !== undefined) {
    return { months: Number(intYear) * 12, label: `${Number(intYear)} yıl` };
  }
  if (intMonth !== undefined) {
    return { months: Number(intMonth), label: `${Number(intMonth)} ay` };
  }
  if (wordYear !== undefined) {
    const years = NUMBER_WORDS[wordYear];
    return { months: years * 12, label: `${years} yıl` };
  }
  if (wordMonth !== undefined) {
    const months = NUMBER_WORDS[wordMonth];
    return { months, label: `${months} ay` };
  }
  return null;
}

function findTier(table: PolicyTable, months: number): Tier | null {
  return (
    table.tiers.find(
      (tier) => months >= tier.minMonths && (tier.maxMonths === null || months <= tier.maxMonths),
    ) ?? null
  );
}

export interface PolicyAnswer {
  answer: string;
  citation: { doc: string; section: string };
  tableId: string;
  months: number;
}

/**
 * Soru bir kademe hesabi mi? Oyleyse cevabi deterministik uretir.
 *
 * Iki kosul birlikte aranir:
 *   1) Konu anahtar kelimesi (yillik izin / ihbar suresi)
 *   2) Somut bir kidem suresi ("5 yillik", "18 ay")
 * Kidem verilmemisse null doner — "Yillik izin kac gun?" gibi genel sorular
 * normal RAG hattina gider ve tablonun tamami baglam olarak sunulur.
 */
export function calculatePolicyAnswer(message: string): PolicyAnswer | null {
  const t = normalize(message);

  const table = POLICY_TABLES.find((tbl) => tbl.keywords.some((k) => t.includes(k)));
  if (!table) return null;

  const tenure = extractTenure(message);
  if (!tenure) return null;

  const tier = findTier(table, tenure.months);
  if (!tier) return null;

  return {
    answer: table.render(tenure.label, tier),
    citation: { doc: table.sourceDoc, section: table.sourceSection },
    tableId: table.id,
    months: tenure.months,
  };
}
