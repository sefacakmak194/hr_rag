/**
 * Politika boslugu raporu testleri (Sprint 4).
 *
 * Iki soruyu cevapliyor:
 *
 *   1. GIZLILIK — kayit gercekten kimliksiz mi? Sprint 1'in korumak istedigi
 *      sey metin ile KISI arasindaki bagdi; o bag hic kurulmamali.
 *   2. KUMELEME — ayni konunun farkli ifadeleri birlesiyor, farkli konular
 *      ayri kaliyor mu? Esik burada OLCULUYOR, sezgiyle secilmiyor.
 *
 * GERCEK EMBEDDING kullanilir: kumeleme kalitesi tam olarak vektorlerin
 * kalitesine bagli, sahte vektorle olculemez. Model onbellekten yuklendigi icin
 * cevrimdisi calisir ve CI'da koser.
 *
 * Kullanim:  cd server && npm run test:gap
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-gap-'));
process.env.DB_PATH = path.join(dir, 'gap-test.db');

const { getDb } = await import('../server/src/services/vectorStore.service.js');
const { generateQueryEmbedding } = await import('../server/src/services/embedding.service.js');
const { recordGap, buildGapReport, purgeOldGaps, isoWeek } = await import(
  '../server/src/services/policyGap.service.js'
);
const { GAP_CLUSTER_THRESHOLD } = await import('../server/src/config/constants.js');

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
};

const db = getDb();

// ============================================================ 1) hafta etiketi
console.log('\n  ISO hafta etiketi\n');

check(isoWeek(new Date('2026-08-19T12:00:00')) === '2026-W34', `19.08.2026 → ${isoWeek(new Date('2026-08-19T12:00:00'))}`);
check(isoWeek(new Date('2026-01-01T12:00:00')) === '2026-W01', `01.01.2026 → ${isoWeek(new Date('2026-01-01T12:00:00'))}`);
// 2027-01-01 bir cuma; ISO'ya gore 2026'nin 53. haftasina ait.
check(isoWeek(new Date('2027-01-01T12:00:00')) === '2026-W53', `01.01.2027 → ${isoWeek(new Date('2027-01-01T12:00:00'))}`);
check(
  isoWeek(new Date('2026-08-17T00:00:00')) === isoWeek(new Date('2026-08-23T23:59:00')),
  'pazartesi ve pazar AYNI haftada',
);
check(
  isoWeek(new Date('2026-08-23T23:59:00')) !== isoWeek(new Date('2026-08-24T00:01:00')),
  'pazar ile ertesi pazartesi FARKLI haftada',
);

// ============================================================ 2) gizlilik
console.log('\n  Gizlilik: kayit kimliksiz\n');

const sutunlar = (db.prepare('PRAGMA table_info(unanswered_questions)').all() as unknown as { name: string }[]).map(
  (c) => c.name,
);
check(
  !sutunlar.some((c) => /user|kullanici|principal|session/i.test(c)),
  `tabloda kimlik sutunu YOK: ${sutunlar.join(', ')}`,
  'Sprint 1 karari: korunmasi gereken sey metin ile kisi arasindaki bag',
);
check(sutunlar.includes('week'), 'zaman HAFTA cozunurlugunde saklaniyor');
check(!sutunlar.some((c) => /^at$|timestamp|created_at/i.test(c)), 'tam zaman damgasi YOK');

// ============================================================ 3) kumeleme
console.log('\n  Kumeleme (gercek embedding)\n');

/** Ayni konunun farkli ifadeleri + acikca farkli konular. */
const KONULAR: Record<string, string[]> = {
  kres: [
    'Kreş desteği için başvuru nasıl yapılır?',
    'Çocuk bakım yardımı almak için ne yapmalıyım?',
    'Anaokulu desteğine kimler başvurabilir?',
  ],
  evcilHayvan: [
    'Ofise evcil hayvan getirebilir miyim?',
    'Köpeğimi işe getirmem serbest mi?',
  ],
  hisse: [
    'Hisse senedi opsiyonu alabilir miyim?',
    'Çalışanlara pay opsiyonu veriliyor mu?',
  ],
};

