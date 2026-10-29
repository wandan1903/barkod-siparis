-- Market (bakkal) tarafı: satış, teklif yanıtı, mal kabul, sayım ve koruma kuralları

-- ---------------------------------------------------------------------------
-- A) Sipariş güvenliği
-- ---------------------------------------------------------------------------

-- A1) Sipariş satırının koli fiyatı HER ZAMAN distribütör kataloğundan gelir; sonradan değiştirilemez.
create or replace function private.order_line_price_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_price numeric;
begin
  if tg_op = 'INSERT' then
    select dp.case_price into v_price
    from orders o
    join distributor_products dp on dp.distributor_id = o.distributor_id and dp.product_id = new.product_id
    where o.id = new.order_id;
    if v_price is null then
      raise exception 'Bu ürün distribütörün kataloğunda yok';
    end if;
    new.case_price := v_price;
  elsif new.case_price is distinct from old.case_price then
    raise exception 'Sipariş satırının fiyatı değiştirilemez';
  end if;
  return new;
end;
$$;

create trigger order_lines_price_guard
before insert or update on public.order_lines
for each row execute function private.order_line_price_guard();

-- A2) Sipariş toplamı her zaman satırlardan hesaplanır
create or replace function private.order_total_refresh()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update orders set updated_at = now()
  where id = coalesce(new.order_id, old.order_id);
  return null;
end;
$$;

create trigger order_lines_total_refresh
after insert or update or delete on public.order_lines
for each row execute function private.order_total_refresh();

-- A3) Durum geçişleri: kim neyi yapabilir
--   Distribütör: draft→sent, changes_requested→sent, approved→shipped
--   Market     : sent→approved | rejected | changes_requested, shipped→delivered
create or replace function private.order_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_dist boolean;
  v_ret boolean;
begin
  new.total := (select coalesce(sum(cases * case_price), 0) from order_lines where order_id = new.id);

  if tg_op = 'UPDATE' then
    if new.retailer_id <> old.retailer_id or new.distributor_id <> old.distributor_id then
      raise exception 'Siparişin tarafları değiştirilemez';
    end if;

    if v_uid is not null and new.status <> old.status then
      v_dist := private.is_member(new.distributor_id);
      v_ret  := private.is_member(new.retailer_id);
      if not (
        (v_dist and (old.status, new.status) in (('draft','sent'), ('changes_requested','sent'), ('approved','shipped')))
        or
        (v_ret and (old.status, new.status) in (('sent','approved'), ('sent','rejected'), ('sent','changes_requested'), ('shipped','delivered')))
      ) then
        raise exception 'Bu durum değişikliğine izin yok: % → %', old.status, new.status;
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger orders_guard
before insert or update on public.orders
for each row execute function private.order_guard();

revoke all on function private.order_line_price_guard() from public, anon, authenticated;
revoke all on function private.order_total_refresh() from public, anon, authenticated;
revoke all on function private.order_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- B) Market stok özeti
-- ---------------------------------------------------------------------------
create or replace function public.retailer_stock_overview(p_retailer uuid, p_weeks integer default 4)
returns table (
  product_id uuid, product_name text, gtin text, case_qty integer,
  stock_units integer, stock_cases numeric, weekly_units numeric, days_left numeric,
  shelf_price numeric, distributor_names text, stock_updated_at timestamptz
)
language sql stable security invoker set search_path = public as $$
  with sold as (
    select product_id, (-sum(qty_delta))::numeric as units
    from stock_movements
    where retailer_id = p_retailer and kind = 'sale'
      and created_at >= now() - make_interval(weeks => p_weeks)
    group by 1
  ),
  dists as (
    select dp.product_id, string_agg(distinct o.name, ', ') as names
    from retailer_distributor_links l
    join distributor_products dp on dp.distributor_id = l.distributor_id and dp.active
    join organizations o on o.id = l.distributor_id
    where l.retailer_id = p_retailer and l.status = 'active'
    group by 1
  )
  select s.product_id, p.name, p.gtin, p.case_qty,
         s.qty_units,
         round(s.qty_units::numeric / p.case_qty, 1),
         round(coalesce(so.units, 0) / p_weeks, 1),
         case when coalesce(so.units, 0) = 0 then null
              else round(s.qty_units / (so.units / (p_weeks * 7.0)), 1) end,
         rp.shelf_price,
         d.names,
         s.updated_at
  from stock_levels s
  join products p on p.id = s.product_id
  left join sold so on so.product_id = s.product_id
  left join retailer_prices rp on rp.retailer_id = s.retailer_id and rp.product_id = s.product_id
  left join dists d on d.product_id = s.product_id
  where s.retailer_id = p_retailer;
