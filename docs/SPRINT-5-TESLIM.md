# Sprint 5 — Sunum ve teslim

> **Bu belge kime yazıldı:** projeyi 5 dakikada değerlendirecek birine. README
> mühendislik için yazıldı ve 1200 satır; burada olan şey onun çevirisi değil,
> **gösterim sırası** ve **ölçümlerin tek yerde derlenmiş hali**.

Son güncelleme: 19.08.2026

---

## 1. Bir cümlede

Kurumsal İK mevzuatı üzerinde **hiçbir veri makineyi terk etmeden** çalışan,
kaynak gösterimli, sürüm takipli ve denetlenebilir bir soru-cevap asistanı.
Microsoft Foundry Local üzerinde, 23 doküman / 201 bölüm.

Ayırt edici olan şey model değil, **modelin etrafına konan mühendislik**:
sistem cevabı bilmediğinde bilmediğini söylüyor, bunu ölçüyoruz, ve
söylediğimiz her sayının arkasında çalıştırılabilir bir betik var.

---

## 2. Demo akışı — 6 istasyon

Her istasyon tek bir iddiayı kanıtlar. Süreler ölçülmüş, tahmin değil.

### İstasyon 1 — Kaynak gösterimli yanıt · ~40 sn

**Sor:** *"Babalık izni kaç gün?"*

**Göster:** yanıtın altındaki kaynak kartı — doküman adı, madde başlığı,
benzerlik skoru ve **alıntılanan cümlenin kendisi**.

**Söyle:** Model cevabı uydurmuyor; hangi cümleden geldiği görünüyor. Kaynak
kartında ayrıca *"… tarihli sürüme dayanmaktadır"* satırı var — cevap yalnızca
dokümana değil, o dokümanın **belirli bir sürümüne** bağlı.

---

### İstasyon 2 — Halüsinasyon engelleme · ~40 sn

**Sor:** *"Şirket aracı tahsis ediliyor mu?"*

**Beklenen:** *"Şirket içi mevzuat dokümanlarında bu konu hakkında bilgi
bulunmamaktadır."* — **0.0 saniyede**, kaynak listesi boş.

**Söyle:** Bu soru modele hiç gitmedi. Şirket aracı, `data/KAPSAM.md` içinde
*bilerek* kapsam dışı bırakılmış bir konu ve bu karar kodda da karşılığı olan
bir liste (`scope.service.ts`).

**Bunun hikâyesi var — anlatmaya değer:** aynı sorunun uzun hali
(*"Şirket bana özel araç tahsisi yapıyor mu?"*) zaten geçiyordu; kısa hali
geçmiyordu. Sebep: "araç" korpusta *gereç* anlamında geçiyor
(*"lisanssız araç kullanımı"*) ve benzerlik 0.8409 ile eşiği aşıyordu. (Bu ölçümün
yapıldığı sırada eşik 0.832 idi; korpus 201 parçaya çıkınca yeniden kalibre edildi ve
bugün 0.828. Kararın gerekçesi değişmedi: iki dağılım örtüşüyor, eşikle çözülemiyor.)

Eşiği yükseltmek denendi ve **ölçüldü**:

```
kapsam-içi  en düşük : 0.8408   "Mobbing bildirimini nereye yapabilirim?"
kapsam-dışı en yüksek: 0.8409   "Şirket aracı tahsis ediliyor mu?"
ayırım boşluğu       : −0.0001
```

İki dağılım üst üste. Şirket aracı sorusunu engelleyen **her** eşik, meşru bir
mobbing sorusunu da engeller. Bu yüzden çözüm eşikte değil, ayrı bir katmanda.

---

### İstasyon 3 — Ayrıntı modelden değil koddan · ~50 sn

**Sor:** *"5 yıllık çalışanın yıllık izni kaç gün?"* → **14 iş günü**

**Sonra sor:** *"peki 10 yıllık olsaydı?"* → **20 iş günü**

**Söyle:** İkisi de deterministik; küçük dil modelleri kademe sınırlarında
sistematik hata yapıyor (*"5 yıla kadar, 5 yıl **dahil**"*). Cevap kodla
hesaplanıyor, kaynak maddesi yine gösteriliyor. İkinci soru ayrıca **oturum
hafızasını** gösteriyor: "10 yıllık" tek başına anlamsız bir cümle.

**İsteğe bağlı:** *"Yıllık izin kaç gün?"* — kıdem verilmediğinde tek kademe
seçmek uydurma olurdu; sistem **tablonun tamamını** veriyor.

---