let sira = 0;
for (const [, sorular] of Object.entries(KONULAR)) {
  for (const soru of sorular) {
    const vector = await generateQueryEmbedding(soru);
    // Skorlar gercekci bir dagilim icin degistiriliyor; kumelemeyi etkilemez.
    recordGap(db, { question: soru, vector, topScore: 0.7 + (sira % 5) * 0.02 }, new Date('2026-08-19T10:00:00'));
    sira++;
  }
}

const rapor = buildGapReport(db);
check(rapor.totalQuestions === 7, `yedi soru kaydedildi (${rapor.totalQuestions})`);

/**
 * BEKLENTI OLCUME GORE YAZILDI.
 *
 * `scripts/calibrate-gap.ts` ayni-konu ve farkli-konu benzerlik dagilimlarinin
 * ORTUSTUGUNU gosterdi (ayirim bosluğu -0.0875). Yani "her konu tam olarak bir
 * kumeye duser" diye bir iddia SAVUNULAMAZ ve testin boyle bir sey iddia etmesi
 * yaniltici olurdu.
 *
 * Testin dogruladigi sey, kumelemenin GERCEKTEN ISE YARADIGI iki ozellik:
 *   1. Kume sayisi soru sayisindan AZ (yani bir gruplama gerceklesiyor)
 *   2. Acikca farkli konular ASLA birlesmiyor (asil zararli hata bu)
 */
const kumeSayisi = rapor.clusters.length;
check(
  kumeSayisi < rapor.totalQuestions,
  `kumeleme gerceklesti: 7 soru → ${kumeSayisi} kume (esik ${GAP_CLUSTER_THRESHOLD})`,
  rapor.clusters.map((c) => `${c.count}x "${c.label}"`).join(' | '),
);

/** Iki soru ayni kumede mi? */
const ayniKumede = (a: RegExp, b: RegExp) =>
  rapor.clusters.some(
    (c) => c.questions.some((q) => a.test(q.question)) && c.questions.some((q) => b.test(q.question)),
  );

// ASIL ZARARLI HATA: farkli bosluklarin tek bosluk gibi gorunmesi.
check(!ayniKumede(/evcil|köpe/i, /hisse|opsiyon/i), 'evcil hayvan ile hisse opsiyonu AYNI kumede DEGIL');
check(!ayniKumede(/kre[şs]|anaokul/i, /hisse|opsiyon/i), 'kres ile hisse opsiyonu AYNI kumede DEGIL');
check(!ayniKumede(/evcil|köpe/i, /kre[şs]|anaokul/i), 'evcil hayvan ile kres AYNI kumede DEGIL');

// En cok sorulan konu basta olmali: rapor bir eylem listesi.
check(
  rapor.clusters.every((c, i) => i === 0 || rapor.clusters[i - 1].count >= c.count),
  'kumeler soru sayisina gore azalan sirada',
);

// Kume basligi UYDURULMUS degil, gercek bir soru olmali.
const tumSorular = Object.values(KONULAR).flat();
check(
  rapor.clusters.every((c) => tumSorular.includes(c.label)),
  'kume basliklari gercek sorulardan seciliyor (uretilmis ozet degil)',
);

// FAZLA BOLMENIN TELAFISI: ayrilmis ama iliskili kumeler gorunur olmali.
check(
  rapor.clusters.some((c) => c.relatedTo !== undefined),
  'en az bir kume "benzer konu" baglantisi tasiyor',
  'fazla bolme yonunde taraf tutuldugu icin bu baglanti sart',
);
check(
  rapor.clusters.every((c) => c.relatedTo !== c.label),
  'kume kendisine benzer olarak isaret etmiyor',
);

// ============================================================ 4) esige yakinlik
console.log('\n  "Az kaldi" ayrimi\n');

const yakin = await generateQueryEmbedding('Servis güzergahı değişikliği nasıl talep edilir?');
recordGap(db, { question: 'Servis güzergahı değişikliği nasıl talep edilir?', vector: yakin, topScore: 0.828 });

const uzak = await generateQueryEmbedding('İstanbul hava durumu nasıl?');
recordGap(db, { question: 'İstanbul hava durumu nasıl?', vector: uzak, topScore: 0.51 });

