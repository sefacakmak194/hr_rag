/**
 * HTTP UC DUZEYINDE erisim kontrolu testleri.
 *
 * NEDEN AYRI BIR PAKET — bu paketin var olma sebebi gercek bir hata:
 *
 *   `test-access.ts` erisim filtresini SERVIS katmaninda dogruluyordu
 *   (`listDocuments`, `findSectionText`, BM25) ve geciyordu. Ara katman
 *   korumalarini da (`requireAuth`, `requireDocumentManager`) sahte req/res ile
 *   dogruluyordu ve o da geciyordu. Ama ROTA GOVDELERI hic test edilmemisti.
 *
 *   Sonuc: `GET /api/documents` listeyi DOSYA SISTEMINDEN kuruyor, etiket
 *   filtresini yalnizca parca sayisina uyguluyordu. `calisan` rolundeki bir
 *   kullanici, `yonetici` etiketli bir belgenin ADINI goruyordu — Sprint 1'in
 *   cikis olcutu tam olarak bunu yasakliyordu.
 *
 *   Iki test katmani da yesildi ve arada duran sey sizdiriyordu.
 *
 * Bu paket gercek bir Express uygulamasi ayaga kaldirir ve uclara HTTP ile
 * gider. LLM ve embedding gerektirmez (sohbet ucu kapsam disi), CI'da kosar.
 *
 * Kullanim:  cd server && npm run test:endpoints
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-endpoints-'));
const corpus = path.join(dir, 'corpus');
fs.mkdirSync(corpus, { recursive: true });

process.env.DB_PATH = path.join(dir, 'endpoints-test.db');
process.env.CORPUS_DIR = corpus;
process.env.PENDING_DIR = path.join(dir, 'pending');
// Butunluk uclari anahtar uretir ve arsiv yazar; YALITILMALI. Aksi halde test
// gercek `data/` dizinine imza anahtari ve arsiv birakir (bir kez oldu).
process.env.ARCHIVE_DIR = path.join(dir, 'arsiv');
process.env.AUDIT_KEY_PATH = path.join(dir, 'audit-signing.key');
process.env.AUDIT_PUBLIC_KEY_PATH = path.join(dir, 'audit-public.pem');

// --------------------------------------------------------------- korpus dosyalari
const GENEL = 'genel_izin.md';
const KISITLI_IK = 'ik_ucret_skalasi.md';
const KISITLI_YONETIM = 'yonetim_kurulu_huzur_hakki.md';

fs.writeFileSync(path.join(corpus, GENEL), '# İzin\n\n## Madde 1\nYıllık izin 14 gündür.', 'utf-8');
fs.writeFileSync(path.join(corpus, KISITLI_IK), '# Ücret\n\n## Madde 1\nBordro 5. gün ödenir.', 'utf-8');
fs.writeFileSync(
  path.join(corpus, KISITLI_YONETIM),
  '# Huzur Hakkı\n\n## Madde 1\nHuzur hakkı 90.000 TL.',
  'utf-8',
);

const { getDb, insertChunk, resetLexicalIndex } = await import(
  '../server/src/services/vectorStore.service.js'
);
const { EMBEDDING_DIM } = await import('../server/src/config/constants.js');
const { createUser, createSession } = await import('../server/src/services/identity.service.js');
const { recordVersion } = await import('../server/src/services/versioning.service.js');
import type { Role } from '../server/src/services/identity.service.js';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
};

const fakeVector = (seed: number) => {
  const v = new Float32Array(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i++) v[i] = Math.sin(seed * (i + 1)) / 20;
  return v;
};

const db = getDb();

// Parcalar + etiketler. `genel_izin.md` documents tablosuna YAZILMIYOR:
// kaydi olmayan dokumanin `genel` sayilmasi da dogrulanmali.
insertChunk({ docTitle: GENEL, section: 'Madde 1', content: 'Yıllık izin 14 gündür.', vector: fakeVector(1) });
insertChunk({ docTitle: KISITLI_IK, section: 'Madde 1', content: 'Bordro 5. gün ödenir.', vector: fakeVector(2) });
insertChunk({
  docTitle: KISITLI_YONETIM,
  section: 'Madde 1',
  content: 'Huzur hakkı 90.000 TL.',
  vector: fakeVector(3),
});

const now = new Date().toISOString();
db.prepare("INSERT INTO documents (doc_title, access_label, source, indexed_at) VALUES (?, 'ik', 'markdown', ?)").run(
  KISITLI_IK,
  now,
);
db.prepare(
  "INSERT INTO documents (doc_title, access_label, source, indexed_at) VALUES (?, 'yonetici', 'markdown', ?)",
).run(KISITLI_YONETIM, now);
resetLexicalIndex();

// Surum kayitlari (surum uclarini sinamak icin).
for (const [doc, text] of [
  [GENEL, 'Yıllık izin 14 gündür.'],
  [KISITLI_IK, 'Bordro 5. gün ödenir.'],
  [KISITLI_YONETIM, 'Huzur hakkı 90.000 TL.'],
] as const) {
  recordVersion(db, { docTitle: doc, content: text, source: 'markdown', bytes: text.length, actor: 'test' });
}
const gizliSurum = db
  .prepare('SELECT id FROM document_versions WHERE doc_title = ?')
  .get(KISITLI_YONETIM) as { id: number };

// ------------------------------------------------------------------ sunucu
// `express` scripts/ dizininden cozulemez (orada node_modules yok). Sunucunun
// kendi cozucusu kullanilir — paketlenmis modda da dogru capayi veren yardimci
// zaten constants icinde duruyor.
const { moduleRequire } = await import('../server/src/config/constants.js');

// Tip de `express` uzerinden gelemez (modul bu dizinden cozulemiyor), bu yuzden
// yalnizca KULLANILAN yuzey yapisal olarak tanimlaniyor.
interface TestApp {
  use(...args: unknown[]): void;
  listen(port: number): import('node:http').Server;
}
type ExpressFactory = (() => TestApp) & { json(options?: { limit?: string }): unknown };

const express = moduleRequire('express') as ExpressFactory;
const { attachPrincipal } = await import('../server/src/middleware/session.js');
const authRoute = (await import('../server/src/routes/auth.route.js')).default;
const documentsRoute = (await import('../server/src/routes/documents.route.js')).default;
const versionsRoute = (await import('../server/src/routes/versions.route.js')).default;
const integrityRoute = (await import('../server/src/routes/integrity.route.js')).default;

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(attachPrincipal);
app.use('/api', authRoute);
app.use('/api', documentsRoute);
app.use('/api', versionsRoute);
app.use('/api', integrityRoute);

const server = app.listen(0);
await new Promise<void>((r) => server.once('listening', () => r()));
const port = (server.address() as { port: number }).port;
const BASE = `http://127.0.0.1:${port}`;

// ------------------------------------------------------------------ hesaplar
function login(username: string, role: Role): string {
  const user = createUser(db, { username, displayName: username, password: 'parola12345', role });
  const token = createSession(db, { userId: user.id, username: user.username, role: user.role });
  return `hr_session=${token}`;
}

const asCalisan = login('ayse', 'calisan');
const asIk = login('mehmet', 'ik');
const asYonetici = login('admin', 'yonetici');

interface Res {
  status: number;
  body: Record<string, unknown>;
}

async function req(
  method: string,
  url: string,
  cookie?: string,
  body?: unknown,
): Promise<Res> {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* JSON degilse bos birak */
  }
  return { status: res.status, body: parsed };
}

