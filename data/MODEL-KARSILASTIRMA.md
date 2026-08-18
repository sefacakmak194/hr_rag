# Model Karşılaştırma Matrisi

Üretim: `npm run compare` · 2026-08-18
Vaka sayısı: 48

Tüm modeller **aynı** değerlendirme vakalarıyla, **aynı** korpus ve eşiklerle ölçüldü.
Kademe hesaplayıcısı, niyet katmanı ve alaka kapısı LLM çağırmadığından o vakalar
her modelde aynıdır; modeller arasında ayırt edici olan "LLM vakaları" sütunudur.

| Model | Skor | Başarım | LLM vakaları | Ortalama | Medyan | En yavaş |
|---|---|---|---|---|---|---|
| `qwen2.5-1.5b-instruct-cuda-gpu` | 48/48 | %100.0 | 33/33 | 0.5s | 0.7s | 1.9s |
| `qwen2.5-7b-instruct-generic-cpu` | 15/48 | %31.3 | 2/33 | 0.1s | 0.1s | 0.1s |
| `Phi-3.5-mini-instruct-cuda-gpu` | 15/48 | %31.3 | 2/33 | 0.0s | 0.1s | 0.1s |
| `Phi-3.5-mini-instruct-generic-cpu` | 15/48 | %31.3 | 2/33 | 0.1s | 0.1s | 0.1s |

## `qwen2.5-1.5b-instruct-cuda-gpu`

Tüm vakalar geçti.

## `qwen2.5-7b-instruct-generic-cpu` — başarısız vakalar

| Vaka | Soru | Neden | Yanıt |
|---|---|---|---|
| spec-2 | Harcırah masraf fişlerimi kaç gün içinde yüklemeliyim? | hata: İşlem sırasında bir hata oluştu. | eksik: 5 |  |
| num-1 | Öğle molası kaç saat ve hangi saatler arasında? | hata: İşlem sırasında bir hata oluştu. | eksik: 12:30, 13:30 |  |
| num-2 | Babalık izni kaç gün? | hata: İşlem sırasında bir hata oluştu. | eksik: 5 |  |
| num-3 | Süt izni günde kaç saat? | hata: İşlem sırasında bir hata oluştu. | eksik: 1,5 |  |
| num-4 | Analık izni toplam kaç hafta? | hata: İşlem sırasında bir hata oluştu. | eksik: 16 |  |
| num-5 | Kreş desteği aylık ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 4.000 |  |
| num-6 | Doğum yardımı ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 15.000 |  |
| num-7 | Yemek kartına günlük ne kadar yükleniyor? | hata: İşlem sırasında bir hata oluştu. | eksik: 250 |  |
| num-8 | Otel konaklama üst limiti gecelik ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 3.500 |  |
| num-9 | Haftada kaç gün uzaktan çalışabilirim? | hata: İşlem sırasında bir hata oluştu. | eksik: 2 |  |
| num-10 | İş kazası kaç gün içinde SGK'ya bildirilir? | hata: İşlem sırasında bir hata oluştu. | eksik: 3 |  |
| num-11 | Kamera kayıtları kaç gün saklanır? | hata: İşlem sırasında bir hata oluştu. | eksik: 30 |  |
| num-12 | Deneme süresi kaç ay? | hata: İşlem sırasında bir hata oluştu. | eksik: 2 |  |
| num-13 | Tedarikçiden en fazla kaç TL değerinde hediye kabul edilebilir? | hata: İşlem sırasında bir hata oluştu. | eksik: 1.000 |  |
| num-14 | Yıllık kişisel gelişim bütçesi ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 25.000 |  |
| num-15 | Gece vardiyası zammı yüzde kaç? | hata: İşlem sırasında bir hata oluştu. | eksik: 20 |  |
| amb-1 | Evlilik yardımı ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 10.000 |  |
| amb-2 | Yol desteği aylık ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 1.500 |  |
| amb-3 | Yıllık toplam fazla mesai en fazla kaç saat olabilir? | hata: İşlem sırasında bir hata oluştu. | eksik: 270 |  |
| amb-4 | Bordro itirazımı kaç gün içinde yapmalıyım? | hata: İşlem sırasında bir hata oluştu. | eksik: 15 |  |
| amb-5 | Referans primi ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 5.000 |  |
| amb-6 | Olumsuz sonuçlanan aday başvuruları en fazla kaç yıl saklanır? | hata: İşlem sırasında bir hata oluştu. | eksik: 2 yıl |  |
| amb-7 | Özlük dosyaları kaç yıl saklanır? | hata: İşlem sırasında bir hata oluştu. | eksik: 10 yıl |  |
| amb-8 | Disiplin cezasına kaç iş günü içinde itiraz edebilirim? | hata: İşlem sırasında bir hata oluştu. | eksik: 7 iş günü |  |
| amb-9 | Savunma için çalışana en az kaç iş günü süre tanınır? | hata: İşlem sırasında bir hata oluştu. | eksik: 3 iş günü |  |
| amb-10 | Performans sonucuna kaç iş günü içinde itiraz edilir? | hata: İşlem sırasında bir hata oluştu. | eksik: 10 iş günü |  |
| amb-11 | Tehlikeli iş yerlerinde İSG eğitimi kaç yılda bir tekrarlanır? | hata: İşlem sırasında bir hata oluştu. | eksik: 2 yıl |  |
| amb-12 | Ücretsiz izin talebini en az kaç gün önce yapmalıyım? | hata: İşlem sırasında bir hata oluştu. | eksik: 15 gün |  |
| amb-13 | Sertifika programı sonrası kaç ay çalışma taahhüdü verilir? | hata: İşlem sırasında bir hata oluştu. | eksik: 24 ay |  |
| amb-14 | Sağlık raporunu bitiminden sonra kaç iş günü içinde yüklemeliyim? | hata: İşlem sırasında bir hata oluştu. | eksik: 3 iş günü |  |
| multi-3 | 2 yıllık olsam? | eksik: 6 hafta | Şirket içi mevzuat dokümanlarında bu konu hakkında bilgi bulunmamaktadır. Lütfen İK departmanı ile doğrudan iletişime ge |
| multi-4 | Kreş desteği ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 4.000 |  |
| multi-6 | ne konuşuyorduk? | eksik: Kreş desteği | Henüz bir konu konuşmadık. İK politikalarıyla ilgili sorunuzu yazabilirsiniz. |

