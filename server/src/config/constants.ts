import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/**
 * Paketlenmis (.exe) modda mi calisiyoruz?
 * SEA icinde kaynak dosya yollari anlamsizdir; her sey exe'nin yanindadir.
 */
export const IS_PACKAGED = (() => {
  if (process.env.PHR_PACKAGED === '1') return true;
  try {
    // node:sea yalnizca paketlenmis calistirmada true doner.
    const req = createRequire(import.meta.url);
    const sea = req('node:sea') as { isSea?: () => boolean };
    return sea.isSea?.() === true;
  } catch {
    return false;
  }
})();

/**
 * Veri kokii.
 * - Gelistirme : depo kokii (server/src/config -> ../../..)
 * - Paketlenmis: .exe'nin bulundugu dizin
 */
export const REPO_ROOT = IS_PACKAGED
  ? path.dirname(process.execPath)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Paketlenmis modda `.env.local`'i kod icinde yukle.
 * Gelistirmede bunu `tsx --env-file-if-exists=../.env.local` yapar; SEA exe'de
 * ise boyle bir bayrak gecirilemedigi icin dosya elle okunur. Bu yapilmazsa
 * FOUNDRY_MODEL sabitlemesi kaybolur ve yanlis (bozuk) varyant secilebilir.
 *
 * NOT: Bu cagri mutlaka process.env okuyan sabitlerden ONCE gelmelidir.
 */
if (IS_PACKAGED) {
  const envFile = path.join(REPO_ROOT, '.env.local');
  try {
    if (fs.existsSync(envFile)) {
      process.loadEnvFile(envFile);
    }
  } catch (error) {
    console.warn(`  .env.local okunamadi: ${(error as Error).message}`);
  }
}

/**
 * Korpus dizini. CORPUS_DIR ile degistirilebilir; boylece ayni hat PDF korpusu
 * uzerinde de dogrulanabilir (bkz. `npm run ingest:pdf`).
 */
export const CORPUS_DIR = process.env.CORPUS_DIR
  ? path.resolve(process.env.CORPUS_DIR)
  : path.join(REPO_ROOT, 'data', 'corpus');
/**
 * Ileri tarihli (bekleyen) surumlerin bekleme dizini — Sprint 2.
 *
 * NEDEN AYRI DIZIN: korpus dizini her zaman YURURLUKTEKI metni icermelidir.
 * 1 Eylul'de yururluge girecek bir yonerge bugunden korpusa konsaydi, sistem
 * henuz yururlukte olmayan bir kurala gore cevap verirdi. Yururluk tarihi
 * gelince dosya buradan korpusa TASINIR (bkz. corpusSync.service).
 *
 * CORPUS_DIR'den turetilir: testler korpusu degistirdiginde bekleme dizini de
 * kendiliginden yalitilir.
 */
export const PENDING_DIR = process.env.PENDING_DIR
  ? path.resolve(process.env.PENDING_DIR)
  : path.join(path.dirname(CORPUS_DIR), `${path.basename(CORPUS_DIR)}-pending`);

/**
 * Vektor veritabani. CORPUS_DIR gibi ortam degiskeniyle degistirilebilir —
 * dokuman yukleme gibi indeksi YENIDEN KURAN akislari, gercek korpusa
 * dokunmadan ayri bir kopyada denemek icin gerekli.
 */
export const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(REPO_ROOT, 'data', 'vectors.db');

/**
 * Calisma aninda modul yukleyen tek nokta.
 *
 * DIKKAT — paketlenmis (SEA) modda `createRequire(__filename)` EXE'nin kendisini
 * temel alir ve `runtime/node_modules` altindaki paketleri BULAMAZ. Olculdu:
 * DOCX yuklemesi "Cannot find module 'mammoth'", taranmis PDF ise
 * "Cannot find module 'pdfjs-dist/...'" ile 400 donuyordu — ustelik PDF hatasi
 * uzun suredir sessizce oradaydi, cunku paketle birlikte hazir bir vectors.db
 * geldigi icin PDF okuma yolu hic calismiyordu.
 *
 * Paketleme betigi de ayni capayi kullanir (runtime/noop.js).
 */