$$;

-- ---------------------------------------------------------------------------
-- C) Satış kaydı: tek işlemde fiş, satırlar, stok hareketi ve stok
--    p_lines: [{"product_id": "...", "qty_units": 2}]
-- ---------------------------------------------------------------------------
create or replace function public.record_sale(p_retailer uuid, p_lines jsonb, p_pos_ref text default null)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_sale uuid;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Sepet boş';
  end if;

  insert into sales (retailer_id, pos_ref) values (p_retailer, p_pos_ref) returning id into v_sale;

  insert into sale_lines (sale_id, product_id, qty_units, unit_price)
  select v_sale, (l->>'product_id')::uuid, sum((l->>'qty_units')::int),
         coalesce(max(rp.shelf_price), 0)
  from jsonb_array_elements(p_lines) l
  left join retailer_prices rp on rp.retailer_id = p_retailer and rp.product_id = (l->>'product_id')::uuid
  where (l->>'qty_units')::int > 0
  group by (l->>'product_id')::uuid;

  update sales set total = (select coalesce(sum(qty_units * unit_price), 0) from sale_lines where sale_id = v_sale)
  where id = v_sale;

  insert into stock_movements (retailer_id, product_id, qty_delta, kind)
  select p_retailer, product_id, -qty_units, 'sale' from sale_lines where sale_id = v_sale;

  insert into stock_levels (retailer_id, product_id, qty_units, source, updated_at)
  select p_retailer, product_id, 0, 'app', now() from sale_lines where sale_id = v_sale
  on conflict (retailer_id, product_id) do nothing;

  update stock_levels s
     set qty_units = greatest(0, s.qty_units - sl.qty_units), updated_at = now()
    from sale_lines sl
   where sl.sale_id = v_sale and s.retailer_id = p_retailer and s.product_id = sl.product_id;

  return v_sale;
end;
$$;

-- ---------------------------------------------------------------------------
-- D) Teklife yanıt: onayla (adetleri değiştirerek de olabilir) ya da reddet
--    p_lines: [{"product_id": "...", "cases": 40}]  (yalnızca onayda)
-- ---------------------------------------------------------------------------
create or replace function public.respond_order(p_order uuid, p_action text, p_lines jsonb default null)
returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_order orders;
begin
  select * into v_order from orders where id = p_order for update;
  if not found or not private.is_member(v_order.retailer_id) then
    raise exception 'Sipariş bulunamadı';
  end if;
  if v_order.status <> 'sent' then
    raise exception 'Bu teklif artık yanıtlanamaz';
  end if;

  if p_action = 'approve' then
    if p_lines is not null then
      update order_lines ol
         set cases = greatest(0, (l->>'cases')::int)
        from jsonb_array_elements(p_lines) l
       where ol.order_id = p_order and ol.product_id = (l->>'product_id')::uuid;
      delete from order_lines where order_id = p_order and cases = 0;
    end if;
    if not exists (select 1 from order_lines where order_id = p_order) then
      raise exception 'Onaylanacak ürün kalmadı';
    end if;
    update orders set status = 'approved' where id = p_order;
  elsif p_action = 'reject' then
    update orders set status = 'rejected' where id = p_order;
  else
    raise exception 'Geçersiz işlem';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- E) Mal kabul: teslim alınan koliler stoğa eklenir