## `Phi-3.5-mini-instruct-cuda-gpu` — başarısız vakalar

| Vaka | Soru | Neden | Yanıt |
|---|---|---|---|
| spec-2 | Harcırah masraf fişlerimi kaç gün içinde yüklemeliyim? | hata: İşlem sırasında bir hata oluştu. | eksik: 5 |  |
| num-1 | Öğle molası kaç saat ve hangi saatler arasında? | hata: İşlem sırasında bir hata oluştu. | eksik: 12:30, 13:30 |  |
| num-2 | Babalık izni kaç gün? | hata: İşlem sırasında bir hata oluştu. | eksik: 5 |  |
| num-3 | Süt izni günde kaç saat? | hata: İşlem sırasında bir hata oluştu. | eksik: 1,5 |  |
| num-4 | Analık izni toplam kaç hafta? | hata: İşlem sırasında bir hata oluştu. | eksik: 16 |  |
| num-5 | Kreş desteği aylık ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 4.000 |  |
| num-6 | Doğum yardımı ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 15.000 |  |
| num-7 | Yemek kartına günlük ne kadar yükleniyor? | hata: İşlem sırasında bir hata oluştu. | eksik: 250 |  |
| num-8 | Otel konaklama üst limiti gecelik ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 3.500 |  |
| num-9 | Haftada kaç gün uzaktan çalışabilirim? | hata: İşlem sırasında bir hata oluştu. | eksik: 2 |  |
| num-10 | İş kazası kaç gün içinde SGK'ya bildirilir? | hata: İşlem sırasında bir hata oluştu. | eksik: 3 |  |
| num-11 | Kamera kayıtları kaç gün saklanır? | hata: İşlem sırasında bir hata oluştu. | eksik: 30 |  |
| num-12 | Deneme süresi kaç ay? | hata: İşlem sırasında bir hata oluştu. | eksik: 2 |  |
| num-13 | Tedarikçiden en fazla kaç TL değerinde hediye kabul edilebilir? | hata: İşlem sırasında bir hata oluştu. | eksik: 1.000 |  |
| num-14 | Yıllık kişisel gelişim bütçesi ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 25.000 |  |
| num-15 | Gece vardiyası zammı yüzde kaç? | hata: İşlem sırasında bir hata oluştu. | eksik: 20 |  |
| amb-1 | Evlilik yardımı ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 10.000 |  |
| amb-2 | Yol desteği aylık ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 1.500 |  |
| amb-3 | Yıllık toplam fazla mesai en fazla kaç saat olabilir? | hata: İşlem sırasında bir hata oluştu. | eksik: 270 |  |
| amb-4 | Bordro itirazımı kaç gün içinde yapmalıyım? | hata: İşlem sırasında bir hata oluştu. | eksik: 15 |  |
| amb-5 | Referans primi ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 5.000 |  |
| amb-6 | Olumsuz sonuçlanan aday başvuruları en fazla kaç yıl saklanır? | hata: İşlem sırasında bir hata oluştu. | eksik: 2 yıl |  |
| amb-7 | Özlük dosyaları kaç yıl saklanır? | hata: İşlem sırasında bir hata oluştu. | eksik: 10 yıl |  |
| amb-8 | Disiplin cezasına kaç iş günü içinde itiraz edebilirim? | hata: İşlem sırasında bir hata oluştu. | eksik: 7 iş günü |  |
| amb-9 | Savunma için çalışana en az kaç iş günü süre tanınır? | hata: İşlem sırasında bir hata oluştu. | eksik: 3 iş günü |  |
| amb-10 | Performans sonucuna kaç iş günü içinde itiraz edilir? | hata: İşlem sırasında bir hata oluştu. | eksik: 10 iş günü |  |
| amb-11 | Tehlikeli iş yerlerinde İSG eğitimi kaç yılda bir tekrarlanır? | hata: İşlem sırasında bir hata oluştu. | eksik: 2 yıl |  |
| amb-12 | Ücretsiz izin talebini en az kaç gün önce yapmalıyım? | hata: İşlem sırasında bir hata oluştu. | eksik: 15 gün |  |
| amb-13 | Sertifika programı sonrası kaç ay çalışma taahhüdü verilir? | hata: İşlem sırasında bir hata oluştu. | eksik: 24 ay |  |
| amb-14 | Sağlık raporunu bitiminden sonra kaç iş günü içinde yüklemeliyim? | hata: İşlem sırasında bir hata oluştu. | eksik: 3 iş günü |  |
| multi-3 | 2 yıllık olsam? | eksik: 6 hafta | Şirket içi mevzuat dokümanlarında bu konu hakkında bilgi bulunmamaktadır. Lütfen İK departmanı ile doğrudan iletişime ge |
| multi-4 | Kreş desteği ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 4.000 |  |
| multi-6 | ne konuşuyorduk? | eksik: Kreş desteği | Henüz bir konu konuşmadık. İK politikalarıyla ilgili sorunuzu yazabilirsiniz. |

