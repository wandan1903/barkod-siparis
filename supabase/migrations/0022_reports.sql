-- Raporlar
--  * retailer_report(): marketin satış raporu. Satış adedi stok hareketlerinden gelir (uygulama, kasa
--    entegrasyonu ya da tahmin; hepsi aynı yerde), ciro = adet × güncel raf fiyatı, maliyet = son teslim
--    alınan siparişteki koli fiyatı / koli içi adet. Raf fiyatı ve kâr yalnızca marketin kendisine gösterilir.
--  * distributor_report(): distribütörün satış raporu. Ciro = teslim edilen siparişler (cari borç kayıtları),
--    tahsilat, sipariş/öneri sayıları, en çok satan ürünler ve marketler, marketteki satış (sell-out;
--    yalnızca stok paylaşımına onay veren marketler) ve şu an rafı boş olan ürünler.
--  Tarihler İstanbul saatine göre, iki uç dahil. 62 günden uzun aralıklar haftalık gruplanır.

create or replace function public.retailer_report(p_retailer uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_days int;
  v_weekly boolean;
  v_prev_from date;
  v_prev_to date;
  v_result jsonb;
begin
  if not private.is_member(p_retailer) then
    raise exception 'Bu market adına işlem yetkiniz yok';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Geçersiz tarih aralığı';
  end if;
  if p_to - p_from > 400 then
    raise exception 'En fazla 400 günlük rapor alınabilir';
  end if;
  v_days := p_to - p_from + 1;
  v_weekly := v_days > 62;
  v_prev_to := p_from - 1;
  v_prev_from := p_from - v_days;

  with cost as (   -- ürün başına son birim maliyet
    select distinct on (ol.product_id) ol.product_id, ol.case_price / p.case_qty as unit_cost
    from orders o
    join order_lines ol on ol.order_id = o.id
    join products p on p.id = ol.product_id
    where o.retailer_id = p_retailer and o.status = 'delivered' and coalesce(ol.accepted_cases, ol.cases) > 0
    order by ol.product_id, o.updated_at desc
  ),
  mv as (
    select m.product_id, -m.qty_delta as units,
           (m.created_at at time zone 'Europe/Istanbul')::date as d
    from stock_movements m
    where m.retailer_id = p_retailer and m.kind = 'sale'
      and (m.created_at at time zone 'Europe/Istanbul')::date between v_prev_from and p_to
  ),
  priced as (
    select mv.*, coalesce(rp.shelf_price, 0) as price, c.unit_cost,
           mv.d >= p_from as cur
    from mv
    left join retailer_prices rp on rp.retailer_id = p_retailer and rp.product_id = mv.product_id
    left join cost c on c.product_id = mv.product_id
  ),
  k as (
    select
      coalesce(sum(units * price) filter (where cur), 0) as revenue,
      coalesce(sum(units) filter (where cur), 0) as units,
      coalesce(sum(units * (price - unit_cost)) filter (where cur and unit_cost is not null and price > 0), 0) as profit,
      coalesce(sum(units * price) filter (where cur and unit_cost is not null and price > 0), 0) as revenue_costed,
      coalesce(sum(units * price) filter (where not cur), 0) as prev_revenue,
      count(distinct product_id) filter (where cur) as products,
      coalesce(sum(units) filter (where cur and price = 0), 0) as units_unpriced
    from priced
  ),
  rc as (
    select count(*) as receipts, coalesce(sum(total), 0) as receipt_total
    from sales s
    where s.retailer_id = p_retailer
      and (s.created_at at time zone 'Europe/Istanbul')::date between p_from and p_to
  ),
  buckets as (
    select case when v_weekly then date_trunc('week', g)::date else g::date end as b
    from generate_series(p_from, p_to, interval '1 day') g
    group by 1
  ),
  series as (
    select b.b,
           coalesce(sum(p.units * p.price), 0) as revenue,
           coalesce(sum(p.units), 0) as units
    from buckets b
    left join priced p on p.cur and (case when v_weekly then date_trunc('week', p.d)::date else p.d end) = b.b
    group by b.b
  ),
  top as (
    select pr.name, pr.gtin, sum(p.units) as units, sum(p.units * p.price) as revenue,
           case when bool_and(p.unit_cost is not null) and max(p.price) > 0
                then sum(p.units * (p.price - p.unit_cost)) end as profit,
           max(p.price) as price, max(p.unit_cost) as unit_cost
    from priced p join products pr on pr.id = p.product_id
    where p.cur
    group by pr.id, pr.name, pr.gtin
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'weekly', v_weekly,
    'kpis', (select jsonb_build_object(
        'revenue', round(k.revenue, 2), 'units', k.units, 'profit', round(k.profit, 2),
        'margin_pct', case when k.revenue_costed > 0 then round(100 * k.profit / k.revenue_costed, 1) end,
        'cost_coverage_pct', case when k.revenue > 0 then round(100 * k.revenue_costed / k.revenue, 0) end,
        'prev_revenue', round(k.prev_revenue, 2),
        'change_pct', case when k.prev_revenue > 0 then round(100 * (k.revenue - k.prev_revenue) / k.prev_revenue, 1) end,
        'products', k.products, 'units_unpriced', k.units_unpriced,
        'receipts', rc.receipts,
        'avg_basket', case when rc.receipts > 0 then round(rc.receipt_total / rc.receipts, 2) end)
      from k, rc),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('d', b, 'revenue', round(revenue, 2), 'units', units) order by b), '[]') from series),
    'top', (select coalesce(jsonb_agg(t order by t.revenue desc), '[]') from (select * from top order by revenue desc, units desc limit 15) t),
    'low_margin', (select coalesce(jsonb_agg(t order by t.m), '[]') from (
        select name, round(100 * profit / nullif(revenue, 0), 1) as m, revenue, price, unit_cost
        from top where profit is not null and revenue > 0 order by profit / revenue limit 5) t)
  ) into v_result;
  return v_result;
