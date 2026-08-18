import { Router, type Request, type Response } from 'express';
import { generateQueryEmbedding } from '../services/embedding.service.js';
import { queryTopKChunks, findSectionText } from '../services/vectorStore.service.js';
import { classifyIntent } from '../services/intent.service.js';
import { calculatePolicyAnswer } from '../services/policyCalculator.service.js';
import { selectEvidence } from '../services/evidence.service.js';
import { rerankByPolarity } from '../services/polarity.service.js';
import { expandQuery } from '../services/synonym.service.js';
import { inspectAnswer } from '../services/answerGuard.service.js';
import {
  getSession,
  recordTurn,
  clearSession,
  resolveQuery,
  summarizeSession,
} from '../services/conversation.service.js';
import {
  streamFromFoundryLocal,
  FoundryOfflineError,
} from '../services/foundryClient.service.js';
import {
  TOP_K,
  SIMILARITY_THRESHOLD,
  NO_CONTEXT_RESPONSE,
  SYSTEM_PROMPT_RULES,
  EVIDENCE_FOCUS,
  EVIDENCE_ONLY,
} from '../config/constants.js';

const router = Router();

/**
 * Yanitin BASINDA gorulen baglam kirintilari.
 *
 * Yalnizca bastan eslesir (`^`): metnin ortasinda gecen bir dosya adi ya da
 * koseli parantez kirpilmaz. Tekrarli (`+`) cunku model bazen hem isaret
 * satirini hem basligi ust uste kopyaliyor.
 */
const LEAK_PREFIX =
  /^(?:[\s>]*(?:CEVAP CÜMLESİ\s*:|TAM METİN\s*:|\[[^\]\n]{1,120}\]\s*:?|[\w.\-]+\.(?:md|pdf)[^:\n]{0,80}:)\s*){1,3}/i;

/**
 * Yanitin ORTASINDA baslayan baglam kopyasi. Bu ifadeler gecerli bir yanitta
 * asla bulunmaz; goruldugu yerde metin KESILIR (olculdu: "Deneme suresi kac
 * ay?" sorusunda model once dogru cevabi verip ardindan tum bolumu
 * "TAM METİN:" basligiyla yeniden yaziyordu).
 */
