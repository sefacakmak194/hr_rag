/**
 * Konusma hafizasi ve takip sorusu cozumlemesi.
 *
 * SORUN: Her soru bagimsiz islendiginde "peki 10 yillik olsaydi?" gibi dogal
 * takip sorulari coker — sorguda konu gecmedigi icin retrieval alakasiz parca
 * getirir veya alaka kapisina takilir.
 *
 * COZUM: Oturum basina son turlar saklanir. Soru takip sorusu olarak tespit
 * edilirse, RETRIEVAL icin onceki soruyla birlestirilir (query rewriting).
 * Boylece hem vektor hem sozcuk aramasi konuyu görur. Uretim asamasinda da
 * son turlar LLM'e gecmis olarak verilir.
 *
 * Tespit deterministiktir (LLM cagrilmaz): takip sorulari Turkce'de belirgin
 * isaretler tasir — "peki", "ya", "o zaman", ya da konu ismi olmayan cok kisa
 * sorular.
 */

import { POLARITY_PAIRS, normalizePolarity } from './polarity.service.js';

export interface Citation {
  doc: string;
  section: string;
}

export interface Turn {
  question: string;
  /** Retrieval icin kullanilan (gerekirse yeniden yazilmis) sorgu. */
  resolvedQuestion: string;
  answer: string;
  citations: Citation[];
  at: number;
}

export interface Session {
  id: string;
  turns: Turn[];
  lastActive: number;
}

const MAX_TURNS = 20;
const MAX_SESSIONS = 100;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 saat

const sessions = new Map<string, Session>();

function prune(): void {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastActive > SESSION_TTL_MS) sessions.delete(id);
  }
  if (sessions.size > MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].lastActive - b[1].lastActive);
    for (const [id] of oldest.slice(0, sessions.size - MAX_SESSIONS)) sessions.delete(id);
  }
}

/**
 * Konusma hafizasinin anahtari KULLANICIYA baglanir.
 *
 * `sessionId` istemciden geliyor ve tarayici sekmesinde yasiyor. Tek basina
 * anahtar olarak kullanilinca iki delik aciliyordu:
 *
 *   1. Cikis yapilip ayni sekmede baska kullanici girdiginde sekmedeki
 *      sessionId degismedigi icin yeni kullanici oncekinin konusma gecmisini
 *      DEVRALIYORDU — ve takip sorusu cozumlemesi o gecmise bakiyor.
 *   2. sessionId baska bir yere dusrse (kayit, ekran goruntusu, ortak cihaz)
 *      sahibi olmayan biri gecmisi okuyabiliyordu.
 *
 * Kullanici KIMLIGIYLE ad alani ayirmak ikisini de kapatir: ayni sessionId
 * farkli kullanicilarda farkli oturuma duser. Ad degil kimlik kullanilir;
 * kullanici adi degistirilebilir ya da silinip yeniden acilabilir.
 */
export function sessionKey(userId: number, sessionId: unknown): string {
  const raw = typeof sessionId === 'string' && sessionId ? sessionId : 'default';
  return `${userId}:${raw}`;
}

export function getSession(id: string): Session {
  prune();
  let s = sessions.get(id);
  if (!s) {
    s = { id, turns: [], lastActive: Date.now() };
    sessions.set(id, s);
  }
  s.lastActive = Date.now();
  return s;
}

export function recordTurn(sessionId: string, turn: Omit<Turn, 'at'>): void {
  const s = getSession(sessionId);
  s.turns.push({ ...turn, at: Date.now() });
  if (s.turns.length > MAX_TURNS) s.turns.splice(0, s.turns.length - MAX_TURNS);
}

export function clearSession(id: string): void {
  sessions.delete(id);
}

// --------------------------------------------------------------- yardimcilar
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

/** Takip sorusunu ele veren baslangic ifadeleri. */
const FOLLOWUP_STARTERS = [
  'peki', 'ya', 'o zaman', 'ozaman', 'ayrica', 'bir de', 'birde',
  'peki ya', 'ondan', 'bunun', 'onun', 'sunun', 'bu durumda', 'ne olacak',
];

/**
 * Konu tasiyan isimler. Sorgu bunlardan birini iceriyorsa kendi basina anlamlidir
 * ve takip sorusu sayilmaz (yanlislikla onceki konuyla birlestirilmemeli).
 */
