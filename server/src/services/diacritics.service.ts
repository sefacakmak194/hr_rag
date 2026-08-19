/**
 * Turkce karakter onarimi — "yillik izin kac gun" -> "yıllık izin kaç gün".
 *
 * SORUN — 10.000 soruluk taramada olculdu (`npm run sweep`).
 *
 * Duzgun Turkce ile yazildiginda CEVAPLANAN 114 soru, ayni soru Turkce karakter
 * kullanilmadan yazildiginda cevapsiz kaliyor. Bu bir esik meselesi degil,
 * ucurum:
 *
 *     "Kısmi süreli çalışma mümkün mü?"          0.8789
 *     "Kismi sureli calisma mumkun mu?"          0.7777   (-0.10)
 *
 *     "Uzaktan çalışma günlerini kim belirliyor?" 0.8697
 *     "Uzaktan calisma gunlerini kim belirliyor?" 0.7821   (-0.09)
 *
 * Sebep iki katmanda birden: embedding modeli "calisma" ile "çalışma"yi ayni
 * sozcuk saymiyor, BM25 ise zaten farkli dizgeler olarak goruyor. Ve bu, nadir
 * bir kullanim degil — Turkiye'de arama kutusuna Turkce karakter kullanmadan
 * yazmak son derece yaygin.
 *
 * ---
 *
 * COZUM VE NEDEN BU COZUM
 *
 * Uc secenek vardi:
 *
 *   1. Sorguyu ve KORPUSU birlikte diakritiksize indirgemek. Calisirdi ama tum
 *      embedding'leri degistirirdi: bastan indeksleme + tum esiklerin yeniden
 *      kalibrasyonu, ve "kar/kâr" gibi ayrimlarin kalici kaybi.
 *   2. Genel bir "deasciifier" (dil modeli/istatistik tabanli). Yeni bir
 *      bagimlilik ve yeni bir hata kaynagi.
 *   3. KORPUSUN KENDI SOZLUGUNU kullanmak. <- secilen
 *
 * Korpustaki her sozcugun diakritiksiz hali cikarilir ve bir harita kurulur:
 * `calisma -> çalışma`. Sorgudaki bir sozcuk korpusta OLDUGU GIBI gecmiyorsa
 * ama diakritiksiz hali bir korpus sozcugune denk geliyorsa, sozcuk korpusun
 * yazimiyla degistirilir.
 *
 * Bu secim kalibrasyona DOKUNMAZ: embedding hala duzgun Turkce goruyor, korpus
 * hic degismiyor. Yani kazanc bedava degil ama bedeli yok denecek kadar az.
 *
 * ---
 *
 * NEDEN YANLIS ONARIM YAPMAZ
 *
 * Uc koruma var:
 *
 *   1. Sozcuk korpusta OLDUGU GIBI geciyorsa asla degistirilmez. "kar" korpusta
 *      varsa "kâr"a cevrilmez.
 *   2. Diakritiksiz hali BIRDEN COK korpus sozcugune denk geliyorsa (belirsiz)
 *      degistirilmez — yanlis tahmin, tahminsizlikten zararlidir.
 *   3. Sorgu zaten Turkce karakter iceriyorsa onarim HIC calismaz. Kullanici
 *      "çalışma" yazabiliyorsa "kac" yazdiginda bunu bilerek yapmistir.
 */
import type { DatabaseSync } from 'node:sqlite';

/** Turkce harfleri ASCII karsiliklarina indirger. */
export function katla(kelime: string): string {
  return kelime
    .replace(/ı/g, 'i').replace(/İ/g, 'i')
    .replace(/ş/g, 's').replace(/Ş/g, 's')
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/Ü/g, 'u')
    .replace(/ö/g, 'o').replace(/Ö/g, 'o')
    .replace(/ç/g, 'c').replace(/Ç/g, 'c')
    .replace(/â/g, 'a').replace(/Â/g, 'a')
    .replace(/î/g, 'i').replace(/Î/g, 'i')
    .replace(/û/g, 'u').replace(/Û/g, 'u')
    .toLowerCase();
}

/** Sorguda Turkce'ye ozgu harf var mi? */
export function turkceHarfIceriyor(metin: string): boolean {
  return /[ıİşŞğĞüÜöÖçÇâîû]/.test(metin);
}

/**
 * TAMAMI BUYUK HARF yazilmis sorguyu kucultur.
 *
 * Taramada olculdu: buyuk harf, normal yazimda cevaplanan 68 soruyu dusuruyor
 * ve bu, diakritik sorunundan sonraki en buyuk tek kirilma sebebiydi. Embedding
 * modeli buyuk harfli dizgeyi belirgin sekilde farkli konumluyor.
 *
 * Yalnizca TAMAMI buyuk olan sorgular icin calisir. Kismi buyuk harf
 * bilgilendiricidir ("KVKK", "SGK", "İSG") ve bozulmamalidir — bu yuzden kural
 * "en az iki harf var ve hicbiri kucuk degil" seklinde dar tutuldu.
 *
 * `turkce` bayragi zorunlu ve ONEMLI. Turkce kurallarla kucultmek "I" harfini
 * "ı" yapar; ASCII yazilmis bir sorguda ("HAFTALIK CALISMA") bu, olmayan bir
 * Turkce harf URETIR ve asagidaki "kullanici Turkce yazabiliyor" korumasini
 * yanlislikla tetikleyip onarimi tamamen iptal eder. Olculdu: bu bayrak
 * olmadan "CALISMA" -> "calısma" gibi YENI bir bozukluk uretiliyordu.
 */
