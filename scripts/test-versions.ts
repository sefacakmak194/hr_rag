/**
 * Politika surumleme testleri (Sprint 2).
 *
 * Surumlemenin ISE YARADIGINI soyleyen tek sey, gecmis bir yanitin dayanagini
 * dokuman degistikten SONRA da okuyabilmektir. Bu paket tam olarak bunu
 * kovaliyor:
 *
 *   1) icerik degisimi surum acar, degismeyen icerik ACMAZ
 *   2) yururluk tarihi gelecekte olan surum YURURLUKTE DEGILDIR
 *   3) surum metni degistirilemez ve silinemez (SQLite tetikleyicileri)
 *   4) erisim etiketi surumleri de kapsar
 *   5) fark (diff) hesabi dogru ve sinirlarda cokmuyor
 *
 * LLM ve embedding gerektirmez; CI'da kosar.
 *
 * Kullanim:  cd server && npm run test:versions
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-versions-'));
process.env.DB_PATH = path.join(dir, 'versions-test.db');

const { getDb } = await import('../server/src/services/vectorStore.service.js');
const {
  recordVersion,
  currentVersion,
  pendingVersion,
  latestVersion,
  listVersions,
  getVersion,
  getVersionById,
  versionState,
  currentVersionsFor,
  withdrawDocument,
  withdrawVersion,
  normalizeEffectiveFrom,
  accessLabelOf,
  canSeeDocument,
} = await import('../server/src/services/versioning.service.js');
const { diffLines } = await import('../server/src/services/diff.service.js');
const { setAccessLabel } = await import('../server/src/services/identity.service.js');
import type { Principal } from '../server/src/services/identity.service.js';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
};

const db = getDb();

const calisan: Principal = { userId: 1, username: 'calisan', role: 'calisan' };
const ik: Principal = { userId: 2, username: 'ik', role: 'ik' };
const yonetici: Principal = { userId: 3, username: 'yonetici', role: 'yonetici' };

const METIN_1 = '# İzin Yönergesi\n\n## Madde 1\nYıllık ücretli izin 14 gündür.';
const METIN_2 = '# İzin Yönergesi\n\n## Madde 1\nYıllık ücretli izin 20 gündür.';
const METIN_3 = '# İzin Yönergesi\n\n## Madde 1\nYıllık ücretli izin 20 gündür.\n\n## Madde 2\nTalep 10 gün önce yapılır.';

const rec = (
  doc: string,
  content: string,
  extra: { note?: string; effectiveFrom?: string; actor?: string } = {},
  now?: Date,
) =>
  recordVersion(
    db,
    {
      docTitle: doc,
      content,
      source: 'markdown',
      bytes: Buffer.byteLength(content),
      actor: extra.actor ?? 'test',
      note: extra.note,
      effectiveFrom: extra.effectiveFrom,
    },
    now,
  );

// ==================================================== 1) surum acilma kurali
console.log('\n  Sürüm açılma kuralı\n');

const v1 = rec('izin.md', METIN_1, { note: 'ilk yayın' });
check(v1.created && v1.row.version === 1, `ilk kayıt s1 açar (s${v1.row.version})`);
check(v1.row.note === 'ilk yayın', 'değişiklik notu saklanır');
check(v1.row.createdBy === 'test', 'sürümü kimin açtığı saklanır');

const same = rec('izin.md', METIN_1);
check(!same.created, 'aynı içerik yeniden verilince sürüm AÇILMAZ');
check(same.row.version === 1, `dönen sürüm yürürlüktekidir (s${same.row.version})`);

const v2 = rec('izin.md', METIN_2, { note: '14 → 20 gün' });
check(v2.created && v2.row.version === 2, `değişen içerik s2 açar (s${v2.row.version})`);
check(currentVersion(db, 'izin.md')?.version === 2, 'yürürlükteki sürüm s2');
check(listVersions(db, 'izin.md').length === 2, 'geçmişte iki sürüm var');

// Bosluk/satir sonu farki da bir degisikliktir: mevzuat metninde bicim onemli.
const v3 = rec('izin.md', METIN_2 + '\n');
check(v3.created, 'satır sonu farkı da yeni sürüm açar');

// =================================================== 2) ileri tarihli surum
console.log('\n  İleri tarihli (bekleyen) sürüm\n');

const GELECEK = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const plan = rec('yonerge.md', 'v1 metin');
check(plan.row.version === 1, 'temel sürüm kuruldu');

const ileri = rec('yonerge.md', 'v2 metin', { effectiveFrom: GELECEK, note: 'yıl başından itibaren' });
check(ileri.created && ileri.row.version === 2, 'ileri tarihli kayıt sürüm açar');
check(currentVersion(db, 'yonerge.md')?.version === 1, 'YÜRÜRLÜKTEKİ sürüm hâlâ s1');
check(pendingVersion(db, 'yonerge.md')?.version === 2, 'bekleyen sürüm s2');
check(latestVersion(db, 'yonerge.md')?.version === 2, 'en son sürüm s2');

// EN KRITIK REGRESYON: bekleyen surum varken korpustaki (eski) icerik yeniden
// indekslenirse SAHTE bir surum acilmamali. Karsilastirma yururlukteki surumle
// yapiliyor; en son surumle yapilsaydi her yeniden indeksleme s3, s4, s5 ...
// diye eski icerikten sahte surumler uretirdi.
const yeniden = rec('yonerge.md', 'v1 metin');
check(!yeniden.created, 'bekleyen sürüm varken yeniden indeksleme SAHTE sürüm açmaz');
check(latestVersion(db, 'yonerge.md')?.version === 2, 'sürüm sayısı değişmedi');

// Tarih gelince s2 kendiliginden yururluge girer.
const sonra = new Date(Date.now() + 31 * 86_400_000);
check(currentVersion(db, 'yonerge.md', sonra)?.version === 2, 'yürürlük tarihi gelince s2 geçerli olur');
check(pendingVersion(db, 'yonerge.md', sonra) === null, 'o tarihte bekleyen sürüm kalmaz');

// ==================================================== 3) tarih normalizasyonu
console.log('\n  Yürürlük tarihi yorumu\n');

const yerel = normalizeEffectiveFrom('2026-09-01');
check(
  new Date(yerel).getFullYear() === 2026 && new Date(yerel).getDate() === 1,
  `salt tarih yerel gece yarısı olarak yorumlanır (${yerel})`,
);
check(
  new Date(yerel).getHours() === 0 && new Date(yerel).getMinutes() === 0,
  'yerel saat gece yarısı — UTC kayması yok',
);

const sabit = new Date('2020-05-05T10:00:00Z');
check(normalizeEffectiveFrom(undefined, sabit) === sabit.toISOString(), 'boş girdi → verilen an');
check(normalizeEffectiveFrom('   ', sabit) === sabit.toISOString(), 'boşluk → verilen an');

let atti = false;
try {
  normalizeEffectiveFrom('dün');
} catch {
  atti = true;
}
check(atti, 'anlaşılmayan tarih hata fırlatır');

// ================================================ 4) degistirilemezlik kisiti
console.log('\n  Değiştirilemezlik (SQLite tetikleyicileri)\n');

const hedef = getVersion(db, 'izin.md', 1)!;
check(hedef !== null && hedef.content === METIN_1, 's1 metni arşivden birebir okunur');

const bekle = (fn: () => void, label: string) => {
  try {
    fn();
    check(false, label, 'işlem reddedilmeliydi ama başarılı oldu');
  } catch (e) {
    check(true, `${label} (${(e as Error).message.slice(0, 48)})`);
  }
};

bekle(
  () => db.prepare('DELETE FROM document_versions WHERE id = ?').run(hedef.id),
  'sürüm satırı SİLİNEMEZ',
);
bekle(
  () => db.prepare('UPDATE document_versions SET content = ? WHERE id = ?').run('sahte', hedef.id),
  'sürüm metni DEĞİŞTİRİLEMEZ',
);
bekle(
  () => db.prepare('UPDATE document_versions SET effective_from = ? WHERE id = ?').run('2000-01-01', hedef.id),
  'yürürlük tarihi geriye alınamaz',
);
bekle(
  () => db.prepare('UPDATE document_versions SET version = 99 WHERE id = ?').run(hedef.id),
  'sürüm numarası değiştirilemez',
);

check(getVersion(db, 'izin.md', 1)?.content === METIN_1, 'reddedilen işlemlerden sonra metin bozulmadı');

// Yasam dongusu damgasi YAZILABILIR olmali; aksi halde silme kaydedilemezdi.
let damga = true;
try {
  db.prepare('UPDATE document_versions SET note = ? WHERE id = ?').run('sonradan not', hedef.id);
} catch {
  damga = false;
}
check(damga, 'içerik dışı alanlar (not) güncellenebilir');

// ====================================================== 5) geri cekme
console.log('\n  Geri çekme\n');

rec('gecici.md', 'birinci');
rec('gecici.md', 'ikinci');
const cekilen = withdrawDocument(db, 'gecici.md');
check(cekilen === 2, `silinen dokümanın tüm canlı sürümleri geri çekilir (${cekilen})`);
check(currentVersion(db, 'gecici.md') === null, 'geri çekilen dokümanın yürürlükteki sürümü yok');
check(listVersions(db, 'gecici.md').length === 2, 'satırlar SİLİNMEDİ, arşivde duruyor');
check(getVersion(db, 'gecici.md', 1)?.content === 'birinci', 'geri çekilen sürümün metni okunabilir');

const geriDonus = rec('gecici.md', 'ucuncu');
check(geriDonus.row.version === 3, `yeniden yükleme numaralandırmayı sürdürür (s${geriDonus.row.version})`);
check(currentVersion(db, 'gecici.md')?.version === 3, 'yeni sürüm canlı');

rec('tekil.md', 'a');
const tekilIleri = rec('tekil.md', 'b', { effectiveFrom: GELECEK });
check(withdrawVersion(db, 'tekil.md', tekilIleri.row.version), 'tek sürüm geri çekilebilir');
check(pendingVersion(db, 'tekil.md') === null, 'geri çekilen bekleyen sürüm listede yok');
check(currentVersion(db, 'tekil.md')?.version === 1, 'yürürlükteki sürüm etkilenmedi');

// ======================================================== 6) durum turetimi
console.log('\n  Sürüm durumu\n');

check(versionState(db, getVersion(db, 'izin.md', 1)!) === 'arsiv', 's1 → arşiv');
check(versionState(db, latestVersion(db, 'izin.md')!) === 'yururlukte', 'en son sürüm → yürürlükte');
check(versionState(db, getVersion(db, 'yonerge.md', 2)!) === 'bekliyor', 'ileri tarihli → bekliyor');
check(versionState(db, getVersion(db, 'gecici.md', 1)!) === 'geri-cekildi', 'geri çekilen → geri-cekildi');

// ==================================================== 7) toplu surum sorgusu
console.log('\n  Toplu sürüm sorgusu (sohbet alıntıları)\n');

const toplu = currentVersionsFor(db, ['izin.md', 'yonerge.md', 'gecici.md', 'yok.md']);
check(toplu.get('izin.md')?.version === 3, 'izin.md → s3');
check(toplu.get('yonerge.md')?.version === 1, 'yonerge.md → s1 (bekleyen sürüm SAYILMAZ)');
check(toplu.get('gecici.md')?.version === 3, 'gecici.md → s3');
check(!toplu.has('yok.md'), 'sürümü olmayan doküman haritada yok');
check(currentVersionsFor(db, []).size === 0, 'boş liste boş harita döner');

// ========================================================== 8) erisim kapisi
console.log('\n  Erişim etiketi sürümleri de kapsar\n');

rec('ucret_skalasi.md', 'Üst yönetim ikramiyesi 450.000 TL.');
check(accessLabelOf(db, 'ucret_skalasi.md') === 'genel', 'kayıtsız doküman varsayılan genel');
check(canSeeDocument(db, 'ucret_skalasi.md', calisan), 'genel iken çalışan görebiliyor');

setAccessLabel(db, 'ucret_skalasi.md', 'ik');
check(accessLabelOf(db, 'ucret_skalasi.md') === 'ik', 'etiket ik olarak yazıldı');
check(!canSeeDocument(db, 'ucret_skalasi.md', calisan), 'çalışan artık GEÇMİŞ sürümleri de göremez');
check(canSeeDocument(db, 'ucret_skalasi.md', ik), 'İK görebiliyor');
check(canSeeDocument(db, 'ucret_skalasi.md', yonetici), 'yönetici görebiliyor');

setAccessLabel(db, 'ucret_skalasi.md', 'yonetici');
check(!canSeeDocument(db, 'ucret_skalasi.md', ik), 'yonetici etiketinde İK göremiyor');

// Etiket degisimi dokuman ustverisini bozmamali.
rec('ucret_skalasi.md', 'Üst yönetim ikramiyesi 500.000 TL.');
check(latestVersion(db, 'ucret_skalasi.md')?.version === 2, 'etiket değişimi sürümlemeyi bozmuyor');
check(accessLabelOf(db, 'ucret_skalasi.md') === 'yonetici', 'yeni sürüm etiketi sıfırlamıyor');

// ============================================================ 9) kimlik ile
console.log('\n  Sürüm kimliğiyle erişim\n');

const kimlikli = getVersionById(db, v2.row.id);
check(kimlikli?.version === 2 && kimlikli.docTitle === 'izin.md', 'kimlik doğru sürüme çözülüyor');
check(kimlikli?.content === METIN_2, 'kimlikten okunan metin o günkü metindir');
check(getVersionById(db, 999_999) === null, 'olmayan kimlik null döner');

// ================================================================ 10) fark
console.log('\n  Fark (diff) hesabı\n');

const ayni = diffLines(METIN_2, METIN_2);
check(ayni.added === 0 && ayni.removed === 0, 'aynı metinde fark yok');

const tekSatir = diffLines(METIN_1, METIN_2);
check(tekSatir.added === 1 && tekSatir.removed === 1, `tek satır değişimi 1+/1− (${tekSatir.added}+/${tekSatir.removed}−)`);
check(
  tekSatir.lines.some((l) => l.kind === 'eklendi' && l.text.includes('20 gündür')),
  'eklenen satır yeni değeri taşıyor',
);
check(
  tekSatir.lines.some((l) => l.kind === 'silindi' && l.text.includes('14 gündür')),
  'silinen satır eski değeri taşıyor',
);

const eklendi = diffLines(METIN_2, METIN_3);
check(eklendi.added === 3 && eklendi.removed === 0, `saf ekleme 3+/0− (${eklendi.added}+/${eklendi.removed}−)`);

const silindi = diffLines(METIN_3, METIN_2);
check(silindi.added === 0 && silindi.removed === 3, `saf silme 0+/3− (${silindi.added}+/${silindi.removed}−)`);

// CRLF: Windows'ta duzenlenmis bir dosya, tek karakter degismeden TUM satirlari
// degismis gosterebilirdi. Normalizasyon bunu engelliyor.
check(diffLines('a\r\nb\r\nc', 'a\nb\nc').added === 0, 'CRLF/LF farkı fark sayılmaz');

const bosla = diffLines('', 'yeni satır');
check(bosla.added === 1 && bosla.removed === 1, 'boş metinden ekleme tutarlı');

// Degismemis uzun blok toplanir; aksi halde iki kelimelik bir duzeltmeyi
// gormek icin 300 satir kaydirmak gerekirdi.
const uzunA = Array.from({ length: 200 }, (_, i) => `satır ${i}`).join('\n');
const uzunB = uzunA.replace('satır 100', 'satır 100 DEĞİŞTİ');
const toplanan = diffLines(uzunA, uzunB);
check(toplanan.added === 1 && toplanan.removed === 1, 'uzun dokümanda tek değişiklik bulunuyor');
check(
  toplanan.lines.some((l) => l.kind === 'atlandi'),
  'değişmemiş uzun blok tek satıra toplanıyor',
);
check(toplanan.lines.length < 20, `çıktı kısa kalıyor (${toplanan.lines.length} satır)`);
check(
  toplanan.lines.filter((l) => l.kind === 'ayni').length >= 4,
  'değişikliğin çevresinde bağlam satırları korunuyor',
);

// Sinir: LCS tavani asildiginda cokmek yerine blok degisiklik raporlanmali.
const devasa = Array.from({ length: 2500 }, (_, i) => `a${i}`).join('\n');
const devasa2 = Array.from({ length: 2500 }, (_, i) => `b${i}`).join('\n');
const buyuk = diffLines(devasa, devasa2);
check(buyuk.truncated, 'LCS tavanı aşılınca blok değişiklik olarak raporlanıyor');
check(buyuk.added === 2500 && buyuk.removed === 2500, 'blok modda sayılar tutarlı');

// Performans: gercek bir yonerge boyutunda diff aninda bitmeli.
const t0 = performance.now();
diffLines(uzunA, uzunB);
const sure = performance.now() - t0;
check(sure < 500, `200 satırlık fark hızlı (${sure.toFixed(1)} ms)`);

// ---------------------------------------------------------------- sonuc
try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch {
  // Windows'ta SQLite dosya kilidi surec kapanana kadar kalabilir; test
  // sonucunu etkilemez.
}

console.log(`\n  ${failures === 0 ? 'TUMU GECTI' : `${failures} test BASARISIZ`}\n`);
process.exit(failures === 0 ? 0 : 1);
