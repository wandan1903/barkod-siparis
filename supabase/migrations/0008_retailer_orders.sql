-- Market (bakkal) distribütöre kendisi sipariş verebilsin.
--
-- origin = 'offer' : distribütör öneri/teklif gönderdi, market onaylar.
-- origin = 'order' : market sipariş verdi, distribütör onaylar.

alter table public.orders add column origin text not null default 'offer'
  check (origin in ('offer', 'order'));

-- Sipariş yalnızca aktif çalışma ilişkisi olan market–distribütör arasında açılabilir
drop policy orders_insert on public.orders;
create policy orders_insert on public.orders for insert
  with check (
    (private.is_member(retailer_id) or private.is_member(distributor_id))
    and exists (select 1 from public.retailer_distributor_links l
                where l.retailer_id = orders.retailer_id
                  and l.distributor_id = orders.distributor_id
                  and l.status = 'active')
  );

-- Durum geçişleri, siparişin kaynağına göre
--   Teklif (offer):  Distribütör draft→sent, changes_requested→sent, approved→shipped
--                    Market      sent→approved | rejected | changes_requested, shipped→delivered
--   Sipariş (order): Distribütör sent→approved | rejected, approved→shipped
--                    Market      sent→rejected (iptal), shipped→delivered
create or replace function private.order_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_dist boolean;
  v_ret boolean;
  v_ok boolean;
begin
  new.total := (select coalesce(sum(cases * case_price), 0) from order_lines where order_id = new.id);

  if tg_op = 'UPDATE' then
    if new.retailer_id <> old.retailer_id or new.distributor_id <> old.distributor_id then
      raise exception 'Siparişin tarafları değiştirilemez';
    end if;
    if new.origin <> old.origin then
      raise exception 'Siparişin kaynağı değiştirilemez';
    end if;

    if v_uid is not null and new.status <> old.status then
      v_dist := private.is_member(new.distributor_id);
      v_ret  := private.is_member(new.retailer_id);
      if new.origin = 'offer' then
        v_ok := (v_dist and (old.status, new.status) in (('draft','sent'), ('changes_requested','sent'), ('approved','shipped')))
             or (v_ret  and (old.status, new.status) in (('sent','approved'), ('sent','rejected'), ('sent','changes_requested'), ('shipped','delivered')));
      else
        v_ok := (v_dist and (old.status, new.status) in (('sent','approved'), ('sent','rejected'), ('approved','shipped')))
             or (v_ret  and (old.status, new.status) in (('sent','rejected'), ('shipped','delivered')));
      end if;
      if not v_ok then
        raise exception 'Bu durum değişikliğine izin yok: % → %', old.status, new.status;
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.order_guard() from public, anon, authenticated;

-- create_order: çağıran distribütörse teklif, marketse sipariş olur
create or replace function public.create_order(
  p_retailer uuid, p_distributor uuid, p_lines jsonb,
  p_status public.order_status default 'sent', p_delivery date default null, p_note text default null
)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
  v_origin text;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Sipariş satırı yok';
  end if;
  if not exists (select 1 from retailer_distributor_links
                 where retailer_id = p_retailer and distributor_id = p_distributor and status = 'active') then
    raise exception 'Bu market ile distribütör arasında aktif bir çalışma ilişkisi yok';
  end if;

  v_origin := case when private.is_member(p_distributor) then 'offer' else 'order' end;

  insert into orders (retailer_id, distributor_id, status, delivery_date, note, created_by, origin)
  values (p_retailer, p_distributor, p_status, p_delivery, p_note, auth.uid(), v_origin)
  returning id into v_id;

  insert into order_lines (order_id, product_id, cases, case_price, suggested_cases, campaign_id)
  select v_id, (l->>'product_id')::uuid, (l->>'cases')::int, 0,
         nullif(l->>'suggested_cases', '')::int, nullif(l->>'campaign_id', '')::uuid
  from jsonb_array_elements(p_lines) l
  join distributor_products dp
    on dp.distributor_id = p_distributor and dp.product_id = (l->>'product_id')::uuid and dp.active
  where (l->>'cases')::int > 0;

  if not found then
    raise exception 'Geçerli ürün satırı yok';
  end if;

  return v_id;
end;
$$;

-- respond_order yalnızca distribütör tekliflerine market yanıtı içindir
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
  if v_order.origin <> 'offer' then
    raise exception 'Bu kendi siparişiniz; onayı distribütör verir';
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

-- Market sipariş ekranı: bağlı distribütörün kataloğu + benim stoğum + öneri
create or replace function public.retailer_order_catalog(p_retailer uuid, p_distributor uuid, p_weeks integer default 4)
returns table (
  product_id uuid, product_name text, gtin text, case_qty integer, case_price numeric,
  stock_units integer, stock_cases numeric, weekly_cases numeric, days_left numeric, suggested_cases integer
)
language sql stable security invoker set search_path = public as $$
  with sold as (
    select product_id, (-sum(qty_delta))::numeric as units
    from stock_movements
    where retailer_id = p_retailer and kind = 'sale'
      and created_at >= now() - make_interval(weeks => p_weeks)
    group by 1
  ),
  base as (
    select dp.product_id, p.name, p.gtin, p.case_qty, dp.case_price,
           coalesce(s.qty_units, 0) as units,
           coalesce(s.qty_units, 0)::numeric / p.case_qty as stock_c,
           coalesce(so.units, 0) / p_weeks / p.case_qty as weekly_c
    from distributor_products dp
    join products p on p.id = dp.product_id
    left join stock_levels s on s.retailer_id = p_retailer and s.product_id = dp.product_id
    left join sold so on so.product_id = dp.product_id
    where dp.distributor_id = p_distributor and dp.active
  )
  select product_id, name, gtin, case_qty, case_price, units,
         round(stock_c, 1), round(weekly_c, 1),
         case when weekly_c = 0 then null else round(stock_c / (weekly_c / 7), 1) end,
         greatest(0, ceil(weekly_c + weekly_c / 7 * 2 - stock_c))::integer
  from base;
$$;
revoke execute on function public.retailer_order_catalog(uuid, uuid, integer) from public, anon;
grant execute on function public.retailer_order_catalog(uuid, uuid, integer) to authenticated;