export function bagirmayiYumusat(metin: string, turkce: boolean): string {
  const harfler = metin.match(/\p{L}/gu);
  if (!harfler || harfler.length < 2) return metin;
  const kucuk = (h: string) => (turkce ? h.toLocaleLowerCase('tr') : h.toLowerCase());
  if (harfler.some((h) => h === kucuk(h))) return metin;
  return kucuk(metin);
}

interface Sozluk {
  /** katlanmis bicim -> korpustaki tek yazim (belirsizler haritada YOK) */
  harita: Map<string, string>;
  /** korpusta oldugu gibi gecen tum sozcukler */
  mevcut: Set<string>;
}

let sozluk: Sozluk | null = null;

/** Korpus degistiginde cagrilmali (yeniden indeksleme sonrasi). */
export function resetDiacriticsSozluk(): void {
  sozluk = null;
}

const SOZCUK = /[\p{L}\p{N}]+/gu;

function sozlukKur(db: DatabaseSync): Sozluk {
  /**
   * DOSYA ADI BILEREK DISARIDA — bu, sozlugu zehirleyen tek sey.
   *
   * BM25 indeksi `doc_title`i de metne katiyor (konu sinyali govdede
   * gecmeyebiliyor) ve bu sozluk ilk yazildiginda ayni desen kopyalandi.
   * Sonuc olculdu ve sessizdi: onarim "calisma", "suresi", "izinler" gibi
   * sozcuklerde CALISMIYORDU.
   *
   * Sebep: dosya adlari zaten ASCII transliterasyon —
   * `01_calisma_saatleri_ve_izinler.md`. Sozcuk ayirici bunu "calisma",
   * "saatleri", "izinler" diye bolunce, onarilmasi gereken sozcuklerin
   * diakritiksiz hali korpusta GECIYOR gibi gorunuyor ve "zaten dogru
   * yazilmis" korumasi devreye giriyordu.
   *
   * Bolum basliklari duzgun Turkce ("Madde 2: Yıllık Ücretli İzin Hakları"),
   * o yuzden onlar iceride kaliyor.
   */
  const satirlar = db
    .prepare('SELECT section, content FROM chunks')
    .all() as { section: string; content: string }[];

  // katlanmis -> gorulen yazimlar ve sayilari
  const adaylar = new Map<string, Map<string, number>>();
  const mevcut = new Set<string>();

  for (const r of satirlar) {
    const metin = `${r.section} ${r.content}`;
    for (const eslesme of metin.matchAll(SOZCUK)) {
      const ham = eslesme[0].toLocaleLowerCase('tr');
      if (ham.length < 3) continue;
      mevcut.add(ham);

      const k = katla(ham);
      if (k === ham) continue; // diakritiksiz sozcuk; onarilacak bir sey yok

      const sayac = adaylar.get(k) ?? new Map<string, number>();
      sayac.set(ham, (sayac.get(ham) ?? 0) + 1);
      adaylar.set(k, sayac);
    }
  }

  const harita = new Map<string, string>();
  for (const [k, sayac] of adaylar) {
    // Korpusta ZATEN diakritiksiz bir sozcuk olarak varsa dokunma: kullanicinin
    // yazdigi sey gercek bir sozcuk olabilir.
    if (mevcut.has(k)) continue;

    const siralı = [...sayac.entries()].sort((a, b) => b[1] - a[1]);
    // Belirsizlik: iki farkli yazim benzer sikliktaysa tahmin etme.
    if (siralı.length > 1 && siralı[1][1] * 2 > siralı[0][1]) continue;
    harita.set(k, siralı[0][0]);
  }

  return { harita, mevcut };
}

/**
 * Sorgudaki diakritiksiz sozcukleri korpusun yazimina cevirir.
 *
 * Degisiklik yapilmadiysa sorgu OLDUGU GIBI doner — cagiran taraf farki
 * gormek zorunda degil.
 */
export function turkceyiOnar(db: DatabaseSync, ham: string): string {
  // Karar HAM metne bakilarak verilir; kucultme Turkce harf URETEBILIR.
  const turkceVar = turkceHarfIceriyor(ham);

  // Once bagirma yumusatilir: buyuk harfli sorgu embedding'i belirgin sekilde
  // kaydiriyor (taramada olculdu).
  const sorgu = bagirmayiYumusat(ham, turkceVar);

  // Kullanici Turkce karakter yazabiliyorsa niyeti odur; karisma.
  if (turkceVar) return sorgu;

  if (!sozluk) sozluk = sozlukKur(db);
  const { harita, mevcut } = sozluk;
  if (!harita.size) return sorgu;

  let degisti = false;
  const cikti = sorgu.replace(SOZCUK, (kelime) => {
    const kucuk = kelime.toLocaleLowerCase('tr');
    if (kucuk.length < 3) return kelime;
    // Korpusta oldugu gibi geciyorsa dogru yazilmis demektir.
    if (mevcut.has(kucuk)) return kelime;

    const onarim = harita.get(katla(kucuk));
    if (!onarim) return kelime;

    degisti = true;
    // Buyuk harfle yazilmissa bicimi koru (tarama bankasindaki BUYUK-HARF hali).
    return kelime === kelime.toLocaleUpperCase('tr') && kelime !== kucuk
      ? onarim.toLocaleUpperCase('tr')
      : onarim;
  });

  return degisti ? cikti : sorgu;
}
