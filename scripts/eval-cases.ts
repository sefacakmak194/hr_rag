/**
 * Degerlendirme vakalari ve uctan uca sorgu yardimcilari — PAYLASILAN modul.
 *
 * Iki tuketicisi var:
 *   eval-answers.ts   — tek yapilandirmayi olcer ve rapor eder
 *   compare-models.ts — ayni vakalari BIRDEN COK model ile kosturup karsilastirir
 *
 * Vakalarin tek bir yerde durmasi sarttir: karsilastirma ancak ayni vakalarla
 * anlamlidir.
 */
export interface EvalCase {
  id: string;
  group: string;
  question: string;
  /**
   * Asil sorudan ONCE ayni oturumda sorulacak turlar. Cok turlu davranisi
   * (hafiza + takip sorusu cozumlemesi) uctan uca olcmek icin kullanilir;
   * yalnizca son sorunun yaniti degerlendirilir.
   */
  context?: string[];
  /** Yanitta MUTLAKA gecmesi gereken ifadeler (hepsi aranir, buyuk/kucuk harf duyarsiz). */
  must: string[];
  /** Yanitta GECMEMESI gereken ifadeler (yaygin hatalar). */
  mustNot?: string[];
  /** Beklenen kaynak dokuman (metadata event'inden dogrulanir). */
  expectDoc?: string | null;
  /** Bilinen zor vaka — basarisizlik raporlanir ama toplam skoru dusurmez. */
  known?: string;
}

