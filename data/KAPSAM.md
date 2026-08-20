# Asistan Kapsam Tanımı

Bu belge, RAG asistanının **neye cevap vermesi beklendiğini** ve **neyi bilinçli olarak
kapsam dışı bıraktığını** tanımlar. Korpusa dahil değildir (indekslenmez); yalnızca
tasarım kararını kayda geçirir.

## Kapsam içi — 23 doküman / 11 alan

| Alan | Dokümanlar | Örnek sorular |
|---|---|---|
| **Çalışma düzeni** | 01, 09 | Mesai saatleri, öğle molası, fazla mesai ücreti, gece vardiya zammı, nöbet ücreti |
| **İzinler** | 01, 10, 11, 12 | Yıllık izin, evlilik/babalık/vefat izni, analık ve süt izni, rapor bildirimi, ücretsiz izin, sınav izni, afet izni |
| **Ücret ve bordro** | 07, 08, 16 | Maaş günü, bordroya erişim, IBAN bildirimi, zam dönemi, ara zam, avans, prim, vergi dilimi, kümülatif matrah devri, maaş haczi, BES, kıdem tazminatı |
| **Yan haklar** | 08 | Yemek/yol desteği, sağlık sigortası limitleri, kreş desteği, bayram ikramiyesi, eğitim ve kırtasiye yardımı, kurumsal hat ve roaming, kurumsal indirim anlaşmaları |
| **İstihdam yaşam döngüsü** | 05, 06, 15 | İşe alım adımları, referans primi, deneme süresi, rekabet yasağı, ikinci iş, istifa, ihbar süreleri, çıkış işlemleri, ibraname, SGK çıkış kodu, çalışma belgesi ve bonservis, yan hakların sona ermesi |
| **Performans ve gelişim** | 13, 14 | Değerlendirme dönemleri, terfi kriterleri, itiraz, 360 derece geri bildirim, bireysel gelişim planı, yetenek havuzu, ara dönem ücret düzenlemesi, eğitim bütçesi, lisansüstü destek, mentorluk, dil desteği |
| **Disiplin ve etik** | 02, 20 | Disiplin kademeleri, devamsızlık, savunma hakkı, hediye politikası, alkol yasağı |
| **İSG ve sağlık** | 11, 17 | İSG eğitimi, iş kazası bildirimi, koruyucu donanım, tahliye, ergonomi, periyodik muayene |
| **Uyum ve işyeri ortamı** | 18, 19, 04 | KVKK, veri saklama süreleri, veri ihlali, açık rıza, kamera, mobbing, ayrımcılık, anonim şikâyet, uzaktan çalışma, ekipman güvenliği |
| **Bilgi güvenliği ve BT** | 21 | Parola/şifre, iki faktörlü doğrulama, USB ve bulut kullanımı, halka açık Wi-Fi, cihaz kaybı, yapay zekâ araçları, yazılım lisansı |
| **Sürdürülebilirlik ve çalışan katılımı** | 22 | Sürdürülebilirlik politikası, geri dönüşüm, gönüllülük izni, sosyal sorumluluk, sosyal kulüpler ve spor takımları, memnuniyet anketi, öneri sistemi, İK'ya erişim |
| **Özlük işlemleri ve resmî belgeler** | 23 | Belge talebi, çalışma ve gelir belgesi, vize yazısı, SGK meslek kodu düzeltmesi, engellilik vergi indirimi, askerlik sevk belgesi, özlük bilgisi güncelleme, sözleşme nüshası |

## Kapsam dışı — bilinçli kararlar

Aşağıdaki konular korpusa **kasıtlı olarak** dahil edilmemiştir:

| Konu | Gerekçe |
|---|---|
| **Şirket aracı / araç tahsisi** | Şartname Bölüm 6, Soru 3 bunu halüsinasyon engelleme testi olarak kullanıyor. Korpusa eklenirse o kabul testi anlamını kaybeder. |
| Hisse senedi / opsiyon programı | Şirkette böyle bir program tanımlı değil. |
| Yemekhane günlük menüsü | Operasyonel bilgi, mevzuat değil. |
| Bireysel maaş bilgileri | Kişisel veri; asistan genel politika sorularına cevap verir, kişiye özel sorgu yapmaz. |
| Vergi/hukuk danışmanlığı | Asistan mevzuat metnini aktarır, hukuki tavsiye vermez. |