const TOPIC_NOUNS = [
  'izin', 'izni', 'mesai', 'maas', 'ucret', 'avans', 'prim', 'tazminat', 'ihbar',
  'kres', 'yemek', 'yol', 'sigorta', 'rapor', 'kaza', 'disiplin', 'terfi',
  'performans', 'egitim', 'butce', 'deneme', 'istifa', 'zimmet', 'mobbing',
  'kvkk', 'kamera', 'hediye', 'vardiya', 'nobet', 'dogum', 'analik', 'babalik',
  'sut', 'harcirah', 'masraf', 'otel', 'uzaktan', 'devamsizlik', 'referans',
];

const NUMBER_WORDS = [
  'bir', 'iki', 'uc', 'dort', 'bes', 'alti', 'yedi', 'sekiz', 'dokuz', 'on',
  'onbes', 'yirmi', 'otuz',
];

/**
 * Soru bir takip sorusu mu?
 *
 * DIKKAT — bu kural KASITLI OLARAK DARDIR. Ilk surumde "cok kisa VE bilinen
 * konu ismi icermiyor" yeterliydi; bu YAPISAL olarak hataliydi, cunku kapsam
 * DISI sorular tanimi geregi konu listesinde bulunmaz. Sonuc olarak "Ofise
 * evcil hayvan getirebilir miyim?" onceki soruyla birlestirilip kullaniciya
 * ihbar suresi cevabi donuyordu (olculdu). Genisletmeden once bunu hatirlayin.
 *
 * Simdiki kosullar:
 *   a) Belirgin takip ifadesiyle basliyor ("peki", "ya", "o zaman") VE yeni bir
 *      konu ismi tasimyor (yani konu degistirmiyor), YA DA
 *   b) Cok kisa (<= 3 kelime) VE bir SAYI iceriyor — tipik "delta" sorusu:
 *      "20 yillik?", "2 yillik olsam?"
 *
 * Oturumda onceki tur yoksa her zaman false.
 */
export function isFollowUp(message: string, session: Session): boolean {
  if (session.turns.length === 0) return false;

  const t = normalize(message);
  if (!t) return false;

  const words = t.split(' ');
  const topics = topicsIn(words);
  const hasNumber = /\d/.test(t) || words.some((w) => NUMBER_WORDS.includes(w));

  const startsWithMarker = FOLLOWUP_STARTERS.some((m) => t === m || t.startsWith(m + ' '));

  if (startsWithMarker) {
    // (a) Isaret var, konu ismi yok: "peki 10 yillik olsaydi?"
    if (topics.size === 0) return true;

    // (b) Isaret var VE konu ismi var. Burasi belirsiz bolge; ayirt edici olan
    //     ONCEKI SORUYLA ORTAK KONU TASIYIP TASIMADIGI.
    //
    //     "Annelikte ucretli izin ne kadar?" -> "peki ya ucretsiz izin"
    //        ortak konu: izin  => DEVAM. Birlestirilmezse "annelik" baglami
    //        kaybolur ve genel ucretsiz izin maddesi doner (olculdu).
    //
    //     "... ihbar suresi kac hafta?" -> "peki kres destegi ne kadar?"
    //        ortak konu yok => KONU DEGISIMI. Birlestirilirse onceki konu yeni
    //        cevaba bulasir (bu da olculdu, gercek bir hataydi).
    const previous = session.turns[session.turns.length - 1];
    const previousTopics = topicsIn(normalize(previous.question).split(' '));
    return [...topics].some((topic) => previousTopics.has(topic));
  }

  // (c) Kisa "delta" sorusu: sayi tasiyan, konusu olmayan cok kisa ifade.
  return words.length <= 3 && hasNumber && topics.size === 0;
}

/**
 * Metinde gecen konu isimlerini kanonik biciminde doner.
 *
 * DIKKAT — kanonlastirma sart: TOPIC_NOUNS hem "izin" hem "izni" iceriyor ve
 * ikisi de ayni konuyu gosteriyor. `find` listedeki ILK (yani en kisa kok)
 * eslesmeyi dondurdugu icin "izin" ve "izni" ayni sepete duser; aksi halde
 * "ucretli izin" ile "ucretsiz izin" ortak konu sayilmazdi.
 */
function topicsIn(words: string[]): Set<string> {
  const found = new Set<string>();
  for (const word of words) {
    const topic = TOPIC_NOUNS.find((n) => word.startsWith(n));
    if (topic) found.add(topic);
  }
  return found;
}

/**
 * Retrieval icin kullanilacak sorguyu uretir.
 * Takip sorusuysa onceki (cozumlenmis) soruyla birlestirilir; boylece konu
 * hem vektor hem BM25 tarafindan gorulur ve kademe hesaplayicisi da calisir.
 */
