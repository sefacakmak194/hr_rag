/**
 * Bozuk yanit kalkani.
 *
 * qwen2.5-1.5b bazi sorularda tamamen anlamsiz metin uretiyor. Olculdu —
 * "Evden calisma hakkim var mi?" sorusuna:
 *
 *   "EVNETE CALIŞMA HAKIMKI BİTTİRMEDİKTIRIR. EVNETE CALIŞMA HAKIMLIIZDA
 *    DAHILİ YETKİLER VAR. EVNETE CALIŞMA HAKIMIMIZDA DAHILİ YETKİLER VAR."
 *
 * Bu bir retrieval hatasi degil: dogru bolum getirilmisti. Kucuk modelin
 * uretim sinirina carpmasi.
 *
 * Boyle bir cikti kullaniciya GOSTERILMEMELI. Tespit edildiginde mevzuatin
 * kendi metnine dusulur — uretilmis degil, birebir alintidir; yani yanlis
 * olma riski yoktur.
 *
 * Kurallar kasitli olarak DAR: normal bir Turkce yanit bunlara takilmamali.
 */

/** Ayni 3 sozcuklu dizinin kac kez tekrarlandigini bulur. */
function maxTrigramRepeat(words: string[]): number {
  if (words.length < 3) return 0;
  const counts = new Map<string, number>();
  let max = 0;
  for (let i = 0; i + 3 <= words.length; i++) {
    const key = words.slice(i, i + 3).join(' ');
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    if (n > max) max = n;
  }
  return max;
}

export interface DegenerateVerdict {
  degenerate: boolean;
  reason?: string;
}

export function inspectAnswer(answer: string): DegenerateVerdict {
  const text = answer.trim();
  if (text.length < 12) return { degenerate: false };

  const words = text.split(/\s+/);

  // 1) Ayni 3 sozcuk dizisi 3+ kez: donguye girmis uretim.
  const repeat = maxTrigramRepeat(words.map((w) => w.toLocaleLowerCase('tr-TR')));
  if (repeat >= 3) return { degenerate: true, reason: `ucgen tekrar x${repeat}` };

  // 2) Uzun ve TAMAMEN buyuk harfli sozcukler. Kisaltmalar (KVKK, SGK, ISG)
  //    kisadir; 6+ harfli tamami buyuk sozcukler bozulma isaretidir.
  const shouty = words.filter((w) => {
    const bare = w.replace(/[^\p{L}]/gu, '');
    return bare.length >= 6 && bare === bare.toLocaleUpperCase('tr-TR') && bare !== bare.toLocaleLowerCase('tr-TR');
  });
  if (shouty.length >= 3) return { degenerate: true, reason: `${shouty.length} buyuk harfli sozcuk` };

  // 3) Ayni harf pes pese 8+ kez: tek jeton bozulmasi.
  //
  //     Olculdu — qwen3.5-2b-text-cuda-gpu varyanti bu makinede Turkce
  //     karakterlerde cokuyor ve "Dogum yardimi ne kadar?" sorusuna
  //     "ÇÇÇÇÇÇÇÇÇÇÇÇ..." donuyor.
  //
  //     Ustteki iki kural bunu KACIRIR: ikisi de en az uc SOZCUK bekler,
  //     bu cikti ise bosluksuz tek sozcuktur. Kalkan "donguye girmis cumle
  //     uretimi" bicimine gore yazilmisti; bu farkli bir bozulma bicimi.
  //
  //     Esik 8 kasitli olarak yuksek: hicbir Turkce sozcukte ayni harf
  //     pes pese ikiden fazla gecmez, dolayisiyla yanlis alarm riski yok.
  if (/(\p{L})\1{7,}/u.test(text)) {
    return { degenerate: true, reason: 'ayni harf pes pese tekrarlandi' };
  }

  // 4) Ayni sozcuk parcasi BOSLUKSUZ 4+ kez: jeton dongusu.
  //
  //     Olculdu — ayni bozuk varyant "Yol destegi aylik ne kadar?" sorusuna
  //     "TopTopTopTop...", "Performans sonucuna..." sorusuna ise
  //     "PerformansPerformansPerformans..." donuyor.
  //
  //     Ustteki harf kurali bunu KACIRIR (tekrarlanan birim tek harf degil),
  //     ucgen kurali da kacirir (bosluk yok, tek "sozcuk" sayiliyor). Ucuncu
  //     bir bozulma bicimi.
  //
  //     Yalnizca HARF dizileri araniyor: "20202020" gibi sayilar ya da tarih
  //     bicimleri yanlislikla bozuk sayilmasin. Normal Turkce metinde bir
  //     sozcuk bosluksuz ard arda tekrarlanmaz.
  if (/(\p{L}{2,20}?)\1{3,}/u.test(text)) {
    return { degenerate: true, reason: 'ayni dizi bosluksuz tekrarlandi' };
  }

  // 5) Ayni cumle birden fazla kez.
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim().toLocaleLowerCase('tr-TR'))
    .filter((s) => s.length > 20);
  if (new Set(sentences).size < sentences.length) {
    return { degenerate: true, reason: 'ayni cumle tekrarlandi' };
  }

  return { degenerate: false };
}
