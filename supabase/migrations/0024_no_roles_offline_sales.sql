-- 1) Rol ayrımı kaldırıldı: kuruluşa bağlı her kullanıcı firma bilgilerini de güncelleyebilir
-- 2) İnternetsiz satış: cihazda bekletilen satışlar internet gelince gönderilir.
--    client_ref sayesinde aynı satış iki kez yazılmaz; satış saati cihazdaki gerçek saat olur.

create or replace function public.update_org_profile(
  p_org uuid, p_name text, p_tax_no text default null, p_city text default null, p_district text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not private.is_member(p_org) then
    raise exception 'Bu kuruluş adına işlem yetkiniz yok';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'Firma adı boş olamaz';
  end if;
  if nullif(trim(p_tax_no), '') is not null and trim(p_tax_no) !~ '^[0-9]{10,11}$' then
    raise exception 'Vergi / TC kimlik numarası 10 ya da 11 haneli olmalı';
  end if;
  update organizations
     set name = left(trim(p_name), 120),
         tax_no = nullif(trim(p_tax_no), ''),
         city = left(nullif(trim(p_city), ''), 80),
         district = left(nullif(trim(p_district), ''), 80)
   where id = p_org;
end;
$$;

alter table public.sales add column client_ref text;
create unique index uq_sales_client_ref on public.sales (retailer_id, client_ref) where client_ref is not null;

create or replace function public.record_sale_offline(
  p_retailer uuid, p_lines jsonb, p_client_ref text, p_sold_at timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_sale uuid;
  v_at timestamptz;
begin
  if not private.is_member(p_retailer)
     or not exists (select 1 from organizations where id = p_retailer and type = 'retailer') then
    raise exception 'Bu market adına işlem yetkiniz yok';
  end if;
  if p_client_ref is null or length(p_client_ref) < 8 or length(p_client_ref) > 64 then
    raise exception 'Geçersiz satış kimliği';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Sepet boş';
  end if;

  -- daha önce gönderildiyse aynı satışı döndür (tekrar yazma)
  select id into v_sale from sales where retailer_id = p_retailer and client_ref = p_client_ref;
  if found then
    return v_sale;
  end if;

  -- saat: gelecekte olamaz, 30 günden eski olamaz
  v_at := least(now(), greatest(coalesce(p_sold_at, now()), now() - interval '30 days'));

  begin
    insert into sales (retailer_id, client_ref, created_at) values (p_retailer, p_client_ref, v_at)
    returning id into v_sale;
  exception when unique_violation then
    -- aynı anda iki gönderim: ilki kazandı
    select id into v_sale from sales where retailer_id = p_retailer and client_ref = p_client_ref;
    return v_sale;
  end;

  insert into sale_lines (sale_id, product_id, qty_units, unit_price)
  select v_sale, (l->>'product_id')::uuid, sum((l->>'qty_units')::int), coalesce(max(rp.shelf_price), 0)
  from jsonb_array_elements(p_lines) l
  join products p on p.id = (l->>'product_id')::uuid
  left join retailer_prices rp on rp.retailer_id = p_retailer and rp.product_id = (l->>'product_id')::uuid
  where (l->>'qty_units')::int > 0
  group by (l->>'product_id')::uuid;

  if not found then
    raise exception 'Geçerli ürün yok';
  end if;

  update sales set total = (select coalesce(sum(qty_units * unit_price), 0) from sale_lines where sale_id = v_sale)
  where id = v_sale;

  insert into stock_movements (retailer_id, product_id, qty_delta, kind, created_at)
  select p_retailer, product_id, -qty_units, 'sale', v_at from sale_lines where sale_id = v_sale;

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
revoke execute on function public.record_sale_offline(uuid, jsonb, text, timestamptz) from public, anon;
grant execute on function public.record_sale_offline(uuid, jsonb, text, timestamptz) to authenticated;