### İstasyon 4 — Kilit kapıda (erişim kontrolü) · ~60 sn

**Yap:** Yönetici olarak **Kaynaklar** panelini aç, bir dokümanın etiketini
`genel` → `ik` yap.

**Sonra:** Çalışan rolüyle giriş yap ve o dokümandaki bir şeyi sor.

**Beklenen:** *"bilgi bulunmamaktadır"* — ve **Korpus listesinde o doküman hiç
görünmüyor**.

**Söyle:** Filtre vektör aramasından **önce** uygulanıyor. Kurumsal denetimde
*"sistem o belgeyi okumadı"* savunulabilir; *"okudu ama attı"* ispatlanamaz.
Yetkisiz doküman için 403 değil **404** dönüyor: 403, olmayan bir şeyin
varlığını ele verir.

---

### İstasyon 5 — Denetim bütünlüğü · ~70 sn

**Yap:** **Denetim** panelini aç → bütünlük bölümü → *Arşiv üret*.

**Sonra:** Makine dışına çıkarılmış paket klasöründe, terminalde:

```bash
node dogrula.mjs denetim-arsivi-<tarih>.json acik-anahtar.pem   # çıkış 0
```

**Sonra:** Dosyada tek bir alanı değiştir ve tekrar çalıştır → **çıkış 1**,
hem imza hem zincir düşüyor ve **kırılan satırın numarası** raporlanıyor.

**Söyle:** Denetim kaydı silinemez (SQLite tetikleyicileri) ama dosyaya doğrudan
erişen biri tetikleyiciyi düşürebilir. Hash zinciri bunu **tespit edilebilir**,
imzalı arşiv **taşınabilir** kılıyor. Doğrulayıcı tek dosya — veritabanına
dokunmaz, sunucuya bağlanmaz, boş bir Node kurulumunda çalışır.

**Dürüstlük payı (söylenmeli):** zincir sisteme sonradan eklendi; şu an
kayıtların bir kısmı "zincir öncesi" ve panelde öyle işaretli. Geriye dönük
hash üretmek, zaten değiştirilmiş olabilecek veriye sahte güvence verirdi.

---

### İstasyon 6 — Politika boşluğu raporu · ~40 sn

**Yap:** **Cevaplanamayanlar** panelini aç.

**Söyle:** Çalışanların sorduğu ama mevzuatta karşılığı olmayan konular. Kayıtlar
**kim sorduğu bilgisini taşımaz** ve hafta çözünürlüğünde tutulur — tam saat
saklansaydı denetim kaydıyla eşleştirilebilirdi.

Panelin altındaki not gizlenmiyor: kümeleme bir **yardımcıdır, sınıflandırıcı
değil**. Ölçüldü — aynı konunun farklı ifadeleri ile farklı konular arasındaki
benzerlik dağılımları örtüşüyor (ayırım boşluğu −0.0875), bu yüzden eşik *fazla
bölme* yönünde seçildi.

---

## 3. Derlenmiş ölçümler

Bu projede sezgiyle alınmış karar yok denecek kadar az. Aşağıdaki her satırın
arkasında çalıştırılabilir bir betik var.

### Doğruluk

| Ölçüm | Değer | Nasıl tekrarlanır |
|---|---|---|
| Uçtan uca değerlendirme | **51/52 (%98.1)** | `npm run eval` |
| Saha seti — 100 gerçek çalışan sorusu | **98/98 cevaplandı, 0 sızıntı, 0 olgu hatası** | `npm run saha` |
| Geniş yüzey — 10.000 sorgu | **%86.7 cevaplandı, 0 kapsam dışı sızıntı** | `npm run sweep` |
| Test doğrulaması | **602 doğrulama / 16 paket** | `npm test` |
| CI | Linux'ta yeşil, çevrim dışı | GitHub Actions |