const names = (r: Res) => ((r.body.documents ?? []) as { name: string }[]).map((d) => d.name);

// ============================================================ 1) korpus listesi
console.log('\n  Korpus listesi (GET /api/documents)\n');

const listeCalisan = await req('GET', '/api/documents', asCalisan);
check(listeCalisan.status === 200, `calisan listeyi alabiliyor (${listeCalisan.status})`);
check(
  names(listeCalisan).join(',') === GENEL,
  `calisan YALNIZCA genel dokumani goruyor: ${names(listeCalisan).join(', ') || '(bos)'}`,
  'REGRESYON: liste dosya sisteminden kurulup filtrelenmemisti',
);
check(
  !names(listeCalisan).includes(KISITLI_IK) && !names(listeCalisan).includes(KISITLI_YONETIM),
  'kisitli dokuman ADLARI listede yok',
);

const listeIk = await req('GET', '/api/documents', asIk);
check(
  names(listeIk).sort().join(',') === [GENEL, KISITLI_IK].sort().join(','),
  `ik iki dokuman goruyor: ${names(listeIk).join(', ')}`,
);
check(!names(listeIk).includes(KISITLI_YONETIM), 'ik, yonetici etiketli dokumani gormuyor');

const listeYonetici = await req('GET', '/api/documents', asYonetici);
check(names(listeYonetici).length === 3, `yonetici ucunu de goruyor (${names(listeYonetici).length})`);

