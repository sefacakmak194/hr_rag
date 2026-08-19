# Private Enterprise HR & Policy Local RAG Assistant

Kurumsal İK mevzuatı üzerinde **%100 çevrim dışı (air-gapped)** çalışan, kaynak gösterimli
yerel RAG asistanı. **20 doküman / 94 bölüm** ile 8 İK alanını kapsar: çalışma düzeni,
izinler, ücret ve yan haklar, istihdam süreci, performans, disiplin, İSG ve uyum (KVKK).
Kapsamın tam dökümü: [data/KAPSAM.md](data/KAPSAM.md).

> **Projeyi hızlı değerlendirmek için:** [docs/SPRINT-5-TESLIM.md](docs/SPRINT-5-TESLIM.md)
> — 6 istasyonluk demo akışı, derlenmiş ölçümler ve kurulum. Bu README mühendislik
> ayrıntısı içindir.

Hiçbir metin, embedding veya sorgu dış bulut API'larına gönderilmez. Tüm doküman işleme,
embedding üretimi, benzerlik araması ve model çıkarımı host makinede gerçekleşir.

---

## Mimari

```
[ İK Dokümanları (.md / .pdf) ]
          │  Markdown başlıklarına göre chunking (350 token, 50 overlap)
          ▼
[ Metin Parçaları + Metadata ]
          │  Yerel embedding — multilingual-e5-small (ONNX, on-device)
          ▼
[ SQLite vektör deposu (node:sqlite) ]
          │
[ Sorgu ] ─┴─► Kosinüs benzerliği ──► İki aşamalı alaka kapısı ──► Top-K parça
                                                                      │
                                                                      ▼
                                             [ Microsoft Foundry Local (OpenAI uyumlu) ]
                                                                      │
                                                                      ▼ SSE token akışı
                                                              [ React Arayüzü ]
```

| Katman | Teknoloji | Not |
|---|---|---|
| Model runtime | Microsoft Foundry Local | OpenAI uyumlu; port **otomatik keşfedilir** |
| LLM | `qwen2.5-1.5b-instruct-cuda-gpu` | GPU'da ~0.3 sn/yanıt (bkz. hız/doğruluk takası) |
| Sözcük araması | BM25 (kendi uygulaması) | Vektörle harmanlanır (hibrit) |
| PDF okuma | `pdfjs-dist` | Saf JS, native bağımlılık yok |
| Embedding | `Xenova/multilingual-e5-small` | 384 boyut, ONNX Runtime, on-device |
| Vektör deposu | `node:sqlite` (Node 24 yerleşik) | Native derleme yok |
| Backend | Express 5 + TypeScript | SSE streaming |
| Frontend | React 19 + Vite | Port 5173 |

---

## Kurulum

Gereksinim: **Node.js 22.5+** (yerleşik `node:sqlite` için; geliştirme Node 24.16 ile yapıldı).

```bash
npm run setup     # server + client bağımlılıkları
npm run ingest    # korpusu indeksle (ilk çalıştırmada embedding modelini indirir, ~1 dk)
```

### Foundry Local kurulumu

```powershell
winget install Microsoft.FoundryLocal
foundry model info phi-3.5-mini          # varyantları listele (önemli, aşağıya bakın)
foundry model download <varyant-kimliği>
foundry model load <varyant-kimliği>
```

> **Port sabit değil.** Şartname `http://localhost:5272/v1` varsayar; Foundry Local 0.10+
> daemon'a **her başlatmada rastgele bir port** atar (ör. `127.0.0.1:57617`). Bu proje
> ucu `foundry server status -o json` çıktısından **otomatik keşfeder**, elle ayar gerekmez.
> Keşfi atlamak isterseniz `FOUNDRY_BASE_URL` verin.

> **Varyant seçimi önemli.** `/v1/models` ucu belleğe yüklü olanı değil, **önbellekteki tüm
> varyantları** listeler. Makinenizde bir varyant bozuksa yanlış olanın seçilmemesi için
> çalışan varyantı `.env.local` içinde tam kimliğiyle sabitleyin:
>
> ```
> FOUNDRY_MODEL=Phi-3.5-mini-instruct-generic-cpu
> ```

`.env.example` dosyasını `.env.local` olarak kopyalayarak başlayın.

### Çalıştırma

İki ayrı terminalde:

```bash
npm run server    # API  → http://localhost:5273
npm run client    # UI   → http://localhost:5173
```

Tarayıcıda <http://localhost:5173> açın. Sağ üstteki durum göstergesi indeks ve
Foundry Local bağlantısını canlı raporlar.

---

## Tek dosya dağıtım (.exe)

Kurulum gerektirmeyen, çift tıkla çalışan bir Windows paketi üretir:

```bash
cd client && npm run build      # arayüzü derle
cd ../server && npm run build:exe
```

Çıktı `dist-app/` klasörüne yazılır:

```
dist-app/
├── PrivateHrRag.exe    # çift tıkla çalıştır
├── .env.local          # model sabitlemesi
├── public/             # derlenmiş React arayüzü
├── data/               # korpus + hazır vektör indeksi
└── runtime/            # native ONNX ikilileri + gömülü embedding modeli
```

