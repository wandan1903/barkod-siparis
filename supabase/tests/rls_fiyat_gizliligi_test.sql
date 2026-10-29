grant usage on schema public, auth to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public, auth to authenticated;

-- Örnek veri (belgedeki süt örneği)
insert into auth.users values
 ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c');
insert into organizations (id,type,name) values
 ('10000000-0000-0000-0000-00000000000a','distributor','Anadolu Gıda'),
 ('10000000-0000-0000-0000-00000000000b','distributor','Rakip Dağıtım'),
 ('10000000-0000-0000-0000-00000000000c','retailer','Yıldız Market');
insert into memberships values
 ('00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a','owner',now()),
 ('00000000-0000-0000-0000-00000000000b','10000000-0000-0000-0000-00000000000b','owner',now()),
 ('00000000-0000-0000-0000-00000000000c','10000000-0000-0000-0000-00000000000c','owner',now());
insert into retailer_distributor_links (retailer_id,distributor_id,status,stock_share_consent_at) values
 ('10000000-0000-0000-0000-00000000000c','10000000-0000-0000-0000-00000000000a','active',now()),
 ('10000000-0000-0000-0000-00000000000c','10000000-0000-0000-0000-00000000000b','active',now());
insert into products (id,gtin,name,case_qty) values
 ('20000000-0000-0000-0000-000000000001','8690000000001','Tam yağlı süt 1 L',12),
 ('20000000-0000-0000-0000-000000000002','8690000000002','Deterjan 4 kg',4);
insert into distributor_products values
 ('10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001',480,true,now()),
 ('10000000-0000-0000-0000-00000000000b','20000000-0000-0000-0000-000000000002',900,true,now());
insert into retailer_prices values
 ('10000000-0000-0000-0000-00000000000c','20000000-0000-0000-0000-000000000001',42.50,now()),
 ('10000000-0000-0000-0000-00000000000c','20000000-0000-0000-0000-000000000002',299.90,now());
insert into stock_levels values
 ('10000000-0000-0000-0000-00000000000c','20000000-0000-0000-0000-000000000001',120,'app',now()),
 ('10000000-0000-0000-0000-00000000000c','20000000-0000-0000-0000-000000000002',6,'app',now());
-- 4 haftada haftalık 40 koli süt satışı = 4 x 480 adet
insert into stock_movements (retailer_id,product_id,qty_delta,kind,created_at)
 select '10000000-0000-0000-0000-00000000000c','20000000-0000-0000-0000-000000000001',-480,'sale', now() - (g||' days')::interval
 from generate_series(1,27,7) g;

set role authenticated;

\echo '--- Anadolu Gıda (süt distribütörü) ---'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
select 'raf fiyatı satırı' as test, count(*) as gorulen from retailer_prices;
select 'stok gördüğü ürünler' as test, string_agg(p.name, ', ') from stock_levels s join products p on p.id=s.product_id;

\echo '--- Rakip Dağıtım (deterjan) ---'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \g /dev/null
select 'raf fiyatı satırı' as test, count(*) as gorulen from retailer_prices;
select 'stok gördüğü ürünler' as test, string_agg(p.name, ', ') from stock_levels s join products p on p.id=s.product_id;
select 'gördüğü süt hareketi' as test, count(*) from stock_movements where product_id='20000000-0000-0000-0000-000000000001';

\echo '--- Yıldız Market ---'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false) \g /dev/null
select 'raf fiyatı satırı' as test, count(*) as gorulen from retailer_prices;
select 'gördüğü koli fiyatları' as test, string_agg(case_price::text, ', ' order by case_price) from distributor_products;

\echo '--- Sipariş önerisi (süt) ---'
select * from suggest_order('10000000-0000-0000-0000-00000000000c','10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001');
