/**
 * Kasitli kapsam disi konu reddi testleri.
 *
 * NEDEN VAR: bu katman bir OLCUM sonucu dogdu. Sartnamenin halusinasyon testi
 * ("Sirket bana ozel arac tahsisi yapiyor mu?") geciyordu ama YENIDEN IFADESI
 * gecmiyordu — "Sirket araci tahsis ediliyor mu?" alaka kapisini asip modele
 * ulasiyor ve model "No" diyordu.
 *
 * Esigi yukseltmek denendi ve OLCULDU: kapsam-ici en dusuk 0.8408,
 * kapsam-disi en yuksek 0.8409. Iki dagilim ustuste; esikle cozulemez.
 *
 * Bu paketin iki isi var ve IKINCISI en az birincisi kadar onemli:
 *   1) listedeki konulari yakalamak
 *   2) KAPSAM ICI sorulari yakalamamak — fazla genis bir kalip, mesru bir
 *      soruyu "bilgi bulunmamaktadir" ile reddeder ve urunu bozar.
 *
 * Ikinci grup ozellikle "arac" kelimesini gerec anlaminda kullanan gercek
 * korpus cumlelerini icerir.
 *
 * Kullanim:  cd server && npm run test:scope
 */
import { checkOutOfScope, OUT_OF_SCOPE_TOPICS } from '../server/src/services/scope.service.js';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
};

console.log('\n  Kapsam disi kalmasi GEREKEN sorular\n');

const disarida: { q: string; topic: string }[] = [
  // sartname kabul sorusu ve yeniden ifadeleri
  { q: 'Şirket bana özel araç tahsisi yapıyor mu?', topic: 'sirket-araci' },
  { q: 'Şirket aracı tahsis ediliyor mu?', topic: 'sirket-araci' },
  { q: 'şirket aracı tahsis ediliyor mu', topic: 'sirket-araci' },
  { q: 'ŞİRKET ARACI VAR MI?', topic: 'sirket-araci' },
  { q: 'Bana makam aracı çıkar mı?', topic: 'sirket-araci' },
  { q: 'Şirket arabası veriliyor mu?', topic: 'sirket-araci' },
  { q: 'Yöneticilere araç tahsisi yapılıyor mu?', topic: 'sirket-araci' },
  // diger kasitli disarida birakilanlar
  { q: 'Hisse senedi opsiyonu alabilir miyim?', topic: 'hisse-opsiyon' },
  { q: 'Şirkette stock option programı var mı?', topic: 'hisse-opsiyon' },
  { q: 'Yemekhanede bugün ne var?', topic: 'yemekhane-menusu' },
];

for (const c of disarida) {
  const v = checkOutOfScope(c.q);
  check(
    v?.topicId === c.topic,
    `"${c.q}" → ${c.topic}`,
    v ? `alinan konu: ${v.topicId}` : 'reddedilmedi — alaka kapisina kaldi',
  );
}

console.log('\n  KAPSAM ICI kalmasi gereken sorular (yanlis alarm olmamali)\n');

const iceride: string[] = [
  // "arac" GEREC anlaminda — disiplin yonetmeliginde gecen gercek konu
  'Lisanssız araç kullanabilir miyim?',
  'Şirket bilgisayarında hangi araçları kullanabilirim?',
  'Yetkisiz yazılım ve araç kullanımı yasak mı?',
  // zimmet/ekipman — kapsam ici
  'Çıkışta zimmetimi kime teslim edeceğim?',
  'Bana tahsis edilen dizüstü bilgisayarı ne zaman teslim etmeliyim?',
  'Uzaktan çalışırken ekipman güvenliği nasıl sağlanır?',
  // esige en yakin olculen mesru soru — bu katman onu ASLA yakalamamali
  'Mobbing bildirimini nereye yapabilirim?',
  // yemek destegi kapsam ici; yalnizca GUNLUK MENU disarida
  'Yemek kartına günlük ne kadar yükleniyor?',
  'Yemek desteği ne kadar?',
  // genel
  'Yıllık izin kaç gün?',
  'Babalık izni kaç gün?',
  'selam',
];

for (const q of iceride) {
  const v = checkOutOfScope(q);
  check(v === null, `"${q}" → kapsam ici`, v ? `yanlis alarm: ${v.topicId} (kalip: "${v.matched}")` : '');
}

console.log('\n  Yapisal kontroller\n');

check(OUT_OF_SCOPE_TOPICS.length > 0, 'en az bir konu tanimli');

for (const t of OUT_OF_SCOPE_TOPICS) {
  check(t.reason.trim().length > 20, `[${t.id}] gerekce yazilmis`, 'gerekce KAPSAM.md ile eslesmelidir');
  check(t.patterns.length > 0, `[${t.id}] en az bir kalip var`);
  // Tek kelimelik kalip cok genis olur ve yanlis alarm uretir; bu kural
  // "arac" gibi bir kalibin listeye sessizce girmesini engeller.
  const tekKelime = t.patterns.filter((p) => !p.includes(' '));
  check(
    tekKelime.length === 0,
    `[${t.id}] tek kelimelik kalip yok`,
    tekKelime.length ? `cok genis: ${tekKelime.join(', ')}` : '',
  );
}

console.log(`\n  ${failures === 0 ? 'TUMU GECTI' : `${failures} test BASARISIZ`}\n`);
process.exit(failures === 0 ? 0 : 1);
