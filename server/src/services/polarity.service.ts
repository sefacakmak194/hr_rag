/**
 * Kutupluluk (polarity) — birbirinin ZITTI olan ama embedding uzayinda neredeyse
 * AYNI yere dusen terim ciftleri.
 *
 * SORUN: "Annelikte ucretli izin ne kadar?" sorgusunda en yuksek skoru
 * "Madde 4: Ucretsiz Dogum Sonrasi Izin" aliyordu (olculdu). Sebep, E5'in
 * "ucretli" ile "ucretsiz" arasindaki tek morfem farkini neredeyse gormemesi;
 * BM25 bileseni de yalnizca 0.05 agirlikta oldugu icin bunu telafi edemiyor.
 * Ayni sinif: "tehlikeli / az tehlikeli", "dahil / haric", "zorunlu / istege
 * bagli".
 *
 * COZUM: sorgu bir ciftin BIR ucunu tasiyorsa, KARSI ucu tasiyan ve sorgunun
 * ucunu HIC tasimayan parcalar geriye alinir.
 *
 * DIKKAT — bu yalnizca YENIDEN SIRALAMA yapar, alaka kapisini etkilemez.
 * Fuzyon skoruna dokunmak esik kalibrasyonunu gecersiz kilardi (esik 0.832,
 * kapsam-ici/disi bosluk yalnizca 0.0179). Kapi zaten acildiktan sonra
 * getirilen parcalarin sirasi degistirilir; hicbir parca elenmez.
 *
 * Kutupluluk ayrica takip sorusu yeniden yazmada da kullanilir: "peki ya
 * ucretsiz izin" sorusu, onceki sorudaki "ucretli" terimi degistirilerek
 * kendi basina anlamli bir soruya cevrilir (bkz. conversation.service).
 */

/** Zit terim ciftleri. Sadelestirilmis (normalize edilmis) bicimde tutulur. */
export const POLARITY_PAIRS: [string, string][] = [
  ['ucretli', 'ucretsiz'],
  ['dahil', 'haric'],
  ['zorunlu', 'istege bagli'],
  ['odenir', 'odenmez'],
  ['verilir', 'verilmez'],
  ['sayilir', 'sayilmaz'],
  ['tam gun', 'yarim gun'],
  ['kadin', 'erkek'],
  ['tam zamanli', 'kismi sureli'],
  ['belirli sureli', 'belirsiz sureli'],
];

export function normalizePolarity(text: string): string {
  return text
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface PolarityHit {
  /** Sorguda gecen uc. */
  wanted: string;
  /** Ciftin diger ucu. */
  opposite: string;
}

/**
 * Sorguda gecen kutup terimlerini bulur.
 *
 * DIKKAT — bir ucun digerini ICERMEDIGINDEN emin olunmali. "ucretsiz" metni
 * "ucretli" iceremez (farkli sonekler) ama "tam gun" / "yarim gun" gibi
 * ciftlerde ortak sozcuk var; bu yuzden tam ifade araniyor.
 */
export function polarityHits(query: string): PolarityHit[] {
  const q = ` ${normalizePolarity(query)} `;
  const hits: PolarityHit[] = [];

  for (const [a, b] of POLARITY_PAIRS) {
    const hasA = q.includes(` ${a} `) || q.includes(` ${a}`);
    const hasB = q.includes(` ${b} `) || q.includes(` ${b}`);
    // Ikisi de varsa ayirt edici degildir (sorgu karsilastirma yapiyor olabilir).
    if (hasA && !hasB) hits.push({ wanted: a, opposite: b });
    else if (hasB && !hasA) hits.push({ wanted: b, opposite: a });
  }

  return hits;
}

/**
 * Kapidan gecmis parcalari kutupluluga gore yeniden siralar.
 *
 * Ceza kurali: parca sorgunun ucunu HIC tasimiyor ve KARSI ucu tasiyorsa geriye
 * alinir. Iki ucu birlikte tasiyan parca cezalandirilmaz — o parca konuyu
 * karsilastiran metindir ve genelde dogru maddedir.
 *
 * Siralama kararli (stable) tutulur: cezasiz parcalarin kendi arasindaki sira
 * (yani fuzyon skoru sirasi) korunur.
 */
export function rerankByPolarity<T extends { content: string; section: string }>(
  chunks: T[],
  query: string,
): T[] {
  const hits = polarityHits(query);
  if (!hits.length || chunks.length < 2) return chunks;

  const scored = chunks.map((chunk, index) => {
    const text = ` ${normalizePolarity(`${chunk.section} ${chunk.content}`)} `;
    let penalty = 0;

    for (const { wanted, opposite } of hits) {
      const hasWanted = text.includes(` ${wanted}`);
      const hasOpposite = text.includes(` ${opposite}`);
      if (!hasWanted && hasOpposite) penalty++;
    }

    return { chunk, index, penalty };
  });

  scored.sort((a, b) => a.penalty - b.penalty || a.index - b.index);
  return scored.map((s) => s.chunk);
}
