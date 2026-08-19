/**
 * 10.000 soruluk tarama bankasi — SSS mantigiyla.
 *
 * NEDEN 500 x 20, 10.000 AYRI SORU DEGIL
 *
 * Insan kaynaklarinda 10.000 ayri KONU yoktur. Zorlayarak uretilen 10.000
 * "farkli" soru, birbirinin kopyasi olur ve olcum degeri tasimaz. Buna karsilik
 * 10.000 ayri IFADE vardir ve asil kirilma noktasi orasidir.
 *
 * Bugun olculdu (rob-1/rob-2): mevcut GECEN iki vakanin yeniden ifade edilmis
 * hali dustu. "Sirket bana ozel arac tahsisi yapiyor mu?" geciyordu,
 * "Sirket araci tahsis ediliyor mu?" gecmiyordu. Yani gecen bir vaka, YALNIZCA
 * o ifadeyle gectigini gosterir.
 *
 * Bu yuzden banka iki eksenli:
 *   500 temel soru  x  20 ifade donusumu  =  10.000 sorgu
 *
 * DONUSUMLER GERCEK KULLANICI DAVRANISI
 *
 * Uydurma bozma degil; gercek bir intranet arama kutusunda gorulen seyler:
 * Turkce karakter kullanmadan yazmak ("izin kac gun kullanabilirim"), kucuk
 * harfle yazmak, soru isaretini atmak, "acaba" ile baslamak, tek harf
 * dusurmek. Sistem bunlarin hepsinde ayni cevabi vermeli.
 *
 * KAPSAM DISI SORULAR DA BILEREK ICERIDE
 *
 * `data/KAPSAM.md` bazi konulari KASITLI olarak disarida birakiyor (sirket
 * araci, hisse opsiyonu, yemekhane menusu). Bunlar bankada var ve
 * `beklenen: 'kapsamDisi'` ile isaretli — cunku taramanin bir isi de bu
 * konularin cevaplanMAdigini dogrulamak. Bir tarama yalnizca eksigi degil,
 * fazlayi da olcmelidir.
 */

export type Beklenti = 'cevaplanmali' | 'kapsamDisi';

export interface TemelSoru {
  id: string;
  alan: string;
  soru: string;
  beklenen: Beklenti;
}

/* ------------------------------------------------------------------ *
 *  1. CALISMA DUZENI — mesai, vardiya, fazla mesai, uzaktan calisma   *
 * ------------------------------------------------------------------ */
const calismaDuzeni = [
  'Mesai saatleri kaçta başlıyor?',
  'İş günü kaçta bitiyor?',
  'Haftalık çalışma süresi kaç saat?',
  'Öğle molası kaç saat?',
  'Öğle molası hangi saatler arasında?',
  'Çay molası hakkım var mı?',
  'Esnek çalışma saati uygulanıyor mu?',
  'Sabah kaçta işte olmam gerekiyor?',
  'Geç kalırsam ne olur?',
  'Mesai başlangıcında tolerans süresi var mı?',
  'Cumartesi çalışıyor muyuz?',
  'Hafta sonu mesaisi zorunlu mu?',
  'Fazla mesai ücreti nasıl hesaplanıyor?',
  'Fazla mesai saat ücreti normalin kaç katı?',
  'Yıllık en fazla kaç saat fazla mesai yapabilirim?',
  'Fazla mesai onayını kim veriyor?',
  'Fazla mesai yerine izin kullanabilir miyim?',
  'Gece vardiyası zammı yüzde kaç?',
  'Gece vardiyası hangi saatler arası sayılıyor?',
  'Vardiya değişimi nasıl talep edilir?',
  'Nöbet ücreti ne kadar?',
  'Hafta tatilinde çalışırsam ne alırım?',
  'Resmî tatilde çalışırsam ücretim nasıl hesaplanır?',
  'Dini bayramlarda çalışma zorunluluğu var mı?',
  'Haftada kaç gün uzaktan çalışabilirim?',
  'Uzaktan çalışma için onay gerekiyor mu?',
  'Uzaktan çalışırken mesai saatlerine uymak zorunda mıyım?',
  'Evden çalışırken internet gideri karşılanıyor mu?',
  'Uzaktan çalışma günlerini kim belirliyor?',
  'Ofise gelme zorunluluğu olan günler var mı?',
  'Yurt dışından çalışabilir miyim?',
  'Başka bir şehirden çalışabilir miyim?',
  'Puantaj nasıl tutuluyor?',
  'Giriş çıkış saatleri kaydediliyor mu?',
  'Mesai kartını unutursam ne yapmalıyım?',
  'Devamsızlık nasıl hesaplanıyor?',
  'Vardiya planı ne zaman açıklanıyor?',
  'Vardiyalar arası dinlenme süresi ne kadar?',
  'Telafi çalışması nasıl yapılır?',
  'Kısmi süreli çalışma mümkün mü?',
  'Yarı zamanlı çalışmaya geçebilir miyim?',
  'İş yerinde kıyafet kuralı var mı?',
  'Ofiste kişisel eşya bulundurabilir miyim?',
  'Molada ofisten çıkabilir miyim?',
  'Mesai bitiminde ofiste kalabilir miyim?',
  'Yıllık çalışma takvimi nerede yayımlanıyor?',
  'Resmî tatil günleri hangileri?',
  'İdari tatil ilan edilirse ücretim kesilir mi?',
  'Yoğun dönemlerde çalışma saatleri değişir mi?',
  'Mesai saatleri dışında gelen e-postalara cevap vermek zorunda mıyım?',
  'Hafta içi izin günü alabilir miyim?',
  'Vardiyalı çalışanlar için öğle molası nasıl işliyor?',
  'İşe geliş gidiş süresi mesaiden sayılıyor mu?',
  'Servis saatleri nedir?',
  'Şirket servisi var mı?',
  'Ofis dışı toplantı mesaiye dahil mi?',
  'Seyahat süresi çalışma saatinden sayılır mı?',
  'Mesai saatleri içinde özel işime bakabilir miyim?',
  'Ofiste kalma süresine üst sınır var mı?',
  'İki vardiyada üst üste çalışabilir miyim?',
];

