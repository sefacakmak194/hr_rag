# Sprint 2 — Politika sürümleme (tasarım)

Durum: **tamamlandı.** Beş teslimatın tamamı kodlandı ve test edildi.

| # | Teslimat | Durum |
|---|---|---|
| 1 | Sürüm + yürürlük tarihi | ✅ `versioning.service` |
| 2 | Eski sürümler arşivde, indeks yalnızca yürürlüktekini görür | ✅ `corpusSync.service` + bekleme dizini |
| 3 | "… tarihli sürüme dayanmaktadır" bildirimi | ✅ `basis` olayı + `BasisNote` |
| 4 | Sürüm farkı görünümü | ✅ `diff.service` + `VersionHistory` |
| 5 | Denetim kaydı dosya adı değil **sürüm kimliği** saklar | ✅ `AuditCitation.versionId` |

Test: `test:versions` (61) · `test:endpoints` (32). Eval: **47/48** — Sprint 2
öncesiyle birebir aynı, gerileme yok.

---

## Çözülen sorun

Sprint 1 sonunda denetim kaydı şunu diyordu:

```
19.08.2026 10:14 · ayse · çalışan · 01_izin.md :: Madde 1
```

Doküman 20 Ağustos'ta güncellendiğinde bu satır **yalan söylemeye başlıyor.**
`01_izin.md :: Madde 1` bugünkü dosyaya çözülür; o gün ne yazdığı hiçbir yerde
durmuyor. Kurumsal denetimde geçmiş bir kararı savunmak için o günkü metin
gerekir — kayıt tam da bu yüzden tutuluyor.

Aynı sorunun kullanıcıya bakan yüzü: bugün doğru olan bir yanıtın ekran
görüntüsü üç ay sonra yanlış hale gelir ve bunu anlamanın bir yolu yoktur.

---

## Kararlar

Açık üç soruya, kullanıcı yanıt vermeden önce şu varsayımlarla devam edildi;
gerekçeleri aşağıda. Farklı karar verilirse üçü de tek noktadan değiştirilebilir.

### 1. Sürüm numarası otomatik artar (1, 2, 3 …)

Elle numaralama insan hatasına açık ve denetim kaydının ihtiyacı olan şey
anlamlı bir numara değil, **kararlı bir kimlik**. Değişikliğin anlamı ayrı bir
`note` alanında tutulur: *"yazım hatası düzeltmesi"*, *"Yönetim Kurulu 2026/14
kararı"*.

### 2. Sürüm tetikleyicisi içerik özetidir (sha256), bir düğme değil

Korpus dizinine **elle kopyalanan** bir dosya da sürüm açar. Sürüm geçmişi
arayüzden geçilmiş olmaya değil, **indekslenmiş olana** dayanır — tek doğruluk
kaynağı budur. Aksi halde `npm run ingest` ile yapılan her değişiklik geçmişin
dışında kalırdı.

### 3. Sürümler silinmez; saklama süresi yok

KVKK'nın veri minimizasyonu **kişisel** veri içindir; şirket mevzuatı kişisel
veri değildir. Buna karşılık denetim kaydının değeri, geçmiş metnin yeniden
kurulabilmesine bağlı. Disk kaygısı doğarsa doğru cevap sessiz silme değil,
imzalı arşivdir (Sprint 3).

Retention anahtarı **bilerek eklenmedi**: değiştirilemezlik tetikleyicisiyle
çakışan, yarısı çalışan bir ayar, hiç olmamasından kötüdür.

### 4. Yürürlük tarihi ileri verilebilir; o tarihe kadar korpus değişmez

Gerçek İK yönergelerinin yürürlük tarihi olur (*"1 Ekim'den itibaren"*). İleri
tarihli dosya korpusa **konmaz**; `data/corpus-pending/` dizininde bekler.
Sebebi basit: korpus dizini tanımı gereği **yürürlükteki** metindir. Bugünden
korpusa konsaydı sistem henüz yürürlükte olmayan bir kurala göre cevap verirdi.

Tarihi gelince `corpusSync` dosyayı korpusa taşır ve indeksi yeniler. Sunucu
açılışında bir kez, sonra saatlik kontrol edilir — açılışta çalışması şart,
aksi halde sunucu kapalıyken geçen bir tarih sonsuza kadar beklerdi.

### 5. Erişim etiketi sürüme değil dokümana aittir

Bir doküman sonradan `ik` yapılırsa **tüm geçmişi** de kısıtlanır. Güvenli yön
budur: geçmişte `genel` yayınlanmış bir metnin bugün kısıtlanması, kısıtlı bir
metnin eski sürümüyle sızmasından iyidir.

---

## Şema