export const moduleRequire = createRequire(
  IS_PACKAGED
    ? path.join(REPO_ROOT, 'runtime', 'noop.js')
    : fileURLToPath(import.meta.url),
);

/** Paketlenmis modda derlenmis React arayuzunun servis edilecegi dizin. */
export const PUBLIC_DIR = path.join(REPO_ROOT, 'public');

/** Arayuz derlenmis olarak yaninda duruyor mu? */
export const HAS_STATIC_UI = fs.existsSync(path.join(PUBLIC_DIR, 'index.html'));

/**
 * Foundry Local: OpenAI uyumlu yerel REST uç noktası.
 *
 * Sartname sabit `http://localhost:5272/v1` varsayar; Foundry Local 0.10+ ise
 * daemon'a HER BASLATMADA rastgele bir port atar (or. 127.0.0.1:57617).
 * Bu yuzden uc nokta calisma aninda `foundry server status -o json` ile kesfedilir.
 * Asagidaki override verilirse kesif atlanir.
 */
export const FOUNDRY_BASE_URL_OVERRIDE = process.env.FOUNDRY_BASE_URL ?? null;

/** Kesif basarisiz olursa denenecek sartname varsayilani. */
export const FOUNDRY_FALLBACK_BASE_URL = 'http://localhost:5272/v1';

/**
 * Varsayilan model — SECIM OLCULDU, sezgiyle belirlenmedi.
 *
 * `npm run compare`, 48 vaka, sicaklik 0 (data/MODEL-KARSILASTIRMA.md):
 *
 *   qwen2.5-1.5b-instruct-cuda-gpu    47/48   ort  0.4s   en yavas  1.4s
 *   qwen2.5-7b-instruct-generic-cpu   48/48   ort 26.0s   en yavas 58.1s
 *   qwen3.5-2b-text-cuda-gpu          31/48   ort  3.6s   en yavas 12.5s
 *   Phi-3.5-mini-instruct-cuda-gpu    41 vakada 13 hata (tamamlanamadi)
 *
 * 7B tam puan aliyor ama en yavas vakasi 58 saniye — urun olarak sunulamaz.
 * 1.5B tek vaka farkla 65 kat hizli; secim bu.
 *
 * Onceki varsayilan `phi-3.5-mini` idi ve olcumde EN KOTU cikan modeldi;
 * .env.local her makinede ezdigi icin fark edilmemisti.
 *
 * Takma ad yerine TAM VARYANT KIMLIGI veriliyor: /v1/models onbellekteki tum
 * varyantlari listeler ve makineye gore bir kismi bozuktur (olculdu:
 * qwen3.5-2b-text-cuda-gpu bu makinede Turkce karakterlerde cokuyor).
 */
export const FOUNDRY_MODEL = process.env.FOUNDRY_MODEL ?? 'qwen2.5-1.5b-instruct-cuda-gpu';

/** Backend portu. 5272 Foundry Local'e ait olduğu icin 5273 kullanilir. */
export const SERVER_PORT = Number(process.env.PORT ?? 5273);

/**
 * Yerel embedding modeli (transformers.js / ONNX Runtime - tamamen on-device).
 * Sartname bge-small-en / MiniLM oneriyor; korpus ve sorgular Turkce oldugu icin
 * cok dilli E5 varyanti kullanilir (384 boyut, Turkce destekli).
 */
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? 'Xenova/multilingual-e5-small';
export const EMBEDDING_DIM = 384;

/** E5 ailesi asimetrik prefix bekler. */
export const E5_QUERY_PREFIX = 'query: ';
export const E5_PASSAGE_PREFIX = 'passage: ';

/** Chunking parametreleri (sartname: 300-400 token, ~%15 overlap). */
export const CHUNK_SIZE = 350;
export const CHUNK_OVERLAP = 50;

/** Retrieval parametreleri. */
export const TOP_K = Number(process.env.TOP_K ?? 3);

