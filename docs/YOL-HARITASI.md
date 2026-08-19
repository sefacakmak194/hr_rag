# Yol haritası

> **Bu belge neden var:** sprint planı bugüne kadar yalnızca konuşmada duruyordu.
> Şartname (`Master Project Specification.docx`) orijinal iskeleleme brief'idir ve
> sprint içermez; depoda da bir plan yoktu. Sprint 3'ün ne olduğunu ararken tek
> bulabildiğim şey koda bırakılmış üç yorum satırıydı. Kırılgan — bu yüzden plan
> buraya yazıldı ve her sprint sonunda güncelleniyor.

Son güncelleme: **19.08.2026**, Sprint 3a kapanışı.

---

## Durum özeti

| Sprint | Konu | Durum |
|---|---|---|
| 0 | Depo, CI, lisans | ✅ tamamlandı |
| 1 | Kimlik ve iz | ✅ tamamlandı — [tasarım](SPRINT-1-TASARIM.md) |
| 2 | Politika sürümleme | ✅ tamamlandı — [tasarım](SPRINT-2-TASARIM.md) |
| 3a | Denetim bütünlüğü (zincir + imzalı arşiv) | ✅ tamamlandı |
| 3b | `.exe` kod imzalama | ⛔ sertifika bekliyor |
| 4 | Politika boşluğu raporu | ⏳ |
| 5 | Sunum ve teslim | ⏳ |

Doğrulama durumu: 13 test paketi · **CI yeşil** · eval **47/48**.

---

## Sprint 0 — Depo, CI, lisans ✅

Git deposu, GitHub Actions üzerinde çevrimdışı test hattı, tescilli lisans.

Kritik ayrıntı: `.gitattributes` içinde `*.traineddata binary`. Bu satır olmasa
CRLF dönüşümü OCR dil verisini sessizce bozar ve Linux'ta OCR çöker.

**Açık kalan:** kod imzalama sertifikası başvurusu. Sprint 3'ün son adımını
bekletiyor (aşağıya bakınız).

---

## Sprint 1 — Kimlik ve iz ✅

Yerel hesaplar, üç rol (`calisan` / `ik` / `yonetici`), erişim etiketi, silinemez
denetim kaydı, yönetici denetim ekranı.

Ana karar **"kilit kapıda"**: erişim etiketi vektör aramasından *önce* uygulanır.
Kurumsal denetimde *"sistem o belgeyi okumadı"* savunulabilir, *"okudu ama attı"*
ispatlanamaz.

**Sprint 2'de kapatılan eksikleri:**
- Etiket şeması ve zorlaması yazılmıştı ama etiketi **atayacak yol yoktu**
- `GET /api/documents`, `GET /api/corpus/audit`, `POST`/`DELETE /api/documents`
  uçları etiket filtresini uygulamıyordu (üç sızıntı)

---

## Sprint 2 — Politika sürümleme ✅

Her içerik değişikliği sürüm açar; sürüm metni arşivlenir ve silinemez. Denetim
kaydı dosya adı değil **sürüm kimliği** saklar. İleri tarihli yürürlük, sürüm
farkı görünümü, yanıt altında *"… tarihli sürüme dayanmaktadır"* bildirimi.

---

## Sprint 3 — Bütünlük ve dağıtım

### Çözülen sorun

Denetim kaydını bugün SQLite tetikleyicileri koruyor:

```sql
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'denetim kaydı silinemez'); END;
```

Bu **uygulama içinden gelen her yolu** kapatıyor. Ama `data/vectors.db` dosyasına
doğrudan erişebilen biri — `sqlite3` komut satırıyla — tetikleyiciyi düşürüp satır
silebilir ve **bunu kimse anlayamaz.** Sprint 1 tasarımı bu boşluğu açıkça
kaydetmişti: *"onun cevabı imzalı arşiv (Sprint 3)"*.

### Dürüst sınır

Tek bir air-gapped makinede kurcalamayı **imkânsız** kılamazsınız; dosyaya erişimi
olan, sonunda her şeye erişir. Yapılabilecek olan şu:

1. Kurcalamayı **tespit edilebilir** kılmak (hash zinciri)
2. Tespit kanıtını **taşınabilir** kılmak (imzalı arşiv)

Asıl savunma, arşivin makineden **dışarı çıkarılmış** olmasıdır: dışarı çıkmış bir
arşiv geriye dönük değiştirilemez.

### Teslimatlar

**(a) Hash zinciri — ✅ tamamlandı**
- Her denetim satırı bir öncekinin özetini taşır: `row_hash = sha256(prev_hash ‖ satır)`
- Bir satırın silinmesi ya da değiştirilmesi zinciri o noktadan itibaren kırar
- `verifyAuditChain()` ilk kırık halkayı bildirir

**(b) İmzalı arşiv — ✅ tamamlandı**
- Yerel üretilen Ed25519 anahtar çifti (`node:crypto`, dış bağımlılık yok)
- Arşiv: denetim satırları + sürüm üstverisi (içerik özetleriyle) + zincir başı
- Her arşiv bir öncekine bağlanır
- **Bağımsız doğrulama betiği**: uygulama olmadan, başka makinede çalışır —
  denetçinin elinde yalnızca arşiv dosyası ve açık anahtar olacak