Kapsam dışı bir soru geldiğinde sistem **LLM'e hiç gitmeden** deterministik alaka
kapısıyla sabit yanıt döner (bkz. README, "Halüsinasyon engelleme").

### Bu tablo kodda da karşılığı olan bir karardır

Yukarıdaki üç konu — şirket aracı, hisse/opsiyon, yemekhane menüsü —
`server/src/services/scope.service.ts` içinde de listelidir ve soru vektör aramasına
**hiç girmeden** reddedilir.

Sebebi ölçüldü: alaka kapısı tek bir benzerlik eşiği ve bu konuda yetmiyor.
*"Şirket aracı tahsis ediliyor mu?"* eşiği aşıyordu çünkü "araç" korpusta
*gereç* anlamında geçiyor. Eşiği yükseltmek denendi — kapsam-içi en düşük 0.8408,
kapsam-dışı en yüksek 0.8409; iki dağılım üst üste, eşikle çözülemiyor.

**Bu tabloyu değiştirirseniz `scope.service.ts` listesini de güncelleyin.** İkisi
ayrışırsa belge bir şey, sistem başka bir şey söyler. `npm run test:scope` listedeki
konuların reddedildiğini *ve* kapsam içi soruların yanlışlıkla reddedilmediğini ölçer.

## Kaynak biçimi

Korpus hem `.md` hem `.pdf` okur. `data/corpus/` kaynak markdown'ları,
`data/corpus-pdf/` ise `npm run pdf` ile üretilen PDF karşılıklarını tutar.
Aynı ada sahip `.md` ve `.pdf` bir arada bulunursa `.md` tercih edilir.

## Sohbet ve tanıtım soruları

Mevzuat sorularının yanı sıra asistan; selamlama ("selam", "günaydın"), teşekkür,
vedalaşma ve tanıtım ("ne iş yaparsın", "neler sorabilirim") sorularını da yanıtlar.
Bunlar RAG hattına hiç girmez, `intent.service.ts` içinde deterministik olarak
karşılanır ve anında döner.

Kapsam **dışı gerçek sorular** için sabit "bilgi bulunmamaktadır" yanıtı korunur —
yani sohbet desteği halüsinasyon engellemesini zayıflatmaz.

## Kapsam 19.08.2026'da genişletildi

10.000 soruluk tarama (`npm run sweep`) korpusun gerçek İK soru yüzeyinin ancak
yarısını karşıladığını gösterdi: 495 temel sorudan **119'u hiçbir ifadeyle**
cevaplanamıyordu. Eksikler kapatıldı — 20 doküman / 94 bölümden **22 doküman /
172 bölüme** çıkıldı.

Eklenenler: bilgi güvenliği ve BT kullanımı (21), sürdürülebilirlik ve çalışan
katılımı (22); mevcut dokümanlara ise sigara/kimlik kartı/sosyal medya/akrabalık
(02), esnek çalışma/servis/çay molası (01), meslek hastalığı/ilk yardım/çalışan
destek programı (17), açık rıza/görsel kullanımı (18), anonim bildirim/ihbarcı
koruması (19) ve diğerleri.

Sonuç ölçüldü: cevaplanma oranı **%50.5 → %83.1**, hiçbir ifadeyle cevaplanamayan
soru **119 → 4**. Kapsam dışı sızıntı **0** kaldı; değerlendirme paketi 51/52'de
sabit durdu.

> Genişletme sırasında iki gerçek regresyon yakalandı ve düzeltildi: yeni "Çay
> Molası" maddesi "Öğle molası saat kaçta?" sorusunu çalıyordu, yeni kamera
> maddesi ise saklama süresini tekrarlayarak Madde 2'yi geçiyordu. Korpus
> denetimi (`npm run test:audit`) ayrıca çelişkili bir süre yakaladı. Bu üçü,
> aşağıdaki uyarının neden orada olduğunun kanıtıdır.