--    p_lines: [{"product_id": "...", "accepted_cases": 38}]
-- ---------------------------------------------------------------------------
create or replace function public.receive_order(p_order uuid, p_lines jsonb)
returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_order orders;
begin
  select * into v_order from orders where id = p_order for update;
  if not found or not private.is_member(v_order.retailer_id) then
    raise exception 'Sipariş bulunamadı';
  end if;
  if v_order.status <> 'shipped' then
    raise exception 'Bu sipariş henüz yola çıkmadı';
  end if;

  update order_lines ol
     set accepted_cases = least(ol.cases, greatest(0, coalesce((l->>'accepted_cases')::int, ol.cases)))
    from jsonb_array_elements(p_lines) l
   where ol.order_id = p_order and ol.product_id = (l->>'product_id')::uuid;
  update order_lines set accepted_cases = cases where order_id = p_order and accepted_cases is null;

  insert into stock_movements (retailer_id, product_id, qty_delta, kind, order_id)
  select v_order.retailer_id, ol.product_id, ol.accepted_cases * p.case_qty, 'receipt', p_order
  from order_lines ol join products p on p.id = ol.product_id
  where ol.order_id = p_order and ol.accepted_cases > 0;

  insert into stock_levels (retailer_id, product_id, qty_units, source, updated_at)
  select v_order.retailer_id, ol.product_id, 0, 'app', now()
  from order_lines ol where ol.order_id = p_order
  on conflict (retailer_id, product_id) do nothing;

  update stock_levels s
     set qty_units = s.qty_units + ol.accepted_cases * p.case_qty, updated_at = now()
    from order_lines ol join products p on p.id = ol.product_id
   where ol.order_id = p_order and s.retailer_id = v_order.retailer_id and s.product_id = ol.product_id;

  update orders set status = 'delivered' where id = p_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- F) Stok sayımı: sayılan adet yeni stok olur, fark kayda geçer
--    p_counts: [{"product_id": "...", "qty_units": 120}]
-- ---------------------------------------------------------------------------
create or replace function public.record_count(p_retailer uuid, p_counts jsonb)
returns integer
language plpgsql security invoker set search_path = public as $$
declare
  v_n integer;
begin
  with c as (
    select (x->>'product_id')::uuid as product_id, greatest(0, (x->>'qty_units')::int) as qty
    from jsonb_array_elements(p_counts) x
    where x->>'qty_units' is not null and x->>'qty_units' <> ''
  ),
  diff as (
    select c.product_id, c.qty, c.qty - coalesce(s.qty_units, 0) as delta
    from c left join stock_levels s on s.retailer_id = p_retailer and s.product_id = c.product_id
  ),
  mv as (
    insert into stock_movements (retailer_id, product_id, qty_delta, kind)
    select p_retailer, product_id, delta, 'count_adjust' from diff where delta <> 0
    returning 1
  ),
  up as (
    insert into stock_levels (retailer_id, product_id, qty_units, source, updated_at)
    select p_retailer, product_id, qty, 'count', now() from diff
    on conflict (retailer_id, product_id)
      do update set qty_units = excluded.qty_units, source = 'count', updated_at = now()
    returning 1
  )
  select count(*) into v_n from up;
  return v_n;
end;
$$;

revoke execute on function public.retailer_stock_overview(uuid, integer) from public, anon;
revoke execute on function public.record_sale(uuid, jsonb, text) from public, anon;
revoke execute on function public.respond_order(uuid, text, jsonb) from public, anon;
revoke execute on function public.receive_order(uuid, jsonb) from public, anon;
revoke execute on function public.record_count(uuid, jsonb) from public, anon;
grant execute on function public.retailer_stock_overview(uuid, integer) to authenticated;
grant execute on function public.record_sale(uuid, jsonb, text) to authenticated;
grant execute on function public.respond_order(uuid, text, jsonb) to authenticated;
grant execute on function public.receive_order(uuid, jsonb) to authenticated;
grant execute on function public.record_count(uuid, jsonb) to authenticated;