/* ------------------------------------------------------------------ *
 *  2. IZINLER — yillik, mazeret, dogum, hastalik, ucretsiz            *
 * ------------------------------------------------------------------ */
const izinler = [
  'Yıllık izin kaç gün?',
  '1 yıllık çalışanın yıllık izni kaç gün?',
  '5 yıllık çalışan kaç gün yıllık izin kullanabilir?',
  '10 yıllık çalışanın yıllık izni kaç gün?',
  '20 yıllık çalışanın yıllık izni kaç gün?',
  'Yıllık izin talebini kaç gün önce yapmalıyım?',
  'Yıllık iznimi bölerek kullanabilir miyim?',
  'Kullanmadığım yıllık izin bir sonraki yıla devreder mi?',
  'Yıllık iznimi paraya çevirebilir miyim?',
  'Deneme süresinde yıllık izin kullanabilir miyim?',
  'İzin talebimi kim onaylıyor?',
  'İzin talebim reddedilirse ne yapabilirim?',
  'İzindeyken çağrılabilir miyim?',
  'Yıllık izin hakkı ne zaman doğar?',
  'İzin günleri iş günü mü takvim günü mü?',
  'Evlilik izni kaç gün?',
  'Babalık izni kaç gün?',
  'Vefat izni kaç gün?',
  'Birinci derece yakınım vefat ederse kaç gün izin alabilirim?',
  'Doğum izni ne kadar sürüyor?',
  'Analık izni toplam kaç hafta?',
  'Doğumdan önce kaç hafta izin kullanabilirim?',
  'Doğumdan sonra kaç hafta izin var?',
  'Süt izni günde kaç saat?',
  'Süt izni ne kadar süre kullanılabilir?',
  'Ebeveyn izni var mı?',
  'Evlat edinme durumunda izin veriliyor mu?',
  'Çoğul gebelikte izin süresi değişir mi?',
  'Doğum sonrası kısmi çalışmaya geçebilir miyim?',
  'Hastalık izni için rapor gerekiyor mu?',
  'Raporumu kaç gün içinde bildirmeliyim?',
  'Sağlık raporunu nereye yüklemeliyim?',
  'Raporlu günlerde maaşım kesilir mi?',
  'Kaç gün rapor alırsam iş göremezlik ödeneği devreye girer?',
  'Doktor randevusu için izin alabilir miyim?',
  'Diş hekimi randevusu mazeret izni sayılır mı?',
  'Refakat izni var mı?',
  'Çocuğum hastalanırsa izin alabilir miyim?',
  'Ücretsiz izin en fazla kaç gün?',
  'Ücretsiz izin talebini en az kaç gün önce yapmalıyım?',
  'Ücretsiz izinde sigortam devam eder mi?',
  'Ücretsiz izin sonrası işime dönebilir miyim?',
  'Sınav izni alabilir miyim?',
  'Mesleki sertifika sınavı için izin var mı?',
  'Üniversite sınavına gireceğim, izin verilir mi?',
  'Afet durumunda izin veriliyor mu?',
  'Deprem izni kaç gün?',
  'Askerlik için izin nasıl alınır?',
  'Askerlik dönüşü işime dönebilir miyim?',
  'Mazeret izni kaç gün?',
  'Taşınma için izin alabilir miyim?',
  'Yeni iş arama izni var mı?',
  'İhbar süresinde iş arama izni kaç saat?',
  'İzinliyken rapor alırsam izin günlerim geri sayılır mı?',
  'Yıllık izinde resmî tatile denk gelen gün sayılır mı?',
  'İzin devir sınırı var mı?',
  'İzin bakiyemi nereden görebilirim?',
  'Toplu izin uygulanıyor mu?',
  'Şirket yaz döneminde toplu izne çıkıyor mu?',
  'İzindeyken şirket telefonuma bakmak zorunda mıyım?',
  'Yurt dışına çıkacağım, izin dışında bildirim gerekir mi?',
  'Hafta sonuna denk gelen izin günü sayılır mı?',
  'Yarım gün izin kullanabilir miyim?',
  'Saatlik izin uygulaması var mı?',
  'İzin talebimi iptal edebilir miyim?',
  'Onaylanmış iznimi erteleyebilir miyim?',
  'Kurum değişikliğinde izin hakkım devreder mi?',
  'Kıdemim arttıkça izin günüm artar mı?',
  'Engelli çalışanlar için ek izin var mı?',
  'Kronik hastalığı olanlar için izin kolaylığı var mı?',
  'Kan bağışı için izin veriliyor mu?',
  'Doğum günümde izin var mı?',
  'Nikâh için kaç gün izin alabilirim?',
  'İzin formu nerede?',
  'İzin belgesi imzalatmam gerekiyor mu?',
];

