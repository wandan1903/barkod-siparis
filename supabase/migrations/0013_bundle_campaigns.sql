-- Kampanya yönetimi: ürün kampanyası ve paket (bundle) kampanyası
--  * campaigns.kind: 'product' (tek ürün, kampanyalı koli fiyatı) | 'bundle' (birden çok ürün, paket fiyatı)
--  * campaign_items: paket içeriği (ürün, koli adedi, paket içindeki koli fiyatı)
--  * create_campaign(): kampanyayı, hedef marketleri ve bildirimleri tek işlemde oluşturur
--  * add_bundle_to_order(): marketin teklife paketi eklemesi
--  * Fiyat kuralı: kampanyalı satırın fiyatı sunucuda kampanyadan gelir (istemci değiştiremez)
--  * respond_order: paket tam alınmadıysa ya da kampanya asgari adedinin altına inildiyse onay verilmez

alter table public.campaigns alter column product_id drop not null;
alter table public.campaigns add column kind text not null default 'product' check (kind in ('product', 'bundle'));
alter table public.campaigns add constraint campaigns_product_required check (kind = 'bundle' or product_id is not null);
alter table public.campaigns add constraint campaigns_dates_valid check (ends_at > starts_at);

create table public.campaign_items (
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  product_id   uuid not null references public.products(id),
  cases        integer not null check (cases > 0),
  case_price   numeric(12,2) not null check (case_price > 0),
  primary key (campaign_id, product_id)
);
alter table public.campaign_items enable row level security;

-- Marketin kampanyayı görme kuralı (campaigns politikasıyla aynı), RLS'e takılmayan yardımcı
create or replace function private.can_see_campaign(p_campaign uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from campaigns c
    where c.id = p_campaign
      and (private.is_member(c.distributor_id)
           or (private.is_linked_retailer_of(c.distributor_id)
               and (c.target <> 'selected' or private.is_campaign_target(c.id))))
  );
$$;
revoke all on function private.can_see_campaign(uuid) from public;
grant execute on function private.can_see_campaign(uuid) to authenticated;

create policy ci_dist_all on public.campaign_items for all
  using (private.is_campaign_owner(campaign_id)) with check (private.is_campaign_owner(campaign_id));
create policy ci_retailer_read on public.campaign_items for select
  using (private.can_see_campaign(campaign_id));

create index if not exists idx_campaign_items_product on public.campaign_items (product_id);
create index if not exists idx_order_lines_campaign on public.order_lines (campaign_id) where campaign_id is not null;

-- ---------------------------------------------------------------------------
-- Satır fiyatı: ürün kampanyasında kampanya fiyatı, pakette paket içi ürün fiyatı
-- ---------------------------------------------------------------------------
create or replace function private.order_line_price_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_price numeric;
  v_campaign_price numeric;
  v_kind text;
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
      select c.kind into v_kind
      from campaigns c join orders o on o.id = new.order_id
      where c.id = new.campaign_id
        and c.distributor_id = o.distributor_id
        and now() between c.starts_at and c.ends_at
        and (c.target <> 'selected' or exists (
              select 1 from campaign_targets t where t.campaign_id = c.id and t.retailer_id = o.retailer_id));

      if v_kind = 'product' then
        select c.case_price into v_campaign_price
        from campaigns c where c.id = new.campaign_id and c.product_id = new.product_id;
      elsif v_kind = 'bundle' then
        select ci.case_price into v_campaign_price
        from campaign_items ci where ci.campaign_id = new.campaign_id and ci.product_id = new.product_id;
      end if;

      if v_campaign_price is null then
        new.campaign_id := null;  -- geçersiz ya da süresi dolmuş kampanya: normal fiyat
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

