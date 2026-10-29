-- Distribütör paneli için veritabanı fonksiyonları.
-- Hepsi SECURITY INVOKER: çağıran kullanıcının RLS kuralları geçerlidir,
-- yani distribütör bu fonksiyonlarla da raf fiyatını veya başkasının ürününü göremez.

-- 1) Genel bakış: bağlı marketlerde benim ürünlerimin stok durumu ve öneri
create or replace function public.distributor_stock_overview(p_distributor uuid, p_weeks integer default 4)
returns table (
  retailer_id uuid, retailer_name text, district text,
  product_id uuid, product_name text, gtin text, case_qty integer, case_price numeric,
  stock_cases numeric, weekly_cases numeric, days_left numeric, suggested_cases integer,
  stock_source public.stock_source, stock_updated_at timestamptz
)
language sql stable security invoker set search_path = public as $$
  with my as (
    select dp.product_id, dp.case_price, p.name, p.gtin, p.case_qty
    from distributor_products dp join products p on p.id = dp.product_id
    where dp.distributor_id = p_distributor and dp.active
  ),
  links as (
    select l.retailer_id, o.name, o.district
    from retailer_distributor_links l join organizations o on o.id = l.retailer_id
    where l.distributor_id = p_distributor and l.status = 'active'
  ),
  sold as (
    select m.retailer_id, m.product_id, (-sum(m.qty_delta))::numeric as units
    from stock_movements m
    where m.kind = 'sale'
      and m.created_at >= now() - make_interval(weeks => p_weeks)
      and m.product_id in (select product_id from my)
    group by 1, 2
  ),
  base as (
    select l.retailer_id, l.name as retailer_name, l.district,
           my.product_id, my.name as product_name, my.gtin, my.case_qty, my.case_price,
           s.qty_units::numeric / my.case_qty                        as stock_c,
           coalesce(so.units, 0) / p_weeks / my.case_qty             as weekly_c,
           s.source, s.updated_at
    from links l
    cross join my
    join stock_levels s on s.retailer_id = l.retailer_id and s.product_id = my.product_id
    left join sold so on so.retailer_id = l.retailer_id and so.product_id = my.product_id
  )
  select retailer_id, retailer_name, district, product_id, product_name, gtin, case_qty, case_price,
         round(stock_c, 1),
         round(weekly_c, 1),
         case when weekly_c = 0 then null else round(stock_c / (weekly_c / 7), 1) end,
         greatest(0, ceil(weekly_c + weekly_c / 7 * 2 - stock_c))::integer,
         source, updated_at
  from base;
$$;

-- 2) Bir markette bir ürünün haftalık satışı (koli), son N hafta
create or replace function public.weekly_sales(p_retailer uuid, p_product uuid, p_weeks integer default 6)
returns table (week_start date, cases numeric)
language sql stable security invoker set search_path = public as $$
  with weeks as (
    select (date_trunc('week', now()) - make_interval(weeks => g))::date as week_start
    from generate_series(p_weeks - 1, 0, -1) g
  ),
  q as (select case_qty from products where id = p_product)
  select w.week_start,
         round(coalesce((
           select -sum(m.qty_delta) from stock_movements m
           where m.retailer_id = p_retailer and m.product_id = p_product and m.kind = 'sale'
             and m.created_at >= w.week_start and m.created_at < w.week_start + 7
         ), 0)::numeric / (select case_qty from q), 1)
  from weeks w order by w.week_start;
$$;

-- 3) Sipariş/teklif oluşturma: koli fiyatı istemciden değil, distribütör kataloğundan alınır
create or replace function public.create_order(
  p_retailer uuid, p_distributor uuid, p_lines jsonb,
  p_status public.order_status default 'sent', p_delivery date default null, p_note text default null
)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Sipariş satırı yok';
  end if;

  insert into orders (retailer_id, distributor_id, status, delivery_date, note, created_by)
  values (p_retailer, p_distributor, p_status, p_delivery, p_note, auth.uid())
  returning id into v_id;

  insert into order_lines (order_id, product_id, cases, case_price, suggested_cases, campaign_id)
  select v_id, (l->>'product_id')::uuid, (l->>'cases')::int, dp.case_price,
         nullif(l->>'suggested_cases', '')::int, nullif(l->>'campaign_id', '')::uuid
  from jsonb_array_elements(p_lines) l
  join distributor_products dp
    on dp.distributor_id = p_distributor and dp.product_id = (l->>'product_id')::uuid and dp.active
  where (l->>'cases')::int > 0;

  if not found then
    raise exception 'Geçerli ürün satırı yok';
  end if;

  update orders set total = (select coalesce(sum(cases * case_price), 0) from order_lines where order_id = v_id)
  where id = v_id;

  return v_id;
end;
$$;

revoke execute on function public.distributor_stock_overview(uuid, integer) from public, anon;
revoke execute on function public.weekly_sales(uuid, uuid, integer) from public, anon;
revoke execute on function public.create_order(uuid, uuid, jsonb, public.order_status, date, text) from public, anon;
grant execute on function public.distributor_stock_overview(uuid, integer) to authenticated;
grant execute on function public.weekly_sales(uuid, uuid, integer) to authenticated;
grant execute on function public.create_order(uuid, uuid, jsonb, public.order_status, date, text) to authenticated;

-- 4) Ürün kataloğu: distribütör Excel/CSV ile yeni ürün ekleyebilsin (güncelleyemez, silemez)
create policy products_insert_by_distributor on public.products for insert
  with check (exists (
    select 1 from public.memberships m join public.organizations o on o.id = m.org_id
    where m.user_id = (select auth.uid()) and o.type = 'distributor'
  ));
