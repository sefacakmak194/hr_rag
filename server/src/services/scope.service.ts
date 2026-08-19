/**
 * Kapsam disi konularin DETERMINISTIK reddi.
 *
 * NEDEN BU KATMAN VAR — once olcum.
 *
 * Alaka kapisi tek bir kosinus esigi (`SIMILARITY_THRESHOLD`). Sartnamenin
 * halusinasyon testi "Sirket bana ozel arac tahsisi yapiyor mu?" bu kapiyi
 * geciyordu; ama YENIDEN IFADESI gecmiyordu:
 *
 *     "Sirket araci tahsis ediliyor mu?"  ->  0.8409  (esik 0.832)  -> KAPI ACIK
 *
 * Model bu baglamla "No" cevabi uretti. Skorun yuksek olmasinin sebebi anlam
 * degil KELIME: "arac" korpusta "lisanssiz ARAC kullanimi" (gerec anlaminda)
 * ve "tahsis edilen dizustu bilgisayar" cumlelerinde geciyor.
 *
 * Esigi yukseltmek AKLA GELEN ilk cozumdu ve OLCULDU — calismiyor
 * (`npm run calibrate`, 38 kapsam-ici / 13 kapsam-disi sorgu):
 *
 *     kapsam-ici  en dusuk : 0.8408   "Mobbing bildirimini nereye yapabilirim?"
 *     kapsam-disi en yuksek: 0.8409   "Sirket araci tahsis ediliyor mu?"
 *     ayirim boslugu       : -0.0001
 *
 * Iki dagilim tam ustuste. rob-2'yi engelleyecek her esik, mesru bir mobbing
 * sorusunu da engeller. Yani bu esik ayariyla COZULEMEZ.
 *
 * ---
 *
 * COZUM VE SINIRI
 *
 * `data/KAPSAM.md` zaten hangi konularin KASITLI olarak kapsam disi
 * birakildigini yaziyor — sirket araci bunlardan biri ve gerekcesi orada
 * kayitli. Bu bir kurumsal KARAR; benzerlik skoruna birakilmamali.
 *
 * Bu katman o karari koda tasiyor: listedeki bir konu geciyorsa soru vektor
 * aramasina HIC girmez, sabit yanit doner.
 *
 * DURUST SINIR: bu bir sinir tanima yetenegi DEGIL, bir liste. Yalnizca
 * yazilmis konulari yakalar; listede olmayan bir kapsam disi soru yine
 * esige kalir ve esik — yukarida olculdugu gibi — tek basina yeterli degil.
 * Liste, kapsam karari degistikce KAPSAM.md ile birlikte guncellenmelidir.
 *
 * NEDEN ESNEK DEGIL: kaliplar dar tutuldu. "arac" tek basina yasakli olsaydi
 * "Lisanssiz arac kullanabilir miyim?" (disiplin yonetmeliginde GECEN, kapsam
 * ICI bir soru) da reddedilirdi. Bu yuzden yalnizca konuyu tekilleyen
 * birlesimler listelenir.
 */

/** Turkce metni eslesme icin sadelestirir (intent/policyCalculator ile ayni yaklasim). */
function normalize(text: string): string {
  return text
    .replace(/İ/g, 'I')
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface OutOfScopeTopic {
  id: string;
  /** KAPSAM.md'deki gerekce — neden bilerek disarida. */
  reason: string;
  /**
   * Konuyu TEKILLEYEN kaliplar. Her kalip, sadelestirilmis metinde aranan
   * kelime dizisidir; tek basina cok genel olan kelimeler (yalniz "arac")
   * KASITLI olarak yoktur.
   */
  patterns: string[];
}

export const OUT_OF_SCOPE_TOPICS: OutOfScopeTopic[] = [
  {
    id: 'sirket-araci',
    reason:
      'Sartname Bolum 6, Soru 3 bunu halusinasyon engelleme testi olarak kullaniyor; ' +
      'korpusa eklenirse o kabul testi anlamini kaybeder (bkz. data/KAPSAM.md).',
    patterns: [
      'sirket araci', 'sirket aracina', 'sirket aracim', 'sirket aracligi',
      'arac tahsis', 'araci tahsis', 'arac tahsisi', 'makam araci',
      'sirket arabasi', 'sirket araba', 'araba tahsis', 'sirket otomobil',
      'ozel arac', 'personel servisi disinda arac',
    ],
  },
  {
    id: 'hisse-opsiyon',
    reason: 'Sirkette boyle bir program tanimli degil (bkz. data/KAPSAM.md).',
    patterns: ['hisse senedi', 'hisse opsiyon', 'opsiyon program', 'stock option', 'pay senedi'],
  },
  {
    id: 'yemekhane-menusu',
    reason: 'Operasyonel bilgi, mevzuat degil (bkz. data/KAPSAM.md).',
    patterns: ['yemekhanede bugun', 'yemek menusu', 'gunun menusu', 'yemekhane menu'],
  },
];

export interface ScopeVerdict {
  topicId: string;
  reason: string;
  /** Eslesen kalip — kararin neden verildigi izlenebilsin diye. */
  matched: string;
}

/**
 * Soru, KASITLI olarak kapsam disi birakilmis bir konuya mi ait?
 *
 * Donerse cagiran taraf vektor aramasina GIRMEDEN sabit yaniti dondurmelidir.
 */
export function checkOutOfScope(question: string): ScopeVerdict | null {
  const t = ` ${normalize(question)} `;

  for (const topic of OUT_OF_SCOPE_TOPICS) {
    for (const p of topic.patterns) {
      if (t.includes(` ${p}`)) {
        return { topicId: topic.id, reason: topic.reason, matched: p };
      }
    }
  }
  return null;
}