/* ------------------------------------------------------------------ *
 *  3. UCRET, BORDRO, YAN HAKLAR, TAZMINAT                             *
 * ------------------------------------------------------------------ */
const ucretVeHaklar = [
  'Maaşlar hangi gün yatıyor?',
  'Maaş günü hafta sonuna denk gelirse ne oluyor?',
  'Bordroma nereden ulaşabilirim?',
  'Bordro itirazımı kaç gün içinde yapmalıyım?',
  'Bordromda hata varsa kime başvurmalıyım?',
  'Zam dönemi ne zaman?',
  'Zam oranı neye göre belirleniyor?',
  'Performansım zammımı etkiler mi?',
  'Ara zam yapılıyor mu?',
  'Avans talep edebilir miyim?',
  'Avans talebi nasıl yapılır?',
  'Avans en fazla ne kadar alınabilir?',
  'Prim ne zaman ödeniyor?',
  'Prim hesaplaması nasıl yapılıyor?',
  'Satış primi var mı?',
  'Bayram ikramiyesi veriliyor mu?',
  'İkramiye kaç maaş tutarında?',
  'Yemek kartına günlük ne kadar yükleniyor?',
  'Yemek kartı nerede geçiyor?',
  'Yemek desteği izinli günlerde de yatıyor mu?',
  'Yol desteği aylık ne kadar?',
  'Yol yardımı nakit mi ödeniyor?',
  'Kreş desteği ne kadar?',
  'Kreş desteğinden kimler yararlanabilir?',
  'Doğum yardımı ne kadar?',
  'Evlilik yardımı ne kadar?',
  'Ölüm yardımı veriliyor mu?',
  'Özel sağlık sigortası var mı?',
  'Sağlık sigortası aileyi kapsıyor mu?',
  'Sağlık sigortası hangi hastaneleri kapsıyor?',
  'Diş tedavisi sigorta kapsamında mı?',
  'Gözlük desteği var mı?',
  'Bireysel emeklilik katkısı yapılıyor mu?',
  'BES kesintisinden çıkabilir miyim?',
  'Kıdem tazminatı nasıl hesaplanıyor?',
  'Kıdem tazminatına hak kazanmak için kaç yıl çalışmak gerekir?',
  'İstifa edersem kıdem tazminatı alabilir miyim?',
  'İhbar tazminatı nedir?',
  'İhbar süresi kaç hafta?',
  '2 yıllık çalışanın ihbar süresi kaç hafta?',
  'İhbar süresini çalışmazsam ne olur?',
  'Kıdem tazminatı tavanı nedir?',
  'Yıllık izin ücreti çıkışta ödenir mi?',
  'Maaş haczi durumunda ne oluyor?',
  'Maaş bilgim gizli mi?',
  'Asgari geçim indirimi uygulanıyor mu?',
  'Gelir vergisi dilimim değişince maaşım düşer mi?',
  'SGK primim ne kadar?',
  'İşveren SGK payını ödüyor mu?',
  'Harcırah ne kadar?',
  'Harcırah masraf fişlerimi kaç gün içinde yüklemeliyim?',
  'Otel konaklama üst limiti gecelik ne kadar?',
  'Şehir dışı görevde yemek limiti ne kadar?',
  'Uçak bileti hangi sınıftan alınıyor?',
  'Kendi aracımla göreve gidersem yakıt ödenir mi?',
  'Taksi fişi kabul ediliyor mu?',
  'Masraf onayını kim veriyor?',
  'Fişsiz harcama kabul ediliyor mu?',
  'Yurt dışı görevde harcırah farklı mı?',
  'Referans primi ne kadar?',
  'Referans primi ne zaman ödeniyor?',
  'Çalışan tavsiye programı var mı?',
  'Yıllık kişisel gelişim bütçesi ne kadar?',
  'Eğitim bütçesi devrediyor mu?',
  'Spor salonu üyeliği karşılanıyor mu?',
  'Ulaşım kartı veriliyor mu?',
  'Şirket telefonu tahsis ediliyor mu?',
  'Şirket bilgisayarı veriliyor mu?',
  'Hisse senedi opsiyonu alabilir miyim?',
  'Şirket aracı tahsis ediliyor mu?',
];

/* ------------------------------------------------------------------ *
 *  4. ISTIHDAM DONGUSU — ise alim, sozlesme, deneme, cikis            *
 * ------------------------------------------------------------------ */