-- ---------------------------------------------------------------------------
-- Kampanya oluşturma
--  p_items (paket): [{"product_id": "...", "cases": 2, "case_price": 120.00}, ...]
-- ---------------------------------------------------------------------------
create or replace function public.create_campaign(
  p_distributor uuid,
  p_kind text,
  p_title text,
  p_product uuid,
  p_case_price numeric,
  p_min_cases integer,
  p_items jsonb,
  p_target public.campaign_target,
  p_retailers uuid[],
  p_starts timestamptz,
  p_ends timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_normal numeric;
  v_item record;
  v_body text;
  v_rid uuid;
  v_name text;
begin
  if not private.is_member(p_distributor) then
    raise exception 'Bu distribütör adına işlem yetkiniz yok';
  end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Kampanya adı gerekli'; end if;
  if p_ends <= p_starts then raise exception 'Bitiş tarihi başlangıçtan sonra olmalı'; end if;
  if p_ends <= now() then raise exception 'Bitiş tarihi geçmişte olamaz'; end if;
  if p_kind not in ('product', 'bundle') then raise exception 'Geçersiz kampanya türü'; end if;
  if p_target = 'selected' and coalesce(array_length(p_retailers, 1), 0) = 0 then
    raise exception 'Seçili marketler için en az bir market seçin';
  end if;

  select name into v_name from organizations where id = p_distributor;

  if p_kind = 'product' then
    select dp.case_price into v_normal
    from distributor_products dp
    where dp.distributor_id = p_distributor and dp.product_id = p_product and dp.active;
    if v_normal is null then raise exception 'Ürün kataloğunuzda yok'; end if;
    if p_case_price is null or p_case_price <= 0 then raise exception 'Kampanya fiyatı girin'; end if;
    if p_case_price >= v_normal then raise exception 'Kampanya fiyatı normal koli fiyatından düşük olmalı'; end if;

    insert into campaigns (distributor_id, kind, product_id, title, case_price, rule, target, starts_at, ends_at)
    values (p_distributor, 'product', p_product, trim(p_title), p_case_price,
            jsonb_build_object('min_cases', greatest(coalesce(p_min_cases, 1), 1)), p_target, p_starts, p_ends)
    returning id into v_id;

    v_body := (select name from products where id = p_product) || ': koli ' || translate(to_char(p_case_price, 'FM999G999D00'), ',.', '.,')
              || ' TL (normalde ' || translate(to_char(v_normal, 'FM999G999D00'), ',.', '.,') || ' TL)';
  else
    if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 2 then
      raise exception 'Paket en az iki ürün içermeli';
    end if;
    insert into campaigns (distributor_id, kind, product_id, title, case_price, rule, target, starts_at, ends_at)
    values (p_distributor, 'bundle', null, trim(p_title), null, '{}', p_target, p_starts, p_ends)
    returning id into v_id;

    for v_item in
      select (i->>'product_id')::uuid as product_id, (i->>'cases')::int as cases, (i->>'case_price')::numeric as case_price
      from jsonb_array_elements(p_items) i
    loop
      select dp.case_price into v_normal
      from distributor_products dp
      where dp.distributor_id = p_distributor and dp.product_id = v_item.product_id and dp.active;
      if v_normal is null then raise exception 'Paketteki bir ürün kataloğunuzda yok'; end if;
      if v_item.cases is null or v_item.cases <= 0 then raise exception 'Paket ürünlerinin koli adedi 1 veya daha fazla olmalı'; end if;
      if v_item.case_price is null or v_item.case_price <= 0 or v_item.case_price > v_normal then
        raise exception 'Paket içi koli fiyatı 0''dan büyük ve normal fiyattan yüksek olmayan bir değer olmalı';
      end if;
      insert into campaign_items (campaign_id, product_id, cases, case_price)
      values (v_id, v_item.product_id, v_item.cases, v_item.case_price);
    end loop;

    v_body := jsonb_array_length(p_items) || ' ürünlük paket';
  end if;

  if p_target = 'selected' then
    insert into campaign_targets (campaign_id, retailer_id)
    select v_id, r from unnest(p_retailers) r
    where exists (select 1 from retailer_distributor_links l
                  where l.retailer_id = r and l.distributor_id = p_distributor and l.status = 'active')
    on conflict do nothing;
  end if;

  -- Bildirim: hedef marketler
  for v_rid in
    select l.retailer_id
    from retailer_distributor_links l
    where l.distributor_id = p_distributor and l.status = 'active'
      and (
        p_target = 'all'
        or (p_target = 'selected' and exists (select 1 from campaign_targets t where t.campaign_id = v_id and t.retailer_id = l.retailer_id))
        or (p_target = 'low_stock' and p_kind = 'product' and exists (
              select 1 from retailer_stock_overview(l.retailer_id) o
              where o.product_id = p_product and o.days_left is not null and o.days_left <= 7))
        or (p_target = 'low_stock' and p_kind = 'bundle')
      )
  loop
    perform private.notify(
      v_rid, 'campaign', v_name || ': ' || trim(p_title),
      v_body || ' · ' || to_char(p_ends at time zone 'Europe/Istanbul', 'DD.MM.YYYY') || ' tarihine kadar',
      '/market/teklifler', 'camp:' || v_id || ':' || v_rid
    );
  end loop;

  return v_id;
end;
$$;
revoke execute on function public.create_campaign(uuid, text, text, uuid, numeric, integer, jsonb, public.campaign_target, uuid[], timestamptz, timestamptz) from public, anon;
grant execute on function public.create_campaign(uuid, text, text, uuid, numeric, integer, jsonb, public.campaign_target, uuid[], timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Market: teklife paket ekle (paketteki ürünler zaten satırdaysa paket fiyatlı satırla değişir)
-- ---------------------------------------------------------------------------
create or replace function public.add_bundle_to_order(p_order uuid, p_campaign uuid)
returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_order orders;
begin
  select * into v_order from orders where id = p_order for update;
  if not found or not private.is_member(v_order.retailer_id) then
    raise exception 'Sipariş bulunamadı';
  end if;
  if v_order.status <> 'sent' or v_order.origin <> 'offer' then
    raise exception 'Bu teklife artık paket eklenemez';
  end if;
  if not exists (
    select 1 from campaigns c
    where c.id = p_campaign and c.kind = 'bundle' and c.distributor_id = v_order.distributor_id
      and now() between c.starts_at and c.ends_at
  ) then
    raise exception 'Kampanya geçerli değil';
  end if;

  delete from order_lines
   where order_id = p_order
     and product_id in (select product_id from campaign_items where campaign_id = p_campaign);

  insert into order_lines (order_id, product_id, cases, case_price, campaign_id)
  select p_order, ci.product_id, ci.cases, 0, p_campaign
  from campaign_items ci where ci.campaign_id = p_campaign;
end;
$$;
revoke execute on function public.add_bundle_to_order(uuid, uuid) from public, anon;
grant execute on function public.add_bundle_to_order(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Onayda kampanya koşulları
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

    -- Paket kampanyası: paketteki her üründen gereken adet alınmalı
    if exists (
      select 1
      from (select distinct ol.campaign_id from order_lines ol
            join campaigns c on c.id = ol.campaign_id and c.kind = 'bundle'
            where ol.order_id = p_order) used
      join campaign_items ci on ci.campaign_id = used.campaign_id
      left join order_lines x on x.order_id = p_order and x.product_id = ci.product_id
      where coalesce(x.cases, 0) < ci.cases
    ) then
      raise exception 'Paket kampanyasından yararlanmak için paketteki tüm ürünlerden gereken koli adedini almalısınız';
    end if;

    -- Ürün kampanyası: asgari koli adedi
    if exists (
      select 1 from order_lines ol
      join campaigns c on c.id = ol.campaign_id and c.kind = 'product'
      where ol.order_id = p_order and ol.cases < coalesce((c.rule->>'min_cases')::int, 1)
    ) then
      raise exception 'Kampanyalı üründe asgari koli adedinin altına inilemez';
    end if;

    update orders set status = 'approved' where id = p_order;
  elsif p_action = 'reject' then
    update orders set status = 'rejected' where id = p_order;
  else
    raise exception 'Geçersiz işlem';
  end if;
end;
$$;