/**
 * Alaka kapisi (relevance gate) — mutlak esik.
 *
 * Sartname 0.65 mutlak esik onerir; bu deger embedding modeline baglidir ve
 * E5 ailesi icin gecersizdir: E5 kosinus skorlarini dar bir banda sikistirdigindan
 * 0.65 her sorguyu gecirir ve halusinasyon engellemesi cokerdi.
 *
 * scripts/calibrate.ts, 94 parcalik korpusta 34 kapsam-ici / 10 kapsam-disi sorgu ile
 * hibrit skor uzerinden secildi:
 *   w=0.00 (salt vektor) : ici-min 0.8499  dis-maks 0.8404  bosluk 0.0096
 *   w=0.05 (SECILEN)     : ici-min 0.8408  dis-maks 0.8230  bosluk 0.0179  <- 1.9x
 *   w>=0.15              : ORTUSUYOR (bosluk negatif)
 *
 * DIKKAT — bosluk hala dar (0.0179). Korpus her degistiginde yeniden kalibre edin.
 */
export const SIMILARITY_THRESHOLD = Number(process.env.SIMILARITY_THRESHOLD ?? 0.832);

/**
 * Goreli marj kapisi — VARSAYILAN OLARAK KAPALI (0).
 *
 * 9 parcalik ilk korpusta "top - korpus ortalamasi" temiz ayirici idi (0.0441 vs
 * 0.0323) ve ikinci asama olarak kullaniliyordu. Korpus 93 parcaya cikinca olcut
 * COKTU: korpus cesitlendikce ortalama duser ve marj TUM sorgular icin sisar;
 * artik kapsam-ici min (0.0427) kapsam-disi maks (0.0491) altinda kaliyor.
 * Acik birakilmasi gercek IK sorularini yanlislikla reddediyordu.
 *
 * Yani bu olcut korpus BUYUKLUGUNE duyarlidir. Yeniden acmadan once mutlaka
 * scripts/calibrate.ts ile ayirici oldugunu dogrulayin.
 */
export const RELEVANCE_MARGIN = Number(process.env.RELEVANCE_MARGIN ?? 0);

/**
 * Hibrit arama: nihai skor = (1 - w) * kosinus + w * BM25_normalize
 *
 * w = 0 salt vektor aramasi demektir. Sozcuk bileseni kapsam disi sorgularda
 * genelde ~0 kalarak fuzyon skorunu asagi ceker ve ayrim bosluğunu genisletir.
 *
 * OLCUM (scripts/calibrate.ts): w=0.05 bosluğu 0.0096 -> 0.0179 cikardi (1.9x).
 * DAHA BUYUK w KOTULESTIRIYOR: w>=0.15'te ayrim tamamen kayboluyor. Sebebi,
 * bazi kapsam-ici sorularin sozcuk ortusmesinin dusuk olmasi (or. "mobbing
 * bildirimi" -> dokumanda "sikayet"), buna karsilik en zorlu kapsam-disi
 * sorunun ("ozel arac TAHSISI") ekipman dokumanindaki "TAHSIS edilen dizustu
 * bilgisayar" ifadesiyle sozcuk duzeyinde de eslesmesi. Yani lexical sinyal
 * yardimci ama sihirli degil; agirligi olcmeden buyutmeyin.
 */
export const LEXICAL_WEIGHT = Number(process.env.LEXICAL_WEIGHT ?? 0.05);

/** Kapi acildiktan sonra en iyi skora bu bant icinde kalan parcalar baglama girer. */
export const CONTEXT_BAND = Number(process.env.CONTEXT_BAND ?? 0.05);

/** Baglam bulunamadiginda donulecek sabit yanit (halusinasyon engelleme). */
export const NO_CONTEXT_RESPONSE =
  'Şirket içi mevzuat dokümanlarında bu konu hakkında bilgi bulunmamaktadır. ' +
  'Lütfen İK departmanı ile doğrudan iletişime geçiniz.';

/**
 * Prompt kurallari.
 *
 * DIKKAT: Buraya "bilgi yoksa su sabit cumleyi yaz" talimati EKLEMEYIN.
 * Halusinasyon engellemesi vectorStore'daki deterministik alaka kapisiyla yapilir;
 * bu prompt yalnizca kapi ACILDIGINDA, yani baglam KESINLIKLE mevcutken calisir.
 * Sabit yanit talimati eklendiginde phi-3.5-mini gibi kucuk modeller talimati
 * asiri tetikleyip dogru baglam onlerindeyken bile "bilgi bulunmamaktadir" yaziyor.
 */