`PrivateHrRag.exe` çalıştırıldığında sunucuyu başlatır, arayüzü **aynı porttan**
(<http://localhost:5273>) servis eder ve tarayıcıyı otomatik açar. Ayrı Vite gerekmez.

**Neden tek bir dosya değil?** `onnxruntime-node` ~60 MB native DLL taşır
(`onnxruntime.dll`, `DirectML.dll`, `dxcompiler.dll`). Windows yükleyicisi bunları
diskten okur; Node SEA blob'una gömülemezler. Bu yüzden exe'nin yanında `runtime/`
klasörü bulunur — kullanıcı yine tek bir şey çalıştırır.

**Boyut neden bu kadar?** Ölçüldü — toplam **918 MB**:

| Bileşen | Boyut |
|---|---|
| `runtime/node_modules/@huggingface` (embedding modeli, fp32) | 478 MB |
| `runtime/node_modules/onnxruntime-web` | 130 MB |
| `PrivateHrRag.exe` (node.exe + SEA blob) | 89 MB |
| `onnxruntime-node` (native DLL'ler) | 60 MB |
| `tesseract.js-core` + `@napi-rs` + `pdfjs-dist` (OCR/PDF) | 116 MB |
| `vendor/tessdata` (Türkçe OCR dil verisi) | 4.4 MB |
| `data/` (korpus + hazır vektör indeksi) | 400 KB |

Embedding modelinin gömülü gelmesi bilinçli: paket **hiç internet olmadan** çalışır,
ilk açılışta model indirmez. Eşikler bu fp32 model üzerinde kalibre edildiği için
kuantize sürüme geçmek yeniden kalibrasyon gerektirir.

`onnxruntime-web` (130 MB) Node paketinde kullanılmıyor — `@huggingface/transformers`
üzerinden geçişli olarak geliyor. Ayıklanabilir; henüz denenmedi.

Klasörü olduğu gibi kopyalayın; Node.js kurulu olmayan makinede de çalışır
(Foundry Local yine gerekir).

### Pakete giden veritabanı temizlenir

`data/vectors.db` yalnızca vektör indeksi değil: Sprint 1'den beri kullanıcı
hesaplarını (parola özetleriyle), denetim kaydını ve Sprint 4'ten beri yanıtsız soru
metinlerini de taşıyor. Düz kopyalama, paketi alan **herkese** bu makinede kimin ne
sorduğunu ve yönetici hesabının parola özetini verirdi.

Paketleyici bu yüzden `VACUUM INTO` ile tutarlı bir kopya alıp temizliyor:

- **silinir:** `users`, `sessions`, `audit_log`, `unanswered_questions`
- **kalır:** `chunks` (hazır indeks), `documents` (erişim etiketleri),
  `document_versions` — `created_by` alanı `kurulum` ile değiştirilerek

Paketi alan kişi **kendi kurulumunu** yapar: uygulama hiç kullanıcı yoksa ilk kurulum
ekranını gösterir. Temizlik doğrulanmadan paket yazılmaz; doğrulama başarısızsa derleme
hata ile durur.

## Doğrulama

```bash
npm test           # tüm paket (LLM gerektirmez)
npm run eval       # cevap kalitesi (çalışan sunucu + LLM gerekir)
npm run compare    # model karşılaştırma matrisi (uzun sürer)
```

`npm run eval` **yalıtılmış koşar**: veritabanının `VACUUM INTO` ile alınmış
anlık kopyası üzerinde kendi sunucusunu ayağa kaldırır, iş bitince kopyayı da
sunucuyu da siler. Sebep — her vaka bir denetim satırı yazıyor ve çalışan
sunucuya karşı koşturulduğunda bunlar gerçek denetim kaydına düşüyordu
(ölçüldü: tek koşum 70+ kalıcı satır bıraktı; kayıt silinemez olduğu için bu
gürültü kalıcıdır).

Belirli bir sunucuya karşı ölçmek için adres verin — bu durumda satırlar o
sunucunun kaydına yazılır ve betik bunu açıkça uyarır:

```bash
npm run eval -- http://localhost:5273
```

`/api/chat` kimlik doğrulaması arkasında olduğu için oturum otomatik açılır:
`EVAL_USER` + `EVAL_PASSWORD` verilirse o hesapla giriş yapar, verilmezse geçici
bir hesap kullanılır (bkz. `scripts/eval-auth.ts`, `scripts/eval-sandbox.ts`).

| Paket | Kapsam |
|---|---|
| `test:policy` | 33 test — kademe hesabı, sınır değerleri, korpus tutarlılığı |
| `test:identity` | 38 test — parola, oturum, roller, denetim değiştirilemezliği |
| `test:access` | 41 test — erişim filtresi servis katmanında (arama, dayanak, BM25) |
| `test:versions` | 61 test — sürüm açılma kuralı, yürürlük tarihi, arşiv, fark hesabı |
| `test:endpoints` | 46 test — **HTTP ucu** düzeyinde erişim kontrolü (gerçek Express) |
| `test:integrity` | 48 test — hash zinciri, imzalı arşiv, kurcalama tespiti |
| `test:gap` | 25 test — politika boşluğu: kimliksizlik, kümeleme, saklama |
| `test:evidence` | 18 test — cümle/yan cümle bölme, canlı korpus üzerinde kanıt seçimi |
| `test:documents` | 21 test — dosya adı doğrulaması (dizin geçişi, uzantı kaçışı) |
| `test:formats` | DOCX okuma, biçim önceliği, taranmış PDF + OCR |
| `test:audit` | Korpus sağlığı — bozuk korpusta bulmalı, temizde susmalı |
| `test:rag` | 70 test — 24 niyet, 14 takip sorusu, 32 retrieval |
| `test:pdf` | 20 doküman — PDF metin çıkarımı sadakati |
| `eval` | 48 uçtan uca cevap doğruluğu ölçümü |
| `compare` | aynı vaka kümesi × birden çok model — doğruluk/gecikme matrisi |

Pakette şunlar var: şartname Bölüm 6 / Adım 3 kabul soruları, 8 İK alanının tamamını
kapsayan retrieval regresyonları, kapsam dışı reddetme senaryoları ve niyet sınıflandırma
testleri. Testler LLM'den bağımsız çalışır — kaynak seçimi ve alaka kapısı deterministik
biçimde ölçülür, dolayısıyla model değiştirmek testleri etkilemez.

`eval` paketinin grupları: şartname kabul soruları (3), sayısal olgular (15), kademe
hesabı (5), **ayrım** (14 — aynı maddede birden çok olgu), **çok turlu** (6), kapsam dışı
(3), sohbet (2). "Ayrım" ve "çok turlu" grupları uçtan uca ölçüm için kritiktir; ikisi de
gerçek hatalar yakaladı.

### Sürekli entegrasyon (CI)

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) her push ve PR'da çalışır:
bağımlılıklar → tip kontrolü (sunucu **ve** `scripts/`) → istemci derlemesi →
korpus indeksleme → 7 çevrimdışı test paketi.

`eval` ve `compare` **bilinçli olarak kapsam dışı**: ikisi de çalışan bir Foundry
Local örneği ve yerel GPU ister; barındırılan bir koşucuda kurulamaz. Bunlar
yerelde çalıştırılır, sonuçları `data/` altında belgelenir.

İki ayrıntı sessiz kırılmayı önlüyor:

- **Örnek dosyalar depoda izleniyor** (`scripts/fixtures/`). Üretici betik taranmış
  PDF için Chrome'a ve Windows yollarına bağlı; CI'da üretilemez. Üretilemediğinde
  `test:formats` kırmızı yanmaz, blokları **atlar** — yani DOCX ve OCR hiç
  ölçülmeden yeşil görünürdü.
- **`.gitattributes` ikili dosyaları donuşumdan muaf tutuyor.** Depoda satır sonu
  LF; `tur.traineddata` CRLF dönüşümünden geçerse dosya bozulur ve OCR sessizce
  çalışmaz hale gelir.

### Ölçüm önce tekrarlanabilir olmalı

`temperature` uzun süre **0.1** idi ve bu, görünmez bir kararsızlık yaratıyordu: art arda
koşumlar 48/48, 45/48, 45/48 verdi ve **başarısız vakalar her seferinde değişti**
(bir koşumda amb-3/amb-5, diğerinde num-12/amb-13). Yani bazı vakalar sınırdaydı,
ölçüm gürültülüydü ve "düzelttiğim" şeylerin bir kısmı aslında örnekleme gürültüsüydü.

`temperature: 0` varyansın büyük kısmını kaldırdı: başarısız vaka kümesi artık koşumlar
arasında yer değiştirmiyor, sabit bir çekirdek üzerinde duruyor. Bir mevzuat asistanı
için doğru ürün davranışı da budur: aynı soruya aynı yanıt.

> **Ama tam determinizm sağlanmadı.** Ardışık koşumlar 46/48 ve 47/48 verebiliyor;
> `amb-6` (aday başvurusu saklama süresi) sınırda duran bir vaka ve zaman zaman
> düşüyor. Sebep sıcaklık değil: GPU çıkarımı bit düzeyinde tekrarlanabilir değil,
> logit'ler birbirine çok yakın olduğunda sıralama değişebiliyor. Daemon yeniden
> başlatıldığında da benzer bir kayma görülüyor. Yani ölçüm **bir bant**, tek bir
> sayı değil.

**Güncel durum: 51/52 (%98.1).** Sabit olarak açık kalan vaka:

> **amb-4** — *"Bordro itirazımı kaç gün içinde yapmalıyım?"* Kanıt seçimi doğru cümleyi
> işaretliyor (*"…15 gün içinde İK departmanına yazılı başvuruda bulunur"*) ama model
> aynı maddedeki ikinci cümleden yanıtlıyor (*"itirazlar 10 iş günü içinde
> sonuçlandırılır"*). Her iki cümle de "kaç gün" sorusuna karşılık geliyor; bu bir
> muhakeme sınırı. Korpusu değiştirerek "düzeltmek" mümkün ama o, testi teste
> uydurmak olurdu — açıkta bırakıldı.

> **Korpusu her değiştirdiğinizde bu paketi çalıştırın.** Kapsam genişletirken gerçek bir
> regresyon yakalandı: yeni "Doğum, Analık ve Ebeveyn Hakları" dokümanı eklenince
> *"Babalık izni kaç gün?"* sorusu konu olarak komşu bu dokümana kaydı ve doğru cevabın
> bulunduğu parça Top-K'ya giremedi. Çözüm, korpusu tutarlı hale getirmek oldu
> (çapraz referanslı madde), eşikle oynamak değil.

### Air-gapped doğrulama

İnternet bağlantısını tamamen kapatın, ardından `npm run server` + `npm run client`
ile sistemi çalıştırın ve sorgu yapın. Tam çevrim dışı çalışmayı zorlamak için:

```powershell
$env:TRANSFORMERS_OFFLINE = "1"
```

Bu değişken embedding modelinin uzak sunucuya erişimini tamamen kapatır; model
`npm run ingest` sırasında yerel önbelleğe alınmıştır.

---

## Soru işleme hattı

```
Kullanıcı sorusu
      │
      ▼  ① Niyet sınıflandırma (deterministik, ~0 ms)
   selamlama / teşekkür / "ne iş yaparsın" / "ne konuşuyorduk"  ──► hazır yanıt
      │
      ▼  ② Takip sorusu çözümlemesi
   "peki 10 yıllık olsaydı?"  ──► önceki soruyla birleştirilir
      │
      ▼  ③ Kademeli politika hesabı (deterministik, LLM'siz)
   "5 yıllık çalışanın izni?"  ──► kodla hesaplanır, kaynak maddesiyle
      │
      ▼  ④ Hibrit arama (vektör + BM25)
      │
      ▼  ⑤ Alaka kapısı (mutlak eşik)
   eşik altı  ──► sabit "bilgi bulunmamaktadır", LLM'e hiç gidilmez
      │
      ▼  ⑥ Cümle düzeyinde kanıt seçimi (deterministik)
   parça içinde soruya karşılık gelen cümle / yan cümle işaretlenir
      │
      ▼  ⑦ Top-K bağlam + Foundry Local → SSE akışı
```

Dört katman LLM'i hiç çağırmaz; bu hem hızı (0 ms) hem de determinizmi sağlar.
48 değerlendirme vakasının **17'si** LLM'e hiç ulaşmıyor ve sonuçları modelden bağımsızdır.

### ① Niyet katmanı

"Selam" veya "ne iş yaparsın" gibi sorular vektör aramasından geçseydi alaka kapısına
takılıp resmî *"bilgi bulunmamaktadır"* yanıtını alırdı — kaba ve yanlış. Bu yüzden
retrieval'ın önünde desen tabanlı bir sınıflandırıcı çalışır (`intent.service.ts`):
selamlama, teşekkür, vedalaşma ve yetenek soruları anında yanıtlanır.

Yetenek yanıtı doküman ve bölüm sayısını **canlı indeksten** okur, böylece kapsam
değiştiğinde metin kendiliğinden güncel kalır.

> **Tuzak:** Kalıplara tek başına "yardım" gibi genel bir sözcük eklenmemelidir —
> korpusta *doğum yardımı*, *evlilik yardımı* gibi gerçek konular var ve bu sorular
> yanlışlıkla tanıtım yanıtı alırdı. Kalıplar bu yüzden çok sözcüklü ve niyet
> belirticidir; test paketi bu durumu ayrıca doğrular.

## Halüsinasyon engelleme: alaka kapısı

Şartname sabit **0.65** kosinüs eşiği önerir. Bu değer embedding modeline bağımlıdır ve
kullanılan E5 modeli için **geçerli değildir**: E5 skorları dar bir banda sıkıştırır,
dolayısıyla 0.65 her sorguyu geçirir ve halüsinasyon engellemesi tamamen çöker.

`scripts/calibrate.ts` ile 94 parçalık korpusta 34 kapsam içi / 8 kapsam dışı sorgu ölçüldü:

| Ölçüt | Kapsam içi min | Kapsam dışı maks | Ayrım |
|---|---|---|---|
| **Mutlak top skor** | 0.8499 | 0.8404 | **ayırıcı** (boşluk 0.0096) |
| Marj (top − ortalama) | 0.0425 | 0.0490 | örtüşüyor |
| Gap (top − ikinci) | 0.0016 | 0.0248 | örtüşüyor |
| Lead (top − rakip ort.) | 0.0147 | 0.0292 | örtüşüyor |

Kapı tek ölçüt uygular: **en iyi skor ≥ `0.845`**. Geçerse en iyi skora `0.05` bandı
içindeki parçalar (en fazla `TOP_K`) bağlama alınır; aksi halde **LLM'e hiç gidilmeden**
sabit yanıt döner:

> Şirket içi mevzuat dokümanlarında bu konu hakkında bilgi bulunmamaktadır. Lütfen İK departmanı ile doğrudan iletişime geçiniz.

Bu, engellemeyi model davranışına değil deterministik bir kapıya bağlar.

### Marj ölçütü neden kaldırıldı (önemli ders)

İlk 9 parçalık korpusta ikinci bir aşama vardı: *top − korpus ortalaması ≥ 0.038*.
O ölçekte temiz ayırıcıydı (0.0441 vs 0.0323). Korpus 94 parçaya çıkınca **çöktü**:

| Korpus | Kapsam içi min marj | Kapsam dışı maks marj | Durum |
|---|---|---|---|
| 9 parça | 0.0441 | 0.0323 | ayırıcı |
| 94 parça | 0.0425 | 0.0490 | **örtüşüyor** |

Nedeni: korpus çeşitlendikçe herhangi bir sorgunun ortalama benzerliği düşer, dolayısıyla
marj **tüm** sorgular için şişer. Yani bu ölçüt korpus **büyüklüğüne** duyarlıdır.
Açık bırakılsaydı gerçek İK sorularını reddetmeye başlayacaktı. `RELEVANCE_MARGIN`
varsayılan olarak `0` (kapalı); yeniden açmadan önce kalibrasyonla doğrulayın.

### İfade değişimine dayanıklılık — ölçülmüş bir sınır

Geçen bir vaka, **o ifadeyle** geçtiğini gösterir. Paketlenmiş `.exe` duman testinde
mevcut iki geçen vakanın yeniden ifade edilmiş hali düştü:

| Soru | Sonuç |
|---|---|
| *"Şirket bana özel araç tahsisi yapıyor mu?"* (şartname Soru 3) | geçiyordu |
| *"Şirket aracı tahsis ediliyor mu?"* | **model "No" dedi** |
| *"5 yıllık çalışan kaç gün yıllık izin kullanabilir?"* | geçiyordu |
| *"Yıllık izin kaç gün?"* | **talep süresini cevapladı** |

İkisi de aynı veritabanıyla geliştirme sunucusunda birebir tekrarlandı — paketleme
sorunu değil, gerçek davranış.

**Eşik yükseltmek çözmüyor, ölçüldü.** Kalibrasyon kümesine yeniden ifadeler eklendi
(`npm run calibrate`, 38 kapsam-içi / 13 kapsam-dışı):

```
kapsam-içi  en düşük : 0.8408   "Mobbing bildirimini nereye yapabilirim?"
kapsam-dışı en yüksek: 0.8409   "Şirket aracı tahsis ediliyor mu?"
ayırım boşluğu       : −0.0001
```

İki dağılım tam üst üste. Şirket aracı sorusunu engelleyen **her** eşik, meşru bir
mobbing sorusunu da engeller. Bu, `RELEVANCE_MARGIN` ve boşluk kümeleme eşiğiyle aynı
sınıf bir sonuç: tek sayı yetmiyor.

Skorun yüksek olma sebebi anlam değil **kelime**: "araç" korpusta *"lisanssız araç
kullanımı"* (gereç anlamında) ve *"tahsis edilen dizüstü bilgisayar"* cümlelerinde
geçiyor.

#### Kasıtlı kapsam dışı konular deterministik reddedilir

`data/KAPSAM.md` hangi konuların **bilerek** dışarıda bırakıldığını ve gerekçesini
zaten yazıyor. Bu bir kurumsal karardır; benzerlik skoruna bırakılmamalı.
`scope.service.ts` o kararı koda taşır — listedeki bir konu geçerse soru vektör
aramasına **hiç girmez**, sabit yanıt döner (0.0 s, modele gitmeden).

**Dürüst sınır: bu bir sınır tanıma yeteneği değil, bir liste.** Yalnızca yazılmış
konuları yakalar; listede olmayan bir kapsam dışı soru yine eşiğe kalır ve eşik —
yukarıda ölçüldüğü gibi — tek başına yeterli değil. Kapsam kararı değiştikçe liste
`KAPSAM.md` ile birlikte güncellenmelidir.

Kalıplar **dar** tutuldu: yalnız "araç" yasaklansaydı *"Lisanssız araç kullanabilir
miyim?"* (disiplin yönetmeliğinde geçen, kapsam **içi** bir soru) da reddedilirdi.
`test:scope` bunu iki yönlü ölçer — listedekileri yakalamak *ve* kapsam içi soruları
yakalamamak.

#### Kıdem verilmeyen kademe sorusu: tablonun tamamı

*"Yıllık izin kaç gün?"* sorusunun tek doğru cevabı yok — cevap kıdem kademesine bağlı.
Bir kademe seçmek uydurma olurdu. Kademeli politika hesaplayıcısı artık kıdem
verilmediğinde **tablonun tamamını** deterministik olarak veriyor.

Kök neden ilginç: madde işaretli kademe satırları konusunu bir üst satırdan
(*"…hakları aşağıdaki gibidir:"*) alıyor, bu yüzden "yıllık" ve "izin" terimlerini
taşımıyorlar; usul cümlesi ise üçünü birden taşıyor ve cümle düzeyinde kanıt seçimini
kazanıyor. Doğru bilgi, yanlış soru.

Usul soruları (`önce`, `talep`, `başvuru`, `nasıl`, `onay`) bu yoldan **hariç** tutulur,
yoksa *"Yıllık izin talebini kaç gün önce yapmalıyım?"* kademe tablosuyla cevaplanırdı.

### Hibrit arama (vektör + BM25)

Salt vektör araması kapsam içi/dışı ayrımını çok dar bir boşlukla yapıyordu. Sözcük
bileşeni eklendi: `skor = (1-w)·kosinüs + w·BM25_normalize`.

Ağırlık `scripts/calibrate.ts` ile süpürüldü (34 kapsam içi / 10 kapsam dışı sorgu):

| w | Kapsam içi min | Kapsam dışı maks | Ayrım boşluğu |
|---|---|---|---|
| 0.00 (salt vektör) | 0.8499 | 0.8404 | 0.0096 |
| **0.05 (seçilen)** | 0.8408 | 0.8230 | **0.0179** — 1.9x |
| ≥0.15 | — | — | negatif (örtüşüyor) |

**Daha büyük ağırlık işe yaramıyor** ve nedeni öğretici: en zorlu kapsam dışı soru
*"özel araç **tahsisi**"*, ekipman dokümanındaki *"**tahsis** edilen dizüstü bilgisayar"*
ifadesiyle sözcük düzeyinde de eşleşiyor. Buna karşılık bazı kapsam içi soruların sözcük
örtüşmesi düşük (*"mobbing bildirimi"* → dokümanda *"şikâyet"*). Yani lexical sinyal
yardımcı ama sihirli değil — ağırlığı ölçmeden büyütmeyin.

Türkçe için tam gövdeleyici yerine hafif sonek kırpma + durak sözcük eleme kullanılır;
amaç mükemmel eşleşme değil, "hiç örtüşme yok" sinyalini yakalamaktır.

### Bağlamsal chunking

Her parça gömülürken metnin başına **doküman başlığı + bölüm başlığı** eklenir; gövde
(`content`) değişmeden saklanır ve LLM'e yalnızca asıl metin gider. Başlık, parça
gövdesinde geçmeyen konu sinyalini taşır — örneğin "Mobbing" kelimesi yalnızca doküman
başlığında geçerken, mobbing sorgusu artık doğru şikâyet maddesini eşliyor
(0.8488 → 0.8557).

> **Prompt'a "bilgi yoksa şunu yaz" talimatı EKLEMEYİN.** Kapı zaten bağlam yokken LLM'i
> hiç çağırmaz; prompt sadece bağlam **kesin mevcutken** çalışır. Bu talimat prompt'a
> eklendiğinde phi-3.5-mini gibi küçük modeller onu aşırı tetikleyip, doğru bağlam
> önlerindeyken bile "bilgi bulunmamaktadır" yanıtı üretiyor (ölçüldü). İki katmanı
> ayrı tutmak hem doğru hem de daha güvenilir.

Eşikler korpus değişince yeniden kalibre edilmelidir:

```bash
cd server && npx tsx ../scripts/calibrate.ts
```

---

## Hız / doğruluk takası — ölçülmüş

GPU'daki küçük model ile CPU'daki büyük model arasındaki fark `npm run eval` ile ölçüldü:

| Yapılandırma | Ortalama süre | Cevap doğruluğu | Not |
|---|---|---|---|
| `qwen2.5-1.5b-instruct-cuda-gpu` **(varsayılan)** | **0.3 sn** | %92.9 (26/28) | 4 GB VRAM'e sığar |
| `qwen2.5-7b-instruct-generic-cpu` | 20–60 sn | daha yüksek hassasiyet | CUDA sürümü 4.7 GB, VRAM'e **sığmaz** |

Değiştirmek için `.env.local` içindeki `FOUNDRY_MODEL` satırını düzenleyip sunucuyu
yeniden başlatın.

**1.5B modelin bilinen sınırı:** Aynı madde birden fazla kalem içerdiğinde yanlışını
seçebiliyor (*"doğum yardımı"* sorusuna *evlilik yardımı* tutarını vermek gibi).
Prompt'a hedefli kural eklemek bunu **düzeltmedi** — ölçüldü; bu bir muhakeme sınırı,
prompt sorunu değil. Kademeli sayısal sorular ise deterministik hesaplayıcıya
devredildiği için bu sınırdan etkilenmez.

### GPU notları

Bu makinede (RTX 3050 Laptop, 4 GB VRAM) ölçülenler:

| Varyant | Sonuç |
|---|---|
| `phi-3.5-mini-*-trtrtx-gpu` | `CUDA error ... invalid device ordinal` → HTTP 500 |
| `Phi-3.5-mini-instruct-cuda-gpu` | Akış çalışıyor ama **çıktı bozuk** (phi'ye özgü) |
| `qwen2.5-1.5b-instruct-cuda-gpu` | **Doğru ve hızlı** |

Yani "GPU bozuk" değil, **varyanta özgü** bir sorundu. Yeni bir modele geçerken
`npm run eval` ile doğrulayın; bozuk varyantlar sessizce anlamsız metin üretebiliyor.

---

## Kademeli politika hesaplayıcısı

Küçük modeller kademeli aralıklarda ("5 yıla kadar, **5 yıl dahil**") sistematik hata
yapıyor. Ölçüm: `qwen2.5-1.5b` 5 kademe sorusunun 4'ünü yanlış yanıtladı; `qwen2.5-7b`
bile sınır değerinde şaşırdı.

Çözüm prompt değil **kod**: yıllık izin ve ihbar süresi kademeleri
`policyCalculator.service.ts` içinde yapılandırılmış tablo olarak durur. Soru somut bir
kıdem içeriyorsa (*"5 yıllık çalışanın izni?"*) cevap deterministik hesaplanır ve LLM
hiç çağrılmaz. Kıdem verilmeyen genel sorular (*"Yıllık izin nasıl belirlenir?"*) normal
RAG hattına gider.

Tablolar korpustan türetilmez; `test:policy` her iki değerin korpus metninde geçtiğini
doğrular, böylece korpus değişince tablo sessizce kaymaz.

Bu, hız kazancını da açıklar: kademe soruları **0 ms** sürer.

---

## Cümle düzeyinde kanıt seçimi

Alaka kapısı doğru **maddeyi** getirdiği hâlde cevap yanlış çıkabiliyordu. Sebep parça
boyutu: bir madde birden fazla bağımsız olgu taşıdığında 1.5B model yanlış olanı seçiyor.

```
Madde 3: Doğum ve Evlilik Yardımı
  "…bir defaya mahsus 10.000 TL evlilik yardımı ödenir.
   Çocuğu dünyaya gelen çalışana çocuk başına 15.000 TL doğum yardımı yapılır…"

Soru : "Doğum yardımı ne kadar?"
Önce : 10.000 TL   ← maddedeki İLK sayı
Sonra: 15.000 TL
```

**Önce prompt denendi ve yetmedi.** `SYSTEM_PROMPT_RULES` 6-7 numaralı kurallar ("tam
kalemi bul, benzer olanla karıştırma") eklendi; ölçüm değişmedi. Bu bir talimat sorunu
değil, dikkat sorunu.

`evidence.service.ts` iki kademeli çalışır:

1. **Cümle seçimi** — parça cümlelere bölünür, bölüm başlığı aday listesinden çıkarılır.
   Soru nicelik soruyorsa ("ne kadar", "kaç") adaylar **sayı taşıyanlarla** sınırlanır
   (answer-type matching). Puanlama, aday kümesi *içindeki* nadirliğe dayanır: her
   cümlede geçen terim ayırt edici değildir, sıfır ağırlık alır.
2. **Yan cümleye inme** — seçilen cümle ≥2 farklı sayısal değer taşıyorsa ve bu değerler
   *ayrı yan cümlelere dağılmışsa* virgül/noktalı virgül sınırında daralma yapılır.

Seçim yeterince belirgin değilse (en iyi aday ikincinin 1.3 katı değilse) **hiç seçim
yapılmaz**: yanlış bir işaret, işaretsizden zararlıdır.

Bağlamda işaret **parçanın başına** konur — ölçüldü, sona konulduğunda 1.5B model onu
yok sayıp bölümün ilk sayısını alıyordu:

```
[08_yan_haklar… - Madde 3: Doğum ve Evlilik Yardımı]
>> CEVAP CÜMLESİ: Çocuğu dünyaya gelen çalışana çocuk başına 15.000 TL doğum yardımı yapılır.
TAM METİN: …maddenin tamamı…
```

Yan cümleye inildiğinde tam metin **verilmez** (rakip değer aynı cümlede olduğu için
tuzak orada) ve işaret satırı kullanılmaz — blok yalnızca işaretten ibaret olduğunda
model öneki cevabına kopyalıyordu.

> **Neden el yazımı bir "olgu tablosu" değil:** korpusta aynı maddede ≥2 sayısal olgu
> taşıyan **25 bölüm** var. Hepsini elle tabloya yazmak sistemi RAG olmaktan çıkarıp SSS
> arama motoruna çevirirdi ve **kullanıcının yüklediği** yeni dokümanlar için hiç
> çalışmazdı. Bu mekanizma korpustan bağımsızdır.

Seçilen cümle SSE `metadata` olayında da döner; arayüzde alıntı rozetine tıklanınca
cevabın dayandığı cümle görünür.

`npm run test:evidence` — cümle/yan cümle bölme ve canlı korpus üzerinde seçim testleri.

### Sızıntı kalkanı

İşaret koymanın bir bedeli var: küçük model bağlamın **yapısını** yanıtına kopyalıyor —
`>> CEVAP CÜMLESİ:` öneki, `TAM METİN:` başlığı ya da köşeli parantezli dosya adı.
Değer doğru olduğu için bu normal iddialardan kaçıyordu.

Prompt kuralıyla çözülmedi (kural eklendi, davranış değişmedi). Çözüm sunucuda:
`chat.route.ts` akışı süzer — baştaki artıkları kırpar, metnin ortasında bu ifadelerden
biri görülürse yanıtı orada keser. Akış korunur; ilk 120 karakter (önek kalıbı tamamlansın
diye) ve son 24 karakter (kesme kalıbı token sınırında bölünmesin diye) tamponda bekler.

Değerlendirme paketi artık bunu **her vaka için** ayrıca arıyor: yanıtta `.md`,
`TAM METİN:` gibi bir bağlam artığı varsa vaka değeri doğru olsa bile başarısız sayılır.

> İşaretin **adı** 9. kuralda açıkça geçmelidir. "İşaretli cümle" gibi muğlak bir
> ifadeye çevrildiğinde model işareti bulamadı ve ölçüm 47/48'den 45/48'e düştü.
> Yani öneki gizlemek çözüm değil; kopyalamayı sunucuda temizlemek çözüm.

---

## Çok turlu konuşma ve hafıza

Oturum başına son 20 tur saklanır (`conversation.service.ts`). Takip soruları önceki
soruyla birleştirilerek çözümlenir:

```
> 5 yıllık çalışanın yıllık izni kaç gün?   → 14 iş günü
> peki 10 yıllık olsaydı?                    → 20 iş günü   (birleştirildi)
> ya 20 yıllık?                              → 26 iş günü   (birleştirildi)
> Kreş desteği ne kadar?                     → 4.000 TL     (yeni konu, birleştirilmedi)
> ne konuşuyorduk?                           → oturum özeti
```

`Ne konuşuyorduk?` yanıtı da deterministiktir: sorulan sorular ve atıf yapılan
dokümanlardan üretilir, LLM çağrılmaz.

> **Bu kural kasıtlı olarak dardır ve öyle kalmalı.** İlk sürümde "kısa VE bilinen konu
> ismi içermiyor" yeterliydi. Bu **yapısal olarak** hatalıydı: kapsam dışı sorular tanımı
> gereği konu listesinde bulunmaz. Sonuç — *"Ofise evcil hayvan getirebilir miyim?"*
> önceki soruyla birleşip kullanıcıya **ihbar süresi** cevabı döndü. Şimdi takip sayılmak
> için ya açık bir işaret ("peki", "ya") ya da ≤3 kelimelik sayı içeren bir "delta"
> ifadesi gerekiyor; her iki durumda da yeni bir konu ismi varsa birleştirme yapılmaz.
> Test paketinde bu senaryonun regresyon koruması var.

Ayrıca geçmiş **yalnızca takip sorularında** LLM'e verilir; konusu belli yeni bir soruya
geçmiş eklendiğinde küçük model önceki konuyu yeni cevaba karıştırıyordu (ölçüldü).

---

## PDF desteği

Şartname korpusu `.md / .pdf` olarak tanımlar. Her ikisi de desteklenir.

```bash
npm run pdf         # data/corpus/*.md → data/corpus-pdf/*.pdf
npm run test:pdf    # çıkarım sadakatini doğrula
```

Dönüşüm ek npm bağımlılığı gerektirmez — sistemde kurulu Chrome/Edge headless modda
kullanılır. Okuma tarafında `pdfjs-dist` (saf JS) çalışır; punto büyüklüğünden başlık
çıkarımı yapılır, böylece mevcut başlık-duyarlı chunker ve "Madde N" alıntıları
değişmeden korunur.

**Doğrulanmış sadakat:** PDF korpusundan indeksleme **94 parça** üretiyor — markdown ile
birebir aynı. Retrieval de aynı maddeleri getiriyor, kapsam dışı sorular yine reddediliyor.

> Punto eşiği 1.15 seçilirse 13.0pt'lik madde başlıkları kaçırılır (gövde 11.5pt →
> eşik 13.22) ve tüm doküman tek bölüme düşer. 1.10 kullanılıyor. Ayrıca pdfjs
> kelime aralarındaki boşlukları **ayrı item** olarak yayar; bunlar elenirse kelimeler
> birbirine yapışır.

---

## Türkçe sorgu katmanı: eşanlam ve kutupluluk

İki ayrı sorun, ikisi de embedding'in tek başına çözemediği türden.

**Eşanlam.** Kullanıcının kelimesi mevzuatın kelimesi değil. Korpusta *"annelik"*
**hiç geçmiyor**, *"analık"* 5 kez geçiyor. *"Annelikte ücretli izin ne kadar?"*
sorusunda doğru madde üçüncü sıraya düşüyor, "Evlat Edinme" öne geçiyordu.
`synonym.service.ts` küçük ve **korpusla doğrulanmış** bir tablo tutar; kullanıcının
biçimi geçiyorsa mevzuatın biçimi sorguya eklenir (değiştirilmez).

> Tabloya ekleme kuralı: yalnızca kullanıcı biçimi korpusta **hiç** geçmiyorsa ekleyin.
> İkisi de geçiyorsa genişletme gereksizdir ve alaka kapısının zaten dar olan
> ayrım boşluğunu (0.0179) daraltma riski taşır.

**Kutupluluk.** *"ücretli"* ile *"ücretsiz"* birbirinin zıddı ama embedding uzayında
neredeyse aynı yerde. `polarity.service.ts` bir çift tablosu tutar; sorgu bir ucu
taşıyorsa, karşı ucu taşıyan ve sorgunun ucunu hiç taşımayan parçalar geriye alınır.

Bu yeniden sıralama **alaka kapısından sonra** çalışır ve hiçbir parçayı elemez —
füzyon skoruna dokunmak eşik kalibrasyonunu geçersiz kılardı.

---

## Takip sorusu: kutup değişimi

`isFollowUp` başlangıçta "işaret var **ve** konu ismi yok" istiyordu. Bu, en doğal
takip sorusunu kaçırıyordu:

```
Annelikte ücretli izin ne kadar?    → 16 hafta
peki ya ücretsiz izin               → (birleştirilmedi, genel ücretsiz izin maddesi)
```

Ayırt edici olan **önceki soruyla ortak konu taşıyıp taşımadığı**: "izin" ortak →
devam; *"peki kreş desteği ne kadar?"* → ortak konu yok → konu değişimi.

Yeniden yazma da düz birleştirme değil. Birleştirilmiş sorgu hem "ücretli" hem
"ücretsiz" taşıdığı için ne retrieval ne kanıt seçimi ayırt edebiliyordu; model önceki
cevabı tekrarlıyordu. Kutup çifti tespit edilirse önceki soruda **terim değiştirilir**:

```
"Annelikte ücretli izin ne kadar?" + "peki ya ücretsiz izin"
    → "annelikte ucretsiz izin ne kadar"   (tek ve kendi başına anlamlı soru)
```

Geçmiş turlar LLM'e `history` olarak **verilmez** — küçük model bunu "önceki cevabı
tekrarla" diye okuyordu. Konu bilgisi sistem promptuna bir satır olarak yazılır.

---

## Ayrıntı modelden değil koddan

Kullanıcı daha ayrıntılı yanıt istedi. Prompt'a *"önce değeri ver, sonra koşul ve
istisnaları da aktar, 2-5 cümle"* kuralı eklendi ve **ölçüm bozuldu** — qwen2.5-1.5b
muhakeme etmeye çalışıp çöktü:

```
"Annelikte ücretli izin ne kadar?"
→ "...Sonuç olarak çalışanların doğumdan önceki 3 haftada... Sonuç = 8 - 3 = 5 haftalar"
```

Küçük modelde **kısalık koruyucudur**. Bu yüzden kural geri alındı ve ayrıntı başka
yerden geliyor: yanıtın altındaki **Dayanak** bloğu, cevabın dayandığı maddenin tam
metnini birebir gösterir (`details` SSE olayı). Hem modelin üretebileceğinden daha
kapsamlı, hem de halüsinasyon riski sıfır — metin üretilmiyor, korpustan okunuyor.

### Bozuk yanıt kalkanı

1.5B model bazen tamamen anlamsız metin üretiyor:

```
"Evden çalışma hakkım var mı?"
→ "EVNETE CALIŞMA HAKIMKI BİTTİRMEDİKTIRIR. EVNETE CALIŞMA HAKIMLIIZDA DAHILİ..."
```

Retrieval doğruydu; bu üretim sınırı. `answerGuard.service.ts` akış sırasında üç dar
kurala bakar (aynı üçlü 3+ kez, 6+ harfli tamamı büyük 3+ sözcük, aynı cümlenin
tekrarı) ve yakalarsa akışı keser; yerine mevzuatın **birebir** cümlesi gönderilir
(`replace` olayı) ve arayüz bunu açıkça belirtir.

---

## Korpus sağlığı denetimi

Bu projedeki 20 doküman elle yazıldı — temiz, tutarlı, çelişkisiz. Gerçek İK arşivleri
böyle değil. `corpusAudit.service.ts` üç senaryoyu deterministik olarak raporlar
(`GET /api/corpus/audit`, Korpus panelinde görünür):

| Bulgu | Ne demek |
|---|---|
| **Çelişki** | Aynı başlıklı iki bölüm, aynı birim, farklı sayı — eski sürüm arşivde kalmış olabilir |
| **Tekrar** | İki bölüm %85+ örtüşüyor — mükerrer yükleme |
| **Yapı** | Doküman tek parçaya düşmüş (başlık yok) veya bölüm çok uzun |

Çelişki ölçütü **iki kez değiştirildi**, ikisi de ölçümle elendi:

| Ölçüt | Temiz korpusta sahte alarm |
|---|---|
| Ortak uzun sözcük ≥ 3 | 9 |
| Ortak **nadir** sözcük ≥ 2 (df ≤ %10) | 11 |
| **Bölüm başlığı örtüşmesi** (≥2 sözcük ve oran ≥ 0.5) | **0** |

> Üçüncüsünde de bir tuzak vardı: gövdeleyici "Madde" sözcüğünü `madd` yapıyor, bu
> yüzden `t !== 'madde'` filtresi hiç tutmuyor ve **her** başlık çifti bedava bir ortak
> sözcük kazanıyordu. "Madde N" öneki tokenize edilmeden önce atılmalı.

`npm run test:audit` iki yönü birlikte ölçer: kasıtlı bozulmuş bir korpusta sorunlar
bulunmalı **ve** temiz korpusta yüksek öncelikli bulgu olmamalı. İkincisi olmadan bir
denetim aracı kolayca "her şeye sorun diyen" bir araca dönüşür.

---

## Doküman biçimleri: DOCX ve taranmış PDF

`documentReader.service.ts` tek giriş noktasıdır; hem indeksleme hem yükleme
doğrulaması buradan geçer. Öncelik: **`.md` > `.docx` > `.pdf`** — markdown kaynak
metin, DOCX yapısı korunmuş metin, PDF ise en çok bilgi kaybeden biçim.

**DOCX.** `mammoth` Word'ü Markdown'a çevirir ve **başlık stillerini korur**
(Heading 1 → `#`, Heading 2 → `##`) — yani mevcut başlık-duyarlı chunker değişmeden
çalışır ve alıntılar "Madde N" düzeyinde kalır. Word'de başlık stili kullanılmamışsa
`Madde N: …` biçimindeki satırlar başlığa yükseltilir.

**Taranmış PDF (OCR).** Metin katmanı boşsa OCR'a düşülür. İki tasarım kararı:

- **Dil verisi depoda taşınır.** `tesseract.js` `tur.traineddata`'yı varsayılan olarak
  bir CDN'den indirir — bu projenin temel iddiasını bozardı. Dosya
  `server/vendor/tessdata/` altında durur, `langPath` oraya bakar, exe paketine kopyalanır.
- **Rasterizasyon canvas'sız.** pdfjs sayfa çizmek için native `canvas` ister.
  Onun yerine gömülü görüntüler doğrudan PDF'ten çıkarılır (`pdfImage.service.ts`):
  `/Subtype /Image` sözlüğü bulunur, `/FlateDecode` zlib ile açılır ya da `/DCTDecode`
  gövdesi zaten JPEG'dir. Ham pikseller `sharp` ile gri tonlamalı PNG'ye çevrilir.

> pdfjs'in kendi nesne havuzundan (`page.objs`) görüntü okumak da denendi: operatör
> listesi alındığında görüntüler henüz çözülmediği için **0 görüntü** dönüyor.

`npm run fixtures` örnek dosyaları üretir (Word başlıklı bir DOCX ve metin katmanı
olmayan bir PDF), `npm run test:formats` ikisini de doğrular — OCR testinde önce
PDF'in gerçekten metin katmansız olduğu kontrol edilir, sonra okunan metinde
`07:30`, `18:00`, `1.250` gibi ayırt edici parçalar aranır. Ölçülen süre: 2000×1800
tek sayfa ≈ 1.7 sn.

---

## Korpus yönetimi (arayüzden)

Başlıktaki **Korpus** düğmesi doküman panelini açar: Markdown/PDF sürükle-bırak,
doküman listesi (parça sayısı, boyut), silme ve elle yeniden indeksleme.

```
POST   /api/documents           { name, contentBase64 }   → kaydet + yeniden indeksle
GET    /api/documents                                     → liste + parça sayıları
DELETE /api/documents/:name                               → sil + yeniden indeksle
POST   /api/documents/reindex                             → yalnızca yeniden indeksle
```

Tasarım kararları:

- **Multipart yerine base64 JSON.** Air-gapped kurulumda yeni bağımlılık (multer vb.)
  eklememek için; korpus dokümanları küçük olduğundan base64'ün %33 şişmesi önemsiz.
- **Kısmi değil tam yeniden indeksleme.** BM25 belge frekansları ve alaka eşiği korpusun
  tamamına bağlı; kısmi güncelleme sessizce tutarsız skorlar üretirdi.
- **Mutex.** Eş zamanlı iki yükleme `resetStore()` üzerinde yarışır ve indeksi yarım
  bırakırdı.
- **Dizin geçişi savunması.** Gelen ad doğrudan dosya sistemine yazılacağı için yalnızca
  taban ad alınır, beyaz liste ile doğrulanır ve uzantı `.md`/`.pdf` ile sınırlanır.
  `test:documents` bunu 21 vakayla doğrular (`../../.env.local`, `sub/dir.md`,
  `script.md.exe`, null bayt…).
- **Önce doğrula, sonra yaz.** Dosya geçici dizine yazılıp çözümlenir; ancak tüm
  kontrolleri geçerse korpusa alınır. Bozuk PDF, boş metin veya aşırı büyük doküman
  korpusu kirletmez ve boşuna yeniden indeksleme tetiklemez.

Sınırlar: dosya başına 10 MB, doküman başına **500 parça**. İkinci sınır ölçümden
doğdu — embedding süreç içinde hesaplandığından 1.6 MB'lik bir metin (~1100 parça)
isteği dakikalarca askıda bıraktı ve sistem bozulmuş gibi göründü. Bu ölçek için doğru
çözüm arka plan işi + ilerleme bildirimi olurdu; kapsamda değil, bu yüzden açıkça
reddediliyor. Ölçek için: mevcut 20 doküman toplam 94 parça, 150 sayfalık gerçek bir
İK el kitabı ~300 parça eder.

Her değişiklikten sonra yanıt bir **uyarı** taşır ve panel bunu olduğu gibi gösterir:

> Korpus değişti. Alaka eşiği korpus büyüklüğüne duyarlıdır — `calibrate.ts` ile yeniden
> kalibre edip `npm test` ile doğrulayın.

Bu uyarı süs değil: eşiğin korpus büyüklüğüne duyarlı olduğu bu projede ölçülerek
öğrenildi (bkz. "Marj ölçütü neden kaldırıldı").

Markdown yüklenirken `#` başlık satırı yoksa panel ayrıca uyarır — başlıksız metin tek
parçaya düşer ve kaynak gösterimi zayıflar.

---

## Politika sürümleme

Mevzuat değişir. Sürümleme olmadan bir doküman güncellendiğinde **geçmiş
yanıtların dayanağı yok olur**: denetim kaydındaki `01_izin.md :: Madde 1`
alıntısı bugünkü dosyaya çözülür, o gün ne yazdığı hiçbir yerde durmaz.

Her içerik değişikliği bir sürüm açar; sürümün metni arşivlenir ve **silinemez**
(SQLite tetikleyicisi). Denetim kaydı dosya adı değil **sürüm kimliği** saklar,
böylece bir yanıtın dayandığı metin yıllar sonra da birebir okunabilir.

```
Yükleme  →  içerik özeti (sha256) yürürlükteki sürümden farklı mı?
             ├── hayır → sürüm açılmaz
             └── evet  → s(n+1), yürürlük tarihi + değişiklik notu ile
```

Sürüm tetikleyicisi **içerik özetidir**, bir düğme değil: korpus dizinine elle
kopyalanan bir dosya da geçmişe yazılır. Tek doğruluk kaynağı indekslenmiş
olandır.

**İleri tarihli yürürlük.** Yürürlük tarihi gelecekteyse dosya korpusa değil
`data/corpus-pending/` dizinine yazılır — korpus dizini tanımı gereği
*yürürlükteki* metindir. Tarihi gelince sunucu dosyayı korpusa taşır ve indeksi
yeniler (açılışta bir kez, sonra saatlik).

**Yanıtın altında** hangi sürüme dayandığı yazar:

> Bu yanıt **01 Ekim 2026** tarihinde yürürlüğe giren 3. sürüme dayanmaktadır.

**Fark görünümü** iki sürüm arasında tam olarak neyin değiştiğini gösterir —
"güncellendi" bilgisi tek başına işe yaramaz, hangi sayının değiştiği önemlidir.
LCS satır farkı bağımlılıksız yazıldı; değişmemiş bloklar toplanır, çevresinde
2 satır bağlam bırakılır.

Erişim etiketi **sürüme değil dokümana** aittir: bir doküman `ik` yapılırsa tüm
geçmişi de kısıtlanır. Güvenli yön budur.

Ayrıntılı gerekçeler: [`docs/SPRINT-2-TASARIM.md`](docs/SPRINT-2-TASARIM.md).

---

## Denetim bütünlüğü

Denetim kaydını SQLite tetikleyicileri koruyor, ama bu **uygulama içinden** gelen
yolları kapatır. `data/vectors.db` dosyasına doğrudan erişebilen biri —
`sqlite3` komut satırıyla — tetikleyiciyi düşürüp satır silebilir.

### Dürüst sınır

Tek bir air-gapped makinede kurcalamayı **imkânsız** kılamazsınız; dosyaya
erişimi olan, sonunda özel anahtara da erişir. Yapılabilecek olan şu:

1. Kurcalamayı **tespit edilebilir** kılmak → hash zinciri
2. Tespit kanıtını **taşınabilir** kılmak → imzalı arşiv

**Asıl savunma, arşivin makineden dışarı çıkarılmış olmasıdır.** Dışarı çıkmış
bir arşiv geriye dönük değiştirilemez.

### Hash zinciri

Her denetim satırı bir öncekinin özetini taşır:

```
row_hash = sha256(prev_hash ‖ satırın alanları)
```

Aradan satır silmek ya da bir satırı değiştirmek zinciri o noktadan itibaren
kırar. Ölçüldü: yalnızca `duration_ms` alanını oynatmak bile yakalanıyor.

**Zincirin göremediği tek durum:** son satırların silinmesi — ileriye işaret
eden bir şey yok. Bunun cevabı arşivdir: arşiv, o an zincirin başını ve son
satır numarasını kaydeder; veritabanı arşivin gerisine düşmüşse kurcalama ortaya
çıkar. Son arşivden *sonra* yazılmış satırların silinmesi hâlâ tespit edilemez;
çözümü sık arşivlemektir. Bu sınır gizlenmiyor çünkü gizlenmesi yanlış güvence
üretir.

### Arşiv üretmek ve dışarı çıkarmak

Arşiv üretmek tek başına hiçbir şey korumaz — koruma, arşivin makineden
**dışarı çıkarılmış** olmasından gelir. Dışarı çıkmış bir arşiv geriye dönük
değiştirilemez. Tek komut hem arşivi üretir hem denetçiye verilecek paketi
hazırlar:

```bash
npm run arsivle -- <hedef-klasör>
```

Hedef klasöre dört dosya yazılır:

```
denetim-arsivi-<tarih>.json   imzalı arşiv
acik-anahtar.pem              Ed25519 açık anahtarı
dogrula.mjs                   bağımsız doğrulayıcı — tek dosya, kurulum yok
OKUBENI.txt                   doğrulama talimatı + parmak izleri + sınırlar
```

Betik kopyayı **yazdıktan sonra doğrular**; doğrulama başarısızsa talimat
dosyası hiç yazılmaz. Pakete güvenilmesini istiyorsak paketin kendisi
sınanmalıdır.

Sonra klasör makine dışına kopyalanır ve iki değer (açık anahtar parmak izi,
arşiv SHA-256'sı) bilgisayardan **bağımsız** bir yere kaydedilir — denetimde
karşılaştırılacak olan budur.

Her arşiv bir öncekinin özetini taşır (`oncekiArsiv`), yani arşivlerin kendisi
de zincirlenir: aradan bir arşivin çıkarılması fark edilir.

### Bağımsız doğrulama

Kurcalanmış bir sunucunun kendi arşivini "geçerli" demesi hiçbir şey kanıtlamaz.
Doğrulama başka bir makinede yapılır. İki yol var:

```bash
# depoda, geliştirme sırasında
npm run verify-archive -- <arşiv.json> <açık-anahtar.pem>

# denetçide — depo yok, node_modules yok, kurulum yok
node dogrula.mjs <arşiv.json> <açık-anahtar.pem>
```

İkisi **aynı kaynaktan** gelir: `dogrula.mjs`, `scripts/verify-archive.ts`'in
esbuild ile paketlenmiş halidir. Mantık kopyalanmaz, yalnızca taşınabilir hale
getirilir. Kaynak dosyanın kendisi `integrity.service`'i import ettiği için depo
ve `tsx` olmadan çalışmaz; denetçinin elinde bunlar olmayacak.

Doğrulayıcı veritabanına dokunmaz, sunucuya bağlanmaz, internete çıkmaz —
yalnızca `node:*` modüllerine bağlıdır. Geçerli arşivde çıkış kodu 0,
kurcalanmışta 1. Ölçüldü: bir denetim satırının yalnızca `role` alanını
değiştirmek hem imzayı hem zinciri düşürüyor ve kırılan satırın numarası
raporlanıyor.

Açık anahtar **bağımsız edinilmelidir**: arşive gömülü anahtarla doğrulama,
dosyanın kendi içinde tutarlı olduğunu gösterir ama kimin imzaladığını
kanıtlamaz — saldırgan kendi anahtarıyla yeniden imzalayıp gömülü alanı da
değiştirebilir. Betik anahtar verilmediğinde bunu açıkça söyler.

### Özel anahtar nerede durmalı

Özel anahtar varsayılan olarak `data/audit-signing.key` içinde, yani
**veritabanıyla aynı klasörde**. Dosyaya erişen kişi ikisine birden erişir ve
kendi arşivini imzalayabilir. `AUDIT_KEY_PATH` ile anahtar başka bir yere
(çıkarılabilir sürücü, ayrı disk) alınabilir; asıl korunma yine açık anahtar
parmak izinin bağımsız kaydıdır — değişmiş bir anahtar hemen fark edilir.

### Zincir öncesi satırlar

Zincir eklenmeden önce yazılmış satırların özeti **geriye dönük
hesaplanmadı** ve panelde "zincir öncesi" olarak gösterilir. Zaten değiştirilmiş
olabilecek veri üzerinden hash üretmek, doğrulanmamış şeye "doğrulandı" demek
olurdu.

---

## Politika boşluğu raporu

Denetim kaydının cevapladığı soru "kim neye erişti" ise, bu raporunki şudur:
**çalışanlar neyi soruyor ama mevzuatta karşılığı yok?**

İK için bu, asistanın kendisinden değerli olabilir — hangi yönergeyi yazmaları
gerektiğini tahminle değil veriyle söyler.

### Sprint 1 ile çakışma ve çözümü

Bu özellik "denetim kaydındaki `answered=0` satırlarından rapor üret" diye
planlanmıştı. Kodlarken çıktı ki **bu mümkün değil**: Sprint 1 kararı gereği
soru metni yalnızca *kısıtlı* bir dokümana erişildiğinde saklanıyor. Alaka
kapısına takılan soruda hiçbir dokümana erişilmez, dolayısıyla metin `NULL`
kalır. Ölçüldü: 20 yanıtsız satırın 20'sinde de soru metni yok.

Sprint 1 kararı yanlış değil — her soruyu kullanıcının adına yazmak, çalışanın
ne merak ettiğini kalıcı kayda geçirir ve sisteme soru sormaktan çekindirir.

**Çözüm:** ayrı bir tablo — soru metni saklanır, **kim sorduğu saklanmaz.**
Korunması gereken şey metnin kendisi değil, *metin ile kişi arasındaki bağdı*:

- `user_id` / `username` **yok**
- zaman damgası **hafta** çözünürlüğünde (tam saat saklansaydı denetim
  kaydındaki `answered=0` satırıyla saniye saniye eşleştirilebilirdi)

Artık risk: düşük hacimli bir kurulumda, bir hafta içinde tek bir yanıtsız soru
varsa eşleştirme yine mümkün. Bu gizlenmiyor; kurum hacmi büyüdükçe kayboluyor.

Bu tablo, denetim kaydının aksine **silinebilir** — serbest metin taşır ve
içine kişisel ayrıntı girebilir. Varsayılan saklama süresi 52 hafta.

### Kümeleme bir yardımcıdır, sınıflandırıcı değil

Sorular yerel embedding ile konu kümelerine ayrılır — vektör zaten arama için
hesaplandığından maliyeti yok ve LLM'e hiç gidilmez (rapor deterministik).

Eşik ölçüldü (`npm run calibrate:gap`, 16 aynı-konu / 89 farklı-konu çifti):

```
AYNI konu    min 0.7892  medyan 0.8638  maks 0.9128
FARKLI konu  min 0.7631  medyan 0.8177  maks 0.8767
ayırım boşluğu: -0.0875   ← NEGATIF, dağılımlar ÖRTÜŞÜYOR
```

Yani tek bir eşik konuları temiz ayıramıyor — bu projede `RELEVANCE_MARGIN`'in
çöküşüyle aynı sınıf bir sonuç. Seçilen 0.86, ölçülen en iyi denge: 16 aynı-konu
çiftinin 10'u birleşiyor, 89 farklı-konu çiftinin yalnızca 1'i yanlış birleşiyor.

**Taraf tutma yönü bilinçli:** fazla bölmek, yanlış birleştirmekten iyidir.
Fazla bölünmüş rapor listeyi uzatır; yanlış birleştirilmiş rapor iki ayrı
boşluğu tek boşluk gibi gösterir ve İK'yı yanıltır. Telafi olarak her kümeye en
benzer diğer küme (`relatedTo`) eklenir.

### "Az kaldı" ayrımı

Eşiğe çok yaklaşan sorular ayrı işaretlenir: konu mevzuatta **geçiyor** ama
yeterince açık yazılmamış demektir — yeni yönerge değil, mevcut maddeyi
netleştirme işi.

Bu tabanın da ölçülmesi gerekti. İlk halinde eşikten sabit bir bant (0.02)
çıkarılmıştı; kalibrasyon ise kapsam dışı sorguların **0.8230'a kadar**
çıkabildiğini söylüyor. Sonuç: apaçık alakasız sorular da "az kaldı" alıyordu
(ölçüldü: "Ofise evcil hayvan getirebilir miyim?" 0.814 ile işaretlendi).
Doğru taban, kalibrasyonda ölçülen kapsam-dışı maksimumudur.

---

## Model karşılaştırması

`npm run compare`, **aynı** değerlendirme vakalarını birden çok Foundry Local modeliyle
koşturup doğruluk/gecikme matrisi üretir ve `data/MODEL-KARSILASTIRMA.md` dosyasına yazar.

Her model için ayrı bir sunucu süreci ayağa kalkar (kendi portu, `FOUNDRY_MODEL`
sabitlenmiş), model daemon'a yüklenir, vakalar koşturulur, süreç kapatılır ve model
bellekten atılır.

> **Model yükleme adımı zorunlu.** `/v1/models` önbellekteki *tüm* varyantları listeler,
> yüklü olanları değil. İlk denemede üç model de 0.1 saniyede aynı şekilde 15/48 ile
> çöktü — hiçbiri aslında çalıştırılmamıştı. `foundry model load` eklenene kadar
> karşılaştırma "model kötü" diye yanlış bir sonuç üretiyordu.

Matriste iki skor vardır: **toplam** ve **LLM vakaları**. Kademe hesaplayıcısı, niyet
katmanı ve alaka kapısı LLM çağırmadığından o vakalar her modelde aynıdır; modeller
arasında ayırt edici olan ikinci sütundur.

---

## Şartnameden bilinçli sapmalar

| Konu | Şartname | Uygulama | Gerekçe |
|---|---|---|---|
| Embedding modeli | `bge-small-en` / MiniLM | `multilingual-e5-small` | Korpus ve sorgular Türkçe; İngilizce-only model Türkçe'de zayıf retrieval üretir |
| Vektör deposu | `sqlite-vss` | `node:sqlite` + in-process kosinüs | sqlite-vss Windows'ta ön-derlenmiş ikili sağlamıyor ve bakımı durdu; bu korpus boyutunda brute-force arama milisaniyeler sürer |
| Benzerlik eşiği | sabit 0.65 | 0.853 + marj kapısı | Yukarıdaki kalibrasyon; 0.65 bu modelde halüsinasyon engellemesini çökertir |
| Backend portu | — | 5273 | 5272 Foundry Local'e ait |

### Şartname içi tutarsızlık (dikkat)

Bölüm 6, *"5 yıllık çalışan kaç gün yıllık izin kullanabilir?"* sorusunun beklenen yanıtını
**20 iş günü** olarak veriyor. Ancak aynı şartnamenin korpus metni (Madde 2) şöyle:

- 1 yıldan **5 yıla kadar (5 yıl dahil)**: **14 iş günü**
- **5 yıldan fazla** 15 yıldan az: 20 iş günü

"5 yıllık" çalışan, korpusun kendi ifadesiyle *5 yıl dahil* kademesine girer → **14 iş günü**.
Korpus metni 4857 sayılı İş Kanunu md. 53 ile de uyumludur; beklenen yanıt satırı hatalı görünüyor.
Sistem korpusa sadık kalır (doğru davranış). Test paketi bu nedenle sayıyı değil, **doğru maddenin
getirilmesini** doğrular. Kararı sizin: korpus doğruysa şartnamedeki beklenen yanıt düzeltilmeli.

---

## Sorun giderme

### Foundry Local varyantı bu makinede bozuk olabilir

Bu depo geliştirilirken çift GPU'lu bir dizüstünde (NVIDIA RTX 3050 Laptop + AMD entegre)
`phi-3.5-mini` varyantları şu şekilde davrandı:

| Varyant | Sonuç |
|---|---|
| `phi-3.5-mini-instruct-trtrtx-gpu` | HTTP 500 → `CUDA error ... invalid device ordinal`, soket kapanıyor |
| `Phi-3.5-mini-instruct-cuda-gpu` | Akış çalışıyor ama **çıktı bozuk** (anlamsız token dizisi) |
| `Phi-3.5-mini-instruct-generic-cpu` | **Doğru çalışıyor** (~5–20 sn/yanıt) |

Çift GPU'lu sistemlerde execution provider yanlış cihaz seçebiliyor. Belirti olarak
500 hatası, `UND_ERR_SOCKET`, ya da dilbilgisiz/tekrarlayan çıktı görürseniz CPU
varyantına geçin ve `.env.local` içinde sabitleyin.

Hızlı teşhis:

```powershell
foundry model info <alias>        # varyantları ve önbellek durumunu gör
foundry server status -o json     # daemon adresi
```

### Yanıtlar birden yavaşladı ve bozuldu

Belirti: normalde 0.5–1 sn süren yanıtlar 6–15 sn sürüyor ve içerik bozuluyor
(*"Kreş desteği ne kadar?"* → *"ay 44.000 TL"*).

Sebep, Foundry daemon'ının **model yükle/at** döngüsünden sonra bozuk duruma düşmesi —
`npm run compare` art arda dört model yükleyip attığında bu yaşandı. Çözüm:

```powershell
foundry server restart
foundry model load qwen2.5-1.5b-instruct-cuda-gpu
```

Ardından ölçülen süre 0.5–1.1 sn'ye, yanıtlar doğruya döndü. Kodda değişiklik gerekmedi.

### Yanıt geliyor ama içerik yanlış

Önce `npm run test:rag` çalıştırın. Testler geçiyorsa **retrieval doğru** demektir; sorun
üretim (LLM) katmanındadır — daha güçlü bir model deneyin. Testler kalıyorsa eşikleri
`scripts/calibrate.ts` ile yeniden kalibre edin.

Küçük modeller (≤4B) Türkçe kademeli listelerde ("5 yıla kadar / 5 yıldan fazla") hata
yapabiliyor. Türkçe kalitesi için Qwen ailesi Phi'ye göre belirgin biçimde daha iyi sonuç
veriyor.

## Proje yapısı

```
private-hr-rag/
├── data/
│   ├── corpus/                     # 20 İK/mevzuat dokümanı (.md / .docx / .pdf)
│   ├── corpus-pdf/                 # aynı dokümanların PDF karşılıkları
│   ├── KAPSAM.md                   # kapsam tanımı (indekslenmez)
│   ├── MODEL-KARSILASTIRMA.md      # `npm run compare` çıktısı
│   └── vectors.db                  # üretilen vektör indeksi (ingest sonrası)
├── server/
│   ├── src/
│   │   ├── config/constants.ts     # tüm eşikler, portlar, model adları
│   │   ├── services/
│   │   │   ├── chunker.ts               # başlık-duyarlı chunking
│   │   │   ├── embedding.service.ts
│   │   │   ├── vectorStore.service.ts   # alaka kapısı + hibrit skor
│   │   │   ├── lexical.service.ts       # BM25 (Türkçe sadeleştirme)
│   │   │   ├── evidence.service.ts      # cümle düzeyinde kanıt seçimi
│   │   │   ├── polarity.service.ts      # ücretli/ücretsiz ayrımı
│   │   │   ├── synonym.service.ts       # sorgu genişletme
│   │   │   ├── answerGuard.service.ts   # bozuk yanıt kalkanı
│   │   │   ├── corpusAudit.service.ts   # çelişki / tekrar / yapı denetimi
│   │   │   ├── documentReader.service.ts # .md / .docx / .pdf tek giriş
│   │   │   ├── docxExtract.service.ts
│   │   │   ├── ocr.service.ts           # taranmış PDF
│   │   │   ├── pdfImage.service.ts      # gömülü görüntü çıkarımı
│   │   │   ├── intent.service.ts        # niyet sınıflandırma
│   │   │   ├── conversation.service.ts  # oturum hafızası + takip sorusu
│   │   │   ├── policyCalculator.service.ts  # kademe tabloları
│   │   │   ├── pdfExtract.service.ts
│   │   │   ├── ingestion.service.ts
│   │   │   ├── identity.service.ts      # hesaplar, roller, erişim etiketi
│   │   │   ├── audit.service.ts         # silinemez denetim kaydı
│   │   │   ├── versioning.service.ts    # politika sürümleri + arşiv
│   │   │   ├── corpusSync.service.ts    # indeks kilidi + yürürlüğe alma
│   │   │   ├── diff.service.ts          # satır düzeyinde sürüm farkı
│   │   │   ├── integrity.service.ts     # hash zinciri + imzalı arşiv
│   │   │   ├── policyGap.service.ts     # yanıtsız soru kümeleme + rapor
│   │   │   └── foundryClient.service.ts # SSE + sağlık kontrolü
│   │   ├── routes/{chat,documents,versions,integrity,reports,auth}.route.ts
│   │   └── index.ts
│   └── package.json
├── client/
│   ├── src/
│   │   ├── components/{ChatWindow,CitationBadge,StatusIndicator,DocumentManager}.tsx
│   │   ├── components/{AuthGate,AuditPanel,VersionHistory,IntegrityPanel}.tsx
│   │   ├── components/{PolicyGapPanel,DetailsBlock,CitationBadge}.tsx
│   │   ├── App.tsx · main.tsx · styles.css · types.ts
│   └── vite.config.ts
├── scripts/
│   ├── ingest.ts
│   ├── calibrate.ts                # eşik kalibrasyon aracı
│   ├── eval-cases.ts               # paylaşılan değerlendirme vakaları
│   ├── eval-answers.ts             # uçtan uca cevap kalitesi
│   ├── compare-models.ts           # model karşılaştırma matrisi
│   ├── eval-auth.ts                # değerlendirme paketleri için oturum
│   ├── eval-sandbox.ts             # eval için yalıtılmış sunucu + DB kopyası
│   ├── test-rag.ts · test-policy.ts · test-evidence.ts · test-pdf.ts
│   ├── test-identity.ts · test-access.ts · test-versions.ts · test-endpoints.ts
│   ├── test-integrity.ts · verify-archive.ts   # bağımsız arşiv doğrulayıcı
│   ├── test-gap.ts · calibrate-gap.ts          # kümeleme eşiği kalibrasyonu
│   ├── md-to-pdf.mjs · build-exe.mjs
└── README.md
```

## API

| Uç | Yöntem | Açıklama |
|---|---|---|
| `/api/health` | GET | İndeks durumu, Foundry Local bağlantısı, aktif model, eşikler |
| `/api/chat` | POST | `{ message, sessionId }` → SSE akışı |
| `/api/session/reset` | POST | `{ sessionId }` → oturum hafızasını siler |
| `/api/documents` | GET | Korpus listesi, parça sayıları, gölgelenen PDF'ler |
| `/api/documents` | POST | `{ name, contentBase64, note?, effectiveFrom? }` → kaydet + yeniden indeksle |
| `/api/documents/:name` | DELETE | Sil + sürümleri geri çek + yeniden indeksle |
| `/api/documents/reindex` | POST | Yalnızca yeniden indeksle |
| `/api/corpus/audit` | GET | Korpus sağlığı: çelişki, tekrar, yapı bulguları |
| `/api/documents/:name/versions` | GET | Sürüm geçmişi (durum, yürürlük tarihi, not) |
| `/api/documents/:name/versions/:v` | GET | Bir sürümün arşivlenmiş tam metni |
| `/api/documents/:name/diff?a=&b=` | GET | İki sürüm arasındaki satır farkı |
| `/api/versions/:id` | GET | Sürüm kimliğiyle doğrudan arşiv metni (denetim bağlantısı) |
| `/api/documents/:name/label` | PATCH | `{ label }` → erişim etiketi (yalnızca yönetici) |
| `/api/documents/pending` | GET | Yürürlüğe girmeyi bekleyen sürümler |
| `/api/documents/pending/promote` | POST | Tarihi gelmiş sürümleri elle yürürlüğe al |
| `/api/documents/:name/pending` | DELETE | Planlanmış sürümden vazgeç |
| `/api/auth/status` · `/auth/login` · `/auth/logout` · `/auth/setup` · `/auth/users` | — | Kimlik katmanı (Sprint 1) |
| `/api/audit` | GET | Denetim kaydı (yönetici tümü, diğerleri kendi satırları) |
| `/api/audit/integrity` | GET | Hash zinciri durumu (yalnızca yönetici) |
| `/api/audit/archive` | POST | İmzalı arşiv üret (yalnızca yönetici) |
| `/api/audit/archives` | GET | Arşiv listesi (yalnızca yönetici) |
| `/api/audit/archives/:dosya` | GET | Bir arşivi yerinde doğrula (yalnızca yönetici) |
| `/api/reports/policy-gaps` | GET | Politika boşluğu raporu (İK + yönetici) |

Erişimi olmayan bir dokümana yapılan istek **404** alır, 403 değil: dokümanın
var olduğu bilgisi bile sızmamalı.

`/api/chat` SSE olay sırası:

```
event: metadata          → { citations: [{ doc, section, score, evidence?,
                                          version?, versionId?, effectiveFrom? }],
                             basis?: { doc, version, effectiveFrom },
                             threshold, rewritten?, computed?, intent? }
data:  { token: "..." }  → akan yanıt token'ları
event: replace           → { text, reason }  (yalnızca bozuk üretim yakalanırsa)
event: details           → { primary: { doc, section, text }, related: [...] }
data:  [DONE]
event: error             → { error, code }   (yalnızca hata durumunda)
```

`metadata` alanları: `evidence` seçilen kanıt cümlesi, `rewritten` takip sorusunun
yeniden yazıldığını, `computed` cevabın kademe tablosundan hesaplandığını, `intent`
sohbet katmanının yanıtladığını gösterir. `basis` yanıtın dayandığı politika
sürümüdür ve arayüzde *"Bu yanıt … tarihinde yürürlüğe giren N. sürüme
dayanmaktadır"* satırı olarak gösterilir; `versionId` denetim kaydına yazılır.

## Yapılandırma

Tüm değerler `server/src/config/constants.ts` içinde, ortam değişkeniyle geçersiz kılınabilir:

`FOUNDRY_BASE_URL` · `FOUNDRY_MODEL` · `PORT` · `EMBEDDING_MODEL` · `CORPUS_DIR` ·
`TOP_K` · `SIMILARITY_THRESHOLD` · `RELEVANCE_MARGIN` · `LEXICAL_WEIGHT` · `CONTEXT_BAND` ·
`EVIDENCE_FOCUS` · `EVIDENCE_ONLY` · `DB_PATH` · `OCR_MAX_PAGES` · `TESSDATA_DIR` ·
`TRANSFORMERS_OFFLINE`

Deney anahtarları:

| Değişken | Ne yapar | Ölçüm (48 vaka, sıcaklık 0) |
|---|---|---|
| `EVIDENCE_FOCUS=0` | Cümle düzeyinde kanıt seçimini kapatır | 44/48 (açıkken **47/48**) |
| `EVIDENCE_ONLY=1` | İşaretli cümle dışında tam metni bağlama koymaz | 46/48 — **daha kötü**, varsayılan kapalı |

`EVIDENCE_ONLY` denemesi öğreticiydi: işaretli cümle tek başına yetmiyor. İki vaka
tam metni gerektiriyor — *"Öğle molası kaç saat ve hangi saatler arasında?"* iki ayrı
olguyu aynı bölümden istiyor. Yani doğru tasarım "işaretle **ve** tam metni de ver".

---

## Katkıda bulunanlar

| | |
|---|---|
| **Sefa Çakmak** | sefacakmak194@gmail.com |
| **İlayda Adaklı** | adakliilayda@gmail.com |

---

## Lisans

Tescilli — tüm hakları saklıdır. Ayrıntı ve üçüncü taraf bildirimleri için
[LICENSE](LICENSE).

Değerlendirme, inceleme ve teknik denetim amacıyla çalıştırmak serbesttir;
üretim kullanımı ayrı bir yazılı lisans gerektirir. Depoda taşınan
`tur.traineddata` ve tüm bağımlılıklar kendi lisanslarına tabidir.
