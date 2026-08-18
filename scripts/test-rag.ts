/**
 * Retrieval kabul + regresyon testleri.
 *
 * LLM'e hic gitmeden, yerel embedding + vektor aramanin dogru dokumani/maddeyi
 * getirdigini ve kapsam disi sorularin alaka kapisini gecemedigini dogrular.
 *
 * Kullanim:  cd server && npm run test:rag
 */
import { generateQueryEmbedding } from '../server/src/services/embedding.service.js';
import { retrieveWithDiagnostics, scoreAllChunks, countChunks } from '../server/src/services/vectorStore.service.js';
import { classifyIntent, type IntentKind } from '../server/src/services/intent.service.js';
import { getSession, recordTurn, resolveQuery, clearSession } from '../server/src/services/conversation.service.js';
import { SIMILARITY_THRESHOLD, RELEVANCE_MARGIN, TOP_K } from '../server/src/config/constants.js';

// ---------------------------------------------------------------------------
// 1) Niyet siniflandirma testleri
//
// En kritik kisim: gercek IK sorulari YANLISLIKLA sohbet sanilmamali.
// Ozellikle "yardim" iceren sorular (dogum yardimi, evlilik yardimi) RAG'e
// gitmeli — aksi halde kullanici tanitim metni alir.
// ---------------------------------------------------------------------------
const intentCases: { input: string; expect: IntentKind }[] = [
  // sohbet
  { input: 'selam', expect: 'greeting' },
  { input: 'Merhaba', expect: 'greeting' },
  { input: 'günaydın', expect: 'greeting' },
  { input: 'iyi günler', expect: 'greeting' },
  { input: 'naber', expect: 'greeting' },
  { input: 'teşekkürler', expect: 'thanks' },
  { input: 'sağ ol', expect: 'thanks' },
  { input: 'görüşürüz', expect: 'farewell' },
  // tanitim
  { input: 'ne iş yaparsın', expect: 'capability' },
  { input: 'Ne yapabilirsin?', expect: 'capability' },
  { input: 'sen kimsin', expect: 'capability' },
  { input: 'neler sorabilirim', expect: 'capability' },
  { input: 'hangi konularda bilgi verebilirsin', expect: 'capability' },
  // hafiza / ozet
  { input: 'ne konuşuyorduk', expect: 'recap' },
  { input: 'neden bahsediyorduk', expect: 'recap' },
  { input: 'önceki sorum neydi', expect: 'recap' },
  // GERCEK IK sorulari — hicbiri sohbet sayilmamali
  { input: 'Doğum yardımı ne kadar?', expect: 'rag' },
  { input: 'Evlilik yardımı alabilir miyim?', expect: 'rag' },
  { input: 'Kreş desteği ne kadar?', expect: 'rag' },
  { input: 'Yıllık iznim kaç gün?', expect: 'rag' },
  { input: 'Maaşlar hangi gün ödeniyor?', expect: 'rag' },
  { input: 'merhaba yıllık iznim kaç gün acaba', expect: 'rag' },
  { input: 'iyi günler harcırah fişlerimi ne zaman yüklemeliyim', expect: 'rag' },
  { input: 'Şirket bana özel araç tahsisi yapıyor mu?', expect: 'rag' },
];

console.log('\n  Niyet siniflandirma testleri\n');