check((await req('GET', '/api/documents')).status === 401, 'girissiz liste istegi 401');

// ======================================================= 2) korpus saglik raporu
console.log('\n  Korpus sagligi (GET /api/corpus/audit)\n');

const auditCalisan = await req('GET', '/api/corpus/audit', asCalisan);
check(auditCalisan.status === 403, `calisan saglik raporuna erisemiyor (${auditCalisan.status})`);

const auditIk = await req('GET', '/api/corpus/audit', asIk);
check(auditIk.status === 200, 'ik saglik raporunu alabiliyor');
check(
  auditIk.body.chunks === 2,
  `rapor yalnizca gorulebilen parcalari sayiyor (${auditIk.body.chunks})`,
  'REGRESYON: rapor tum korpusu okuyordu; bulgular icerik sizdirir',
);

const auditYonetici = await req('GET', '/api/corpus/audit', asYonetici);
check(auditYonetici.body.chunks === 3, `yonetici icin 3 parca (${auditYonetici.body.chunks})`);

// ============================================================= 3) surum uclari
console.log('\n  Surum uclari\n');

const surumGenel = await req('GET', `/api/documents/${GENEL}/versions`, asCalisan);
check(surumGenel.status === 200, `calisan genel dokumanin surumlerini goruyor (${surumGenel.status})`);

const surumGizli = await req('GET', `/api/documents/${KISITLI_IK}/versions`, asCalisan);
check(surumGizli.status === 404, `calisan kisitli surum gecmisini goremiyor (${surumGizli.status})`);
check(
  surumGizli.body.error === 'Doküman bulunamadı.',
  'yanit "bulunamadi" — 403 degil, varlik sizmasin',
  String(surumGizli.body.error),
);

const surumIkYonetim = await req('GET', `/api/documents/${KISITLI_YONETIM}/versions`, asIk);
check(surumIkYonetim.status === 404, `ik, yonetici belgesinin surumlerini goremiyor (${surumIkYonetim.status})`);

const metinGizli = await req('GET', `/api/documents/${KISITLI_IK}/versions/1`, asCalisan);
check(metinGizli.status === 404, `arsiv metni kapali (${metinGizli.status})`);

const farkGizli = await req('GET', `/api/documents/${KISITLI_IK}/diff?a=1&b=1`, asCalisan);
check(farkGizli.status === 404, `fark ucu kapali (${farkGizli.status})`);

const kimlikGizli = await req('GET', `/api/versions/${gizliSurum.id}`, asIk);
check(kimlikGizli.status === 404, `surum KIMLIGIYLE dogrudan erisim de kapali (${kimlikGizli.status})`);

const kimlikAcik = await req('GET', `/api/versions/${gizliSurum.id}`, asYonetici);
check(kimlikAcik.status === 200 && typeof kimlikAcik.body.content === 'string', 'yonetici ayni kimligi okuyabiliyor');

// ============================================================ 4) yazma uclari
console.log('\n  Yazma uclari\n');

const b64 = Buffer.from('# Sahte\n\n## Madde 1\nDegistirilmis metin.').toString('base64');

const yazCalisan = await req('POST', '/api/documents', asCalisan, { name: GENEL, contentBase64: b64 });
check(yazCalisan.status === 403, `calisan yukleme yapamiyor (${yazCalisan.status})`);

const ezIk = await req('POST', '/api/documents', asIk, { name: KISITLI_YONETIM, contentBase64: b64 });
check(
  ezIk.status === 404,
  `ik, GORMEDIGI dokumanin uzerine yazamiyor (${ezIk.status})`,
  'REGRESYON: yukleme yetkisi etiketten bagimsizdi',
);
check(
  fs.readFileSync(path.join(corpus, KISITLI_YONETIM), 'utf-8').includes('90.000'),
  'dosya diskte degismedi',
);

const silIk = await req('DELETE', `/api/documents/${KISITLI_YONETIM}`, asIk);
check(silIk.status === 404, `ik, GORMEDIGI dokumani silemiyor (${silIk.status})`);
check(fs.existsSync(path.join(corpus, KISITLI_YONETIM)), 'dosya hala korpusta');

