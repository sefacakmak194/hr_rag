# Model Karşılaştırma Matrisi

Üretim: `npm run compare` · 2026-08-18
Vaka sayısı: 48

Tüm modeller **aynı** değerlendirme vakalarıyla, **aynı** korpus ve eşiklerle ölçüldü.
Kademe hesaplayıcısı, niyet katmanı ve alaka kapısı LLM çağırmadığından o vakalar
her modelde aynıdır; modeller arasında ayırt edici olan "LLM vakaları" sütunudur.

| Model | Skor | Başarım | LLM vakaları | Ortalama | Medyan | En yavaş |
|---|---|---|---|---|---|---|
| `qwen2.5-1.5b-instruct-cuda-gpu` | 47/48 | %97.9 | 30/31 | 0.4s | 0.6s | 1.4s |
| `qwen3.5-2b-text-cuda-gpu` | 31/48 | %64.6 | 14/31 | 3.6s | 1.7s | 12.5s |
| `qwen2.5-7b-instruct-generic-cpu` | 48/48 | %100.0 | 31/31 | 26.0s | 35.0s | 58.1s |

## Karar: `qwen2.5-1.5b-instruct-cuda-gpu`

Varsayılan model bu ölçümle belirlendi (`constants.ts` → `FOUNDRY_MODEL`).
Önceki varsayılan `phi-3.5-mini` idi ve ölçümde en kötü çıkan modeldi; her
makinede `.env.local` ezdiği için fark edilmemişti.

**7B tam puan alıyor ama ürün olamaz.** 48/48 karşılığında ortalama 26 saniye,
en yavaş vaka 58 saniye. 1.5B tek vaka farkla **65 kat** hızlı. Kullanıcı
"kaç gün izin hakkım var" diye sorup bir dakika bekleyemez.

**Büyüklük belirleyici değil.** 2.1 GB'lık Phi, 1.3 GB'lık qwen'in çok
gerisinde kaldı. Ayırt edici olan parametre sayısı değil Türkçe yetkinliği.
Ürün açısından iyi haber: müşteri donanım gereksinimi düşük kalıyor
(ölçüm makinesi 4 GB VRAM'li RTX 3050 Laptop).

**7B'nin 48/48'i bir şey daha söylüyor:** `amb-4` vakası çözülebilir bir
sorudur. 1.5B'nin oradaki hatası retrieval hatası değil, model kapasitesi
sınırı — doğru bölüm getiriliyor, model yanlış cümleden cevaplıyor.

### Kısmi ölçüm: `Phi-3.5-mini-instruct-cuda-gpu`

Bu model **tamamlanamadı**, tabloda yer almıyor. 48 vakanın 41'i koşuldu ve
**13 hata** verdi; ardından Foundry Local arka plan süreci çöktü.

Süre ölçümleri de kullanılamaz durumdaydı: ilk ~30 vaka normal hızda geçti,
sonrasında vaka başına ~100 saniyeye çıktı. Bu daemon yorulmasıdır, modelin
karakteristiği değil — "Phi yavaştır" demek ölçüme iftira olurdu.

Sonuç yine de karar için yeterli: aynı vakalarda qwen2.5-1.5b 1 hata verdi.

### Bozuk varyant: `qwen3.5-2b-text-cuda-gpu`

31/48'i "qwen3.5 kötü bir model" diye okumak yanlış olur. Hataların çoğunda
model anlamsız çıktı üretti ve bozulma **Türkçeye özgü harflerde** yoğunlaştı:

```
Doğum yardımı ne kadar?          → ÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇ
Özlük dosyaları kaç yıl saklanır? → ÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖ
Yol desteği aylık ne kadar?      → TopTopTopTopTopTop
```

Bu, ONNX derlemesinin bu makinede bozuk olduğunu gösterir. Ölçülen şey modelin
yeteneği değil, **bu varyantın bu makinedeki durumu**.

Bu bulgu bir ürün hatası da ortaya çıkardı: bozuk yanıt kalkanı iki bozulma
biçimini de kaçırıyordu (tek harf tekrarı ve boşluksuz sözcük döngüsü). İkisi
için de kural eklendi, `test:guard` paketiyle ölçülüyor.

---

## `qwen2.5-1.5b-instruct-cuda-gpu` — başarısız vakalar

| Vaka | Soru | Neden | Yanıt |
|---|---|---|---|
| amb-4 | Bordro itirazımı kaç gün içinde yapmalıyım? | eksik: 15 | En az 10 iş günü içinde sonucunu elde edelim. |

## `qwen3.5-2b-text-cuda-gpu` — başarısız vakalar

| Vaka | Soru | Neden | Yanıt |
|---|---|---|---|
| num-4 | Analık izni toplam kaç hafta? | baglam sizintisi: .md | K'nın 10_dogum_analik_ve_ebeveyn_haklari.md dosyasındaki Madde 1 gereği, kadın çalışanlara doğumdan önce 8 hafta ve doğu |
| num-6 | Doğum yardımı ne kadar? | eksik: 15.000 | ÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇ |
| num-7 | Yemek kartına günlük ne kadar yükleniyor? | eksik: 250 | T. |
| num-8 | Otel konaklama üst limiti gecelik ne kadar? | eksik: 3.500 | ŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞŞ |
| num-9 | Haftada kaç gün uzaktan çalışabilirim? | eksik: 2 | Ş |
| num-12 | Deneme süresi kaç ay? | eksik: 2 | Y |
| num-13 | Tedarikçiden en fazla kaç TL değerinde hediye kabul edilebilir? | eksik: 1.000 | ÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇ |
| num-15 | Gece vardiyası zammı yüzde kaç? | eksik: 20 | GeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGeGe |
| amb-1 | Evlilik yardımı ne kadar? | eksik: 10.000 | ÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇ |
| amb-2 | Yol desteği aylık ne kadar? | eksik: 1.500 | TopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTopTop |
| amb-5 | Referans primi ne kadar? | eksik: 5.000 | Ş |
| amb-6 | Olumsuz sonuçlanan aday başvuruları en fazla kaç yıl saklanır? | eksik: 2 yıl | İİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİ |
| amb-7 | Özlük dosyaları kaç yıl saklanır? | eksik: 10 yıl | ÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖÖ |
| amb-9 | Savunma için çalışana en az kaç iş günü süre tanınır? | eksik: 3 iş günü | ÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇ |
| amb-10 | Performans sonucuna kaç iş günü içinde itiraz edilir? | eksik: 10 iş günü | PerformansPerformansPerformansPerformansPerformansPerformansPerformansPerformansPerformansPerformansPerformansPerformans |
| amb-12 | Ücretsiz izin talebini en az kaç gün önce yapmalıyım? | eksik: 15 gün | ÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇÇ |
| amb-13 | Sertifika programı sonrası kaç ay çalışma taahhüdü verilir? | baglam sizintisi: .md | S 14/10/2023 (14_egitim_ve_kariyer_gelisimi.md) mevzuatına göre, sertifika programı sonrası çalışan eğitimin tamamlanmas |

## `qwen2.5-7b-instruct-generic-cpu`

Tüm vakalar geçti.