end;
$$;
revoke execute on function public.retailer_report(uuid, date, date) from public, anon;
grant execute on function public.retailer_report(uuid, date, date) to authenticated;

create or replace function public.distributor_report(p_distributor uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_days int;
  v_weekly boolean;
  v_prev_from date;
  v_result jsonb;
begin
  if not private.is_member(p_distributor) then
    raise exception 'Bu distribütör adına işlem yetkiniz yok';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Geçersiz tarih aralığı';
  end if;
  if p_to - p_from > 400 then
    raise exception 'En fazla 400 günlük rapor alınabilir';
  end if;
  v_days := p_to - p_from + 1;
  v_weekly := v_days > 62;
  v_prev_from := p_from - v_days;

  with inv as (   -- teslim edilen siparişler (iptal edilmemiş borç kayıtları)
    select e.order_id, e.retailer_id, e.amount, e.entry_date as d, e.entry_date >= p_from as cur
    from account_entries e
    where e.distributor_id = p_distributor and e.kind = 'siparis'
      and e.entry_date between v_prev_from and p_to
      and not exists (select 1 from account_entries x where x.reverses_id = e.id)
  ),
  pay as (
    select coalesce(-sum(e.amount), 0) as collected
    from account_entries e
    where e.distributor_id = p_distributor and e.kind = 'tahsilat'
      and e.entry_date between p_from and p_to
      and not exists (select 1 from account_entries x where x.reverses_id = e.id)
  ),
  ord as (
    select o.id, o.origin, o.status
    from orders o
    where o.distributor_id = p_distributor
      and (o.created_at at time zone 'Europe/Istanbul')::date between p_from and p_to
  ),
  k as (
    select
      coalesce(sum(amount) filter (where cur), 0) as revenue,
      coalesce(sum(amount) filter (where not cur), 0) as prev_revenue,
      count(*) filter (where cur) as deliveries,
      count(distinct retailer_id) filter (where cur) as active_markets
    from inv
  ),
  ko as (
    select
      count(*) filter (where status in ('approved', 'shipped', 'delivered')) as approved_orders,
      count(*) filter (where origin = 'order') as market_orders,
      count(*) filter (where origin = 'offer' and status in ('approved', 'shipped', 'delivered')) as offers_accepted,
      count(*) filter (where origin = 'offer' and status in ('approved', 'shipped', 'delivered', 'rejected', 'changes_requested')) as offers_answered,
      count(*) filter (where origin = 'offer') as offers_sent
    from ord
  ),
  lines as (
    select ol.product_id, i.retailer_id,
           coalesce(ol.accepted_cases, ol.cases) as cases,
           coalesce(ol.accepted_cases, ol.cases) * ol.case_price as revenue
    from inv i join order_lines ol on ol.order_id = i.order_id
    where i.cur
  ),
  buckets as (
    select case when v_weekly then date_trunc('week', g)::date else g::date end as b
    from generate_series(p_from, p_to, interval '1 day') g
    group by 1
  ),
  series as (
    select b.b, coalesce(sum(i.amount), 0) as revenue
    from buckets b
    left join inv i on i.cur and (case when v_weekly then date_trunc('week', i.d)::date else i.d end) = b.b
    group by b.b
  ),
  consent as (
    select l.retailer_id from retailer_distributor_links l
    where l.distributor_id = p_distributor and l.status = 'active' and l.stock_share_consent_at is not null
  ),
  my as (
    select dp.product_id from distributor_products dp where dp.distributor_id = p_distributor and dp.active
  ),
  sellout as (
    select m.product_id, -sum(m.qty_delta) as units
    from stock_movements m
    where m.kind = 'sale'
      and m.retailer_id in (select retailer_id from consent)
      and m.product_id in (select product_id from my)
      and (m.created_at at time zone 'Europe/Istanbul')::date between p_from and p_to
    group by 1
  ),
  empty_shelves as (
    select count(*) as n
    from stock_levels s
    where s.retailer_id in (select retailer_id from consent)
      and s.product_id in (select product_id from my)
      and s.qty_units = 0
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'weekly', v_weekly,
    'kpis', (select jsonb_build_object(
        'revenue', round(k.revenue, 2), 'prev_revenue', round(k.prev_revenue, 2),
        'change_pct', case when k.prev_revenue > 0 then round(100 * (k.revenue - k.prev_revenue) / k.prev_revenue, 1) end,
        'deliveries', k.deliveries, 'active_markets', k.active_markets,
        'linked_markets', (select count(*) from retailer_distributor_links where distributor_id = p_distributor and status = 'active'),
        'avg_order', case when k.deliveries > 0 then round(k.revenue / k.deliveries, 2) end,
        'collected', round(pay.collected, 2),
        'approved_orders', ko.approved_orders, 'market_orders', ko.market_orders,
        'offers_sent', ko.offers_sent, 'offers_accepted', ko.offers_accepted,
        'offer_accept_pct', case when ko.offers_answered > 0 then round(100.0 * ko.offers_accepted / ko.offers_answered, 0) end,
        'empty_shelves', (select n from empty_shelves))
      from k, ko, pay),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('d', b, 'revenue', round(revenue, 2)) order by b), '[]') from series),
    'top_products', (select coalesce(jsonb_agg(t order by t.revenue desc), '[]') from (
        select p.name, sum(l.cases) as cases, round(sum(l.revenue), 2) as revenue
        from lines l join products p on p.id = l.product_id
        group by p.id, p.name order by sum(l.revenue) desc limit 10) t),
    'top_markets', (select coalesce(jsonb_agg(t order by t.revenue desc), '[]') from (
        select o.name, count(*) as deliveries, round(sum(i.amount), 2) as revenue
        from inv i join organizations o on o.id = i.retailer_id
        where i.cur
        group by o.id, o.name order by sum(i.amount) desc limit 10) t),
    'sellout', (select coalesce(jsonb_agg(t order by t.cases desc), '[]') from (
        select p.name, s.units, round(s.units::numeric / p.case_qty, 1) as cases
        from sellout s join products p on p.id = s.product_id
        order by s.units::numeric / p.case_qty desc limit 10) t),
    'sellout_markets', (select count(*) from consent)
  ) into v_result;
  return v_result;
end;
$$;
revoke execute on function public.distributor_report(uuid, date, date) from public, anon;
grant execute on function public.distributor_report(uuid, date, date) to authenticated;