const silYok = await req('DELETE', '/api/documents/olmayan_dosya.md', asIk);
check(
  silYok.status === 404 && silYok.body.error === silIk.body.error,
  'olmayan dosya ile yetkisiz dosya AYNI yaniti aliyor',
  `${silYok.body.error} vs ${silIk.body.error}`,
);

// ============================================================ 5) etiket ucu
console.log('\n  Erisim etiketi (PATCH /api/documents/:name/label)\n');

const etiketIk = await req('PATCH', `/api/documents/${GENEL}/label`, asIk, { label: 'ik' });
check(etiketIk.status === 403, `ik etiket degistiremiyor (${etiketIk.status})`, 'yetkilendirme karari yoneticiye ait');

const etiketCalisan = await req('PATCH', `/api/documents/${GENEL}/label`, asCalisan, { label: 'ik' });
check(etiketCalisan.status === 403, `calisan etiket degistiremiyor (${etiketCalisan.status})`);

const etiketGecersiz = await req('PATCH', `/api/documents/${GENEL}/label`, asYonetici, { label: 'sirket-disi' });
check(etiketGecersiz.status === 400, `gecersiz etiket reddediliyor (${etiketGecersiz.status})`);

const etiketOk = await req('PATCH', `/api/documents/${GENEL}/label`, asYonetici, { label: 'ik' });
check(etiketOk.status === 200, `yonetici etiket degistirebiliyor (${etiketOk.status})`);

// Etiket degisiminin ANINDA etkili olmasi kritik: onbellek kalirsa eski
// gorunurluk yasamaya devam eder.
const listeSonra = await req('GET', '/api/documents', asCalisan);
check(
  names(listeSonra).length === 0,
  `etiket degisince calisan hicbir dokuman gormuyor: ${names(listeSonra).join(', ') || '(bos)'}`,
);
const surumSonra = await req('GET', `/api/documents/${GENEL}/versions`, asCalisan);
check(surumSonra.status === 404, `gecmis surumler de aninda kapaniyor (${surumSonra.status})`);

// ======================================================== 6) butunluk uclari
console.log('\n  Butunluk uclari (Sprint 3a)\n');

for (const [rol, cookie] of [['calisan', asCalisan], ['ik', asIk]] as const) {
  const durum = await req('GET', '/api/audit/integrity', cookie);
  check(durum.status === 403, `${rol} zincir raporunu goremiyor (${durum.status})`);

  const arsivle = await req('POST', '/api/audit/archive', cookie);
  check(arsivle.status === 403, `${rol} arsiv uretemiyor (${arsivle.status})`);

  const liste = await req('GET', '/api/audit/archives', cookie);
  check(liste.status === 403, `${rol} arsivleri listeleyemiyor (${liste.status})`);
}

check((await req('GET', '/api/audit/integrity')).status === 401, 'girissiz istek 401');

const durumYonetici = await req('GET', '/api/audit/integrity', asYonetici);
check(durumYonetici.status === 200, `yonetici zincir raporunu aliyor (${durumYonetici.status})`);
check(durumYonetici.body.ok === true, 'temiz veritabaninda zincir butun');
check(typeof durumYonetici.body.acikAnahtarParmakIzi === 'string', 'acik anahtar parmak izi donuyor');

const uretildi = await req('POST', '/api/audit/archive', asYonetici);
check(uretildi.status === 200 && uretildi.body.ok === true, `yonetici arsiv uretebiliyor (${uretildi.status})`);

const arsivListesi = await req('GET', '/api/audit/archives', asYonetici);
check(
  ((arsivListesi.body.arsivler ?? []) as unknown[]).length === 1,
  'uretilen arsiv listede',
);

// Dizin gecisi: arsiv adi dosya sistemine giriyor.
const gecis = await req('GET', '/api/audit/archives/..%2F..%2Fpackage.json', asYonetici);
check(gecis.status === 400 || gecis.status === 404, `dizin gecisi reddediliyor (${gecis.status})`);

const yokArsiv = await req('GET', '/api/audit/archives/olmayan.json', asYonetici);
check(yokArsiv.status === 404, `olmayan arsiv 404 (${yokArsiv.status})`);

// ---------------------------------------------------------------- sonuc
server.close();
try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch {
  // Windows'ta SQLite dosya kilidi surec kapanana kadar kalabilir.
}

console.log(`\n  ${failures === 0 ? 'TUMU GECTI' : `${failures} test BASARISIZ`}\n`);
process.exit(failures === 0 ? 0 : 1);
