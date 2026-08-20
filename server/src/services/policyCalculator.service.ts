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
  /**
   * Kidem BELIRTILMEMIS soru icin tablonun tamamini veren yanit.
   *
   * "Yillik izin kac gun?" sorusunun tek bir dogru cevabi yok — cevap kidem
   * kademesine bagli. Tek bir kademeyi secmek uydurma olur; dogru davranis
   * tabloyu oldugu gibi vermektir.
   */
  renderAll: () => string;
  /**
   * Sorunun HAK MIKTARINI sordugunu gosteren ibareler. Konu anahtar kelimesi
   * tek basina yetmiyor: "Yillik izin talebini kac gun ONCE yapmaliyim?" da
   * "yillik izin" iceriyor ama cevabi tabloda degil, usul cumlesinde.
   */
  unitMarkers: string[];
  /**
   * Tabloyu DEVRE DISI birakan ibareler — konu anahtari fazla genel oldugunda.
   *
   * NEDEN VAR: `yillik-izin` anahtarlari arasinda "izni kac gun" gibi GENEL
   * bir kalip var ve bu kalip her izin turunu yakaliyordu. Olculdu (saha
   * denetimi, 20.08.2026):
   *
   *   "Evlilik izni kac gundur?"  -> yillik izin kademe tablosu
   *   "Babalik izni kac gun?"     -> yillik izin kademe tablosu
   *   "Sut izni kac gun?"         -> yillik izin kademe tablosu
   *   "Vefat izni kac gundur?"    -> yillik izin kademe tablosu
   *
   * Hepsi YANLIS ve hepsi KENDINDEN EMIN: hesaplayici LLM'den ve alaka
   * kapisindan ONCE calistigi icin soru korpusa HIC ulasmiyordu. Yani
   * korpusa dogru maddeyi yazmak bu hatayi duzeltmiyor — nitekim 01/Madde 3'e
   * eklenen evlilik izni belgeleri erisilemez kaliyordu.
   *
   * Anahtari daraltmak yerine AYRI BIR LISTE tutulmasinin sebebi: kalibi
   * daraltmak ("yillik izni kac gun") mesru kisa ifadeleri
   * ("izni kac gun kullanabilirim") kaybettiriyordu. Usul ayrimi da ayni
   * sekilde ayri bir liste ile yapiliyor (bkz. PROCEDURE_MARKERS).
   */
  excludeKeywords?: string[];
}

/**
 * Usul sorusu isaretleri — bunlardan biri geciyorsa soru hak miktarini degil
 * SURECI soruyor ve normal RAG hattina gitmelidir.
 *
 * Olculdu: bu ayrim olmadan "Yillik izin talebini kac gun once yapmaliyim?"
 * sorusu kademe tablosuyla cevaplaniyor — yani dogru bilgi, yanlis soruya.
 */
const PROCEDURE_MARKERS = [
  'once', 'oncesinden', 'talep', 'basvuru', 'bildir', 'nasil', 'onay', 'kim ',
];

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
    unitMarkers: ['kac gun', 'kac is gunu', 'ne kadar', 'kac gundur', 'kac gunluk'],
    // Baska bir izin turu ADIYLA geciyorsa bu tablo calismaz; soru korpusa gider.
    excludeKeywords: [
      'evlilik izni', 'evlenme izni', 'nikah izni',
      'babalik izni', 'dogum izni', 'analik izni', 'sut izni', 'evlat edinme',
      'vefat izni', 'olum izni', 'cenaze izni',
      'mazeret izni', 'ucretsiz izin', 'idari izin', 'afet izni', 'refakat izni',
      'sinav izni', 'egitim izni', 'tasinma izni', 'kan bagisi',
      'hastalik izni', 'rapor', 'is arama izni', 'telafi izni', 'sut hakki',
    ],
    renderAll: () =>
      'Yıllık ücretli izin süresi kıdeme göre değişir: ' +
      '1 yıldan 5 yıla kadar (5 yıl dahil) kıdemi olanlar 14 iş günü, ' +
      '5 yıldan fazla 15 yıldan az kıdemi olanlar 20 iş günü, ' +
      '15 yıl (dahil) ve daha fazla kıdemi olanlar 26 iş günü izin kullanabilir. ' +
      'Kıdeminizi belirtirseniz size özel süreyi söyleyebilirim.',
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
    unitMarkers: ['kac hafta', 'ne kadar', 'kac haftadir'],
    renderAll: () =>
      'İhbar süresi kıdeme göre değişir: ' +
      '6 aydan az kıdemi olanlar için 2 hafta, ' +
      '6 aydan 1,5 yıla kadar 4 hafta, ' +
      '1,5 yıldan 3 yıla kadar 6 hafta, ' +
      '3 yıldan fazla kıdemi olanlar için 8 haftadır. ' +
      'Kıdeminizi belirtirseniz size özel süreyi söyleyebilirim.',
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
  let prev: RegExpExecArray | null = null;
  for (const m of t.matchAll(pattern)) {
    prev = last;
    last = m as RegExpExecArray;
  }
  if (!last) return null;

  // "5 YIL 6 AY" TEK BIR SUREDIR — iki ayri sure degil.
  //
  // "en son gecen sure kazanir" kurali takip sorulari icin dogru ("5 yillik …
  // peki 10 yillik olsaydi?"), ama bitisik yazilan yil+ay ikilisinde yanlis
  // sonuc veriyordu: son eslesme "6 ay" oldugu icin kidem 6 aya dusuyor,
  // hicbir kademe tutmadigi icin hesaplayici null donuyordu. Iki eslesme
  // metinde YAN YANA ise (aralarinda en fazla bir baglac) birlestirilir.
  const birlesik = birlestirYilAy(prev, last, t);
  if (birlesik) return birlesik;

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

