# Sprint 1 — Kimlik ve iz (tasarım)

Durum: **tamamlandı.** Beş teslimatın tamamı kodlandı ve test edildi; çıkış
ölçütünün iki cümlesi de karşılandı.

| # | Teslimat | Durum |
|---|---|---|
| 1 | Yerel hesap girişi | ✅ `identity.service` · `auth.route` · `AuthGate` |
| 2 | Üç rol | ✅ |
| 3 | Erişim etiketi, kapıdan önce filtreleme | ✅ `vectorStore` + rol başına BM25 |
| 4 | Silinemez denetim günlüğü | ✅ SQLite tetikleyicileri |
| 5 | Yönetici ekranı: arama + dışa aktarma | ✅ `AuditPanel`, CSV |

Test: `test:identity` (38) · `test:access` (41).

Amaç: İK verisine kimin ne zaman eriştiğinin kayıt altına alınması ve yetkisiz
dokümanların kullanıcıya hiçbir yoldan ulaşmaması.

---

## Karar: kilit kapıda

Erişim etiketi **vektör aramasından önce** uygulanır. Kullanıcının yetkisi
olmayan dokümanın parçaları aday havuzuna hiç girmez.

Alternatif (arama tam korpusta çalışır, sonuçlar cevap üretilmeden elenir)
reddedildi: kurumsal denetimde *"sistem o belgeyi okumadı"* savunulabilir,
*"okudu ama attı"* ispatlanamaz.

Bedeli tasarımda taşınıyor, aşağıda **kalibrasyon** başlığında.

---

## Şema eklemeleri

Bugün tek tablo var: `chunks(id, doc_title, section, content, dim, vector)`.

```sql
-- Yerel hesaplar. Parola scrypt ile saklanır (node:crypto, dış bağımlılık yok).
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  display_name  TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  password_salt TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('calisan','ik','yonetici')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL
);

-- Doküman üst verisi. Bugün böyle bir tablo YOK; doc_title chunks içinde
-- serbest metin. Erişim etiketinin tek doğruluk kaynağı burası olacak.
CREATE TABLE documents (
  doc_title    TEXT PRIMARY KEY,
  access_label TEXT NOT NULL DEFAULT 'genel'
               CHECK (access_label IN ('genel','ik','yonetici')),
  source       TEXT NOT NULL,   -- markdown | docx | pdf-text | pdf-ocr
  indexed_at   TEXT NOT NULL
);

-- Oturumlar. Bellekte tutulursa sunucu yeniden başladığında herkes düşer;
-- tek dosya exe sık yeniden başlatıldığı için tabloda tutuluyor.
CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Denetim kaydı.
CREATE TABLE audit_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  at             TEXT    NOT NULL,
  user_id        INTEGER NOT NULL,
  username       TEXT    NOT NULL,  -- denormalize: hesap silinse de kayıt okunur
  role           TEXT    NOT NULL,
  -- Soru metni YALNIZCA kısıtlı dokümana erişildiğinde doldurulur (bkz. Kararlar).
  -- Genel dokümana erişimde NULL kalır.
  question       TEXT,
  resolved_query TEXT,              -- takip sorusu yeniden yazıldıysa
  citations      TEXT    NOT NULL,  -- JSON [{docTitle, section, score}]
  answered       INTEGER NOT NULL,  -- 0 = alaka kapısına takıldı
  duration_ms    INTEGER NOT NULL
);
```

### Silinemezlik politika değil, kısıt

"Denetim kaydı silinemez" cümlesi kodda bir kural olarak kalırsa, kuralı
atlayan ilk sorgu onu geçersiz kılar. Veritabanı düzeyinde zorlanıyor:

```sql
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'denetim kaydı değiştirilemez'); END;

CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'denetim kaydı silinemez'); END;
```

Bu, dosyaya doğrudan erişebilen birini durdurmaz — onun cevabı yedekleme ve
imzalı arşiv (Sprint 3). Uygulama içinden gelen her yolu kapatır.

---

## Rol görünürlüğü

| Etiket | çalışan | İK | yönetici |
|---|:--:|:--:|:--:|
| `genel` | ✓ | ✓ | ✓ |
| `ik` | | ✓ | ✓ |
| `yonetici` | | | ✓ |

---

## Zorlama noktaları — altı yer

`chunks` tablosunu okuyan **her** yer filtrelenmeli. Bugünkü durum:

| Yer | Ne yapar | Filtre |
|---|---|---|
| `scoreAllChunks` | ana arama taraması | **zorunlu** |
| `resetLexicalIndex` | BM25 indeksi kurar | **zorunlu** — aşağıya bak |
| `findSectionText` | Dayanak bloğunun tam metni | **zorunlu, kritik** |
| `listDocuments` | korpus listesi / sağlık | zorunlu |
| `countChunks` | parça sayısı | gerekmez (sayı bilgi taşımaz) |
| `resetStore` | yeniden indeksleme | gerekmez (yazma) |

`findSectionText` özellikle önemli: cevabın altındaki **Dayanak** bloğu maddenin
tam metnini birebir gösteriyor. Arama filtrelense bile burası filtrelenmezse,
yetkisiz maddenin metni doğrudan ekrana düşer.

### Yapısal güvence

Filtreyi "unutmamaya" güvenmek yeterli değil. Bu fonksiyonların imzası
**zorunlu** bir kimlik parametresi alacak:

```ts
scoreAllChunks(queryVector, query, principal: Principal)
findSectionText(docTitle, section, principal: Principal)
```