const istihdamDongusu = [
  'İşe alım süreci kaç adımdan oluşuyor?',
  'Mülakat kaç aşamalı?',
  'İşe alımda hangi belgeler isteniyor?',
  'Referans kontrolü yapılıyor mu?',
  'İş teklifi ne kadar sürede geliyor?',
  'Oryantasyon süreci ne kadar sürüyor?',
  'İlk gün ne yapmam gerekiyor?',
  'Oryantasyonda kimlerle tanışacağım?',
  'Deneme süresi kaç ay?',
  'Deneme süresinde çıkarılabilir miyim?',
  'Deneme süresinde ihbar süresi var mı?',
  'Deneme süresi uzatılabilir mi?',
  'İş sözleşmem belirli süreli mi?',
  'Sözleşmemin bir kopyasını alabilir miyim?',
  'Sözleşme yenileme nasıl oluyor?',
  'Rekabet yasağı ne kadar sürüyor?',
  'Rekabet yasağı hangi şirketleri kapsıyor?',
  'Gizlilik sözleşmesi imzalamak zorunda mıyım?',
  'İkinci bir işte çalışabilir miyim?',
  'Serbest çalışma yapabilir miyim?',
  'Kendi şirketimi kurabilir miyim?',
  'İstifa etmek için ne yapmalıyım?',
  'İstifa dilekçesi nasıl yazılır?',
  'İstifamı geri alabilir miyim?',
  'İstifa ettikten sonra kaç gün çalışmam gerekiyor?',
  'Çıkış işlemleri ne kadar sürüyor?',
  'Zimmetimi kime teslim edeceğim?',
  'Çıkışta hangi belgeleri alacağım?',
  'Çalışma belgesi verilir mi?',
  'Bonservis alabilir miyim?',
  'İşten çıkarılırsam hangi haklarım var?',
  'Performans nedeniyle çıkarılabilir miyim?',
  'Geçerli fesih sebepleri neler?',
  'Haklı fesih nedir?',
  'İşe iade davası açabilir miyim?',
  'Çıkış mülakatı zorunlu mu?',
  'Şirkete geri dönebilir miyim?',
  'Eski çalışanlar tekrar başvurabilir mi?',
  'Terfi ile birlikte sözleşmem değişir mi?',
  'Departman değişikliği talep edebilir miyim?',
  'Yatay geçiş mümkün mü?',
  'İç ilana nasıl başvururum?',
  'İç ilan önceliği var mı?',
  'Görev tanımım nerede yazılı?',
  'Görev tanımım dışında iş verilebilir mi?',
  'Unvanım nasıl değişir?',
  'Şirket içi transferde maaşım değişir mi?',
  'Başka şehre atanabilir miyim?',
  'Görev yeri değişikliğini reddedebilir miyim?',
  'Yurt dışı görevlendirme nasıl oluyor?',
  'Stajyer alımı yapılıyor mu?',
  'Stajyerler sigortalı mı?',
  'Staj sonrası işe alınabilir miyim?',
  'Yarı zamanlı çalışanlar aynı haklara sahip mi?',
  'Taşeron çalışanlar bu politikalara tabi mi?',
  'Emeklilik durumunda ne oluyor?',
  'Emekli olup çalışmaya devam edebilir miyim?',
  'İşe giriş bildirgemi nereden görebilirim?',
  'Özlük dosyamda neler var?',
  'Özlük dosyamı görebilir miyim?',
  'Adres değişikliğimi nasıl bildiririm?',
  'Medeni durum değişikliğini bildirmek zorunda mıyım?',
  'Banka hesabımı nasıl güncellerim?',
  'İş sözleşmemde değişiklik yapılabilir mi?',
  'Ücretsiz izin sonrası pozisyonum korunur mu?',
];

/* ------------------------------------------------------------------ *
 *  5. PERFORMANS VE GELISIM                                           *
 * ------------------------------------------------------------------ */