/**
 * Yan yana duran yil ve ay eslesmelerini tek sureye toplar.
 *
 * Yalnizca ARADA baska sozcuk yokken birlestirir: "5 yil 6 ay" ve "5 yil ve 6
 * ay" birlesir; "5 yillik calisan 6 ay izin alsa" birlesmez — orada iki ayri
 * sayi var ve sonuncusu kidem degil. Sinir olarak 4 karakter secildi: " ve "
 * en uzun mesru baglac.
 */
function birlestirYilAy(
  prev: RegExpExecArray | null,
  last: RegExpExecArray,
  metin: string,
): Tenure | null {
  if (!prev) return null;

  const ay = last[4] !== undefined ? Number(last[4]) : last[6] !== undefined ? NUMBER_WORDS[last[6]] : null;
  if (ay === null || ay === undefined) return null;

  const yil = prev[3] !== undefined ? Number(prev[3]) : prev[5] !== undefined ? NUMBER_WORDS[prev[5]] : null;
  if (yil === null || yil === undefined) return null;

  const bosluk = metin.slice((prev.index ?? 0) + prev[0].length, last.index ?? 0);
  if (!/^\s*(ve\s*)?$/.test(bosluk) || bosluk.length > 4) return null;

  return { months: yil * 12 + ay, label: `${yil} yıl ${ay} ay` };
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
  /** Kidem belirtilmemis genel soruda null. */
  months: number | null;
}

/**
 * Soru bir kademe hesabi mi? Oyleyse cevabi deterministik uretir.
 *
 * Iki yol var:
 *
 *   1) Konu anahtar kelimesi + somut kidem ("5 yillik", "18 ay")
 *      -> o kademenin cevabi.
 *   2) Konu anahtar kelimesi + miktar sorusu, kidem YOK
 *      -> tablonun TAMAMI. "Yillik izin kac gun?" sorusunun tek bir dogru
 *         cevabi yoktur; tek kademe secmek uydurma olurdu.
 *
 * (2) NEDEN EKLENDI — bu davranis zaten tasarlanmisti ama gerceklesmiyordu.
 * Kidem verilmeyen soru RAG hattina gidiyor ve "tablonun tamami baglam olarak
 * sunulur" varsayiliyordu; oysa cumle duzeyinde kanit secimi tek cumle
 * isaretliyor ve madde isaretli kademe satirlari kaybediyor: kademeler
 * konusunu bir ust satirdan ("...haklari asagidaki gibidir:") aldigi icin
 * "yillik" ve "izin" terimlerini TASIMIYOR, usul cumlesi ise ucunu birden
 * tasiyor. Olculdu: "Yillik izin kac gun?" -> "En az 10 gun oncesinden IK
 * Portali uzerinden talep olusturulmasi zorunludur." Dogru bilgi, yanlis soru.
 *
 * Usul sorulari (PROCEDURE_MARKERS) bu yoldan HARIC tutulur.
 */
export function calculatePolicyAnswer(message: string): PolicyAnswer | null {
  const t = normalize(message);

  const table = POLICY_TABLES.find(
    (tbl) =>
      tbl.keywords.some((k) => t.includes(k)) &&
      !(tbl.excludeKeywords ?? []).some((k) => t.includes(k)),
  );
  if (!table) return null;

  const tenure = extractTenure(message);

  if (!tenure) {
    const usul = PROCEDURE_MARKERS.some((m) => t.includes(m));
    const miktar = table.unitMarkers.some((m) => t.includes(m));
    if (usul || !miktar) return null;

    return {
      answer: table.renderAll(),
      citation: { doc: table.sourceDoc, section: table.sourceSection },
      tableId: table.id,
      months: null,
    };
  }

  const tier = findTier(table, tenure.months);
  if (!tier) return null;

  return {
    answer: table.render(tenure.label, tier),
    citation: { doc: table.sourceDoc, section: table.sourceSection },
    tableId: table.id,
    months: tenure.months,
  };
}