**(c) `.exe` kod imzalama — ⛔ SERTİFİKA BEKLİYOR**
- Kullanıcı tek dosyayı çalıştırırken SmartScreen uyarısı almasın
- Ticari kod imzalama sertifikası gerekiyor; başvuru haftalar sürer
- Sprint 3'ün diğer iki yarısı bunu beklemedi ve **tamamlandı**

### Sonuç

(a) ve (b) kodlandı ve ölçüldü: `test:integrity` 48 test. Testler
tetikleyicileri **bilerek düşürüp** satırları değiştiriyor — yani gerçek
saldırganın yapacağı şeyi yapıyor. Tetikleyicilerin çalıştığını doğrulamak
yeterli değil; kritik olan tetikleyici *atlandığında* ne olduğu.

Bağımsız doğrulayıcı uçtan uca çalıştırıldı: geçerli arşivde çıkış kodu 0,
tek alanı değiştirilmiş kopyada 1 — hem imza hem zincir kırıklığı ayrı ayrı
raporlandı.

### Geriye dönük satırlar zincire alınmadı

Zincir eklenmeden önce yazılmış denetim satırlarının özeti **hesaplanmadı**;
panelde "zincir öncesi" olarak gösteriliyorlar. Geriye dönük hash üretmek, zaten
değiştirilmiş olabilecek veri üzerinden sahte bir güvence yaratırdı.
Doğrulanamayan şeye doğrulandı dememek gerekir.

---

## Sprint 4 — Politika boşluğu raporu ⏳

Denetim kaydındaki `answered = 0` satırları şu soruyu cevaplıyor: **çalışanlar
neyi soruyor ama mevzuatta karşılığı yok?**

İK için bu, asistanın kendisinden daha değerli olabilir — hangi yönergeyi yazmaları
gerektiğini tahminle değil veriyle söyler. Altyapısı Sprint 1'de kuruldu
(`chat.route.ts`, alaka kapısına takılan sorular `answered=0` ile yazılıyor).

Kapsam:
- Cevaplanamayan soruların konu bazında kümelenmesi
- Haftalık özet + CSV
- Bekleyen sürüm bildirimi (yürürlük tarihi geldiğinde kimseye haber verilmiyor)

---

## Sprint 5 — Sunum ve teslim ⏳

Microsoft AI Innovators Program teslimi: demo akışı, ölçüm tablolarının
derlenmesi, kurulum videosu/belgesi, `.exe` paketinin imzalı sürümü.

---

## Sprint'e bağlı olmayan borçlar

### Kalibrasyon — koşullu, henüz canlı değil

`SIMILARITY_THRESHOLD = 0.832` **tek bir sayı** ve 94 parçalık tam korpusa göre
ölçüldü. Sprint 1 tasarımı rol başına ayrı eşik öngörmüştü; uygulanmadı.

Şu an sorun değil: 20 dokümanın hepsi `genel`, üç rol de aynı havuzu görüyor,
BM25 indeksleri birebir aynı. **İlk doküman `ik` olarak etiketlendiği an** çalışan
rolünün havuzu daralır ve eşik o rol için kalibre olmaktan çıkar.

Tetikleyici: ilk kısıtlı doküman. `scripts/calibrate.ts` rol farkındalığı kazanmalı.

### LICENSE telif sahibi adı — doğrulanmadı

`Telif Hakkı (c) 2026 Sefa Çakmak` satırı GitHub kullanıcı adından çıkarıldı,
onaylanmadı. İlayda Adaklı'nın ortak hak sahibi olarak yazılıp yazılmayacağı da
belirsiz.

### `client/tsconfig.tsbuildinfo` izleniyor

Derleme artefaktı depoda; her derlemede diff gürültüsü üretiyor. `.gitignore`'a
alınıp `git rm --cached` ile düşürülmeli.

---

## Ölçülmüş kararlar — nereye bakmalı

Bu projede sezgiyle alınmış karar yok denecek kadar az; çoğunun arkasında bir
ölçüm var ve hepsi kodun yanında duruyor.

| Karar | Nerede |
|---|---|
| Varsayılan model (`qwen2.5-1.5b`) | `data/MODEL-KARSILASTIRMA.md` |
| Eşik 0.832, hibrit ağırlık 0.05 | `config/constants.ts` + `scripts/calibrate.ts` |
| Sıcaklık 0 (0.1 değil) | `foundryClient.service.ts` |
| Marj ölçütünün kaldırılması | `constants.ts`, `RELEVANCE_MARGIN` |
| Ayrıntının modelden değil koddan gelmesi | `constants.ts`, 2. kural notu |
| Rol başına BM25 indeksi | `vectorStore.service.ts` |
| Karşılaştırmanın yürürlükteki sürümle yapılması | `versioning.service.ts` |
