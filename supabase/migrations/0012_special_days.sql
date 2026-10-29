-- Önemli günler takvimi: resmi tatil, bayram, özel gün, alışveriş dönemi.
-- Tüm giriş yapmış kullanıcılar okuyabilir; yazma yalnızca sunucu tarafından (migration) yapılır.
create table public.special_days (
  id        uuid primary key default gen_random_uuid(),
  day       date not null,
  end_day   date,
  name      text not null,
  kind      text not null check (kind in ('resmi', 'dini', 'ozel', 'alisveris')),
  note      text,
  unique (day, name),
  check (end_day is null or end_day >= day)
);
create index special_days_day_idx on public.special_days (day);
alter table public.special_days enable row level security;
create policy sd_read on public.special_days for select to authenticated using (true);

insert into public.special_days (day, end_day, name, kind, note) values
 ('2026-10-29', null,         'Cumhuriyet Bayramı',          'resmi',     'Resmi tatil. Önceki günlerde içecek ve atıştırmalık satışı artabilir.'),
 ('2026-11-10', null,         'Atatürk''ü Anma Günü',        'ozel',      null),
 ('2026-11-24', null,         'Öğretmenler Günü',            'ozel',      'Çikolata ve hediyelik ürün satışı hareketlenir.'),
 ('2026-11-27', null,         'Efsane Cuma (Black Friday)',  'alisveris', 'Kampanya dönemi. Rakip kampanyalarına karşı fiyat ve paket planlamak için iyi zaman.'),
 ('2026-12-31', null,         'Yılbaşı gecesi',              'ozel',      'Atıştırmalık, içecek ve kuruyemiş satışı artar; hafta sonuna denk gelirse siparişi erkene al.'),
 ('2027-01-01', null,         'Yılbaşı',                     'resmi',     'Resmi tatil.'),
 ('2027-02-08', null,         'Ramazan başlangıcı',          'dini',      'Ramazan boyunca süt, yoğurt, peynir, zeytin, hurma ve konserve talebi belirgin değişir. Önerileri bir hafta önceden gözden geçir.'),
 ('2027-02-14', null,         'Sevgililer Günü',             'ozel',      'Çikolata ve hediyelik ürünlerde hareket.'),
 ('2027-03-08', '2027-03-08', 'Ramazan Bayramı arefesi',     'dini',      'Yarım gün resmi tatil. Bayram öncesi alışveriş yoğun olur.'),
 ('2027-03-09', '2027-03-11', 'Ramazan Bayramı',             'dini',      'Resmi tatil (3 gün). Şeker, çikolata, lokum, içecek talebi artar; teslimatı tatil öncesine çek.'),
 ('2027-04-23', null,         '23 Nisan Ulusal Egemenlik ve Çocuk Bayramı', 'resmi', 'Resmi tatil.'),
 ('2027-05-01', null,         'Emek ve Dayanışma Günü',      'resmi',     'Resmi tatil.'),
 ('2027-05-09', null,         'Anneler Günü',                'ozel',      'Çikolata ve hediyelik ürünlerde hareket.'),
 ('2027-05-15', null,         'Kurban Bayramı arefesi',      'dini',      'Yarım gün resmi tatil.'),
 ('2027-05-16', '2027-05-19', 'Kurban Bayramı',              'dini',      'Resmi tatil (4 gün). Bayram öncesi stok ve teslimat planını erkene al.'),
 ('2027-05-19', null,         'Atatürk''ü Anma, Gençlik ve Spor Bayramı', 'resmi', 'Resmi tatil.'),
 ('2027-06-20', null,         'Babalar Günü',                'ozel',      null),
 ('2027-07-15', null,         'Demokrasi ve Milli Birlik Günü', 'resmi',  'Resmi tatil.'),
 ('2027-08-30', null,         'Zafer Bayramı',               'resmi',     'Resmi tatil.'),
 ('2027-10-28', null,         'Cumhuriyet Bayramı arefesi',  'resmi',     'Yarım gün resmi tatil.'),
 ('2027-10-29', null,         'Cumhuriyet Bayramı',          'resmi',     'Resmi tatil.'),
 ('2027-11-10', null,         'Atatürk''ü Anma Günü',        'ozel',      null),
 ('2027-11-24', null,         'Öğretmenler Günü',            'ozel',      null),
 ('2027-11-26', null,         'Efsane Cuma (Black Friday)',  'alisveris', 'Kampanya dönemi.'),
 ('2027-12-31', null,         'Yılbaşı gecesi',              'ozel',      'Atıştırmalık ve içecek satışı artar.');
