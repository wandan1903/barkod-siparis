-- Kampanyalı satırda koli fiyatı kampanyadan gelir (kampanya geçerliyse ve aynı distribütör/ürün içinse).
create or replace function private.order_line_price_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_price numeric;
  v_campaign_price numeric;
begin
  if tg_op = 'INSERT' then
    select dp.case_price into v_price
    from orders o
    join distributor_products dp on dp.distributor_id = o.distributor_id and dp.product_id = new.product_id
    where o.id = new.order_id;
    if v_price is null then
      raise exception 'Bu ürün distribütörün kataloğunda yok';
    end if;

    if new.campaign_id is not null then
      select c.case_price into v_campaign_price
      from campaigns c join orders o on o.id = new.order_id
      where c.id = new.campaign_id
        and c.distributor_id = o.distributor_id
        and c.product_id = new.product_id
        and now() between c.starts_at and c.ends_at;
      if not found then
        new.campaign_id := null;  -- geçersiz kampanya: normal fiyat
      end if;
    end if;

    new.case_price := coalesce(v_campaign_price, v_price);
  elsif new.case_price is distinct from old.case_price then
    raise exception 'Sipariş satırının fiyatı değiştirilemez';
  end if;
  return new;
end;
$$;
revoke all on function private.order_line_price_guard() from public, anon, authenticated;