let intentFailures = 0;
for (const c of intentCases) {
  const got = classifyIntent(c.input).kind;
  const ok = got === c.expect;
  if (!ok) intentFailures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  "${c.input}" → ${got}${ok ? '' : ` (beklenen ${c.expect})`}`);
}
console.log(`\n  Niyet: ${intentCases.length - intentFailures}/${intentCases.length} gecti.`);

// ---------------------------------------------------------------------------
// 1b) Takip sorusu cozumlemesi
//
// "peki 10 yillik olsaydi?" kendi basina anlamsizdir; onceki soruyla
// birlestirilmelidir. Konu ismi TASIYAN sorular ise birlestirilmemeli —
// aksi halde yeni konu eski konuyla kirlenir.
// ---------------------------------------------------------------------------
console.log('\n  Takip sorusu cozumlemesi\n');

let followupFailures = 0;
{
  const sid = 'test-followup';
  clearSession(sid);
  const session = getSession(sid);

  // ilk soru: takip degil (gecmis bos)
  const first = resolveQuery('5 yıllık çalışanın yıllık izni kaç gün?', session);
  const firstOk = !first.rewritten;
  if (!firstOk) followupFailures++;
  console.log(`  ${firstOk ? 'PASS' : 'FAIL'}  ilk soru yeniden yazilmadi`);

  recordTurn(sid, {
    question: '5 yıllık çalışanın yıllık izni kaç gün?',
    resolvedQuestion: '5 yıllık çalışanın yıllık izni kaç gün?',
    answer: '14 iş günü',
    citations: [{ doc: '01_calisma_saatleri_ve_izinler.md', section: 'Madde 2' }],
  });

  const cases: { input: string; shouldRewrite: boolean }[] = [
    { input: 'peki 10 yıllık olsaydı?', shouldRewrite: true },
    { input: 'ya 3 yıllık?', shouldRewrite: true },
    { input: '20 yıllık?', shouldRewrite: true },
    { input: 'o zaman ne olur', shouldRewrite: true },
    // konu ismi tasiyan sorular BIRLESTIRILMEMELI
    { input: 'Kreş desteği ne kadar?', shouldRewrite: false },
    { input: 'Maaşlar hangi gün ödeniyor?', shouldRewrite: false },
    { input: 'İş kazasını kaç gün içinde bildirmeliyim?', shouldRewrite: false },
    // REGRESYON: kapsam disi sorular takip sorusu SANILMAMALI.
    // Ilk surumde "kisa + bilinen konu ismi yok" kurali bunlari takip sorusu
    // sayiyor ve onceki soruyla birlestirip alakasiz cevap donduruyordu.
    { input: 'Ofise evcil hayvan getirebilir miyim?', shouldRewrite: false },
    { input: 'Hisse senedi opsiyonu alabilir miyim?', shouldRewrite: false },
    { input: 'İstanbul hava durumu nasıl?', shouldRewrite: false },
    { input: 'Yemekhanede bugün ne var?', shouldRewrite: false },
    // konu degistiren "peki" de birlestirilmemeli
    { input: 'peki kreş desteği ne kadar?', shouldRewrite: false },
  ];

  for (const c of cases) {
    const r = resolveQuery(c.input, getSession(sid));
    const ok = r.rewritten === c.shouldRewrite;
    if (!ok) followupFailures++;
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  "${c.input}" → ${r.rewritten ? 'birlestirildi' : 'oldugu gibi'}`,
    );
  }
  clearSession(sid);

  // -------------------------------------------------- kutup degisimi (contrast)
  //
  // "Annelikte ucretli izin ne kadar?" -> "peki ya ucretsiz izin"
  //
  // Bu vaka iki kurali birlikte sinar: (1) isaret + ORTAK konu ismi tasiyan soru
  // takip sorusu sayilmali, (2) yeniden yazma duz birlestirme DEGIL, kutup
  // degisimi olmali. Duz birlestirmede sorgu hem "ucretli" hem "ucretsiz"
  // tasiyor ve model onceki cevabi tekrarliyordu (olculdu).
  const psid = 'test-polarity';
  clearSession(psid);
  const base = 'Annelikte ücretli izin ne kadar?';
  recordTurn(psid, {
    question: base,
    resolvedQuestion: base,
    answer: '16 hafta',
    citations: [{ doc: '10_dogum_analik_ve_ebeveyn_haklari.md', section: 'Madde 1: Analık İzni' }],
  });

  const polar = resolveQuery('peki ya ücretsiz izin', getSession(psid));

  // "ücretsiz" ifadesi "ücretli"yi ICERMEZ (farkli sonekler), bu yuzden duz
  // arama yeterli. Sorgu ya Turkce karakterli ya sadelestirilmis gelebilir.
  const polarOk =
    polar.rewritten &&
    /(ücretsiz|ucretsiz)/i.test(polar.query) &&
    !/(ücretli|ucretli)/i.test(polar.query);

  if (!polarOk) followupFailures++;
  console.log(
    `  ${polarOk ? 'PASS' : 'FAIL'}  kutup degisimi → "${polar.query}"` +
      (polarOk ? '' : '\n        beklenen: "ucretli" cikarilip "ucretsiz" konmus tek bir soru'),
  );
  clearSession(psid);
}
console.log(`\n  Takip: ${followupFailures === 0 ? 'tumu gecti' : followupFailures + ' basarisiz'}`);

interface Case {
  group: string;
  question: string;
  /**
   * Beklenen kaynak dokuman; null ise "baglam bulunmamali" (halusinasyon testi).
   * Birden fazla dokuman ayni dogru bilgiyi tasiyorsa dizi verilebilir.
   */
  expectDoc: string | string[] | null;
  expectSection?: string;
}