## Kapsam 20.08.2026'da saha sorularıyla yeniden ölçüldü

Bir önceki genişletme korpusun **kendi türettiği** sorularla ölçülmüştü
(`question-bank.ts`, korpustan üretilir). Bu tur **dışarıdan** geldi: bir İK
biriminin çalışanlardan topladığı 100 gerçek soru (`scripts/saha-sorulari.ts`).
Fark önemli — dış set korpusun dilini bilmez, kısaltma kullanır ("TSS", "IDP",
"core hours") ve tek soruda birkaç olgu birden ister.

Ölçüm uçtan uca yapıldı (`npm run saha`): alaka kapısı **ve** üretim birlikte.
`npm run sweep` bilerek yalnızca getirmeyi ölçer; bu betik ise "cevap geldi" ile
"cevap DOĞRU" ayrımını açar.

| Ölçüt | Önce | Sonra |
|---|---:|---:|
| Cevapsız kalan (100 sorunun 98 kapsam içi) | 9 | **0** |
| Yanlış maddeden cevaplanan | 24 | **0** |
| Kapsam dışı sızıntı | 0 | **0** |
| Tarama: mevzuattan cevaplanan | %83.1 | **%86.7** |
| Tarama: hiçbir ifadeyle cevaplanamayan | 4 | **0** |

Korpus 22 doküman / 172 bölümden **23 doküman / 201 bölüme** çıktı. Yeni doküman:
özlük işlemleri ve resmî belgeler (23). Mevcut dokümanlara eklenenler: bordroya
erişim / IBAN / kümülatif matrah devri (07), kurumsal hat / kurumsal indirim
anlaşmaları / eğitim ve kırtasiye yardımı (08), izin bakiyesi / izin yılı ve
devir (12), 360 derece / bireysel gelişim planı / ara dönem ücret düzenlemesi /
yetenek havuzu (13), lisansüstü eğitim desteği (14), ibraname / SGK çıkış kodu /
yan hakların sona ermesi (15), turnike ve puantaj düzeltme (01), İK
arabuluculuğu (19), sosyal kulüpler (22).

### Bu turda öğrenilen üç şey

**1. "Cevapsız" ile "yanlış cevap" ayrı sorunlardır ve ikincisi daha tehlikelidir.**
İlk ölçümde 9 soru cevapsızdı ama **24 soru yanlış maddeden** cevaplanıyordu —
kullanıcı bunu anlayamaz. Örnek: *"Yöneticimle kronik iletişim sorunu"* sorusu
"kronik" sözcüğü yüzünden **Kronik Rahatsızlık** maddesine, *"yüksek lisans
desteği"* ise **Gözlük ve Optik Desteği** maddesine düşüyordu. Yalnızca
cevaplanma oranına bakan bir ölçüm bu 24 vakayı BAŞARI sayar.

**2. Bazı hatalar korpusla düzeltilemez — çünkü soru korpusa hiç ulaşmaz.**
*"Evlilik izni kaç gündür?"* sorusuna **yıllık izin kademe tablosu** dönüyordu.
Sebep korpus değildi: `policyCalculator.service` içindeki `"izni kac gun"`
kalıbı her izin türünü yakalıyor ve alaka kapısından **önce** çalışıyordu.
Aynı hata *"Babalık izni kaç gün?"*, *"Süt izni kaç gün?"* ve *"Vefat izni kaç
gündür?"* sorularında da vardı. 01/Madde 3'e yazılan evlilik izni belgeleri bu
yüzden erişilemez kalıyordu — yani korpus düzeltmesi ölüydü. `excludeKeywords`
ile kapatıldı ve `npm run test:policy` içine 10 regresyon vakası eklendi.

**3. Bölüm başlığı gömülü metne girer; yönlendirmenin en güçlü kaldıracı odur.**
Çok konulu maddeler, içindeki her konuyu zayıflatıyordu. "İzin Bakiyesi ve İzin
Talebinin Değiştirilmesi" ikiye ayrılınca bakiye sorusu doğru cümleyi buldu;
"Kimlik Kartı ve Ziyaretçi Kabulü" ayrılınca *"Ofise arkadaşımı davet edebilir
miyim?"* 0.8206'dan 0.8305'e çıkarak kapıyı geçti.

