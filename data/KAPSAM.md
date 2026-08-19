# Asistan Kapsam Tanımı

Bu belge, RAG asistanının **neye cevap vermesi beklendiğini** ve **neyi bilinçli olarak
kapsam dışı bıraktığını** tanımlar. Korpusa dahil değildir (indekslenmez); yalnızca
tasarım kararını kayda geçirir.

## Kapsam içi — 22 doküman / 10 alan

| Alan | Dokümanlar | Örnek sorular |
|---|---|---|
| **Çalışma düzeni** | 01, 09 | Mesai saatleri, öğle molası, fazla mesai ücreti, gece vardiya zammı, nöbet ücreti |
| **İzinler** | 01, 10, 11, 12 | Yıllık izin, evlilik/babalık/vefat izni, analık ve süt izni, rapor bildirimi, ücretsiz izin, sınav izni, afet izni |
| **Ücret ve özlük** | 07, 08, 16 | Maaş günü, zam dönemi, avans, prim, yemek/yol desteği, sağlık sigortası, kreş desteği, bayram ikramiyesi, kıdem tazminatı |
| **İstihdam yaşam döngüsü** | 05, 06, 15 | İşe alım adımları, referans primi, deneme süresi, rekabet yasağı, istifa, ihbar süreleri, çıkış işlemleri |
| **Performans ve gelişim** | 13, 14 | Değerlendirme dönemleri, terfi kriterleri, itiraz, eğitim bütçesi, mentorluk, dil desteği |
| **Disiplin ve etik** | 02, 20 | Disiplin kademeleri, devamsızlık, savunma hakkı, hediye politikası, alkol yasağı |
| **İSG ve sağlık** | 11, 17 | İSG eğitimi, iş kazası bildirimi, koruyucu donanım, tahliye, ergonomi, periyodik muayene |
| **Uyum ve işyeri ortamı** | 18, 19, 04 | KVKK, veri saklama süreleri, veri ihlali, açık rıza, kamera, mobbing, ayrımcılık, anonim şikâyet, uzaktan çalışma, ekipman güvenliği |
| **Bilgi güvenliği ve BT** | 21 | Parola/şifre, iki faktörlü doğrulama, USB ve bulut kullanımı, halka açık Wi-Fi, cihaz kaybı, yapay zekâ araçları, yazılım lisansı |
| **Sürdürülebilirlik ve çalışan katılımı** | 22 | Sürdürülebilirlik politikası, geri dönüşüm, gönüllülük izni, sosyal sorumluluk, memnuniyet anketi, öneri sistemi, İK'ya erişim |

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
170 bölüme** çıkıldı.

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
