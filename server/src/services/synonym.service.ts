/**
 * Sorgu genisletme (query expansion) — kullanicinin kelimesi ile mevzuatin
 * kelimesi ayni olmadiginda arayi kapatir.
 *
 * SORUN: "Annelikte ucretli izin ne kadar?" sorgusunda dogru madde (Analik
 * Izni) ucuncu siraya dusuyor, ustelik "Evlat Edinme" maddesi one geciyordu
 * (olculdu). Sebep basit: korpusta "annelik" kelimesi HIC GECMIYOR, "analik"
 * 5 kez geciyor. E5 bu ikisini yakin buluyor ama yeterince degil; BM25 ise
 * hic goremiyor cunku farkli sozcukler.
 *
 * COZUM: kucuk ve KORPUSLA DOGRULANMIS bir esanlam tablosu. Kullanicinin
 * soyledigi bicim sorguda varsa, mevzuatin bicimi sorguya EKLENIR (degistirmez
 * — ikisi birlikte aranir).
 *
 * TABLOYA EKLEME KURALI: yalnizca kullanici bicimi korpusta HIC gecmiyorsa
 * ekleyin. Iki bicim de geciyorsa genisletme gereksizdir ve alaka kapisinin
 * kapsam-ici/disi bosluğunu (yalnizca 0.0179) daraltma riski tasir. Korpus
 * degistiginde bu tabloyu yeniden dogrulayin:
 *
 *   grep -roi "annelik" data/corpus | wc -l     # 0 olmali
 *   grep -roi "analık"  data/corpus | wc -l     # > 0 olmali
 */

/** [kullanicinin soyledigi, korpusta gecen] */
export const SYNONYMS: [string, string][] = [
  ['annelik', 'analık izni'],
  ['doğum izni', 'analık izni'],
  ['emzirme', 'süt izni'],
  ['nikah', 'evlilik'],
  ['işten ayrılma', 'istifa fesih'],
  ['işten çıkma', 'istifa fesih'],
  ['fazla çalışma', 'fazla mesai'],
  ['evden çalışma', 'uzaktan çalışma'],
  ['çocuk bakımı', 'kreş'],
  ['ebeveyn izni', 'ücretsiz doğum sonrası izin'],
];

function normalize(text: string): string {
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

/**
 * Sorguyu esanlamlarla genisletir. Orijinal metin KORUNUR, karsiliklar sonuna
 * eklenir; boylece hem kullanicinin ifadesi hem mevzuatin ifadesi aranir.
 *
 * Ek yapilmadiysa sorgu oldugu gibi doner.
 */
export function expandQuery(query: string): string {
  const q = ` ${normalize(query)} `;
  const additions: string[] = [];

  for (const [user, corpus] of SYNONYMS) {
    const userForm = normalize(user);
    const corpusForm = normalize(corpus);

    // Kullanicinin bicimi geciyor mu? Kok olarak aranir ("annelikte" -> "annelik").
    if (!q.includes(` ${userForm}`)) continue;
    // Mevzuatin bicimi zaten geciyorsa eklemeye gerek yok.
    if (q.includes(` ${corpusForm}`)) continue;

    additions.push(corpus);
  }

  return additions.length ? `${query} ${additions.join(' ')}` : query;
}