> **Yeni madde yazarken kapsam dışını da ölçün.** Bu turda gerçekten yaşandı:
> yeni "Ofise Misafir ve Ziyaretçi Kabulü" maddesi *"Ofise evcil hayvan
> getirebilir miyim"* sorusunu 0.8280'e çıkarıp kapıdan geçirdi — tarama bunu
> **1 sızıntı** olarak yakaladı. Madde, davet edilebilecek kişileri açıkça
> adlandıracak biçimde ("arkadaşını, eşini veya bir yakınını") yeniden yazıldı;
> arkadaş sorusu 0.8305'te kalırken evcil hayvan sorusu 0.8132'ye indi. Bu,
> `constants.ts` içinde kayıtlı olan aynı tuzağın ikinci kez yaşanmasıdır.

### Eşik neden değiştirilmedi

Korpus büyüdüğü için `scripts/calibrate.ts` yeniden koşuldu. Kalibrasyon
"geçerli aralık yok" uyarısı verdi; sebebi tek bir sorgu:

    Bordromu nereden görüntülerim?     0.8004  (doğru maddeyi buluyor)
    Ofise evcil hayvan getirebilir...  0.8020  (kapsam dışı)

Bu bir korpus eksiği **değil**: sorgu doğru maddeyi (07/Madde 10) getiriyor, ama
sözcük bileşeni 0 aldığı için füzyon skoru %5 düşüyor. Sebep `lexical.service`
gövdeleyicisinde: `"bordromu"` → `"bordrom"`, korpustaki `"bordro"` ile
eşleşmiyor (iyelik ekleri `SUFFIXES` listesinde yok). Uzun biçim
("Bu ayki bordromu nereden ve nasıl görüntüleyebilirim?") 0.8378 ile geçiyor.

Eşiği düşürmek bu tek sorguyu kazanır ama kapsam dışı sorguları (0.8020 evcil
hayvan, 0.8027 "şirket araba veriyor mu") içeri alırdı. **0.828 korundu.**
Kısa "bordro" ifadeleri, taramanın "kısmen cevapsız" başlığı altında kayıtlı
dayanıklılık sorununun bir örneğidir; çözümü korpus değil gövdeleyicidir.

## Kapsamı genişletirken

Arayüzdeki **Korpus** panelinden Markdown/PDF sürükleyip bırakmak 1. ve 2. adımı
otomatik yapar (kaydeder ve yeniden indeksler). Kalan adımlar yine gereklidir —
panel de yükleme sonrası kalibrasyon uyarısını gösterir.

1. Yeni `.md` dokümanını `data/corpus/` altına ekleyin (başlık = `#`, maddeler = `##`).
   Mevcut dokümanlarla **çelişen sayı vermeyin**; aynı konu iki yerde geçecekse çapraz
   referans verin (örn. babalık izni 01 ve 10'da aynı değerle yer alır).
   Bir madde içinde birden çok sayısal olgu varsa bunları **ayrı cümlelere** yazın;
   cümle düzeyinde kanıt seçimi doğru kalemi ancak o zaman güvenle işaretleyebilir.
2. `npm run ingest` ile yeniden indeksleyin.
3. **Eşikleri yeniden kalibre edin** — `npx tsx ../scripts/calibrate.ts`.
   Kalibrasyon sorgu listesine yeni alanın örneklerini ekleyin.
4. `npm run test:rag` ile regresyonu doğrulayın. Yeni alan için test ekleyin ve
   şartmanenin 3 kabul sorusunun hâlâ geçtiğinden emin olun.
5. Bu belgedeki kapsam tablosunu ve `intent.service.ts` içindeki
   `capabilityResponse()` konu listesini güncelleyin (doküman/bölüm sayısı
   otomatik gelir, konu başlıkları elle tutulur).

> Konu olarak komşu bir doküman eklemek, mevcut bir sorunun cevabını "çalabilir".
> Bu gerçekten yaşandı: 10 numaralı doküman eklenince *"Babalık izni kaç gün?"*
> sorusu oraya kaydı. Testler olmasa sessizce yanlış cevap üretecekti.