const cases: Case[] = [
  // ---- Sartname Bolum 6 / Adim 3 kabul sorulari (DEGISTIRILEMEZ) ----
  { group: 'ŞARTNAME', question: '5 yıllık çalışan kaç gün yıllık izin kullanabilir?', expectDoc: '01_calisma_saatleri_ve_izinler.md', expectSection: 'Madde 2' },
  { group: 'ŞARTNAME', question: 'Harcırah masraf fişlerimi kaç gün içinde yüklemeliyim?', expectDoc: '03_harcirah_ve_masraf_politikalari.md', expectSection: 'Madde 2' },
  { group: 'ŞARTNAME', question: 'Şirket bana özel araç tahsisi yapıyor mu?', expectDoc: null },

  // ---- Calisma duzeni ----
  { group: 'Çalışma düzeni', question: 'Öğle molası saat kaçta?', expectDoc: '01_calisma_saatleri_ve_izinler.md', expectSection: 'Madde 1' },
  { group: 'Çalışma düzeni', question: 'Hafta sonu fazla mesai ücreti kaç katı?', expectDoc: '09_fazla_mesai_ve_vardiya.md', expectSection: 'Madde 2' },
  { group: 'Çalışma düzeni', question: 'Gece vardiyası zammı yüzde kaç?', expectDoc: '09_fazla_mesai_ve_vardiya.md', expectSection: 'Madde 3' },
  { group: 'Çalışma düzeni', question: 'Haftada kaç gün uzaktan çalışabilirim?', expectDoc: '04_uzaktan_calisma_ve_ekipman_guvenligi.md', expectSection: 'Madde 1' },

  // ---- Izinler ----
  // Babalik izni her iki dokumanda da ayni bilgiyle yer alir (capraz referansli).
  { group: 'İzinler', question: 'Babalık izni kaç gün?', expectDoc: ['01_calisma_saatleri_ve_izinler.md', '10_dogum_analik_ve_ebeveyn_haklari.md'] },
  { group: 'İzinler', question: 'Süt izni günde kaç saat?', expectDoc: '10_dogum_analik_ve_ebeveyn_haklari.md', expectSection: 'Madde 2' },
  { group: 'İzinler', question: 'Analık izni kaç hafta?', expectDoc: '10_dogum_analik_ve_ebeveyn_haklari.md', expectSection: 'Madde 1' },
  { group: 'İzinler', question: 'Hastalık raporumu kaç gün içinde bildirmeliyim?', expectDoc: '11_hastalik_izni_ve_saglik_raporu.md', expectSection: 'Madde 1' },
  { group: 'İzinler', question: 'Yılda en fazla kaç gün ücretsiz izin alabilirim?', expectDoc: '12_ucretsiz_izin_ve_idari_izinler.md', expectSection: 'Madde 1' },

  // ---- Ucret ve yan haklar ----
  { group: 'Ücret', question: 'Maaşlar hangi gün ödeniyor?', expectDoc: '07_ucret_bordro_ve_odemeler.md', expectSection: 'Madde 1' },
  { group: 'Ücret', question: 'Avans olarak en fazla ne kadar alabilirim?', expectDoc: '07_ucret_bordro_ve_odemeler.md', expectSection: 'Madde 3' },
  { group: 'Ücret', question: 'Yemek kartına günlük ne kadar yükleniyor?', expectDoc: '08_yan_haklar_ve_sosyal_yardimlar.md', expectSection: 'Madde 1' },
  { group: 'Ücret', question: 'Kreş desteği ne kadar?', expectDoc: '08_yan_haklar_ve_sosyal_yardimlar.md', expectSection: 'Madde 4' },
  { group: 'Ücret', question: 'Kıdem tazminatı kaç günlük ücret üzerinden hesaplanır?', expectDoc: '16_kidem_ve_ihbar_tazminati.md', expectSection: 'Madde 1' },

  // ---- Istihdam dongusu ----
  { group: 'İstihdam', question: 'Deneme süresi kaç ay?', expectDoc: '06_is_sozlesmesi_ve_deneme_suresi.md', expectSection: 'Madde 2' },
  { group: 'İstihdam', question: 'İstifa edersem ihbar süresi ne kadar?', expectDoc: '15_istifa_fesih_ve_cikis_sureci.md', expectSection: 'Madde 2' },
  { group: 'İstihdam', question: 'Referans primi ne kadar?', expectDoc: '05_ise_alim_ve_oryantasyon.md', expectSection: 'Madde 2' },

  // ---- Performans ve gelisim ----
  { group: 'Performans', question: 'Terfi için kaç ay çalışmış olmam gerekir?', expectDoc: '13_performans_degerlendirme_ve_terfi.md', expectSection: 'Madde 3' },
  { group: 'Performans', question: 'Yıllık kişisel gelişim bütçem ne kadar?', expectDoc: '14_egitim_ve_kariyer_gelisimi.md', expectSection: 'Madde 1' },

  // ---- Disiplin, ISG, uyum ----
  { group: 'Disiplin', question: 'Ücret kesme cezası en fazla kaç günlük olabilir?', expectDoc: '20_disiplin_cezalari_ve_devamsizlik.md', expectSection: 'Madde 2' },
  { group: 'Disiplin', question: 'Tedarikçiden hediye kabul edebilir miyim?', expectDoc: '02_disiplin_yonetmeligi_ve_etik_kurallar.md', expectSection: 'Madde 2' },
  { group: 'İSG', question: 'İş kazasını kaç gün içinde bildirmek gerekir?', expectDoc: '17_is_sagligi_ve_guvenligi.md', expectSection: 'Madde 2' },
  { group: 'Uyum', question: 'Kamera kayıtları ne kadar süre saklanıyor?', expectDoc: '18_kvkk_ve_calisan_verilerinin_korunmasi.md', expectSection: 'Madde 2' },
  { group: 'Uyum', question: 'Mobbing bildirimini nereye yapabilirim?', expectDoc: '19_esitlik_mobbing_ve_sikayet_mekanizmasi.md' },

  // ---- Kapsam disi (reddedilmeli) ----
  { group: 'Kapsam dışı', question: 'Hisse senedi opsiyonu alabilir miyim?', expectDoc: null },
  { group: 'Kapsam dışı', question: 'İstanbul hava durumu nasıl?', expectDoc: null },
  { group: 'Kapsam dışı', question: 'Yemekhanede bugün ne var?', expectDoc: null },
  { group: 'Kapsam dışı', question: 'Ofise evcil hayvan getirebilir miyim?', expectDoc: null },
  { group: 'Kapsam dışı', question: 'Python nasıl öğrenilir?', expectDoc: null },
];