// SINIR VAKASI — bu, tabanin ilk halinde YANLIS isaretleniyordu.
//
// Kalibrasyon kapsam disi sorgularin 0.8230'a kadar cikabildigini soyluyor.
// Taban esikten sabit bir bant cikararak (0.812) belirlenmisti ve apacik
// alakasiz sorular da "az kaldi" aliyordu. Olculdu: canli sunucuda "Ofise
// evcil hayvan getirebilir miyim?" 0.814 ile isaretlendi.
const sinir = await generateQueryEmbedding('Ofise evcil hayvan getirebilir miyim?');
recordGap(db, { question: 'Ofise evcil hayvan getirebilir miyim?', vector: sinir, topScore: 0.814 });

const rapor2 = buildGapReport(db);
const yakinKume = rapor2.clusters.find((c) => /servis güzergah/i.test(c.label));
const uzakKume = rapor2.clusters.find((c) => /hava durumu/i.test(c.label));

check(yakinKume?.nearMiss === true, `esige yakin soru "az kaldi" isaretli (skor ${yakinKume?.bestScore})`);
check(uzakKume?.nearMiss === false, `kapsam disi soru isaretsiz (skor ${uzakKume?.bestScore})`);

const sinirKume = rapor2.clusters.find((c) => /evcil hayvan/i.test(c.label));
check(
  sinirKume?.nearMiss === false,
  `kapsam disi sinir vakasi (0.814) isaretlenMIYOR (skor ${sinirKume?.bestScore})`,
  'kalibrasyon: kapsam disi sorgular 0.8230a kadar cikabiliyor',
);

// ============================================================ 5) hafta ozeti
console.log('\n  Hafta bazinda egilim\n');

const gecenHafta = await generateQueryEmbedding('Yemek kartı bakiyem nasıl öğrenilir?');
recordGap(
  db,
  { question: 'Yemek kartı bakiyem nasıl öğrenilir?', vector: gecenHafta, topScore: 0.6 },
  new Date('2026-08-10T10:00:00'),
);

const rapor3 = buildGapReport(db);
check(rapor3.byWeek.length === 2, `iki farkli hafta gorunuyor (${rapor3.byWeek.length})`);
check(rapor3.byWeek[0].week < rapor3.byWeek[1].week, 'haftalar eskiden yeniye sirali');
check(
  rapor3.byWeek.reduce((s, w) => s + w.count, 0) === rapor3.totalQuestions,
  'hafta toplamlari genel toplamla tutuyor',
);

const suzulmus = buildGapReport(db, { sinceWeek: '2026-W34' });
check(
  suzulmus.totalQuestions === rapor3.totalQuestions - 1,
  `hafta suzmesi calisiyor (${suzulmus.totalQuestions} / ${rapor3.totalQuestions})`,
);

// ============================================================ 6) saklama
console.log('\n  Saklama suresi\n');

const cokEski = await generateQueryEmbedding('Eski bir soru');
recordGap(db, { question: 'Eski bir soru', vector: cokEski, topScore: 0.4 }, new Date('2020-01-15T10:00:00'));

const oncekiToplam = buildGapReport(db).totalQuestions;
const silinen = purgeOldGaps(db, new Date('2026-08-19T10:00:00'));
check(silinen === 1, `saklama suresi dolan kayit silindi (${silinen})`);
check(
  buildGapReport(db).totalQuestions === oncekiToplam - 1,
  'guncel kayitlar etkilenmedi',
);

// Denetim kaydinin aksine bu tabloda silmeyi engelleyen tetikleyici YOK.
// Ayrim bilincli: burada serbest metin var, orada kanit var.
let silinebilir = true;
try {
  db.prepare('DELETE FROM unanswered_questions WHERE id = (SELECT MIN(id) FROM unanswered_questions)').run();
} catch {
  silinebilir = false;
}
check(silinebilir, 'bu tablo SILINEBILIR (denetim kaydinin aksine)');

// ---------------------------------------------------------------- sonuc
try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch {
  // Windows'ta SQLite dosya kilidi surec kapanana kadar kalabilir.
}

console.log(`\n  ${failures === 0 ? 'TUMU GECTI' : `${failures} test BASARISIZ`}\n`);
process.exit(failures === 0 ? 0 : 1);
