/**
 * Bozuk yanit kalkani testleri.
 *
 * NEDEN VAR: kalkan yazildiginda hic test edilmemisti ve bir acigi vardi.
 * Model karsilastirmasi sirasinda qwen3.5-2b-text varyantinin Turkce
 * karakterlerde cokup "ÇÇÇÇÇÇÇÇÇÇÇÇ" dondugu olculdu; kalkan bunu
 * KACIRIYORDU, cunku mevcut kurallarin ikisi de en az uc SOZCUK bekliyor,
 * bu cikti ise bosluksuz tek sozcuk.
 *
 * Bu paketin iki isi var ve ikincisi en az birincisi kadar onemli:
 *   1) bozuk ciktilari yakalamak
 *   2) NORMAL yanitlari yakalamamak — yanlis alarm veren bir kalkan,
 *      dogru cevaplari mevzuat metniyle degistirir ve urunu bozar.
 *
 * Kullanim:  cd server && npm run test:guard
 */
import { inspectAnswer } from '../server/src/services/answerGuard.service.js';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
};

/** Bozuk sayilmasi GEREKEN ciktilar. */
const degenerate: { text: string; label: string }[] = [
  {
    label: 'tek jeton bozulmasi (Ç)',
    text: 'Ç'.repeat(120),
  },
  {
    label: 'tek jeton bozulmasi (Ş)',
    text: 'Ş'.repeat(64),
  },
  {
    label: 'cumle icinde harf tekrari',
    text: 'Doğum yardımı ŞŞŞŞŞŞŞŞŞŞŞŞ TL olarak ödenir.',
  },
  {
    label: 'donguye girmis uretim (olculdu)',
    text:
      'EVNETE CALIŞMA HAKIMKI BİTTİRMEDİKTIRIR. EVNETE CALIŞMA HAKIMLIIZDA ' +
      'DAHILİ YETKİLER VAR. EVNETE CALIŞMA HAKIMIMIZDA DAHILİ YETKİLER VAR.',
  },
  {
    label: 'ayni cumle tekrarlandi',
    text: 'Yıllık izin süresi on dört gündür. Yıllık izin süresi on dört gündür.',
  },
  {
    label: 'ucgen tekrar',
    text: 'yıllık izin hakkı yıllık izin hakkı yıllık izin hakkı bulunmaktadır burada.',
  },
];

/** Kesinlikle bozuk SAYILMAMASI gereken normal yanitlar. */
const healthy: { text: string; label: string }[] = [
  { label: 'sayisal olgu', text: 'Doğum yardımı 15.000 TL olarak ödenir.' },
  { label: 'kisa yanit', text: 'Yıllık izin süresi 14 gündür.' },
  { label: 'iki olgu', text: 'Öğle molası 1 saattir ve 12:30 - 13:30 arasındadır.' },
  { label: 'uzun turkce sozcukler', text: 'Çalışanlarımızın haklarındandır, başvurabilirsiniz.' },
  { label: 'kisaltmalar', text: 'KVKK ve SGK kapsamındaki yükümlülükler İSG mevzuatına tabidir.' },
  {
    label: 'uzun ve bilgilendirici yanit',
    text:
      'Analık izni doğumdan önce 8 hafta ve doğumdan sonra 8 hafta olmak üzere ' +
      'toplam 16 haftadır. Çoğul gebelikte doğum öncesi süreye 2 hafta eklenir.',
  },
  {
    label: 'ayni sozcuk cumlede birden fazla (dongu degil)',
    text: 'Yıllık izin talebi izin formuyla yapılır ve izin onayı yöneticiden alınır.',
  },
  { label: 'cok kisa metin — kalkan bilincli olarak susar', text: '14 gün.' },
];

console.log('\n  Bozuk sayilmasi gereken ciktilar\n');
for (const c of degenerate) {
  const v = inspectAnswer(c.text);
  check(v.degenerate, `${c.label} → ${v.reason ?? 'TESPIT EDILMEDI'}`, `metin: ${c.text.slice(0, 60)}`);
}

console.log('\n  Normal yanitlar — yanlis alarm olmamali\n');
for (const c of healthy) {
  const v = inspectAnswer(c.text);
  check(!v.degenerate, `${c.label}${v.degenerate ? ` → YANLIS ALARM (${v.reason})` : ''}`, `metin: ${c.text.slice(0, 60)}`);
}

// Sinir degeri: esik 8 secildi. Turkce'de ayni harf pes pese en fazla iki kez
// gecer ("dikkatt" gibi bir sozcuk yok), dolayisiyla 7 tekrar da bozuktur ama
// esigin ALTINDA kalan bir deger yanlis alarm uretmemeli.
console.log('\n  Esik davranisi\n');
check(inspectAnswer('Aaaaaaaaaa bir yanıt değildir bu.').degenerate, '10 tekrar bozuk sayiliyor');
check(!inspectAnswer('Anne ve babaya izin verilir.').degenerate, 'cift harf (nn) temiz sayiliyor');

console.log(`\n  ${failures === 0 ? 'TUMU GECTI' : `${failures} test BASARISIZ`}\n`);
process.exit(failures === 0 ? 0 : 1);
