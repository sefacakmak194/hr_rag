import { countChunks, listDocuments } from './vectorStore.service.js';
import type { Principal } from './identity.service.js';

export type IntentKind = 'greeting' | 'capability' | 'thanks' | 'farewell' | 'recap' | 'rag';

export interface IntentResult {
  kind: IntentKind;
  /** 'rag' disindaki niyetlerde dogrudan kullaniciya donulecek hazir yanit. */
  response?: string;
}

/**
 * Turkce metni eslesme icin sadelestirir: aksanlari kaldirir, kucuk harfe cevirir,
 * noktalama isaretlerini bosluga donusturur.
 *
 * NOT: 'İ'.toLowerCase() JavaScript'te birlesik nokta ureterek eslesmeyi bozar;
 * bu yuzden Turkce'ye ozgu i/I ciftleri toLowerCase ONCESI elle donusturulur.
 */
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

const wordCount = (s: string) => (s ? s.split(' ').length : 0);

/**
 * Selamlama sozcukleri.
 * Yalnizca KISA sorgularda (<= 4 kelime) ve sorgu bu sozcuklerden biriyle
 * BASLIYORSA eslesir. Boylece "iyi gunler, yillik iznim kac gun" gibi bir cumle
 * selamlama sanilip RAG'e gitmeden kesilmez.
 */
const GREETINGS = [
  'selam', 'selamlar', 'slm', 'merhaba', 'mrb', 'sa', 'selamun aleykum',
  'gunaydin', 'iyi gunler', 'iyi aksamlar', 'iyi sabahlar', 'hey', 'alo',
  'naber', 'nasilsin', 'naber', 'hello', 'hi',
];

const THANKS = [
  'tesekkurler', 'tesekkur ederim', 'tesekkur', 'sagol', 'sag ol', 'sagolun',
  'eyvallah', 'tamamdir', 'anladim tesekkurler', 'thanks',
];

const FAREWELLS = [
  'gorusuruz', 'hosca kal', 'hoscakal', 'bay bay', 'baybay', 'iyi calismalar',
  'iyi aksamlar iyi calismalar', 'kendine iyi bak', 'bye',
];

/**
 * Yetenek/tanitim sorulari.
 *
 * DIKKAT: Buraya tek basina "yardim" gibi genel bir sozcuk EKLENMEMELIDIR —
 * korpusta "dogum yardimi", "evlilik yardimi", "kres destegi" gibi gercek IK
 * konulari var ve bu tur sorular yanlislikla tanitim yaniti alirdi.
 * Bu yuzden kaliplar cok sozcuklu ve niyet belirtici tutulmustur.
 */
/**
 * "Ne konusuyorduk?" tipi meta sorular. Yanit oturum hafizasindan uretilir,
 * bu yuzden intent.service yalnizca TESPIT eder; metni chat.route kurar.
 */
export const RECAP_PATTERNS = [
  /^ne(ler)? konus(tuk|uyorduk|uyoruz)/,
  /^neden bahsed(iyorduk|iyoruz|ttik)/,
  /^ne hakk[ıi]nda konus(tuk|uyorduk)/,
  /^konumuz ne(ydi)?$/,
  /^ne sormustum$/,
  /^onceki soru(m|lar[ıi]m)?( ne(ydi)?)?$/,
  /^ozetle(r misin)?$/,
  /^hat[ıi]rl[ıi]yor musun/,
];

const CAPABILITY_PATTERNS = [
  /^(sen )?kimsin$/,
  /^(sen )?nesin$/,
  /^ne(ler)? (is )?yapars[ıi]n$/,
  /^ne(ler)? yapabilirsin$/,
  /^ne ise yarars[ıi]n$/,
  /^ne(ler)? biliyorsun$/,
  /^ne(ler)? sorabilirim$/,
  /^sana ne(ler)? sorabilirim$/,
  /^hangi konularda/,
  /^ne hakk[ıi]nda (bilgi|soru)/,
  /^nas[ıi]l kullan[ıi]l[ıi]r$/,
  /^nas[ıi]l kullanabilirim$/,
  /^yard[ıi]m menusu$/,
  /^konular[ıi]n neler$/,
  /^kapsam[ıi]n neler?$/,
  /^bana nas[ıi]l yard[ıi]mc[ıi] olabilirsin$/,
  /^neler yapabilirsin$/,
  /^help$/,
  /^what can you do$/,
];

const startsWithAny = (text: string, list: string[]) =>
  list.some((w) => text === w || text.startsWith(w + ' '));