export const SYSTEM_PROMPT_RULES = `KURALLAR:
1. Yanıtı yalnızca yukarıdaki BAĞLAM metnine dayandır; bağlamda olmayan bilgi ekleme.
2. Kısa ve net yanıt ver: en fazla 2-3 cümle.
3. Sayısal değerleri (gün, tutar, saat) bağlamdaki gibi birebir aktar; yuvarlama veya çıkarım yapma.
4. Yanıtı bir kez ver, aynı cümleyi tekrar etme.
5. Sadece Türkçe yanıt ver.
6. Soruda geçen TAM kalemi bağlamda bul. Bir madde birden fazla kalem içerebilir; benzer ama farklı olanla karıştırma (örn. "doğum yardımı" ile "evlilik yardımı" ayrı kalemlerdir, tutarları farklıdır).
7. Soru bir SAYI soruyorsa yanıtın o sayıyı mutlaka içersin; bağlamdaki ilgili cümleyi değil, sorulan değeri ver.
8. Kademeli aralıklarda sınır değerlere dikkat et: "(dahil)" ibaresi o değerin O kademeye ait olduğunu gösterir. Örneğin "1 yıldan 5 yıla kadar (5 yıl dahil)" ifadesinde tam 5 yıl bu kademeye girer, bir üst kademeye DEĞİL.
9. Bir bölümün altında ">> CEVAP CÜMLESİ:" satırı varsa, cevabı O CÜMLEDEN kur. O satır, soruyla eşleşen cümlenin sistem tarafından işaretlenmiş halidir; aynı bölümdeki diğer cümlelerde geçen sayıları kullanma.
10. Bağlamdaki etiketleri (">> CEVAP CÜMLESİ:", "TAM METİN:", "EN İLGİLİ BÖLÜM", köşeli parantezli dosya adları) yanıtına ASLA kopyalama; yalnızca düz Türkçe cümle yaz.
11. "EN İLGİLİ BÖLÜM" etiketli bölüm sorunun asıl karşılığıdır; yanıtı oradan kur. Diğer bölümler yalnızca destekleyici bağlamdır, cevabı onlardan verme.`;
// DIKKAT — 2. kuralda "daha detayli yanit ver" DENEMESI YAPILDI VE GERI ALINDI.
// Kural "once degeri ver, sonra kosul/istisnalari da aktar, 2-5 cumle" diye
// genisletildiginde qwen2.5-1.5b muhakeme etmeye calisip cokuyor; olculdu:
//   "Annelikte ucretli izin ne kadar?" -> "...Sonuc = 8 - 3 = 5 haftalar"
// Kucuk modelde kisalik koruyucudur. Kullanicinin istedigi DETAY, modelden
// degil KODDAN gelir: yanitin altina ilgili maddenin tam metni birebir
// eklenir (bkz. chat.route.ts 'details' olayi). Boylece detay hem daha
// kapsamli hem de halusinasyon riski sifir olur.

// DIKKAT — 9. kuralda isaretin ADI acikca gecmeli. "isaretli cumle" gibi mugla
// bir ifadeye cevrildiginde model isareti bulamadi ve olcum 48/48'den 45/48'e
// dustu. Modelin bu adi cevabina kopyalama egilimi prompt'la degil, sunucudaki
// sizinti kalkaniyla cozulur (bkz. chat.route.ts LEAK_PREFIX).

/**
 * Cumle duzeyinde kanit isaretleme (bkz. services/evidence.service.ts).
 *
 * Acikken, baglama giren her parcanin altina soruyla en ilgili cumle
 * "ILGILI CUMLE" olarak eklenir. Parca metni KIRPILMAZ; yalnizca isaret konur.
 * EVIDENCE_FOCUS=0 ile kapatilip eval ile karsilastirma yapilabilir.
 */
export const EVIDENCE_FOCUS = (process.env.EVIDENCE_FOCUS ?? '1') !== '0';

/**
 * Kanit cumlesi secildiginde parcanin TAM METNI de baglama girsin mi?
 *
 * Deney anahtari: EVIDENCE_ONLY=1 tam metni tamamen birakir ve LLM yalnizca
 * isaretlenmis cumleyi gorur. Varsayilan KAPALI — olcum icin bkz. README.
 */
export const EVIDENCE_ONLY = process.env.EVIDENCE_ONLY === '1';