if (countChunks() === 0) {
  console.error('\n  Indeks bos. Once `npm run ingest` calistirin.\n');
  process.exit(1);
}

console.log(
  `\n  Retrieval testleri — ${countChunks()} parca, topK=${TOP_K}, esik=${SIMILARITY_THRESHOLD}` +
    `${RELEVANCE_MARGIN > 0 ? `, marj=${RELEVANCE_MARGIN}` : ' (marj kapali)'}\n`,
);

let failures = 0;
let lastGroup = '';

for (const c of cases) {
  if (c.group !== lastGroup) {
    console.log(`  --- ${c.group} ---`);
    lastGroup = c.group;
  }

  const vector = await generateQueryEmbedding(c.question);
  const { chunks: hits, diagnostics: d } = retrieveWithDiagnostics(vector, undefined, undefined, c.question);
  const top = hits[0];

  const accepted = c.expectDoc === null ? [] : [c.expectDoc].flat();
  const ok =
    c.expectDoc === null
      ? hits.length === 0
      : !!top &&
        accepted.includes(top.docTitle) &&
        (!c.expectSection || top.section.includes(c.expectSection));

  if (!ok) failures++;

  const detail =
    c.expectDoc === null
      ? `reddedildi (en iyi ${d.top.toFixed(4)})`
      : top
        ? `${top.docTitle.replace(/^\d+_/, '').replace(/\.md$/, '')} → ${top.section.split(':')[0]} (${d.top.toFixed(4)})`
        : `SEÇİM YOK (en iyi ${d.top.toFixed(4)}, eşik altı)`;

  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${c.question}`);
  console.log(`        ${detail}`);

  if (!ok && c.expectDoc !== null) {
    const near = scoreAllChunks(vector, c.question).slice(0, 3);
    for (const n of near) console.log(`          aday ${n.score.toFixed(4)}  ${n.docTitle} → ${n.section}`);
  }
}

const total = cases.length + intentCases.length + 14;
const passed = total - failures - intentFailures - followupFailures;
console.log(`\n  Retrieval: ${cases.length - failures}/${cases.length} · Niyet: ${intentCases.length - intentFailures}/${intentCases.length}`);
console.log(`  TOPLAM: ${passed}/${total} gecti.\n`);
process.exit(failures + intentFailures + followupFailures === 0 ? 0 : 1);