export const cases: EvalCase[] = [
  // --- sartname kabul sorulari ---
  {
    id: 'spec-1',
    group: 'Şartname',
    question: '5 yıllık çalışan kaç gün yıllık izin kullanabilir?',
    must: ['14 iş günü'],
    mustNot: ['26 iş günü', '20 iş günü'],
    expectDoc: '01_calisma_saatleri_ve_izinler.md',
    known:
      'Korpus "5 yıl dahil -> 14 iş günü" diyor; şartnamenin beklenen yanıtı ise 20. ' +
      'Küçük modeller sınır değerinde 20 diyor. Madde 3 (deterministik hesaplayıcı) bunu çözmeli.',
  },
  {
    id: 'spec-2',
    group: 'Şartname',
    question: 'Harcırah masraf fişlerimi kaç gün içinde yüklemeliyim?',
    must: ['5'],
    expectDoc: '03_harcirah_ve_masraf_politikalari.md',
  },
  {
    id: 'spec-3',
    group: 'Şartname',
    question: 'Şirket bana özel araç tahsisi yapıyor mu?',
    must: ['bilgi bulunmamaktadır'],
    expectDoc: null,
  },

  // --- sayisal olgular ---
  { id: 'num-1', group: 'Sayısal', question: 'Öğle molası kaç saat ve hangi saatler arasında?', must: ['12:30', '13:30'] },
  { id: 'num-2', group: 'Sayısal', question: 'Babalık izni kaç gün?', must: ['5'] },
  { id: 'num-3', group: 'Sayısal', question: 'Süt izni günde kaç saat?', must: ['1,5'] },
  { id: 'num-4', group: 'Sayısal', question: 'Analık izni toplam kaç hafta?', must: ['16'] },
  { id: 'num-5', group: 'Sayısal', question: 'Kreş desteği aylık ne kadar?', must: ['4.000'] },
  { id: 'num-6', group: 'Sayısal', question: 'Doğum yardımı ne kadar?', must: ['15.000'] },
  { id: 'num-7', group: 'Sayısal', question: 'Yemek kartına günlük ne kadar yükleniyor?', must: ['250'] },
  { id: 'num-8', group: 'Sayısal', question: 'Otel konaklama üst limiti gecelik ne kadar?', must: ['3.500'] },
  { id: 'num-9', group: 'Sayısal', question: 'Haftada kaç gün uzaktan çalışabilirim?', must: ['2'] },
  { id: 'num-10', group: 'Sayısal', question: 'İş kazası kaç gün içinde SGK\'ya bildirilir?', must: ['3'] },
  { id: 'num-11', group: 'Sayısal', question: 'Kamera kayıtları kaç gün saklanır?', must: ['30'] },
  { id: 'num-12', group: 'Sayısal', question: 'Deneme süresi kaç ay?', must: ['2'] },
  { id: 'num-13', group: 'Sayısal', question: 'Tedarikçiden en fazla kaç TL değerinde hediye kabul edilebilir?', must: ['1.000'] },
  { id: 'num-14', group: 'Sayısal', question: 'Yıllık kişisel gelişim bütçesi ne kadar?', must: ['25.000'] },
  { id: 'num-15', group: 'Sayısal', question: 'Gece vardiyası zammı yüzde kaç?', must: ['20'] },

  // --- kademeli/sinir vakalar (deterministik hesaplayici hedefi) ---
  { id: 'tier-1', group: 'Kademe', question: '3 yıllık çalışanın yıllık izni kaç gün?', must: ['14 iş günü'], mustNot: ['20 iş günü', '26 iş günü'] },
  { id: 'tier-2', group: 'Kademe', question: '10 yıllık çalışanın yıllık izni kaç gün?', must: ['20 iş günü'], mustNot: ['14 iş günü', '26 iş günü'] },
  { id: 'tier-3', group: 'Kademe', question: '20 yıllık çalışanın yıllık izni kaç gün?', must: ['26 iş günü'], mustNot: ['14 iş günü', '20 iş günü'] },
  { id: 'tier-4', group: 'Kademe', question: '2 yıllık çalışanın ihbar süresi kaç hafta?', must: ['6 hafta'] },
  { id: 'tier-5', group: 'Kademe', question: '5 aylık çalışanın ihbar süresi ne kadar?', must: ['2 hafta'] },

  // --- coklu olgu tasiyan maddeler: DOGRU KALEM secilmeli ---
  //
  // Bu grup, cumle duzeyinde kanit secimini (evidence.service.ts) olcer.
  // Hepsinde ilgili madde birden fazla sayisal olgu tasir; parca dogru
  // getirilse bile model yanlis olani secebilir. Korpusta bu yapida 25 bolum
  // var; asagidakiler en riskli olanlardir.
  { id: 'amb-1', group: 'Ayrım', question: 'Evlilik yardımı ne kadar?', must: ['10.000'], mustNot: ['15.000'] },
  { id: 'amb-2', group: 'Ayrım', question: 'Yol desteği aylık ne kadar?', must: ['1.500'], mustNot: ['250 TL'] },
  { id: 'amb-3', group: 'Ayrım', question: 'Yıllık toplam fazla mesai en fazla kaç saat olabilir?', must: ['270'], mustNot: ['40 saat'] },
  { id: 'amb-4', group: 'Ayrım', question: 'Bordro itirazımı kaç gün içinde yapmalıyım?', must: ['15'] },
  { id: 'amb-5', group: 'Ayrım', question: 'Referans primi ne kadar?', must: ['5.000'] },
  { id: 'amb-6', group: 'Ayrım', question: 'Olumsuz sonuçlanan aday başvuruları en fazla kaç yıl saklanır?', must: ['2 yıl'], mustNot: ['10 yıl'] },
  { id: 'amb-7', group: 'Ayrım', question: 'Özlük dosyaları kaç yıl saklanır?', must: ['10 yıl'] },
  { id: 'amb-8', group: 'Ayrım', question: 'Disiplin cezasına kaç iş günü içinde itiraz edebilirim?', must: ['7 iş günü'] },
  { id: 'amb-9', group: 'Ayrım', question: 'Savunma için çalışana en az kaç iş günü süre tanınır?', must: ['3 iş günü'] },
  { id: 'amb-10', group: 'Ayrım', question: 'Performans sonucuna kaç iş günü içinde itiraz edilir?', must: ['10 iş günü'] },
  { id: 'amb-11', group: 'Ayrım', question: 'Tehlikeli iş yerlerinde İSG eğitimi kaç yılda bir tekrarlanır?', must: ['2 yıl'], mustNot: ['3 yılda'] },
  { id: 'amb-12', group: 'Ayrım', question: 'Ücretsiz izin talebini en az kaç gün önce yapmalıyım?', must: ['15 gün'] },
  { id: 'amb-13', group: 'Ayrım', question: 'Sertifika programı sonrası kaç ay çalışma taahhüdü verilir?', must: ['24 ay'] },
  { id: 'amb-14', group: 'Ayrım', question: 'Sağlık raporunu bitiminden sonra kaç iş günü içinde yüklemeliyim?', must: ['3 iş günü'] },

  // --- cok turlu: hafiza ve takip sorusu cozumlemesi (uctan uca) ---
  { id: 'multi-1', group: 'Çok turlu', context: ['5 yıllık çalışanın yıllık izni kaç gün?'], question: 'peki 10 yıllık olsaydı?', must: ['20 iş günü'], mustNot: ['14 iş günü'] },
  { id: 'multi-2', group: 'Çok turlu', context: ['5 yıllık çalışanın yıllık izni kaç gün?'], question: 'ya 20 yıllık?', must: ['26 iş günü'] },
  { id: 'multi-3', group: 'Çok turlu', context: ['İstifa edersem ihbar süresi ne kadar?'], question: '2 yıllık olsam?', must: ['6 hafta'] },
  // Konu DEGISIMI: onceki konu yeni cevaba bulasmamali (gercek bir hataydi).
  { id: 'multi-4', group: 'Çok turlu', context: ['2 yıllık çalışanın ihbar süresi kaç hafta?'], question: 'Kreş desteği ne kadar?', must: ['4.000'], mustNot: ['ihbar'] },
  // Kapsam disi soru, onceki turla BIRLESTIRILMEMELI (gercek bir hataydi).
  { id: 'multi-5', group: 'Çok turlu', context: ['Babalık izni kaç gün?'], question: 'Ofise evcil hayvan getirebilir miyim?', must: ['bilgi bulunmamaktadır'], expectDoc: null },
  { id: 'multi-6', group: 'Çok turlu', context: ['Kreş desteği ne kadar?'], question: 'ne konuşuyorduk?', must: ['Kreş desteği'], expectDoc: null },

  // --- kapsam disi (reddedilmeli) ---
  { id: 'oos-1', group: 'Kapsam dışı', question: 'Ofise evcil hayvan getirebilir miyim?', must: ['bilgi bulunmamaktadır'], expectDoc: null },
  { id: 'oos-2', group: 'Kapsam dışı', question: 'Hisse senedi opsiyonu alabilir miyim?', must: ['bilgi bulunmamaktadır'], expectDoc: null },
  { id: 'oos-3', group: 'Kapsam dışı', question: 'İstanbul hava durumu nasıl?', must: ['bilgi bulunmamaktadır'], expectDoc: null },

  // --- sohbet ---
  { id: 'chat-1', group: 'Sohbet', question: 'selam', must: ['Merhaba'], expectDoc: null },
  { id: 'chat-2', group: 'Sohbet', question: 'ne iş yaparsın', must: ['İK'], expectDoc: null },
];