const performansGelisim = [
  'Performans değerlendirmesi ne zaman yapılıyor?',
  'Performans dönemleri hangi aylarda?',
  'Performans notum neye göre veriliyor?',
  'Performans sonucuna kaç iş günü içinde itiraz edilir?',
  'Performans itirazımı kime yapmalıyım?',
  'Düşük performans notu alırsam ne olur?',
  'Performans gelişim planı nedir?',
  'Hedeflerim nasıl belirleniyor?',
  'Hedeflerim yıl içinde değişebilir mi?',
  'Ara değerlendirme yapılıyor mu?',
  'Yöneticimle birebir görüşme sıklığı ne?',
  '360 derece değerlendirme var mı?',
  'Terfi kriterleri neler?',
  'Terfi için kaç ay çalışmam gerekiyor?',
  'Terfi başvurusu yapabilir miyim?',
  'Terfi ne zaman açıklanıyor?',
  'Terfi ile zam birlikte mi geliyor?',
  'Kariyer basamakları nasıl ilerliyor?',
  'Uzmanlık kariyeri ile yöneticilik kariyeri farklı mı?',
  'Yönetici olmak için ne gerekiyor?',
  'Eğitim talebimi nasıl iletirim?',
  'Eğitim bütçemi neye harcayabilirim?',
  'Online kurslar karşılanıyor mu?',
  'Konferans katılımı destekleniyor mu?',
  'Sertifika sınav ücreti ödeniyor mu?',
  'Sertifika programı sonrası kaç ay çalışma taahhüdü verilir?',
  'Taahhüt süresi dolmadan ayrılırsam ne olur?',
  'Yüksek lisans desteği var mı?',
  'Dil eğitimi desteği veriliyor mu?',
  'İngilizce kursu şirket tarafından karşılanıyor mu?',
  'Mentorluk programı var mı?',
  'Mentor nasıl atanıyor?',
  'Koçluk desteği alabilir miyim?',
  'Yetenek havuzu nedir?',
  'Yedekleme planı var mı?',
  'İç eğitmen olabilir miyim?',
  'Eğitim katılım zorunlu mu?',
  'Eğitime katılmazsam ne olur?',
  'Zorunlu eğitimler hangileri?',
  'Eğitim mesai saatinde mi yapılıyor?',
  'Gelişim geri bildirimi ne sıklıkla veriliyor?',
  'Kendi kendime değerlendirme yapıyor muyum?',
  'Yöneticimi değerlendirebilir miyim?',
  'Performans sistemi kimler için geçerli?',
  'Yeni başlayanlar performans değerlendirmesine girer mi?',
  'İzinli olduğum dönem performansımı etkiler mi?',
  'Proje bazlı değerlendirme yapılıyor mu?',
  'Takım performansı bireysel notumu etkiler mi?',
  'Performans sonuçları gizli mi?',
  'Performans geçmişimi görebilir miyim?',
  'Rotasyon programı var mı?',
  'Yurt dışı görevlendirme kariyerimi etkiler mi?',
  'İş değiştirmek isteyenler için içeride destek var mı?',
  'Geri bildirim kültürü nasıl işliyor?',
  'Anonim geri bildirim verebilir miyim?',
];

/* ------------------------------------------------------------------ *
 *  6. DISIPLIN VE ETIK                                                *
 * ------------------------------------------------------------------ */
const disiplinEtik = [
  'Disiplin süreci nasıl işliyor?',
  'Disiplin cezaları nelerdir?',
  'Uyarı cezası kaç kez verilir?',
  'Kınama cezası ne demek?',
  'Disiplin cezasına kaç iş günü içinde itiraz edebilirim?',
  'Savunma için çalışana en az kaç iş günü süre tanınır?',
  'Savunma vermezsem ne olur?',
  'Disiplin kurulu kimlerden oluşuyor?',
  'Disiplin cezası özlük dosyama işlenir mi?',
  'Disiplin cezası ne kadar süre sonra siliniyor?',
  'Kaç gün devamsızlık yaparsam işten çıkarılırım?',
  'Aylık toplam devamsızlık sınırı nedir?',
  'Mazeretsiz devamsızlık nasıl değerlendiriliyor?',
  'Geç kalmalar devamsızlık sayılır mı?',
  'İşe gelmeyeceğimi nasıl bildirmeliyim?',
  'Tedarikçiden en fazla kaç TL değerinde hediye kabul edilebilir?',
  'Hediye kabul etmenin kuralı nedir?',
  'Müşteriden hediye alabilir miyim?',
  'Yemek daveti kabul edebilir miyim?',
  'Çıkar çatışması nedir?',
  'Akrabam şirkete başvurabilir mi?',
  'Akrabamla aynı departmanda çalışabilir miyim?',
  'Şirket içi ilişkiler hakkında kural var mı?',
  'İş yerinde alkol yasağı var mı?',
  'Şirket etkinliklerinde alkol serbest mi?',
  'Sigara içmek serbest mi?',
  'Ofiste sigara alanı var mı?',
  'Rüşvet politikası nedir?',
  'Şüpheli bir durumu nasıl bildiririm?',
  'İhbar hattı var mı?',
  'İhbarda bulunursam kimliğim gizli kalır mı?',
  'İhbarcı koruması var mı?',
  'Şirket bilgisayarında kişisel dosya tutabilir miyim?',
  'Lisanssız araç kullanımı yasak mı?',
  'Şirket internetini kişisel amaçla kullanabilir miyim?',
  'Sosyal medyada şirket hakkında paylaşım yapabilir miyim?',
  'Şirket adına açıklama yapabilir miyim?',
  'Basınla iletişim kim tarafından yapılıyor?',
  'İş yerinde fotoğraf çekebilir miyim?',
  'Toplantı kaydı alabilir miyim?',
  'Şirket sırrı nedir?',
  'Gizli bilgiyi paylaşırsam ne olur?',
  'Eski işverenimin bilgilerini kullanabilir miyim?',
  'Şirket dışında danışmanlık yapabilir miyim?',
  'Siyasi faaliyet yasağı var mı?',
  'İş yerinde bağış toplayabilir miyim?',
  'Ofiste satış yapabilir miyim?',
  'Kılık kıyafet kuralına uymazsam ne olur?',
  'Kimlik kartımı takmak zorunda mıyım?',
  'Kimlik kartımı kaybedersem ne yapmalıyım?',
  'Ziyaretçi getirebilir miyim?',
  'Ofise arkadaşımı davet edebilir miyim?',
  'Etik kurallara aykırı davranışın cezası nedir?',
  'Etik kurul kararına itiraz edilebilir mi?',
  'Ofise evcil hayvan getirebilir miyim?',
];