Açık kalan tek vaka **amb-4** (*"Bordro itirazımı kaç gün içinde
yapmalıyım?"*): kanıt seçimi doğru cümleyi işaretliyor ama model aynı maddedeki
ikinci cümleden yanıtlıyor. Korpusu değiştirerek "düzeltmek" mümkün — o, testi
teste uydurmak olurdu; açıkta bırakıldı.

### Model seçimi — ölçümle belirlendi

| Model | Skor | Ortalama | Karar |
|---|---|---|---|
| `qwen2.5-1.5b-instruct-cuda-gpu` | 47/48 | 0.4 s | **seçildi** |
| `qwen2.5-7b-instruct-generic-cpu` | 48/48 | 26.0 s | 1 vaka için 65× yavaş |
| `qwen3.5-2b-text-cuda-gpu` | 31/48 | 3.6 s | çıktı bozuk (`ÇÇÇÇ…`) |

Tam matris: [`data/MODEL-KARSILASTIRMA.md`](../data/MODEL-KARSILASTIRMA.md).
Ölçüm o tarihteki 48 vakalık kümeyle yapıldı.

> Bozuk varyant deneyimi ayrıca bir savunma doğurdu: **bozuk yanıt kalkanı**.
> Model çöktüğünde kullanıcı `ÇÇÇÇ…` görmüyor, mevzuatın birebir alıntısını
> görüyor.

### Kalibre edilmiş eşikler

| Sabit | Değer | Ölçüm |
|---|---|---|
| `SIMILARITY_THRESHOLD` | 0.828 | `npm run calibrate` |
| `LEXICAL_WEIGHT` (hibrit ağırlık) | 0.05 | aynı betik, w süpürmesi |
| `TOP_K` | 3 | — |
| `GAP_CLUSTER_THRESHOLD` | 0.86 | `npm run calibrate:gap` |
| `GAP_NEAR_MISS_FLOOR` | 0.823 | aynı betik |

**İki eşik ilk tahminde yanlıştı ve ölçüm düzeltti:** kümeleme 0.92 → 0.86
(0.92'de her soru kendi kümesinde kalıyordu), "az kaldı" tabanı 0.812 → 0.823
(kapsam dışı sorgular 0.823'e çıkabiliyor).

### Ölçümün öğrettiği üç olumsuz sonuç

Bunlar başarısızlık değil, ölçümün işe yaradığının kanıtı:

1. **Marj ölçütü kaldırıldı** — "en iyi ile ikinci arasındaki fark" ölçütü
   ayırıcı değildi.
2. **Boşluk kümelemesi bir sınıflandırıcı değil** — dağılımlar örtüşüyor
   (−0.0875).
3. **Alaka eşiği tek başına yetmiyor** — kapsam-içi min 0.8408, kapsam-dışı
   maks 0.8409 (−0.0001).

### Hız

Ölçüm: 52 vaka, RTX 3050 Laptop (4 GB VRAM), Foundry taze başlatılmış.

| Yol | Süre |
|---|---|
| Kapsam dışı / selamlama / kademe hesabı | **0.0–0.1 s** (modele hiç gitmez) |
| Mevzuat sorusu (GPU) | ortalama **0.4 s** · medyan 0.6 s · en yavaş 1.4 s |

### ⚠ Demo öncesi Foundry'i yeniden başlatın

Bu, sunum günü en olası aksaklık ve **yaşandı**. Daemon uzun süre açık kaldığında
`foundry server status` hâlâ *Ready* diyor ama bağlantılar yanıt ortasında
kopuyor:

```
Foundry Local bağlantısı yanıt ortasında kesildi (terminated)
```

Aynı gün ölçüldü — tek fark daemon'un durumu:

| Koşum | Skor | Ortalama |
|---|---|---|
| ~7,5 saat açık kalmış daemon | **19/52** | 0.1 s (hiç yanıt yok) |
| yeniden başlatıldıktan sonra | **51/52** | 0.4 s |

Demodan hemen önce:

```bash
foundry server restart
foundry model load qwen2.5-1.5b-instruct-cuda-gpu
```

Uygulamanın kendisi portu **otomatik yeniden keşfediyor**, yani sunucuyu
yeniden başlatmanız gerekmiyor (port her başlatmada değişir).

### Paket

| | |
|---|---|
| `PrivateHrRag.exe` | 89 MB |
| Toplam klasör | 918 MB (embedding modeli gömülü, indirme yok) |
| Kurulum | yok — çift tıkla |
| Node.js gereksinimi | yok |

---

## 4. Kurulum

### A) Değerlendirici için — tek klasör

1. `dist-app/` klasörünü olduğu gibi kopyalayın.
2. Microsoft Foundry Local kurulu olmalı ve model yüklü olmalı:
   ```bash
   foundry model run qwen2.5-1.5b-instruct-cuda-gpu
   ```
3. `PrivateHrRag.exe` → çift tıklayın. Tarayıcı otomatik açılır
   (<http://localhost:5273>).
4. İlk açılışta **kurulum ekranı** gelir; kendi yönetici hesabınızı oluşturun.

> Pakete giden veritabanı **temizlenir**: hesaplar, denetim kaydı ve yanıtsız
> soru metinleri silinir; yalnızca korpus, hazır vektör indeksi ve sürüm
> üstverisi kalır.

> **SmartScreen uyarısı:** `.exe` bilerek **imzasız**. İlk açılışta Windows bir
> uyarı gösterir: *Daha fazla bilgi → Yine de çalıştır.*
>
> Kod imzalama kapsam dışı bırakıldı. Sebep maliyet değil oran: SmartScreen
> imzaya değil **itibara** bakar, yani sıradan (OV) bir sertifikayla imzalanmış
> yeni bir paket de aynı uyarıyı verir. Uyarıyı gerçekten kaldıran EV sertifika
> haftalar süren bir tüzel kişilik doğrulaması gerektiriyor ve kazancı,
> değerlendirici için iki tıklık bir farktan ibaret.

### B) Geliştirici için

```bash
npm run setup      # server + client bağımlılıkları
npm run ingest     # korpusu indeksle
npm test           # 560 doğrulama
npm run eval       # uçtan uca kalite (yalıtılmış kopyada çalışır)
npm run server     # :5273
npm run client     # :5173
```

### C) Air-gapped olduğunu doğrulamak

Makinenin ağını kapatın ve akışı tekrarlayın. Tek dış bağımlılık Foundry
Local'dir ve o da **yerel** çalışır. Ayrıntı: README, "Air-gapped doğrulama".

---

## 5. Bilerek açıkta bırakılanlar

Bunları saklamak, projenin kendi ilkesine aykırı olurdu.

| Konu | Durum |
|---|---|
| `.exe` kod imzalama | **kapsam dışı bırakıldı** — SmartScreen uyarısı çıkar; dağıtıma geçilirse gerekir |
| Zincir öncesi denetim satırları | geriye dönük hash **üretilmedi**; panelde işaretli |
| Son arşivden sonraki satırların silinmesi | tespit edilemez; çözümü sık arşivleme |
| Özel imza anahtarı | veritabanıyla aynı makinede (`AUDIT_KEY_PATH` ile taşınabilir) |
| Rol başına eşik kalibrasyonu | tek eşik; ilk kısıtlı doküman etiketlendiğinde gerekecek |
| amb-4 vakası | model muhakeme sınırı; korpus değiştirilerek "düzeltilmedi" |
| Kapsam dışı listesi | bir **liste**, sınır tanıma yeteneği değil |

---

## 6. Teslim kontrol listesi

- [x] Korpus 23 doküman / 201 bölüm, kapsam belgesi yazılı
- [x] `npm test` — 531 doğrulama, 15 paket
- [x] `npm run eval` — 51/52
- [x] CI yeşil (Linux, çevrim dışı)
- [x] `.exe` güncel derleme, veritabanı temizleniyor
- [x] İmzalı denetim arşivi üretildi ve makine dışına çıkarıldı
- [x] Bağımsız doğrulayıcı izole klasörde sınandı (geçerli 0 / kurcalanmış 1)
- [x] Yol haritası ve tasarım belgeleri depoda
- [x] `.exe` kod imzalama — bilinçli olarak **kapsam dışı**
- [x] LICENSE — Sefa Çakmak ve İlayda Adaklı müşterek hak sahibi
- [ ] Kurulum videosu

**Demo günü:**

- [ ] `foundry server restart` + `foundry model load …` (yukarıdaki uyarı)
- [ ] Boşluk panelindeki test kayıtları temizlendi mi?
- [ ] Denetim arşivi paketi elde (USB) — istasyon 5 için

---

## 7. Sorulması muhtemel sorular

**"Neden 1.5B gibi küçük bir model?"**
Ölçüldü: 7B tek bir vaka daha fazla kazanıyor ama 65 kat yavaş. Kademeli sayısal
muhakeme — küçük modelin asıl zayıflığı — zaten deterministik hesaplayıcıya
devredildi, yani o zayıflık devre dışı.

**"Cevap yanlış olursa?"**
Üç savunma katmanı var: kapsam dışı listesi, alaka kapısı ve bozuk yanıt kalkanı.
Hiçbiri kusursuz değil ve sınırları belgede yazılı. Sistemin "bilmiyorum" demesi
yanlış cevap vermesine tercih edildi.

**"Veri gerçekten dışarı çıkmıyor mu?"**
Embedding, vektör araması ve model çıkarımı host makinede. Doğrulaması basit: ağı
kapatıp aynı akışı tekrarlayın.

**"Bu ölçümlere neden güvenelim?"**
Hepsi tekrarlanabilir betikler. Değerlendirme paketi üretim veritabanının
**yalıtılmış bir kopyasında** çalışır, ölçüm gerçek kaydı kirletmez.