/**
 * Yazi ile yazilmis sayilar rakama cevrilir.
 *
 * NEDEN: model bazen "3 is gunu" yerine "uc is gunu" yaziyor. Icerik DOGRU,
 * yalnizca bicim farkli. Bunu basarisizlik saymak dogrulugu degil bicimi
 * olcmek olurdu. Yalnizca tam sozcuk eslesmesi yapilir ("birlikte" bozulmaz).
 */
const NUMBER_WORDS: Record<string, string> = {
  bir: '1', iki: '2', üç: '3', dört: '4', beş: '5', alti: '6', yedi: '7',
  sekiz: '8', dokuz: '9', on: '10', onbeş: '15', yirmi: '20', otuz: '30',
  kirk: '40', elli: '50',
};

/** Turkce sayi/metin karsilastirmasi icin sadelestirme. */
const norm = (s: string) => {
  let out = s
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .replace(/\s+/g, ' ');
  for (const [word, digit] of Object.entries(NUMBER_WORDS)) {
    out = out.replace(new RegExp(`(^|[^a-zçğöşü])${word}([^a-zçğöşü]|$)`, 'g'), `$1${digit}$2`);
  }
  return out;
};

export interface AskResult {
  answer: string;
  citations: { doc: string; section: string }[];
  seconds: number;
  error?: string;
  /** Bozuk yanit kalkani devreye girdi; metin mevzuat alintisiyla degistirildi. */
  replaced?: boolean;
}

