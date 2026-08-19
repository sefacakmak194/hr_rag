/**
 * SAHA SORU SETI — gercek calisanin sordugu 100 soru.
 *
 * NEDEN AYRI BIR SET: `question-bank.ts` korpustan TURETILMIS sorulari 20 ayri
 * ifadeyle cogaltir; yani korpusun kendi diliyle sorar ve dogal olarak yuksek
 * cevaplanma orani uretir. Bu set ise DISARIDAN geldi: bir IK biriminin
 * calisanlardan topladigi gercek sorular. Korpusun dilini bilmiyor, kisaltma
 * kullaniyor ("ÖSS", "IDP", "core hours"), tek soruda iki-uc olgu birden
 * istiyor ("kac gundur VE hangi evraklar").
 *
 * Olcumdeki degeri: tarama korpusun IC tutarliligini, bu set DIS gecerliligini
 * olcer. Ikisi ayri seydir ve ikincisi daha zordur.
 *
 * `beklenen` alani KASITLI bir karardir, sonuca bakilarak doldurulmadi:
 *   cevaplanmali — bu bir IK mevzuat sorusudur, korpus karsilamali
 *   kapsamDisi   — data/KAPSAM.md'de bilincli olarak disarida birakilmis
 */

export interface SahaSorusu {
  id: string;
  alan: string;
  soru: string;
  beklenen: 'cevaplanmali' | 'kapsamDisi';
  /** Yanitta gecmesi beklenen olgular — bos ise yalnizca cevaplanma olculur. */
  bekle?: string[];
}