/* ------------------------------------------------------------------ *
 *  7. IS SAGLIGI VE GUVENLIGI                                         *
 * ------------------------------------------------------------------ */
const isgSaglik = [
  'İSG eğitimi zorunlu mu?',
  'Tehlikeli iş yerlerinde İSG eğitimi kaç yılda bir tekrarlanır?',
  'İSG eğitimine katılmazsam ne olur?',
  'İş kazası kaç gün içinde SGK\'ya bildirilir?',
  'İş kazası olduğunda ilk ne yapmalıyım?',
  'İş kazasını kime bildirmeliyim?',
  'Ramak kala olayı nedir?',
  'Ramak kala bildirimi zorunlu mu?',
  'Meslek hastalığı nasıl tespit ediliyor?',
  'Periyodik sağlık muayenesi ne sıklıkla yapılıyor?',
  'İşe giriş sağlık raporu gerekiyor mu?',
  'Sağlık muayenesine katılmak zorunda mıyım?',
  'Koruyucu donanım kullanmak zorunlu mu?',
  'Baret ve gözlük nereden temin edilir?',
  'Koruyucu donanımı kullanmazsam yaptırım var mı?',
  'Yangın tatbikatı ne sıklıkla yapılıyor?',
  'Tahliye planı nerede asılı?',
  'Yangın çıkışları nerede?',
  'Acil durum toplanma alanı neresi?',
  'Deprem anında ne yapmalıyım?',
  'İlk yardım ekibi kimlerden oluşuyor?',
  'İlk yardım eğitimi alabilir miyim?',
  'Revir var mı?',
  'İş yerinde doktor bulunuyor mu?',
  'Ergonomi değerlendirmesi yapılıyor mu?',
  'Masa ve sandalye ayarı için destek alabilir miyim?',
  'Ekran koruyucu gözlük veriliyor mu?',
  'Uzun süre oturmaya karşı mola önerisi var mı?',
  'Gürültü ölçümü yapılıyor mu?',
  'Aydınlatma standardı nedir?',
  'Havalandırma şikâyetimi nereye iletebilirim?',
  'İş yerinde su sebili var mı?',
  'Temizlik ne sıklıkla yapılıyor?',
  'Hijyen kuralları neler?',
  'Bulaşıcı hastalık durumunda ne yapmalıyım?',
  'Ateşim varsa işe gelmeli miyim?',
  'Salgın döneminde uzaktan çalışma zorunlu mu?',
  'Maske zorunluluğu var mı?',
  'Aşı desteği veriliyor mu?',
  'Psikolojik destek hizmeti var mı?',
  'Çalışan destek programı nedir?',
  'Stres yönetimi eğitimi var mı?',
  'Tükenmişlik yaşıyorsam kime başvurabilirim?',
  'İş yükü fazla gelirse ne yapmalıyım?',
  'Hamile çalışanlar için özel düzenleme var mı?',
  'Hamileyken gece vardiyasında çalışabilir miyim?',
  'Emziren çalışanlar için oda var mı?',
  'Engelli çalışanlar için erişilebilirlik düzenlemesi var mı?',
  'Asansör arızasında ne yapılır?',
  'Elektrik kesintisinde çalışmaya devam eder miyim?',
  'İş yerinde kaza geçirirsem masraflar karşılanır mı?',
  'İşe gidiş gelişte kaza olursa iş kazası sayılır mı?',
  'Görev seyahatinde kaza olursa ne olur?',
  'Riskli işler için ek prim var mı?',
  'İSG kurulu toplantıları ne sıklıkla?',
  'Çalışan temsilcisi kim?',
  'Güvenlik ihlali gördüğümde ne yapmalıyım?',
  'İş durdurma hakkım var mı?',
  'Tehlikeli bir işi reddedebilir miyim?',
  'İş güvenliği uzmanına nasıl ulaşırım?',
];

/* ------------------------------------------------------------------ *
 *  8. UYUM, KVKK, ISYERI ORTAMI                                       *
 * ------------------------------------------------------------------ */