Varsayılan değer verilmeyecek. Böylece filtreyi atlayan yeni bir çağrı
**derlenmez**; tip kontrolü CI'da zaten koşuyor.

---

## Kalibrasyon — kararın gerçek bedeli

Hibrit puanın bir bileşeni BM25 ve BM25 **korpus istatistiğine** bağlı: bir
kelimenin kaç dokümanda geçtiği (IDF). Havuz role göre daralınca bu istatistik
kayar.

Bugünkü baraj `SIMILARITY_THRESHOLD = 0.828`, 201 parçalık tam korpusta ölçüldü.
Daha dar bir havuzda aynı hassasiyet noktasına karşılık gelmez.

İki seçenek:

1. **Rol başına BM25 indeksi** — dar havuzun kendi istatistiği. Doğru, ama her
   rol için ayrı baraj ölçümü gerekir.
2. **Küresel BM25, filtrelenmiş adaylar** — baraj sabit kalır, ama IDF
   istatistiği kullanıcının göremediği dokümanlar hakkında (çok zayıf da olsa)
   bilgi taşır. "Sistem okumadı" iddiasını zayıflatır.

**Seçim: (1).** Karar zaten saflık gerekçesiyle alındı; burada tutarsız
davranmak kararı anlamsız kılar. Sonuç:

- `scripts/calibrate.ts` rol farkındalığı kazanır
- `SIMILARITY_THRESHOLD` tek sayı olmaktan çıkar, rol başına saklanır
- BM25 indeksi rol başına kurulur (3 rol × ~100 parça — maliyeti önemsiz)

---

## Test planı

Erişim kontrolü test edilmeden "var" sayılamaz. Yeni paket: `test:access`.

- Yetkisiz kullanıcı, `ik` etiketli dokümanın içeriğini **hiçbir yoldan**
  göremiyor: cevapta yok, alıntıda yok, Dayanak bloğunda yok, korpus
  listesinde yok
- Aynı soru iki rolle sorulduğunda İK cevap alıyor, çalışan alamıyor
- Her yanıt **tam olarak bir** denetim satırı üretiyor
- Denetim satırı UPDATE ve DELETE ile değiştirilemiyor (trigger)
- Alaka kapısına takılan soru da denetime yazılıyor (`answered = 0`)
- Genel dokümana erişimde `question` alanı NULL, kısıtlı erişimde dolu
- `calisan` rolü yükleme/silme/yeniden indeksleme uçlarına erişemiyor (403)
- Yetkisiz dokümana denk gelen soru, kapsam dışı soruyla **aynı** metni alıyor
  (iki mesaj ayrışırsa varlık sızar)
- Kullanıcı kendi denetim satırlarını görüyor, başkasınınkini görmüyor

Bu paket LLM gerektirmiyor, dolayısıyla CI'da koşar.

---

## Kararlar

Tamamı kullanıcı tarafından onaylandı; tasarım bunlara göre kilitlendi.

### Soru metni yalnızca kısıtlı erişimde saklanır

`genel` etiketli bir dokümana erişimde denetim satırı kullanıcı, zaman ve
dönen alıntıları tutar; `question` alanı **NULL** kalır. Soru metni yalnızca
`ik` veya `yonetici` etiketli bir dokümana erişildiğinde yazılır.

Gerekçe: denetim ihtiyacı zaten orada. Her soruyu kaydetmek çalışanın ne merak
ettiğini kalıcı olarak adına yazar — mobbing şikayeti veya istifa süreci gibi
konular dahil. Bu dokümanlar `genel` olduğu için, bu kural onları kayıt dışında
bırakır ve sisteme soru sormaktan çekinmeyi önler.

### Denetim kaydını yönetici tümüyle, kullanıcı kendi satırlarını görür

KVKK kişiye kendi verisine erişim hakkı tanıyor; kendi kaydını görebilmek bu
hakkı doğrudan karşılar ve sistemi şeffaf yapar. Başkasının kaydını yalnızca
`yonetici` görür.

### Yetkisiz dokümana denk gelen soru "bilgi bulunamadı" alır

Kapsam dışı soruyla **birebir aynı** cevap. Dokümanın var olduğu bilgisi bile
sızmaz.

Bunun güzel tarafı: "kilit kapıda" kararı sayesinde bu davranış **kendiliğinden**
oluşuyor. Havuz aramadan önce daraldığı için yetkisiz doküman zaten aday
değildir; hiçbir parça alaka kapısını geçemez ve mevcut "bulunamadı" yanıtı
devreye girer. **Ayrı bir kod dalı yazılmıyor** — dolayısıyla iki mesajın
birbirinden ayrışıp varlık sızdırması da mümkün değil.

### Yükleme ve yeniden indeksleme: `ik` + `yonetici`

Bugün herkes yükleyebiliyor; rol geldikten sonra bu açık kalmamalı. `calisan`
rolü `POST /api/documents`, `DELETE` ve `reindex` uçlarına erişemez.

### İlk kurulumda tek seferlik yönetici hesabı

Hiç kullanıcı yoksa uygulama kurulum ekranı gösterir ve `yonetici` rolünde tek
hesap açtırır. Sonraki hesaplar yönetici panelinden eklenir.

### Mevcut dokümanların tamamı `genel` etiketi alır

Sessizce `ik` yapmak bugünkü davranışı bozar ve eval paketi kırmızı yanar.
Etiketleme yöneticiye bırakılır.

### LDAP/AD bu sprintte kapsam dışı

Yol haritasında opsiyonel; yerel hesap doğrulaması yeterli.