export const sahaSorulari: SahaSorusu[] = [
  // ------------------------------------------------ 1. Ucret, bordro ve avans
  { id: 'ucr-01', alan: 'Ücret, bordro ve avans', soru: 'Bu ayki bordromu nereden ve nasıl görüntüleyebilirim?', beklenen: 'cevaplanmali' },
  { id: 'ucr-02', alan: 'Ücret, bordro ve avans', soru: 'Maaş zamları yılın hangi döneminde, hangi enflasyon ve performans kriterlerine göre belirleniyor?', beklenen: 'cevaplanmali' },
  { id: 'ucr-03', alan: 'Ücret, bordro ve avans', soru: 'Bordromdaki gelir vergisi dilimi kesintisi neden bu ay daha yüksek çıktı?', beklenen: 'cevaplanmali' },
  { id: 'ucr-04', alan: 'Ücret, bordro ve avans', soru: 'Maaş avansı talep edebilir miyim; şartları, kesinti takvimi ve limitleri nelerdir?', beklenen: 'cevaplanmali' },
  { id: 'ucr-05', alan: 'Ücret, bordro ve avans', soru: 'Fazla mesai ödemeleri bordroya ne zaman ve hangi katsayıyla yansıtılıyor?', beklenen: 'cevaplanmali' },
  { id: 'ucr-06', alan: 'Ücret, bordro ve avans', soru: 'Yıllık veya dönemsel prim ve ikramiye ödemeleri hangi tarihte hesaplara yatırılır?', beklenen: 'cevaplanmali' },
  { id: 'ucr-07', alan: 'Ücret, bordro ve avans', soru: 'Banka hesap numaramı veya IBAN bilgilerimi nereden güncelleyebilirim?', beklenen: 'cevaplanmali' },
  { id: 'ucr-08', alan: 'Ücret, bordro ve avans', soru: 'Bireysel Emeklilik Sistemi kesintisini nasıl iptal edebilir veya fon oranını değiştirebilirim?', beklenen: 'cevaplanmali' },
  { id: 'ucr-09', alan: 'Ücret, bordro ve avans', soru: 'Maaş haczi veya nafaka kesintisi durumunda yasal kesinti süreci nasıl işliyor?', beklenen: 'cevaplanmali' },
  { id: 'ucr-10', alan: 'Ücret, bordro ve avans', soru: 'Yol ve yemek ücreti nakit olarak mı ödeniyor yoksa karta mı yükleniyor?', beklenen: 'cevaplanmali' },
  { id: 'ucr-11', alan: 'Ücret, bordro ve avans', soru: 'Döviz kuru veya yüksek enflasyon kaynaklı yıl ortası ara zam yapılacak mı?', beklenen: 'cevaplanmali' },
  { id: 'ucr-12', alan: 'Ücret, bordro ve avans', soru: 'Vergi matrahı kümülatif aktarımı, yani önceki iş yerinden gelen matrah sisteme nasıl işlenir?', beklenen: 'cevaplanmali' },

  // ------------------------------------------------ 2. Izin haklari
  { id: 'izn-01', alan: 'İzin hakları ve süreçleri', soru: 'Kalan yıllık izin gün bakiyemi nereden ve nasıl görebilirim?', beklenen: 'cevaplanmali' },
  { id: 'izn-02', alan: 'İzin hakları ve süreçleri', soru: 'Yıllık izin hakkım tam olarak hangi tarihte yenileniyor?', beklenen: 'cevaplanmali' },
  { id: 'izn-03', alan: 'İzin hakları ve süreçleri', soru: 'Yıl içinde kullanılmayan yıllık izinler bir sonraki yıla devreder mi, yanar mı?', beklenen: 'cevaplanmali' },
  { id: 'izn-04', alan: 'İzin hakları ve süreçleri', soru: 'Deneme sürem dolmadan yıllık izin veya avans izin kullanabilir miyim?', beklenen: 'cevaplanmali' },
  { id: 'izn-05', alan: 'İzin hakları ve süreçleri', soru: 'Doktor raporu aldığımda bunu sisteme ne zamana kadar yüklemeliyim ve SGK bildirimini kim yapar?', beklenen: 'cevaplanmali' },
  { id: 'izn-06', alan: 'İzin hakları ve süreçleri', soru: 'Evlilik izni kaç gündür ve hangi resmi evrakları ibraz etmem gerekir?', beklenen: 'cevaplanmali', bekle: ['3'] },
  { id: 'izn-07', alan: 'İzin hakları ve süreçleri', soru: 'Babalık izni yasal olarak kaç gündür; şirket ek süre tanıyor mu?', beklenen: 'cevaplanmali', bekle: ['5'] },
  { id: 'izn-08', alan: 'İzin hakları ve süreçleri', soru: 'Birinci ve ikinci derece yakınların vefatı durumunda mazeret izni süresi nedir?', beklenen: 'cevaplanmali', bekle: ['3'] },
  { id: 'izn-09', alan: 'İzin hakları ve süreçleri', soru: 'Ücretsiz izin talep etme kriterleri ve izin boyunca SGK prim durumu nedir?', beklenen: 'cevaplanmali' },
  { id: 'izn-10', alan: 'İzin hakları ve süreçleri', soru: 'Taşınma izni hakkımız var mı, kaç iş günü olarak kullanılır?', beklenen: 'cevaplanmali' },
  { id: 'izn-11', alan: 'İzin hakları ve süreçleri', soru: 'Süt izni ve doğum sonrası kısmi süreli çalışma hakları haftalık bazda nasıl planlanır?', beklenen: 'cevaplanmali' },
  { id: 'izn-12', alan: 'İzin hakları ve süreçleri', soru: 'SGK iş göremezlik ödeneğini, yani rapor parasını nasıl alırım; şirkete iadesi gerekir mi?', beklenen: 'cevaplanmali' },
  { id: 'izn-13', alan: 'İzin hakları ve süreçleri', soru: 'Yüksek lisans, doktora veya sınav günleri için eğitim izni veriliyor mu?', beklenen: 'cevaplanmali' },

  // ------------------------------------------------ 3. Yan haklar
  { id: 'yan-01', alan: 'Yan haklar ve sosyal yardımlar', soru: 'Tamamlayıcı sağlık sigortası poliçe kapsamım ve limitlerim nelerdir?', beklenen: 'cevaplanmali' },
  { id: 'yan-02', alan: 'Yan haklar ve sosyal yardımlar', soru: 'Eşimi ve çocuklarımı şirket sağlık sigortası kapsamına nasıl dahil edebilirim?', beklenen: 'cevaplanmali' },
  { id: 'yan-03', alan: 'Yan haklar ve sosyal yardımlar', soru: 'Yemek kartı bakiyesi her ayın kaçında yüklenir ve resmi tatillerde kesinti yapılır mı?', beklenen: 'cevaplanmali' },
  { id: 'yan-04', alan: 'Yan haklar ve sosyal yardımlar', soru: 'İşe gelmediğim, raporda veya izinde olduğum günlerde yemek parası kesilir mi?', beklenen: 'cevaplanmali' },
  { id: 'yan-05', alan: 'Yan haklar ve sosyal yardımlar', soru: 'Şirket aracı kullanım politikası, kasko şartları ve aylık yakıt limiti nedir?', beklenen: 'kapsamDisi' },
  { id: 'yan-06', alan: 'Yan haklar ve sosyal yardımlar', soru: 'Personel servisi güzergahlarına, duraklarına ve saatlerine nereden ulaşabilirim?', beklenen: 'cevaplanmali' },
  { id: 'yan-07', alan: 'Yan haklar ve sosyal yardımlar', soru: 'Uzaktan veya hibrit çalışanlar için ev interneti ya da fatura desteği sağlanıyor mu?', beklenen: 'cevaplanmali' },
  { id: 'yan-08', alan: 'Yan haklar ve sosyal yardımlar', soru: 'Şirketin sağladığı psikolojik danışmanlık, diyetisyen veya esenlik destekleri var mı?', beklenen: 'cevaplanmali' },
  { id: 'yan-09', alan: 'Yan haklar ve sosyal yardımlar', soru: 'Bayram yardımı, kırtasiye yardımı veya yakacak yardımı gibi sosyal ödenekler mevcut mu?', beklenen: 'cevaplanmali' },
  { id: 'yan-10', alan: 'Yan haklar ve sosyal yardımlar', soru: 'Şirket hattı ve telefon tahsis kuralları ile yurt dışı dolaşım paketi nasıl açılır?', beklenen: 'cevaplanmali' },
  { id: 'yan-11', alan: 'Yan haklar ve sosyal yardımlar', soru: 'Şirket çalışanlarına özel indirim sağlayan kurumsal marka ve anlaşmalar hangileridir?', beklenen: 'cevaplanmali' },
  { id: 'yan-12', alan: 'Yan haklar ve sosyal yardımlar', soru: 'Sağlık sigortasından karşılanmayan muayene ve tahlil faturalarını şirketten talep edebilir miyim?', beklenen: 'cevaplanmali' },
  { id: 'yan-13', alan: 'Yan haklar ve sosyal yardımlar', soru: 'Şirket bünyesinde kreş desteği veya anlaşmalı anaokulu indirimi bulunuyor mu?', beklenen: 'cevaplanmali', bekle: ['4.000'] },

  // ------------------------------------------------ 4. Performans ve kariyer
  { id: 'prf-01', alan: 'Performans, terfi ve kariyer', soru: 'Yıllık ve dönemlik performans değerlendirme süreci hangi tarihte başlıyor?', beklenen: 'cevaplanmali' },
  { id: 'prf-02', alan: 'Performans, terfi ve kariyer', soru: 'Performans değerlendirme puanım maaş artışımı ve primimi nasıl etkiliyor?', beklenen: 'cevaplanmali' },
  { id: 'prf-03', alan: 'Performans, terfi ve kariyer', soru: 'Farklı bir departmana veya pozisyona yatay geçiş süreci nasıl yürütülür?', beklenen: 'cevaplanmali' },
  { id: 'prf-04', alan: 'Performans, terfi ve kariyer', soru: 'Terfi alabilmek için mevcut rolde minimum ne kadar süre çalışmış olmak gerekir?', beklenen: 'cevaplanmali' },
  { id: 'prf-05', alan: 'Performans, terfi ve kariyer', soru: 'Şirket içi açık pozisyonları nereden takip edebilir ve nasıl başvurabilirim?', beklenen: 'cevaplanmali' },
  { id: 'prf-06', alan: 'Performans, terfi ve kariyer', soru: 'Yöneticimin verdiği performans puanına itiraz etmek istersem izlemem gereken resmi yol nedir?', beklenen: 'cevaplanmali' },
  { id: 'prf-07', alan: 'Performans, terfi ve kariyer', soru: '360 derece geri bildirim anketi kimleri kapsıyor ve verdiğim yanıtlar anonim mi?', beklenen: 'cevaplanmali' },
  { id: 'prf-08', alan: 'Performans, terfi ve kariyer', soru: 'Bireysel gelişim planı hedeflerimi ne zaman ve nereye girmeliyim?', beklenen: 'cevaplanmali' },
  { id: 'prf-09', alan: 'Performans, terfi ve kariyer', soru: 'Performans hedeflerimin yıl içinde değişmesi durumunda revizyon nasıl yapılır?', beklenen: 'cevaplanmali' },
  { id: 'prf-10', alan: 'Performans, terfi ve kariyer', soru: 'Şirket içi mentorluk veya tersine mentorluk programlarına nasıl dahil olabilirim?', beklenen: 'cevaplanmali' },
  { id: 'prf-11', alan: 'Performans, terfi ve kariyer', soru: 'Unvan değişikliği veya rol büyümesi ara dönemde maaş artışını otomatik getirir mi?', beklenen: 'cevaplanmali' },
  { id: 'prf-12', alan: 'Performans, terfi ve kariyer', soru: 'Yetenek havuzu veya liderlik akademisine dahil edilme kriterleri nelerdir?', beklenen: 'cevaplanmali' },

  // ------------------------------------------------ 5. Egitim ve gelisim
  { id: 'egt-01', alan: 'Eğitim ve kişisel gelişim', soru: 'Departman dışı mesleki bir sertifika veya eğitim almak istediğimde bütçe desteği nasıl talep edilir?', beklenen: 'cevaplanmali' },
  { id: 'egt-02', alan: 'Eğitim ve kişisel gelişim', soru: 'Şirketin karşıladığı eğitimler için belirli bir süre çalışma taahhüdü isteniyor mu?', beklenen: 'cevaplanmali' },
  { id: 'egt-03', alan: 'Eğitim ve kişisel gelişim', soru: 'Yüksek lisans veya doktora yapan çalışanlara zaman esnekliği ya da finansal destek sağlanıyor mu?', beklenen: 'cevaplanmali' },
  { id: 'egt-04', alan: 'Eğitim ve kişisel gelişim', soru: 'Kurumsal online eğitim platformlarına ücretsiz üyelik nasıl alınır?', beklenen: 'cevaplanmali' },
  { id: 'egt-05', alan: 'Eğitim ve kişisel gelişim', soru: 'Yabancı dil eğitim desteği veriliyor mu ya da dil tazminatı uygulaması var mı?', beklenen: 'cevaplanmali' },
  { id: 'egt-06', alan: 'Eğitim ve kişisel gelişim', soru: 'Zorunlu İSG ve KVKK eğitimlerini hangi süre içinde tamamlamalıyım?', beklenen: 'cevaplanmali' },
  { id: 'egt-07', alan: 'Eğitim ve kişisel gelişim', soru: 'Sektörel konferans, fuar veya seminer katılım bütçesi hangi durumlarda onaylanır?', beklenen: 'cevaplanmali' },
  { id: 'egt-08', alan: 'Eğitim ve kişisel gelişim', soru: 'Yeni başlayan ekip arkadaşları için mentor veya buddy ataması nasıl yapılıyor?', beklenen: 'cevaplanmali' },
  { id: 'egt-09', alan: 'Eğitim ve kişisel gelişim', soru: 'Oryantasyon sürecimdeki eksik form ve eğitimleri nereden tamamlayabilirim?', beklenen: 'cevaplanmali' },
  { id: 'egt-10', alan: 'Eğitim ve kişisel gelişim', soru: 'Şirket içi eğitmen olmak için hangi adımları izlemeliyim?', beklenen: 'cevaplanmali' },

  // ------------------------------------------------ 6. Calisma modelleri ve mesai
  { id: 'cal-01', alan: 'Çalışma modelleri ve mesai', soru: 'Haftalık uzaktan çalışma gün kotamız kaçtır?', beklenen: 'cevaplanmali', bekle: ['2'] },
  { id: 'cal-02', alan: 'Çalışma modelleri ve mesai', soru: 'Belirli bir süre farklı bir şehirden veya yurt dışından uzaktan çalışabilir miyim?', beklenen: 'cevaplanmali' },
  { id: 'cal-03', alan: 'Çalışma modelleri ve mesai', soru: 'Esnek çalışma saatleri politikamızda çekirdek saat aralığı nedir?', beklenen: 'cevaplanmali' },
  { id: 'cal-04', alan: 'Çalışma modelleri ve mesai', soru: 'Fazla mesai onayını kim verir ve bir çalışan yılda en fazla kaç saat mesaiye kalabilir?', beklenen: 'cevaplanmali', bekle: ['270'] },
  { id: 'cal-05', alan: 'Çalışma modelleri ve mesai', soru: 'Ev ofis ergonomi desteği talep süreci nasıl işler; ek monitör veya ofis sandalyesi verilir mi?', beklenen: 'cevaplanmali' },
  { id: 'cal-06', alan: 'Çalışma modelleri ve mesai', soru: 'Kart basmayı unuttuğumda veya turnike giriş çıkış hatalarında düzeltmeyi nasıl yaparım?', beklenen: 'cevaplanmali' },
  { id: 'cal-07', alan: 'Çalışma modelleri ve mesai', soru: 'İcap veya nöbet mesaisi ücretlendirmesi ve izin karşılığı nasıl hesaplanır?', beklenen: 'cevaplanmali' },
  { id: 'cal-08', alan: 'Çalışma modelleri ve mesai', soru: 'İşe geç kalma tolerans sınırı nedir ve sürekli geç kalma durumunda süreç nasıl işletilir?', beklenen: 'cevaplanmali' },
  { id: 'cal-09', alan: 'Çalışma modelleri ve mesai', soru: 'Resmî tatil gününe denk gelen vardiyalarda çalışma ücreti veya telafi izni nasıl uygulanır?', beklenen: 'cevaplanmali' },
  { id: 'cal-10', alan: 'Çalışma modelleri ve mesai', soru: 'Ofiste uygulanan kıyafet yönetmeliği ve serbest cuma kuralları nelerdir?', beklenen: 'cevaplanmali' },
  { id: 'cal-11', alan: 'Çalışma modelleri ve mesai', soru: 'İş seyahatlerinde günlük harcırah limitleri ve masraf onay mekanizması nasıldır?', beklenen: 'cevaplanmali' },
  { id: 'cal-12', alan: 'Çalışma modelleri ve mesai', soru: 'Şahsi araçla iş amaçlı seyahat edildiğinde kilometre bazlı yakıt bedeli nasıl ödenir?', beklenen: 'cevaplanmali' },

  // ------------------------------------------------ 7. Cikis surecleri
  { id: 'ckt-01', alan: 'İşten ayrılma ve çıkış', soru: 'İstifa dilekçemi kime, hangi formatta ve ne kadar süre önceden teslim etmeliyim?', beklenen: 'cevaplanmali' },
  { id: 'ckt-02', alan: 'İşten ayrılma ve çıkış', soru: 'İhbar süresi içinde günlük 2 saatlik yeni iş arama iznini toplu kullanabilir miyim?', beklenen: 'cevaplanmali' },
  { id: 'ckt-03', alan: 'İşten ayrılma ve çıkış', soru: 'İhbar süremi çalışmak yerine ihbar tazminatını ödeyerek derhal ayrılabilir miyim?', beklenen: 'cevaplanmali' },
  { id: 'ckt-04', alan: 'İşten ayrılma ve çıkış', soru: 'Kıdem tazminatı alma şartlarım nelerdir ve brüt kıdem tavanı üzerinden hesaplama nasıl yapılır?', beklenen: 'cevaplanmali' },
  { id: 'ckt-05', alan: 'İşten ayrılma ve çıkış', soru: 'Kullanmadığım yıllık izin günlerimin ücreti son maaş bordroma nasıl yansır?', beklenen: 'cevaplanmali' },
  { id: 'ckt-06', alan: 'İşten ayrılma ve çıkış', soru: 'İşten çıkış mülakatı zorunlu mudur ve geri bildirimler anonim kalır mı?', beklenen: 'cevaplanmali' },
  { id: 'ckt-07', alan: 'İşten ayrılma ve çıkış', soru: 'Şirket bilgisayarı, telefon, giriş kartı ve zimmetli ekipmanları kime teslim etmeliyim?', beklenen: 'cevaplanmali' },
  { id: 'ckt-08', alan: 'İşten ayrılma ve çıkış', soru: 'Tamamlayıcı sağlık sigortam işten ayrıldığım gün mü sona erer, bireysele çevrilebilir mi?', beklenen: 'cevaplanmali' },
  { id: 'ckt-09', alan: 'İşten ayrılma ve çıkış', soru: 'İşsizlik maaşı alabilmem için SGK işten çıkış kodum ne olmalıdır?', beklenen: 'cevaplanmali' },
  { id: 'ckt-10', alan: 'İşten ayrılma ve çıkış', soru: 'İbraname ne zaman imzalanır ve varsa hak talepleri için şerh düşülebilir mi?', beklenen: 'cevaplanmali' },
  { id: 'ckt-11', alan: 'İşten ayrılma ve çıkış', soru: 'Yeni başlayacağım iş yeri için çalışma belgesi ve İK referans yazısını nereden alabilirim?', beklenen: 'cevaplanmali' },
  { id: 'ckt-12', alan: 'İşten ayrılma ve çıkış', soru: 'Şirket hisse opsiyonlarım işten ayrıldığımda ne olur?', beklenen: 'kapsamDisi' },

  // ------------------------------------------------ 8. Resmi belgeler
  { id: 'blg-01', alan: 'Resmi belgeler ve sözleşmeler', soru: 'Vize başvurusu için konsolosluğa hitaben çalışma ve izin yazısını nasıl alırım?', beklenen: 'cevaplanmali' },
  { id: 'blg-02', alan: 'Resmi belgeler ve sözleşmeler', soru: 'Banka kredisi veya ev kiralama için kaşeli ve imzalı gelir belgesi nereden talep edilir?', beklenen: 'cevaplanmali' },
  { id: 'blg-03', alan: 'Resmi belgeler ve sözleşmeler', soru: 'SGK hizmet dökümümde görünen unvanım ve meslek kodum yanlışsa ne yapmalıyım?', beklenen: 'cevaplanmali' },
  { id: 'blg-04', alan: 'Resmi belgeler ve sözleşmeler', soru: 'Adres, medeni durum, çocuk veya soyadı değişikliklerini sisteme nasıl işletirim?', beklenen: 'cevaplanmali' },
  { id: 'blg-05', alan: 'Resmi belgeler ve sözleşmeler', soru: 'İşe giriş sözleşmemin ve ek protokollerimin bir nüshasını nereden temin edebilirim?', beklenen: 'cevaplanmali' },
  { id: 'blg-06', alan: 'Resmi belgeler ve sözleşmeler', soru: 'İmzaladığım gizlilik sözleşmesi ve rekabet yasağı maddeleri neleri kapsıyor?', beklenen: 'cevaplanmali' },
  { id: 'blg-07', alan: 'Resmi belgeler ve sözleşmeler', soru: 'Engellilik vergi indirimi başvurusu için şirkete hangi evrakları teslim etmeliyim?', beklenen: 'cevaplanmali' },
  { id: 'blg-08', alan: 'Resmi belgeler ve sözleşmeler', soru: 'Askerlik sevk belgesi teslim süreci nasıl yürütülür ve askerlik süresince kadrom korunur mu?', beklenen: 'cevaplanmali' },

  // ------------------------------------------------ 9. Kultur ve etik
  { id: 'kul-01', alan: 'Kültür, etik ve çalışan ilişkileri', soru: 'Şirkete önerdiğim adayın işe girmesi durumunda çalışan tavsiye primi ne zaman ödenir?', beklenen: 'cevaplanmali' },
  { id: 'kul-02', alan: 'Kültür, etik ve çalışan ilişkileri', soru: 'Mobbing, psikolojik taciz veya ayrımcılık durumunda İK ya da etik kurula nasıl başvurulur?', beklenen: 'cevaplanmali' },
  { id: 'kul-03', alan: 'Kültür, etik ve çalışan ilişkileri', soru: 'Yöneticimle yaşadığım kronik iletişim sorununda İK arabulucu olarak devreye girer mi?', beklenen: 'cevaplanmali' },
  { id: 'kul-04', alan: 'Kültür, etik ve çalışan ilişkileri', soru: 'Etik ihbar hattı üzerinden yapılan bildirimlerde kimlik gizliliği nasıl korunuyor?', beklenen: 'cevaplanmali' },
  { id: 'kul-05', alan: 'Kültür, etik ve çalışan ilişkileri', soru: 'Sosyal kulüpler, spor takımları veya gönüllülük projelerine bütçe ve katılım desteği var mı?', beklenen: 'cevaplanmali' },
  { id: 'kul-06', alan: 'Kültür, etik ve çalışan ilişkileri', soru: 'Şirket dışında serbest zamanlı iş yapma veya kendi şirketimi kurma iznim var mı?', beklenen: 'cevaplanmali' },
  { id: 'kul-07', alan: 'Kültür, etik ve çalışan ilişkileri', soru: 'Çalışan bağlılığı ve memnuniyeti anket sonuçları ne zaman ve nasıl paylaşılıyor?', beklenen: 'cevaplanmali' },
  { id: 'kul-08', alan: 'Kültür, etik ve çalışan ilişkileri', soru: 'Disiplin kurulu süreçleri, yazılı savunma talebi ve uyarı mekanizmaları nasıl işler?', beklenen: 'cevaplanmali' },
];