/**
 * Her vaka IZOLE bir oturumda calisir.
 *
 * Onemli: ortak oturum kullanildiginda onceki vakanin konusu takip sorusu
 * cozumlemesi uzerinden bir sonrakine sizabiliyor. Bu gercek bir hatayi
 * ortaya cikardi; izolasyon hem dogru test hijyeni hem de o hatanin regresyon
 * korumasi icin gerekli.
 */
export async function ask(
  base: string,
  message: string,
  sessionId: string,
  /**
   * Oturum cerezi. Sprint 1'den beri `/api/chat` kimlik istiyor; cerez
   * verilmezse her vaka HTTP 401 alir (bkz. eval-auth.ts).
   */
  cookie?: string,
): Promise<AskResult> {
  const t0 = Date.now();
  try {
  // Zaman asimi: 7B CPU varyantinda tek yanit 60 sn'yi bulabiliyor. Sinirsiz
  // birakilirsa bozuk bir model karsilastirmayi sonsuza kadar bloke eder.
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ message, sessionId }),
    signal: AbortSignal.timeout(Number(process.env.EVAL_TIMEOUT_MS ?? 180_000)),
  });

  if (!res.ok || !res.body) {
    return { answer: '', citations: [], seconds: 0, error: `HTTP ${res.status}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event: string | null = null;
  let answer = '';
  let citations: { doc: string; section: string }[] = [];
  let error: string | undefined;
  let replaced = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const raw of lines) {
      const line = raw.replace(/\r$/, '');
      if (line.startsWith('event:')) { event = line.slice(6).trim(); continue; }
      if (!line.startsWith('data:')) { if (line === '') event = null; continue; }
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload);
        if (event === 'metadata') citations = parsed.citations ?? [];
        else if (event === 'error') error = parsed.error;
        else if (event === 'replace' && typeof parsed.text === 'string') {
          // BOZUK YANIT KALKANI devreye girdi (bkz. answerGuard.service).
          //
          // Bu olay ELE ALINMIYORDU ve olcum sessizce YANLIS seyi puanliyordu:
          // kullanici mevzuatin birebir alintisini goruyor, eval ise modelin
          // urettigi bozuk metni puanliyordu. Olculdu — "EnEnEnEn..." gibi
          // cikti eval raporuna dusuyor, arayuzde ise hic gorunmuyordu.
          answer = parsed.text;
          replaced = true;
        } else if (parsed.token) answer += parsed.token;
      } catch { /* kismi satir */ }
    }
  }

  return { answer, citations, seconds: (Date.now() - t0) / 1000, error, replaced };
  } catch (e) {
    return { answer: '', citations: [], seconds: (Date.now() - t0) / 1000, error: (e as Error).message };
  }
}


/**
 * Tek bir vakayi kosturur ve GECTI/KALDI kararini verir.
 *
 * Her vaka IZOLE oturumda calisir; cok turlu vakalarda hazirlik turlari ayni
 * oturumda once sorulur ve yalnizca son sorunun yaniti degerlendirilir.
 */
export interface CaseResult {
  ok: boolean;
  answer: string;
  seconds: number;
  citations: { doc: string; section: string }[];
  /** Bozuk yanit kalkani devreye girdi mi? */
  replaced?: boolean;
  /** Basarisizlik gerekceleri (bos ise gecti). */
  why: string[];
}

export async function runCase(base: string, c: EvalCase, cookie?: string): Promise<CaseResult> {
  const sessionId = `eval-${c.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  for (const warmup of c.context ?? []) await ask(base, warmup, sessionId, cookie);

  const r = await ask(base, c.question, sessionId, cookie);

  const a = norm(r.answer);
  const missing = c.must.filter((m) => !a.includes(norm(m)));
  const forbidden = (c.mustNot ?? []).filter((m) => a.includes(norm(m)));

  let docOk = true;
  if (c.expectDoc === null) docOk = r.citations.length === 0;
  else if (c.expectDoc) docOk = r.citations.some((x) => x.doc === c.expectDoc);

  /**
   * BAGLAM SIZINTISI — her vaka icin gecerli evrensel kural.
   *
   * Model bazen baglamin YAPISINI cevabina kopyaliyor: dosya adi, koseli
   * parantezli baslik ya da isaret satiri. Deger dogru oldugu icin normal
   * iddialar bunu YAKALAMIYORDU (olculdu: ">> CEVAP CÜMLESİ: 17_is_sagligi…"
   * yaniti amb-11'i geciriyordu). Bu yuzden ayri bir kural olarak aranir.
   */
  const leaks = ['.md', '.pdf', 'cevap cümlesi', 'tam metin:', '[0', '[1'].filter((m) =>
    a.includes(norm(m)),
  );

  const why: string[] = [];
  if (r.error) why.push(`hata: ${r.error}`);
  if (missing.length) why.push(`eksik: ${missing.join(', ')}`);
  if (forbidden.length) why.push(`yasak ifade: ${forbidden.join(', ')}`);
  if (leaks.length) why.push(`baglam sizintisi: ${leaks.join(', ')}`);
  if (!docOk) {
    why.push(`kaynak beklenen "${c.expectDoc}" degil: ${r.citations.map((x) => x.doc).join(', ') || '(yok)'}`);
  }

  return {
    ok: why.length === 0,
    answer: r.answer,
    seconds: r.seconds,
    citations: r.citations,
    replaced: r.replaced,
    why,
  };
}

/**
 * Vaka LLM'e gidiyor mu?
 *
 * Kademe hesaplayicisi, niyet katmani ve alaka kapisi LLM'i HIC cagirmaz;
 * bu vakalarin sonucu model degisiminden etkilenmez. Model karsilastirmasinda
 * yalnizca LLM'e giden vakalar ayirt edicidir.
 */
export const isLlmCase = (c: EvalCase): boolean => !BYPASS_IDS.has(c.id);

/**
 * LLM'e HIC ulasmayan vakalar (48 vakanin 17'si).
 *
 * DIKKAT — bu liste GRUP adindan turetilemez. Ornegin "Şartname" grubunda
 * spec-1 kademe hesaplayicisina, spec-3 alaka kapisina takilir ve LLM'e
 * gitmezken spec-2 gider. Grup bazli tahmin, karsilastirmada LLM vaka sayisini
 * 33 gosteriyordu; dogrusu 31.
 *
 * Dogrulama: bu vakalarin olculen suresi her modelde 0.0 sn'dir.
 */
const BYPASS_IDS = new Set([
  'spec-1', // kademe hesaplayicisi
  'spec-3', // alaka kapisi
  'tier-1', 'tier-2', 'tier-3', 'tier-4', 'tier-5', // kademe hesaplayicisi
  'oos-1', 'oos-2', 'oos-3', // alaka kapisi
  'chat-1', 'chat-2', // niyet katmani
  'multi-1', 'multi-2', 'multi-3', // takip sorusu -> kademe hesaplayicisi
  'multi-5', // takip degil, kapsam disi -> alaka kapisi
  'multi-6', // "ne konusuyorduk" -> oturum ozeti
]);