const LEAK_CUT = /(?:>>\s*)?CEVAP CÜMLESİ\s*:|TAM METİN\s*:|\[[\w.\-]+\.(?:md|pdf)\b/i;

/** Onek/kesme kaliplari tamamlanana kadar tutulan tampon uzunluklari. */
const LEAK_HEAD = 120;
const LEAK_TAIL = 24;

/** Bozuk yanit yerine gosterilecek mevzuat alintisini kurar. */
function firstSentences(text: string, count: number): string {
  const body = text.replace(/^[^\n]*\n/, ''); // bolum basligi satirini at
  const parts = body.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  return parts.slice(0, count).join(' ').trim() || body.trim();
}

/** Oturumu sifirlar ("yeni sohbet"). */
router.post('/session/reset', (req: Request, res: Response) => {
  const { sessionId } = req.body ?? {};
  if (typeof sessionId === 'string' && sessionId) clearSession(sessionId);
  res.json({ ok: true });
});

router.post('/chat', async (req: Request, res: Response) => {
  const { message, sessionId } = req.body ?? {};

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Sorgu boş olamaz.' });
  }

  // SSE Header Kurulumu
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (data: unknown, event?: string) => {
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const session = getSession(typeof sessionId === 'string' && sessionId ? sessionId : 'default');

  /**
   * "Dayanak" blogu — yanitin altinda gosterilen TAM madde metni.
   *
   * NEDEN KODDAN: kullanici daha detayli yanit istiyor, ama modelden detay
   * istemek 1.5B olcekte cevabi BOZUYOR (bkz. constants, 2. kural notu).
   * Detayi mevzuat metninin kendisinden vermek hem daha kapsamli hem de
   * halusinasyon riski sifir — metin birebir, uretilmis degil.
   */
  const sendDetails = (citations: { doc: string; section: string }[]) => {
    if (!citations.length) return;

    const [primary, ...rest] = citations;
    const text = findSectionText(primary.doc, primary.section);
    if (!text) return;

    send(
      {
        primary: { doc: primary.doc, section: primary.section, text },
        related: rest.map((c) => ({ doc: c.doc, section: c.section })),
      },
      'details',
    );
  };

  /** Hazir (LLM'siz) yaniti gonderip turu hafizaya yazar. */
  const respondDirectly = (
    text: string,
    citations: { doc: string; section: string }[],
    meta: Record<string, unknown>,
    resolvedQuestion: string,
  ) => {
    send({ citations, ...meta }, 'metadata');
    send({ token: text });
    sendDetails(citations);
    res.write('data: [DONE]\n\n');
    recordTurn(session.id, { question: message, resolvedQuestion, answer: text, citations });
    return res.end();
  };

  try {
    // 0. Niyet siniflandirmasi (deterministik, LLM'siz).
    // Selamlama ve tanitim sorulari RAG hattina hic girmez; aksi halde alaka
    // kapisina takilip resmi "bilgi bulunmamaktadir" yanitini alirlardi.
    const intent = classifyIntent(message);

    // "Ne konusuyorduk?" — yanit oturum hafizasindan deterministik uretilir.
    if (intent.kind === 'recap') {
      return respondDirectly(summarizeSession(session), [], { intent: 'recap' }, message);
    }

    if (intent.kind !== 'rag' && intent.response) {
      return respondDirectly(intent.response, [], { intent: intent.kind }, message);
    }

    // 0a. Takip sorusu cozumlemesi.
    // "peki 10 yillik olsaydi?" gibi sorular kendi baslarina anlamsizdir;
    // retrieval ve hesaplama icin onceki soruyla birlestirilir.
    const { query, rewritten } = resolveQuery(message, session);

    // 0b. Kademeli politika hesabi (deterministik, LLM'siz).
    // Kucuk modeller sayisal kademe muhakemesinde sistematik hata yapiyor;
    // cevap kodla hesaplanir, kaynak maddesi yine gosterilir.
    const policy = calculatePolicyAnswer(query);
    if (policy) {
      return respondDirectly(
        policy.answer,
        [{ doc: policy.citation.doc, section: policy.citation.section }],
        { computed: policy.tableId, rewritten },
        query,
      );
    }

    // 0c. Esanlam genisletmesi. Kullanicinin kelimesi mevzuatin kelimesi
    // olmayabilir ("annelik" korpusta hic gecmiyor, "analik" geciyor).
    // Orijinal ifade korunur, mevzuat karsiligi eklenir. Bkz. synonym.service.
    const searchQuery = expandQuery(query);

    // 1. Sorguyu vektorlestir (yerel embedding)
    const queryVector = await generateQueryEmbedding(searchQuery);

    // 2. Yerel veritabanindan Top-K parcalari getir (hibrit: vektor + BM25)
    const retrieved = queryTopKChunks(queryVector, TOP_K, SIMILARITY_THRESHOLD, searchQuery);

    // 2a. Kutupluluga gore yeniden sirala (alaka kapisindan SONRA, hicbir parca
    // elenmeden). "ucretli" sorgusu "ucretsiz" maddesini one cikariyordu;
    // embedding bu tek morfem farkini gormuyor. Bkz. polarity.service.
    const contextChunks = rerankByPolarity(retrieved, searchQuery);

    // 2b. Cumle duzeyinde kanit secimi.
    // Parca dogru olsa bile icinde birden fazla olgu varsa kucuk model yanlis
    // olani seciyor; soruyla en ilgili cumle deterministik olarak isaretlenir.
    // Kanit secimi ONCE kullanicinin YENI mesajiyla denenir, sonra birlestirilmis
    // sorguyla. Sebep: takip sorusunda birlestirilmis sorgu hem eski hem yeni
    // terimi tasir ("... ucretli izin ne kadar? peki ya ucretsiz izin") ve ayirt
    // edici olan tam da o farktir. Yeni mesaj tek basina anlamsizsa
    // ("peki 10 yillik?") secim bos doner ve birlestirilmis sorguya dusulur.
    const evidences = contextChunks.map((c) => {
      if (!EVIDENCE_FOCUS) return null;
      return (
        selectEvidence(c.content, expandQuery(message), { heading: c.section }) ??
        selectEvidence(c.content, searchQuery, { heading: c.section })
      );
    });

    // 3. Istemciye kaynak bilgisi metadata event'ini gonder.
    // Secilen kanit cumlesi de gonderilir; arayuz alintiyi metinle gosterir.
    const citations = contextChunks.map((c, i) => ({
      doc: c.docTitle,
      section: c.section,
      score: Number(c.score.toFixed(4)),
      evidence: evidences[i]?.sentence,
    }));
    send({ citations, threshold: SIMILARITY_THRESHOLD, rewritten }, 'metadata');

    // 3b. Halusinasyon engelleme: esigi gecen hicbir baglam yoksa LLM'e hic gitme.
    if (contextChunks.length === 0) {
      send({ token: NO_CONTEXT_RESPONSE });
      res.write('data: [DONE]\n\n');
      recordTurn(session.id, {
        question: message,
        resolvedQuestion: query,
        answer: NO_CONTEXT_RESPONSE,
        citations: [],
      });
      return res.end();
    }

    // 4. Baglam olustur ve Foundry Local'e ilet
    const contextText = contextChunks
      .map((c, i) => {
        // EN ILGILI BOLUM acikca etiketlenir. Butun bloklar ayni gorundugunde
        // model bazen ikinci ya da ucuncu bolumden yanitliyordu (olculdu:
        // "Emzirme icin izin var mi?" -> Sut Izni birinci sirada oldugu halde
        // "Yeni Is Arama Izni" maddesinden cevap).
        const head = i === 0
          ? `[EN İLGİLİ BÖLÜM — ${c.docTitle} - ${c.section}]`
          : `[${c.docTitle} - ${c.section}]`;
        const hit = evidences[i];
        if (!hit) return `${head}: ${c.content}`;

        // YAN CUMLEYE INILDIYSE tam metin verilmez. Bu yol yalnizca rakip deger
        // AYNI cumlede oldugunda calisir; tam metin birakildiginda model yanlis
        // olani aliyordu (olculdu: "tehlikeli is yerlerinde" sorusuna, metinde
        // "az tehlikeli ... 3 yilda bir" gectigi icin 3 cevabi). Alinti yine
        // maddeye isaret eder, arayuz de secilen cumleyi gosterir.
        //
        // Yan cumleye inildiyse blok AYNI YAPIYI korur, yalnizca tam metin
        // verilmez (rakip deger zaten o metnin icinde).
        //
        // Iki alternatif denendi ve GERI ALINDI:
        //   - Basliksiz, ciplak cumle: alt siradaki parcalarin yan cumleleri de
        //     "ciplak olgu" haline geldi, sonda yer aldiklari icin one gecip
        //     kazandilar (olculdu: "Sertifika sonrasi kac ay?" -> Mentorluk
        //     maddesindeki "program suresi 6 aydir").
        //   - `[baslik]: cumle` tek satir: model satiri oldugu gibi ya da
        //     basligi tek basina kopyaladi.
        // Yapiyi her yerde ayni tutmak, 9. prompt kuralinin de her blokta
        // ayni sekilde islemesini sagliyor. Kopyalama egilimi prompt'la degil,
        // sunucudaki sizinti kalkaniyla cozulur.
        if (hit.narrowed) return `${head}\n>> CEVAP CÜMLESİ: ${hit.sentence}`;

        // Isaret parcanin BASINA konur. Olculdu: sona konuldugunda 1.5B model
        // yok sayip bolumun ILK sayisini aliyordu ("dogum yardimi" -> 10.000).
        return EVIDENCE_ONLY
          ? `${head}\n>> CEVAP CÜMLESİ: ${hit.sentence}`
          : `${head}\n>> CEVAP CÜMLESİ: ${hit.sentence}\nTAM METİN: ${c.content}`;
      })
      .join('\n\n');

    // Bu noktaya yalnizca alaka kapisi acildiginda gelinir: baglam kesinlikle mevcut
    // ve konuyla ilgilidir. Prompt'a "bilgi yoksa ..." talimati EKLENMEZ (bkz. constants).
    // Takip sorusunda konu bilgisi SISTEM promptuna yazilir, kullanici turuna
    // degil. Gecmis turlari `history` olarak gondermek denendi ve kucuk model
    // bunu "onceki cevabi tekrarla" diye okudu (olculdu: "peki ya ucretsiz
    // izin" sorusuna yine "16 hafta" yaniti).
    const followUpNote = rewritten
      ? `\nKONU BİLGİSİ: Kullanıcı az önce "${session.turns[session.turns.length - 1]?.question}" diye sordu. Şimdiki soru bunun devamıdır ve aynı konu başlığındadır. Şimdiki soruyu yanıtla; önceki sorunun cevabını tekrarlama.\n`
      : '';

    const systemPrompt = `Sen bir Kurumsal İK ve Şirket Mevzuat Asistanısın. Aşağıdaki BAĞLAM, kullanıcının sorusuyla ilgili şirket mevzuatından alınmıştır ve sorunun cevabını içerir.

BAĞLAM:
${contextText}
${followUpNote}
${SYSTEM_PROMPT_RULES}`;

    // 5. Foundry Local uzerinden Stream ile yaniti ilet.
    //
    // TAKIP SORUSUNDA GECMIS MESAJ OLARAK VERILMEZ, soruya YAZILIR.
    //
    // Once gecmis turlar `history` olarak gonderiliyordu; kucuk model bunu
    // "onceki cevabi tekrarla" diye okuyordu — olculdu: "Annelikte ucretli izin
    // ne kadar?" ardindan "peki ya ucretsiz izin" sorulunca dogru madde
    // getirildigi halde model yine "16 hafta" dedi. Onceki soruyu acikca
    // etiketleyip yeni soruyu isaret etmek bu tekrari kesiyor.
    // Kullanici turu KISA tutulur; baglam bilgisi sistem promptuna yazilir.
    // Iki parcali bir kullanici mesaji ("Onceki sorum ... Simdiki sorum ...")
    // denendi ve 1.5B model yanitini iki kez yazmaya basladi.
    const stream = streamFromFoundryLocal(systemPrompt, message, []);

    // SIZINTI KALKANI.
    //
    // Kucuk model bazen baglamin YAPISINI cevabina kopyaliyor: isaret satirini,
    // "TAM METİN:" basligini ya da koseli parantezli dosya adini. Deger dogru
    // oldugu icin bu gozden kacabiliyor. Prompt kuraliyla engellenemedi —
    // kural eklendi, davranis degismedi (bkz. constants, 10. kural).
    //
    // Akis korunarak temizlenir: onek kaliplari tamamlansin diye ilk
    // LEAK_HEAD karakter, kesme kalibi token sinirinda bolunmesin diye de son
    // LEAK_TAIL karakter tamponda bekletilir.
    let raw = '';
    let sent = 0;
    let cut = false;

    const pump = (final: boolean) => {
      if (!final && raw.length < LEAK_HEAD) return;

      let text = raw.replace(LEAK_PREFIX, '');
      const hit = text.match(LEAK_CUT);
      if (hit) {
        text = text.slice(0, hit.index).trimEnd();
        cut = true;
      }

      const upto = final || cut ? text.length : Math.max(0, text.length - LEAK_TAIL);
      if (upto > sent) {
        send({ token: text.slice(sent, upto) });
        sent = upto;
      }
      return text;
    };

    // BOZUK YANIT KALKANI — akis sirasinda calisir.
    //
    // Kucuk model bazen anlamsiz metin uretiyor (bkz. answerGuard.service).
    // Tespit akis sirasinda yapilir ki kullanici uzun bir sacmalik izlemesin;
    // sonra `replace` olayiyla yerine mevzuatin BIREBIR metni gonderilir.
    let degenerate: string | null = null;

    for await (const token of stream) {
      raw += token;
      pump(false);
      if (cut) break;

      if (!degenerate && raw.length > 60) {
        const verdict = inspectAnswer(raw);
        if (verdict.degenerate) {
          degenerate = verdict.reason ?? 'bozuk uretim';
          break;
        }
      }
    }

    let answer = pump(true) ?? '';

    if (!degenerate) {
      const verdict = inspectAnswer(answer);
      if (verdict.degenerate) degenerate = verdict.reason ?? 'bozuk uretim';
    }

    if (degenerate) {
      // Uretilmis metin yerine mevzuatin kendisi. Halusinasyon riski yok:
      // bu cumle korpustan birebir okunur.
      const source = evidences[0]?.sentence ?? firstSentences(contextChunks[0].content, 2);
      answer = `Mevzuat metni şu şekildedir: "${source}"`;
      console.warn(`[Bozuk yanit] ${degenerate} — mevzuat metnine dusuldu.`);
      send({ text: answer, reason: degenerate }, 'replace');
    }

    if (!answer) {
      answer = NO_CONTEXT_RESPONSE;
      send({ token: answer });
    }

    sendDetails(citations);
    res.write('data: [DONE]\n\n');
    recordTurn(session.id, {
      question: message,
      resolvedQuestion: query,
      answer,
      citations: citations.map((c) => ({ doc: c.doc, section: c.section })),
    });
    res.end();
  } catch (error) {
    console.error('Chat Error:', error);

    const offline = error instanceof FoundryOfflineError;
    send(
      {
        error: offline
          ? (error as Error).message
          : 'İşlem sırasında bir hata oluştu.',
        code: offline ? 'FOUNDRY_OFFLINE' : 'INTERNAL',
      },
      'error',
    );
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

export default router;