## `Phi-3.5-mini-instruct-generic-cpu` — başarısız vakalar

| Vaka | Soru | Neden | Yanıt |
|---|---|---|---|
| spec-2 | Harcırah masraf fişlerimi kaç gün içinde yüklemeliyim? | hata: İşlem sırasında bir hata oluştu. | eksik: 5 |  |
| num-1 | Öğle molası kaç saat ve hangi saatler arasında? | hata: İşlem sırasında bir hata oluştu. | eksik: 12:30, 13:30 |  |
| num-2 | Babalık izni kaç gün? | hata: İşlem sırasında bir hata oluştu. | eksik: 5 |  |
| num-3 | Süt izni günde kaç saat? | hata: İşlem sırasında bir hata oluştu. | eksik: 1,5 |  |
| num-4 | Analık izni toplam kaç hafta? | hata: İşlem sırasında bir hata oluştu. | eksik: 16 |  |
| num-5 | Kreş desteği aylık ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 4.000 |  |
| num-6 | Doğum yardımı ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 15.000 |  |
| num-7 | Yemek kartına günlük ne kadar yükleniyor? | hata: İşlem sırasında bir hata oluştu. | eksik: 250 |  |
| num-8 | Otel konaklama üst limiti gecelik ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 3.500 |  |
| num-9 | Haftada kaç gün uzaktan çalışabilirim? | hata: İşlem sırasında bir hata oluştu. | eksik: 2 |  |
| num-10 | İş kazası kaç gün içinde SGK'ya bildirilir? | hata: İşlem sırasında bir hata oluştu. | eksik: 3 |  |
| num-11 | Kamera kayıtları kaç gün saklanır? | hata: İşlem sırasında bir hata oluştu. | eksik: 30 |  |
| num-12 | Deneme süresi kaç ay? | hata: İşlem sırasında bir hata oluştu. | eksik: 2 |  |
| num-13 | Tedarikçiden en fazla kaç TL değerinde hediye kabul edilebilir? | hata: İşlem sırasında bir hata oluştu. | eksik: 1.000 |  |
| num-14 | Yıllık kişisel gelişim bütçesi ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 25.000 |  |
| num-15 | Gece vardiyası zammı yüzde kaç? | hata: İşlem sırasında bir hata oluştu. | eksik: 20 |  |
| amb-1 | Evlilik yardımı ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 10.000 |  |
| amb-2 | Yol desteği aylık ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 1.500 |  |
| amb-3 | Yıllık toplam fazla mesai en fazla kaç saat olabilir? | hata: İşlem sırasında bir hata oluştu. | eksik: 270 |  |
| amb-4 | Bordro itirazımı kaç gün içinde yapmalıyım? | hata: İşlem sırasında bir hata oluştu. | eksik: 15 |  |
| amb-5 | Referans primi ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 5.000 |  |
| amb-6 | Olumsuz sonuçlanan aday başvuruları en fazla kaç yıl saklanır? | hata: İşlem sırasında bir hata oluştu. | eksik: 2 yıl |  |
| amb-7 | Özlük dosyaları kaç yıl saklanır? | hata: İşlem sırasında bir hata oluştu. | eksik: 10 yıl |  |
| amb-8 | Disiplin cezasına kaç iş günü içinde itiraz edebilirim? | hata: İşlem sırasında bir hata oluştu. | eksik: 7 iş günü |  |
| amb-9 | Savunma için çalışana en az kaç iş günü süre tanınır? | hata: İşlem sırasında bir hata oluştu. | eksik: 3 iş günü |  |
| amb-10 | Performans sonucuna kaç iş günü içinde itiraz edilir? | hata: İşlem sırasında bir hata oluştu. | eksik: 10 iş günü |  |
| amb-11 | Tehlikeli iş yerlerinde İSG eğitimi kaç yılda bir tekrarlanır? | hata: İşlem sırasında bir hata oluştu. | eksik: 2 yıl |  |
| amb-12 | Ücretsiz izin talebini en az kaç gün önce yapmalıyım? | hata: İşlem sırasında bir hata oluştu. | eksik: 15 gün |  |
| amb-13 | Sertifika programı sonrası kaç ay çalışma taahhüdü verilir? | hata: İşlem sırasında bir hata oluştu. | eksik: 24 ay |  |
| amb-14 | Sağlık raporunu bitiminden sonra kaç iş günü içinde yüklemeliyim? | hata: İşlem sırasında bir hata oluştu. | eksik: 3 iş günü |  |
| multi-3 | 2 yıllık olsam? | eksik: 6 hafta | Şirket içi mevzuat dokümanlarında bu konu hakkında bilgi bulunmamaktadır. Lütfen İK departmanı ile doğrudan iletişime ge |
| multi-4 | Kreş desteği ne kadar? | hata: İşlem sırasında bir hata oluştu. | eksik: 4.000 |  |
| multi-6 | ne konuşuyorduk? | eksik: Kreş desteği | Henüz bir konu konuşmadık. İK politikalarıyla ilgili sorunuzu yazabilirsiniz. |