function greetingResponse(): string {
  return (
    'Merhaba! Ben Kurumsal İK ve Mevzuat Asistanınızım. ' +
    'Şirket içi İK politikaları hakkındaki sorularınızı yanıtlıyorum — ' +
    'izinler, ücret ve yan haklar, işe alım, performans, disiplin, İSG ve KVKK gibi konularda.\n\n' +
    'Örnek: "Yıllık iznim kaç gün?" veya "Maaşlar hangi gün ödeniyor?"'
  );
}

function thanksResponse(): string {
  return 'Rica ederim! Başka bir konuda sorunuz olursa buradayım.';
}

function farewellResponse(): string {
  return 'İyi çalışmalar! İK ile ilgili başka sorunuz olursa tekrar bekleriz.';
}

/**
 * Yetenek yaniti canli indeksten beslenir: dokuman ve parca sayisi
 * veritabanindan okunur, boylece kapsam degistiginde metin de guncel kalir.
 */
function capabilityResponse(principal: Principal): string {
  let docCount = 0;
  let chunkCount = 0;
  try {
    docCount = listDocuments(principal).length;
    chunkCount = countChunks();
  } catch {
    /* indeks henuz olusmamis olabilir */
  }

  const scale =
    docCount > 0
      ? `Şu anda ${docCount} şirket içi mevzuat dokümanı (${chunkCount} bölüm) indekslenmiş durumda.`
      : 'Mevzuat dokümanları henüz indekslenmemiş.';

  return (
    'Ben şirket içi İK ve mevzuat asistanıyım. Yanıtlarımı yalnızca kurumsal doküman ' +
    `korpusundan üretir ve her yanıtta kaynak maddesini gösteririm. ${scale}\n\n` +
    'Cevap verebildiğim konular:\n' +
    '• Çalışma düzeni — mesai saatleri, molalar, fazla mesai, vardiya, nöbet\n' +
    '• İzinler — yıllık izin, mazeret izinleri, doğum/analık/babalık, hastalık raporu, ücretsiz izin\n' +
    '• Ücret ve yan haklar — maaş günü, avans, prim, yemek/yol, sağlık sigortası, kreş desteği, kıdem tazminatı\n' +
    '• İstihdam süreci — işe alım, deneme süresi, istifa, ihbar süreleri, çıkış işlemleri\n' +
    '• Performans ve gelişim — değerlendirme dönemleri, terfi, eğitim bütçesi\n' +
    '• Disiplin ve etik — disiplin kademeleri, devamsızlık, hediye politikası\n' +
    '• İSG ve sağlık — iş kazası bildirimi, koruyucu donanım, periyodik muayene\n' +
    '• Uyum ve işyeri ortamı — KVKK, veri saklama, mobbing, şikâyet kanalları, uzaktan çalışma\n\n' +
    'Bu kapsam dışındaki sorularda bilgi bulunmadığını belirtir, tahmin yürütmem.'
  );
}

/**
 * Sorguyu RAG hattina girmeden once siniflandirir.
 *
 * Amac: "selam" veya "ne is yaparsin" gibi sohbet/tanitim sorularinin, vektor
 * aramasindan gecip alaka kapisina takilarak resmi "bilgi bulunmamaktadir"
 * yanitini almasini onlemek. Kapsam disi GERCEK sorular icin fallback korunur.
 */
export function classifyIntent(message: string, principal: Principal): IntentResult {
  const text = normalize(message);
  if (!text) return { kind: 'rag' };

  const words = wordCount(text);

  // "Ne konusuyorduk?" — yanit oturum hafizasindan uretilecegi icin burada
  // yalnizca tur bildirilir, response bos birakilir.
  if (RECAP_PATTERNS.some((re) => re.test(text))) {
    return { kind: 'recap' };
  }

  // Yetenek sorulari (kalip bazli, uzunluktan bagimsiz).
  if (CAPABILITY_PATTERNS.some((re) => re.test(text))) {
    return { kind: 'capability', response: capabilityResponse(principal) };
  }

  // Selamlama / tesekkur / vedalasma: yalnizca kisa sorgularda.
  // Uzun cumleler (or. "merhaba yillik iznim kac gun") RAG'e gitmelidir.
  if (words <= 4) {
    if (startsWithAny(text, THANKS)) return { kind: 'thanks', response: thanksResponse() };
    if (startsWithAny(text, FAREWELLS)) return { kind: 'farewell', response: farewellResponse() };
    if (startsWithAny(text, GREETINGS)) return { kind: 'greeting', response: greetingResponse() };
  }

  return { kind: 'rag' };
}