const uyumOrtam = [
  'KVKK kapsamında hangi verilerim işleniyor?',
  'Kişisel verilerim ne kadar süre saklanıyor?',
  'Özlük dosyaları kaç yıl saklanır?',
  'Olumsuz sonuçlanan aday başvuruları en fazla kaç yıl saklanır?',
  'Kamera kayıtları kaç gün saklanır?',
  'Ofiste kamera var mı?',
  'Kamera kayıtlarını kim izleyebiliyor?',
  'E-postalarım okunuyor mu?',
  'Şirket bilgisayarım izleniyor mu?',
  'İnternet kullanımım kaydediliyor mu?',
  'Verilerimin silinmesini talep edebilir miyim?',
  'KVKK başvurusunu nereye yapmalıyım?',
  'KVKK başvuruma kaç günde cevap verilir?',
  'Verilerim yurt dışına aktarılıyor mu?',
  'Veri ihlali olursa bilgilendirilir miyim?',
  'Veri ihlalini kime bildirmeliyim?',
  'Açık rıza vermek zorunda mıyım?',
  'Rızamı geri çekebilir miyim?',
  'Fotoğrafım şirket tanıtımında kullanılabilir mi?',
  'Şirket rehberinde bilgilerim görünür mü?',
  'Mobbing nedir?',
  'Mobbing bildirimini nereye yapabilirim?',
  'Mobbing şikâyeti nasıl sonuçlanıyor?',
  'Şikâyetim gizli tutulur mu?',
  'Şikâyetim sonrası misilleme olur mu?',
  'Ayrımcılık politikası nedir?',
  'Eşit işe eşit ücret uygulanıyor mu?',
  'Cinsiyet eşitliği politikası var mı?',
  'Taciz durumunda ne yapmalıyım?',
  'Taciz şikâyeti nasıl inceleniyor?',
  'Şikâyet kanalları neler?',
  'Anonim şikâyet edebilir miyim?',
  'İnsan kaynaklarına nasıl ulaşabilirim?',
  'İK ile birebir görüşme talep edebilir miyim?',
  'Çalışan memnuniyeti anketi yapılıyor mu?',
  'Anket sonuçları paylaşılıyor mu?',
  'Öneri sistemi var mı?',
  'Önerim uygulanırsa ödül alır mıyım?',
  'Şirket içi iletişim kanalları neler?',
  'Duyurular nereden yapılıyor?',
  'Uzaktan çalışırken ekipman güvenliği nasıl sağlanır?',
  'Şirket bilgisayarını evde kullanabilir miyim?',
  'Şirket bilgisayarını ailem kullanabilir mi?',
  'Halka açık wifi kullanabilir miyim?',
  'VPN kullanmak zorunda mıyım?',
  'Şifre politikası nedir?',
  'Şifremi ne sıklıkla değiştirmeliyim?',
  'İki faktörlü doğrulama zorunlu mu?',
  'Cihazımı kaybedersem ne yapmalıyım?',
  'USB bellek kullanabilir miyim?',
  'Bulut depolama kullanabilir miyim?',
  'Kişisel telefonumla şirket e-postasına bakabilir miyim?',
  'Yapay zekâ araçlarını işte kullanabilir miyim?',
  'Şirket verisini yapay zekâya girebilir miyim?',
  'Sürdürülebilirlik politikası var mı?',
  'Geri dönüşüm uygulaması var mı?',
  'Gönüllülük programı var mı?',
  'Sosyal sorumluluk projelerine katılabilir miyim?',
  'Şirketin bu çeyrek cirosu ne oldu?',
  'Yemekhanede bugün ne var?',
];

/* ------------------------------------------------------------------ *
 *  KAPSAM DISI oldugu KAPSAM.md'de yazili olanlar                     *
 * ------------------------------------------------------------------ */
const kapsamDisiSorular = new Set([
  'Şirket aracı tahsis ediliyor mu?',
  'Hisse senedi opsiyonu alabilir miyim?',
  'Yemekhanede bugün ne var?',
  'Şirketin bu çeyrek cirosu ne oldu?',
  // Degerlendirme paketinin oos-1 ve multi-5 vakasi. Korpusa evcil hayvan
  // politikasi eklemek bu iki testi SESSIZCE bozardi — tarama bir eksik
  // gorunse de burasi bilerek bostur.
  'Ofise evcil hayvan getirebilir miyim?',
]);

const alanlar: { ad: string; sorular: string[] }[] = [
  { ad: 'Çalışma düzeni', sorular: calismaDuzeni },
  { ad: 'İzinler', sorular: izinler },
  { ad: 'Ücret ve yan haklar', sorular: ucretVeHaklar },
  { ad: 'İstihdam döngüsü', sorular: istihdamDongusu },
  { ad: 'Performans ve gelişim', sorular: performansGelisim },
  { ad: 'Disiplin ve etik', sorular: disiplinEtik },
  { ad: 'İSG ve sağlık', sorular: isgSaglik },
  { ad: 'Uyum ve işyeri ortamı', sorular: uyumOrtam },
];

export const temelSorular: TemelSoru[] = alanlar.flatMap((a, ai) =>
  a.sorular.map((soru, si) => ({
    id: `${ai + 1}-${String(si + 1).padStart(3, '0')}`,
    alan: a.ad,
    soru,
    beklenen: (kapsamDisiSorular.has(soru) ? 'kapsamDisi' : 'cevaplanmali') as Beklenti,
  })),
);

/* ================================================================== *
 *  IFADE DONUSUMLERI                                                 *
 * ================================================================== */

/** Turkce karakterleri duz karsiliklarina indirger — cok yaygin bir yazim. */
const duzHarf = (t: string): string =>
  t
    .replace(/ı/g, 'i').replace(/İ/g, 'I')
    .replace(/ş/g, 's').replace(/Ş/g, 'S')
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
    .replace(/ü/g, 'u').replace(/Ü/g, 'U')
    .replace(/ö/g, 'o').replace(/Ö/g, 'O')
    .replace(/ç/g, 'c').replace(/Ç/g, 'C');