export function resolveQuery(message: string, session: Session): { query: string; rewritten: boolean } {
  if (!isFollowUp(message, session)) return { query: message, rewritten: false };

  const previous = session.turns[session.turns.length - 1];
  const base = previous.resolvedQuestion || previous.question;

  // (1) KUTUP DEGISIMI — en temiz durum.
  // "Annelikte ucretli izin ne kadar?" + "peki ya ucretsiz izin" sorusunda
  // yeni mesaj yalnizca bir terimi ZITTIYLA degistiriyor. Onceki soruda o
  // terimi yenisiyle degistirmek, kendi basina anlamli TEK bir soru uretir:
  // "Annelikte ucretsiz izin ne kadar?"
  //
  // Duz birlestirme burada yetmiyordu: birlesik sorgu hem "ucretli" hem
  // "ucretsiz" tasidigi icin ne retrieval ne kanit secimi ayirt edebiliyordu
  // ve model onceki cevabi tekrarliyordu (olculdu).
  const swapped = swapPolarity(base, message);
  if (swapped) return { query: swapped, rewritten: true };

  // (2) Genel durum: onceki soru + yeni soru. Yeni sorudaki sayilar/kisitlar
  // oncelik kazanir cunku hesaplayici ve retrieval en son gecen degeri alir.
  return { query: `${base} ${message}`, rewritten: true };
}

/**
 * Onceki soruda bir kutup terimini, yeni mesajdaki karsi ucuyla degistirir.
 *
 * Yalnizca su kosullarda calisir:
 *   - yeni mesaj bir kutup terimi tasiyor,
 *   - onceki soru AYNI ciftin diger ucunu tasiyor,
 *   - onceki soru yeni mesajdaki ucu HIC tasimiyor (yoksa degisim anlamsiz).
 *
 * Bulunamazsa null doner ve cagiran duz birlestirmeye duser.
 */
function swapPolarity(previousQuestion: string, message: string): string | null {
  const msg = ` ${normalizePolarity(message)} `;
  const prevNorm = ` ${normalizePolarity(previousQuestion)} `;

  for (const [a, b] of POLARITY_PAIRS) {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      // Yeni mesaj `to` ucunu, onceki soru `from` ucunu tasiyor mu?
      if (!msg.includes(` ${to}`) || msg.includes(` ${from}`)) continue;
      if (!prevNorm.includes(` ${from}`) || prevNorm.includes(` ${to}`)) continue;

      // Degisimi ORIJINAL metinde yap (buyuk/kucuk harf duyarsiz, Turkce
      // karakterler korunur). Sadelestirilmis bicim yalnizca tespit icindir.
      const pattern = new RegExp(escapeRegex(from), 'iu');
      const swapped = previousQuestion.replace(pattern, to);
      if (swapped !== previousQuestion) return swapped;

      // Orijinalde Turkce karakterli yazilmis olabilir ("ücretli"); bu durumda
      // sadelestirilmis eslesme tuttugu halde ham metinde bulunamaz. O zaman
      // sadelestirilmis soruyu kullanmak yeterlidir — retrieval icin gidiyor.
      return normalizePolarity(previousQuestion).replace(new RegExp(escapeRegex(from), 'u'), to);
    }
  }

  return null;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** LLM'e verilecek kisa gecmis (son N tur). */
export function recentHistory(session: Session, turns = 2): { role: 'user' | 'assistant'; content: string }[] {
  return session.turns.slice(-turns).flatMap((t) => [
    { role: 'user' as const, content: t.question },
    { role: 'assistant' as const, content: t.answer },
  ]);
}

/**
 * "Ne konusuyorduk?" sorusuna deterministik ozet uretir.
 * Kaynak dokumanlar ve sorulan sorular uzerinden kurulur; LLM cagrilmaz.
 */
export function summarizeSession(session: Session): string {
  if (session.turns.length === 0) {
    return 'Henüz bir konu konuşmadık. İK politikalarıyla ilgili sorunuzu yazabilirsiniz.';
  }

  const questions = session.turns.slice(-5).map((t) => t.question);

  const docs = new Map<string, number>();
  for (const t of session.turns) {
    for (const c of t.citations) {
      const pretty = c.doc.replace(/^\d+_/, '').replace(/\.md$/, '').replace(/_/g, ' ');
      docs.set(pretty, (docs.get(pretty) ?? 0) + 1);
    }
  }

  const topics = [...docs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d]) => d);

  let out = `Bu oturumda ${session.turns.length} soru konuştuk.\n\n`;
  out += 'Son sorularınız:\n';
  for (const q of questions) out += `• ${q}\n`;
  if (topics.length) {
    out += `\nDeğindiğimiz konular: ${topics.join(', ')}.`;
  }
  return out;
}