```sql
CREATE TABLE document_versions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_title      TEXT    NOT NULL,
  version        INTEGER NOT NULL,
  content_hash   TEXT    NOT NULL,   -- sha256; sürüm tetikleyicisi
  content        TEXT    NOT NULL,   -- çıkarılmış TAM METİN (ham dosya değil)
  source         TEXT    NOT NULL,   -- markdown | docx | pdf-text | pdf-ocr
  bytes          INTEGER NOT NULL,
  effective_from TEXT    NOT NULL,   -- gelecekte olabilir
  note           TEXT,               -- değişikliğin anlamı
  created_at     TEXT    NOT NULL,
  created_by     TEXT    NOT NULL,
  withdrawn_at   TEXT,               -- doküman silindi / plandan vazgeçildi
  UNIQUE (doc_title, version)
);
```

`content` **çıkarılmış metindir**, ham dosya değil: diff, arşiv ve "o gün ne
yazıyordu" sorusunun tamamı metin üzerinden çalışır. 5 MB'lık bir PDF'i saklamak
aynı soruyu cevaplamaz, yalnızca veritabanını şişirir.

### Değiştirilemezlik — tam kilit değil, doğru kilit

```sql
CREATE TRIGGER versions_no_delete BEFORE DELETE ON document_versions
BEGIN SELECT RAISE(ABORT, 'politika sürümü silinemez'); END;

CREATE TRIGGER versions_immutable BEFORE UPDATE ON document_versions
WHEN OLD.content <> NEW.content OR OLD.content_hash <> NEW.content_hash
  OR OLD.doc_title <> NEW.doc_title OR OLD.version <> NEW.version
  OR OLD.effective_from <> NEW.effective_from OR OLD.created_at <> NEW.created_at
BEGIN SELECT RAISE(ABORT, 'sürüm içeriği değiştirilemez'); END;
```

İçerik ve kimlik dondurulur; yaşam döngüsü damgası (`withdrawn_at`) yazılabilir
kalır. Tam kilit konsaydı doküman silme işlemi kaydedilemezdi.

### Türetilen, saklanmayan alanlar

`yururlukte / bekliyor / arsiv / geri-cekildi` durumu **saklanmaz**, sorgu anında
türetilir:

> yürürlükteki sürüm = `withdrawn_at IS NULL` **ve** `effective_from <= şimdi`
> olan **en yüksek numaralı** sürüm

"En yüksek numaralı" olması bilinçli: geriye dönük düzeltmeye izin verir. Geçmiş
tarihli yeni bir sürüm yüklenirse o geçerli olur, çünkü en son **yazılan** metin
odur.

Saklamak yerine türetmek, iki alanın birbirinden kayma ihtimalini ortadan
kaldırır.

---

## En ince nokta: karşılaştırma yürürlükteki sürümle yapılır

`recordVersion` içerik özetini **yürürlükteki** sürümle karşılaştırır, en son
sürümle değil.

Neden: bekleyen (ileri tarihli) bir sürüm varken korpustaki dosya hâlâ **eski**
metindir. En son sürümle karşılaştırılsaydı, her yeniden indeksleme eski
içerikten sahte bir sürüm açardı — s3, s4, s5 … Sistem kendi kendine geçmiş
uydururdu.

`test-versions.ts` bunu ayrı bir regresyon vakası olarak tutuyor:

```
PASS  bekleyen sürüm varken yeniden indeksleme SAHTE sürüm açmaz
```

### Çakışma otomatik çözülmez

Bekleyen sürüm beklerken aynı doküman başka bir yoldan değişirse, bekleyen sürüm
artık en yüksek numaralı sürüm değildir ve taşınsa bile yürürlüğe giremez. Bu
durumda dosya beklemede **bırakılır** ve arayüzde `çakışma` olarak gösterilir.

Otomatik çözüm iki taraftan birini sessizce yok saymak zorunda kalırdı: ya
aradaki değişikliği ya da planlanmış değişikliği. İkisi de kullanıcının bilmesi
gereken bir karar.

---

## Sprint 1'den kalan üç sızıntı — bu sprintte kapatıldı

Sürüm uçlarına erişim filtresi yazarken aynı sınıftan üç açık ortaya çıktı.
Hepsi Sprint 1'in "kilit kapıda" kararının **dışında kalmış okuma yollarıydı**.

| Uç | Ne sızıyordu | Düzeltme |
|---|---|---|
| `GET /api/documents` | Liste dosya sisteminden kuruluyor, etiket filtresi yalnızca parça sayısına uygulanıyordu. Çalışan, `yonetici` etiketli belgenin **adını** görüyordu. | Liste `canSeeDocument` ile süzülüyor |
| `GET /api/corpus/audit` | Rapor tüm parçaları okuyordu; bulgular doküman adı, madde başlığı ve **çelişen sayısal değerleri** taşır. | `auditCorpus(principal)` |
| `POST` / `DELETE /api/documents` | `ik` rolü, göremediği `yonetici` belgesinin üzerine yazabiliyor ve silebiliyordu. | Görünmeyen hedef → 404 |

**Neden iki test katmanı da bunu kaçırdı:** `test-access.ts` filtreyi *servis*
katmanında doğruluyordu (`listDocuments` süzüyor, geçiyor) ve ara katman
korumalarını sahte `req/res` ile doğruluyordu (`requireAuth` çalışıyor, geçiyor).
**Rota gövdeleri hiç test edilmemişti** — sızıntı tam da o boşluktaydı.