/** Deterministik konum secimi — ayni soru her kosumda ayni sekilde bozulur. */
function tohum(t: string): number {
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return h;
}

/** Bir harf dusurur (klavye hatasi). */
function harfDusur(t: string): string {
  const govde = t.replace(/[?!.]+$/, '');
  if (govde.length < 8) return t;
  const i = 4 + (tohum(t) % (govde.length - 6));
  return govde.slice(0, i) + govde.slice(i + 1);
}

/** Iki komsu harfi yer degistirir (en sik yazim hatasi). */
function harfDegistir(t: string): string {
  const govde = t.replace(/[?!.]+$/, '');
  if (govde.length < 8) return t;
  const i = 4 + (tohum(t) % (govde.length - 6));
  if (govde[i] === ' ' || govde[i + 1] === ' ') return govde;
  return govde.slice(0, i) + govde[i + 1] + govde[i] + govde.slice(i + 2);
}

/** Es anlamli sozcuk degisimleri — kullanicinin kelimesi mevzuatinki olmayabilir. */
const esAnlamlilar: [RegExp, string][] = [
  [/\banalık\b/gi, 'annelik'],
  [/\bçalışan\b/gi, 'personel'],
  [/\bşirket\b/gi, 'firma'],
  [/\bmesai saatleri\b/gi, 'çalışma saatleri'],
  [/\bücret\b/gi, 'maaş'],
  [/\bizin\b/gi, 'tatil'],
  [/\bfesih\b/gi, 'işten çıkarma'],
  [/\byönetici\b/gi, 'amir'],
  [/\btazminat\b/gi, 'ödeme'],
  [/\beğitim\b/gi, 'kurs'],
];

function esAnlamliUygula(t: string): string {
  for (const [kalip, yeni] of esAnlamlilar) {
    if (kalip.test(t)) return t.replace(kalip, yeni);
  }
  return t;
}

/** Bas buyuk harfi kucultur (kutu icine hizli yazim). */
const kucult = (t: string) => t.charAt(0).toLocaleLowerCase('tr') + t.slice(1);

export interface Donusum {
  ad: string;
  uygula: (t: string) => string;
}

/**
 * 20 donusum. Hepsi GERCEK kullanici davranisi; uydurma bozma yok.
 *
 * Kimlik donusumu ilk sirada: temel sorunun kendisi de bankada olmali.
 */
export const donusumler: Donusum[] = [
  { ad: 'ozgun',            uygula: (t) => t },
  { ad: 'kucuk-harf',       uygula: (t) => t.toLocaleLowerCase('tr') },
  { ad: 'duz-harf',         uygula: duzHarf },
  { ad: 'duz-harf-kucuk',   uygula: (t) => duzHarf(t).toLocaleLowerCase('tr') },
  { ad: 'soru-isaretsiz',   uygula: (t) => t.replace(/\?+$/, '') },
  { ad: 'acaba',            uygula: (t) => `acaba ${kucult(t)}` },
  { ad: 'selamli',          uygula: (t) => `merhaba, ${kucult(t)}` },
  { ad: 'sorum-var',        uygula: (t) => `bir sorum var: ${kucult(t)}` },
  { ad: 'ogrenmek-istiyorum', uygula: (t) => `${t.replace(/\?+$/, '')} öğrenmek istiyorum` },
  { ad: 'bilgi-verir-misin', uygula: (t) => `${t.replace(/\?+$/, '')} konusunda bilgi verir misin` },
  { ad: 'peki',             uygula: (t) => `peki ${kucult(t)}` },
  { ad: 'sirkette',         uygula: (t) => `şirkette ${kucult(t)}` },
  { ad: 'tesekkurlu',       uygula: (t) => `${t} teşekkürler` },
  { ad: 'buyuk-harf',       uygula: (t) => t.toLocaleUpperCase('tr') },
  { ad: 'bosluklu',         uygula: (t) => `  ${t.replace(/ /g, '  ')}  ` },
  { ad: 'harf-dusur',       uygula: harfDusur },
  { ad: 'harf-degistir',    uygula: harfDegistir },
  { ad: 'es-anlamli',       uygula: esAnlamliUygula },
  { ad: 'es-anlamli-duz',   uygula: (t) => duzHarf(esAnlamliUygula(t)) },
  { ad: 'kisa',             uygula: (t) => t.replace(/^(acaba|peki)\s+/i, '').replace(/\?+$/, '').split(' ').slice(0, 5).join(' ') },
];

export interface Sorgu {
  temelId: string;
  alan: string;
  beklenen: Beklenti;
  donusum: string;
  temel: string;
  metin: string;
}

/** 500 temel soru x 20 donusum = 10.000 sorgu. Deterministik. */
export function bankayiUret(): Sorgu[] {
  const cikti: Sorgu[] = [];
  for (const t of temelSorular) {
    for (const d of donusumler) {
      cikti.push({
        temelId: t.id,
        alan: t.alan,
        beklenen: t.beklenen,
        donusum: d.ad,
        temel: t.soru,
        metin: d.uygula(t.soru),
      });
    }
  }
  return cikti;
}
