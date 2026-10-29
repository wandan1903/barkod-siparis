# Barkod Sipariş

Distribütörler ve küçük marketler için stok takibi ve sipariş önerisi platformu (pilot).

## Klasörler

- `supabase/migrations/` – veritabanı şeması, sırayla uygulanır
  - `0001_init.sql` – kuruluşlar, ürünler, stok, sipariş, satır bazlı güvenlik (RLS)
  - `0002_hardening.sql` – güvenlik ve performans düzeltmeleri
  - `0003_connectors.sql` – değiştirilebilir entegrasyonlar (bağlayıcı kataloğu, sistem değiştirme)
  - `0004_panel_functions.sql` – panelin kullandığı stok özeti, haftalık satış ve teklif oluşturma fonksiyonları
- `supabase/seed/demo_seed.sql` – uydurma örnek veri (şifre dosyada tutulmaz)
- `supabase/tests/` – fiyat gizliliği testi
- `panel/` – distribütör paneli (Next.js)

## Temel kurallar (veritabanında uygulanır)

1. Marketin raf satış fiyatını yalnızca market görür.
2. Distribütör yalnızca kendi kataloğundaki ürünlerin stoğunu, yalnızca veri paylaşımına onay vermiş marketlerde görür.
3. Distribütörün koli fiyatı bağlı marketlere teklifte görünür; teklif fiyatı istemciden değil katalogdan alınır.

## Yeni bir kasa / muhasebe sistemi eklemek

1. `connectors` tablosuna bir satır ekle: kod, ad, yetenekler, kurulum formunda sorulacak alanlar (`config_fields`).
2. Kodda o sistemin adaptörünü yaz (bağlantı testi, stok/satış okuma, sepet gönderme).
3. Kullanıcılar uygulamayı güncellemeden "Entegrasyonlar → Sistem ekle / Sistemi değiştir" ekranından bağlar.

## Panel ortam değişkenleri

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
