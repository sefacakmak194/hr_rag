# Asistan Kapsam Tanımı

Bu belge, RAG asistanının **neye cevap vermesi beklendiğini** ve **neyi bilinçli olarak
kapsam dışı bıraktığını** tanımlar. Korpusa dahil değildir (indekslenmez); yalnızca
tasarım kararını kayda geçirir.

## Kapsam içi — 20 doküman / 8 alan

| Alan | Dokümanlar | Örnek sorular |
|---|---|---|
| **Çalışma düzeni** | 01, 09 | Mesai saatleri, öğle molası, fazla mesai ücreti, gece vardiya zammı, nöbet ücreti |
| **İzinler** | 01, 10, 11, 12 | Yıllık izin, evlilik/babalık/vefat izni, analık ve süt izni, rapor bildirimi, ücretsiz izin, sınav izni, afet izni |
| **Ücret ve özlük** | 07, 08, 16 | Maaş günü, zam dönemi, avans, prim, yemek/yol desteği, sağlık sigortası, kreş desteği, bayram ikramiyesi, kıdem tazminatı |
| **İstihdam yaşam döngüsü** | 05, 06, 15 | İşe alım adımları, referans primi, deneme süresi, rekabet yasağı, istifa, ihbar süreleri, çıkış işlemleri |
| **Performans ve gelişim** | 13, 14 | Değerlendirme dönemleri, terfi kriterleri, itiraz, eğitim bütçesi, mentorluk, dil desteği |
| **Disiplin ve etik** | 02, 20 | Disiplin kademeleri, devamsızlık, savunma hakkı, hediye politikası, alkol yasağı |
| **İSG ve sağlık** | 11, 17 | İSG eğitimi, iş kazası bildirimi, koruyucu donanım, tahliye, ergonomi, periyodik muayene |
| **Uyum ve işyeri ortamı** | 18, 19, 04 | KVKK, veri saklama süreleri, veri ihlali, mobbing, ayrımcılık, şikâyet kanalları, uzaktan çalışma, ekipman güvenliği |

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
