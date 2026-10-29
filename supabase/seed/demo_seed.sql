-- Örnek (demo) veri: tamamı uydurmadır.
-- __DEMO_PASSWORD__ yer tutucusu çalıştırılmadan önce gerçek şifreyle değiştirilir; şifre dosyada tutulmaz.
-- Barkodlar '2' ile başlar (mağaza içi kullanım aralığı), gerçek ürünlerle çakışmaz.

select setseed(0.42);

-- Kullanıcılar ------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
values
 ('00000000-0000-0000-0000-000000000000','d0000000-0000-0000-0000-000000000001','authenticated','authenticated',
  'demo-dagitim@example.com', extensions.crypt('__DEMO_PASSWORD__', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{"full_name":"Demo Distribütör"}', now(), now(), '', '', '', ''),
 ('00000000-0000-0000-0000-000000000000','d0000000-0000-0000-0000-000000000002','authenticated','authenticated',
  'demo-market@example.com', extensions.crypt('__DEMO_PASSWORD__', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{"full_name":"Demo Market"}', now(), now(), '', '', '', '');

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
 (gen_random_uuid(),'d0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001',
  '{"sub":"d0000000-0000-0000-0000-000000000001","email":"demo-dagitim@example.com","email_verified":true}','email', now(), now(), now()),
 (gen_random_uuid(),'d0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000002',
  '{"sub":"d0000000-0000-0000-0000-000000000002","email":"demo-market@example.com","email_verified":true}','email', now(), now(), now());

-- Kuruluşlar --------------------------------------------------------------
insert into organizations (id, type, name, city, district) values
 ('a0000000-0000-0000-0000-000000000001','distributor','Demo Anadolu Gıda Dağıtım','İstanbul','Ümraniye'),
 ('b0000000-0000-0000-0000-000000000001','retailer','Yıldız Market','İstanbul','Kadıköy'),
 ('b0000000-0000-0000-0000-000000000002','retailer','Çınar Bakkal','İstanbul','Üsküdar'),
 ('b0000000-0000-0000-0000-000000000003','retailer','Park Süpermarket','İstanbul','Ataşehir'),
 ('b0000000-0000-0000-0000-000000000004','retailer','Ece Büfe','İstanbul','Kadıköy'),
 ('b0000000-0000-0000-0000-000000000005','retailer','Gül Market','İstanbul','Maltepe'),
 ('b0000000-0000-0000-0000-000000000006','retailer','Deniz Bakkal','İstanbul','Kartal');

insert into memberships (user_id, org_id, role) values
 ('d0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','owner'),
 ('d0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000001','owner');

insert into retailer_distributor_links (retailer_id, distributor_id, status, stock_share_consent_at)
select id, 'a0000000-0000-0000-0000-000000000001', 'active', now() - interval '60 days'
from organizations where type = 'retailer';

-- Ürünler ve distribütör koli fiyatları -------------------------------------
create temp table demo_products (n int, id uuid, gtin text, name text, case_qty int, case_price numeric, base_weekly numeric);
insert into demo_products values
 ( 1,'c0000000-0000-0000-0000-000000000001','2000000000015','Tam yağlı süt 1 L',        12,  480, 30),
 ( 2,'c0000000-0000-0000-0000-000000000002','2000000000022','Yarım yağlı süt 1 L',      12,  450, 12),
 ( 3,'c0000000-0000-0000-0000-000000000003','2000000000039','Ayran 200 ml',             24,  216, 10),
 ( 4,'c0000000-0000-0000-0000-000000000004','2000000000046','Ayran 1 L',                12,  300,  6),
 ( 5,'c0000000-0000-0000-0000-000000000005','2000000000053','Süzme yoğurt 1 kg',         6,  540,  8),
 ( 6,'c0000000-0000-0000-0000-000000000006','2000000000060','Tam yağlı yoğurt 2 kg',     4,  520,  9),
 ( 7,'c0000000-0000-0000-0000-000000000007','2000000000077','Beyaz peynir 500 g',       12, 1680,  3),
 ( 8,'c0000000-0000-0000-0000-000000000008','2000000000084','Kaşar peyniri 400 g',      12, 2100,  2),
 ( 9,'c0000000-0000-0000-0000-000000000009','2000000000091','Tereyağı 250 g',           12, 1500,  2),
 (10,'c0000000-0000-0000-0000-000000000010','2000000000107','Kefir 1 L',                 6,  390,  3),
 (11,'c0000000-0000-0000-0000-000000000011','2000000000114','Krem peynir 180 g',        12,  840,  2),
 (12,'c0000000-0000-0000-0000-000000000012','2000000000121','Laktozsuz süt 1 L',        12,  600,  2);

insert into products (id, gtin, name, brand, unit, case_qty, category)
select id, gtin, name, 'Örnek Marka', 'adet', case_qty, 'Süt ürünleri' from demo_products;

insert into distributor_products (distributor_id, product_id, case_price)
select 'a0000000-0000-0000-0000-000000000001', id, case_price from demo_products;

-- Market büyüklüğü katsayısı: Park Süpermarket büyük, Ece Büfe küçük
create temp table demo_retailers (id uuid, size numeric, src public.stock_source);
insert into demo_retailers values
 ('b0000000-0000-0000-0000-000000000001', 1.30, 'app'),
 ('b0000000-0000-0000-0000-000000000002', 0.60, 'estimate'),
 ('b0000000-0000-0000-0000-000000000003', 2.20, 'pos_integration'),
 ('b0000000-0000-0000-0000-000000000004', 0.35, 'app'),
 ('b0000000-0000-0000-0000-000000000005', 1.00, 'app'),
 ('b0000000-0000-0000-0000-000000000006', 0.55, 'estimate');

-- Hangi market hangi ürünü satıyor (küçükler her şeyi satmaz) ve haftalık hızı
create temp table demo_rp as
select r.id as retailer_id, p.id as product_id, p.case_qty, p.n,
       greatest(0.5, round(p.base_weekly * r.size * (0.8 + random()::numeric * 0.4), 1)) as weekly_cases,
       r.src
from demo_retailers r cross join demo_products p
where not (r.size < 0.7 and p.n in (8, 11, 12));

-- Son 42 günün günlük satışları (yalnızca adet, fiyat yok)
insert into stock_movements (retailer_id, product_id, qty_delta, kind, created_at)
select rp.retailer_id, rp.product_id,
       -greatest(0, round(rp.weekly_cases * rp.case_qty / 7.0
                          * (case when extract(isodow from d) in (6,7) then 1.25 else 0.9 end)
                          * (0.7 + random() * 0.6)))::int,
       'sale',
       d + time '18:00'
from demo_rp rp
cross join generate_series(current_date - 42, current_date - 1, interval '1 day') d;

-- Güncel stok: çoğu 3–10 günlük, bazıları kritik
insert into stock_levels (retailer_id, product_id, qty_units, source, updated_at)
select retailer_id, product_id,
       greatest(0, round(weekly_cases * case_qty / 7.0 *
         case when (n + get_byte(decode(substr(md5(retailer_id::text), 1, 2), 'hex'), 0)) % 5 = 0
              then 0.5 + random() * 1.5     -- kritik: 0,5–2 gün
              else 3 + random() * 7 end))::int,
       src, now() - (random() * interval '20 hours')
from demo_rp;

-- Marketlerin kendi raf fiyatları (distribütör göremez)
insert into retailer_prices (retailer_id, product_id, shelf_price)
select rp.retailer_id, rp.product_id, round(dp.case_price / rp.case_qty * (1.18 + random()::numeric * 0.12), 2)
from demo_rp rp join demo_products dp on dp.id = rp.product_id;

-- Kampanya
insert into campaigns (id, distributor_id, product_id, title, case_price, rule, target, ends_at) values
 ('e0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002',
  'Yarım yağlı süt: 10 koliye 1 koli hediye', 450, '{"buy":10,"free":1}', 'low_stock', now() + interval '7 days'),
 ('e0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000003',
  'Ayran 200 ml: 20 koliye %5 indirim', 205.20, '{"min_cases":20,"discount_pct":5}', 'all', now() + interval '14 days');

-- Geçmiş ve bekleyen siparişler
create temp table demo_orders (id uuid, retailer_id uuid, status public.order_status, days_ago int);
insert into demo_orders values
 ('f0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','delivered', 6),
 ('f0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000004','delivered', 6),
 ('f0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000005','approved',  1),
 ('f0000000-0000-0000-0000-000000000004','b0000000-0000-0000-0000-000000000006','approved',  1),
 ('f0000000-0000-0000-0000-000000000005','b0000000-0000-0000-0000-000000000003','changes_requested', 1),
 ('f0000000-0000-0000-0000-000000000006','b0000000-0000-0000-0000-000000000002','sent', 0);

insert into orders (id, retailer_id, distributor_id, status, delivery_date, created_by, created_at, updated_at)
select id, retailer_id, 'a0000000-0000-0000-0000-000000000001', status,
       current_date - days_ago + 1, 'd0000000-0000-0000-0000-000000000001',
       now() - make_interval(days => days_ago), now() - make_interval(days => days_ago)
from demo_orders;

insert into order_lines (order_id, product_id, cases, case_price, suggested_cases, accepted_cases)
select o.id, rp.product_id, greatest(1, round(rp.weekly_cases))::int, dp.case_price,
       greatest(1, round(rp.weekly_cases))::int,
       case when o.status = 'delivered' then greatest(1, round(rp.weekly_cases))::int end
from demo_orders o
join demo_rp rp on rp.retailer_id = o.retailer_id and rp.n <= 6
join demo_products dp on dp.id = rp.product_id;

update orders o set total = s.t
from (select order_id, sum(cases * case_price) t from order_lines group by 1) s
where s.order_id = o.id;

-- Bağlantılar (bağlayıcılar)
insert into org_integrations (org_id, connector_code, label, state, is_primary_stock_source, last_test_at, last_test_ok, created_by)
values
 ('a0000000-0000-0000-0000-000000000001','csv_upload','Ürün listesi (Excel)','active', false, now() - interval '3 days', true,
  'd0000000-0000-0000-0000-000000000001'),
 ('b0000000-0000-0000-0000-000000000001','app_barcode','Kasa','active', true, now() - interval '30 days', true,
  'd0000000-0000-0000-0000-000000000002');

select (select count(*) from products) urun, (select count(*) from stock_movements) hareket,
       (select count(*) from stock_levels) stok, (select count(*) from orders) siparis;