Bu yüzden `test-endpoints.ts` eklendi: gerçek bir Express uygulaması ayağa
kaldırır ve uçlara HTTP ile gider.

### Erişim etiketini atayacak yol da yoktu

Sprint 1 şemayı ve zorlamayı yazdı, "etiketleme yöneticiye bırakılır" dedi — ama
etiketi atayacak bir uç ya da ekran kalmadı; tablo yalnızca doğrudan SQL ile
doldurulabiliyordu. `PATCH /api/documents/:name/label` bu boşluğu kapatıyor.

**Yalnızca yönetici** değiştirebilir; yükleme yetkisi İK'da da var. Yükleme
korpusa içerik ekler, etiket ise **kimin neyi göreceğini** belirler — ikincisi
bir yetkilendirme kararıdır.

---

## Yetkisiz erişim 404 döner, 403 değil

Sprint 1'in kararıyla aynı: dokümanın **var olduğu** bilgisi bile sızmamalı.
403 "bu doküman var ama göremezsin" demektir ve tek başına bir bilgidir. GitHub
özel depolarda aynı sebeple 404 döner.

`test-endpoints.ts` bunu ayrıca doğruluyor: olmayan dosya ile yetkisiz dosya
**birebir aynı** yanıt gövdesini alıyor.

---

## Fark hesabı kendi yazıldı

Air-gapped kurulumda her yeni bağımlılık bir yüktür. İhtiyaç duyulan şey standart
LCS; mevzuat dokümanları birkaç yüz satır olduğundan basit ve okunabilir bir
uygulama yeterli.

- Önce **ortak baş ve ortak son** kırpılır → 300 satırlık doküman çoğu zaman
  10 satırlık bir probleme iner
- LCS tablosu `Int32Array`; 4M hücre tavanı aşılırsa satır satır yerine **blok
  değişiklik** raporlanır (dakikalarca asılı kalmaktansa durumu söylemek doğru)
- Değişmemiş uzun bloklar tek `atlandi` satırına toplanır, değişikliğin
  çevresinde 2 satır bağlam bırakılır
- CRLF/LF normalize edilir — aksi halde Windows'ta düzenlenen bir dosya, tek
  karakter değişmeden **tüm satırları** değişmiş gösterirdi

Ölçüm: 200 satırlık dokümanda tek satır değişikliği **0.1 ms**, çıktı 8 satır.

---

## Değerlendirme paketleri Sprint 1'den beri bozukmuş

`npm run eval` ve `npm run compare`, `/api/chat` kimlik doğrulaması arkasına
alındığından beri her vakada **HTTP 401** alıyordu. Paketler koşuyor ama hiçbir
şeyi ölçmüyordu — çıktı "48 vaka kaldı" diyordu, sebep ise cevap kalitesi değil
yetkisizlikti. Sessiz bir kayıptı.

`scripts/eval-auth.ts` eklendi:

- `EVAL_USER` + `EVAL_PASSWORD` verilmişse normal giriş yapılır
- verilmemişse **geçici** bir hesap açılır, oturum alınır, iş bitince hesap da
  oturum da silinir (CI'da parola yönetmeden koşar)

Sunucuya erişilemezse **açıkça hata atar** — sessizce kimliksiz devam edip 48
vakayı "başarısız" saymak, bu dosyanın var olma sebebi olan hatanın ta kendisi.

---

## Ölçüm

Ölçülen, izole bir korpus üzerinde uçtan uca doğrulandı:

```
yükleme (not ile)      → s2 açıldı, indeks yenilendi
fark s1 ↔ s2           → +1 / −1, 13 satır toplandı, bağlam korundu
ileri tarihli yükleme  → s3 kaydedildi, korpus DEĞİŞMEDİ, dosya beklemede
yanıt üstverisi        → basis: s2, alıntılar versionId taşıyor
denetim kaydı          → versionId=4 s2
etiket ik yapıldı      → çalışan için liste/sürüm/arşiv hepsi 404
```

Eval **47/48** (ort. 0.5s · medyan 0.6s · en yavaş 1.7s) — `constants.ts` içinde
kayıtlı Sprint 2 öncesi ölçümle aynı. Tek başarısız vaka `amb-4`, bilinen sınır
vakası.

---

## Açık kalanlar

- **Kalibrasyon**: eşik `SIMILARITY_THRESHOLD = 0.832` hâlâ 94 parçalık tam
  korpusa göre. Rol başına eşik (Sprint 1 tasarımında öngörülmüştü) henüz tek
  sayı; kısıtlı doküman sayısı arttığında ölçülmeli.
- **Bekleyen sürüm bildirimi**: yürürlük tarihi geldiğinde kimseye haber
  verilmiyor, yalnızca indeks güncelleniyor. Bildirim Sprint 4 kapsamında.
- **Kod imzalama sertifikası**: Sprint 0'dan beri açık, Sprint 3'ü bloke ediyor.
  *(19.08.2026 notu: kapsam dışı bırakıldı — bkz. YOL-HARITASI, Sprint 3(c).)*
