-- Distribütör deposu (kendi stoğu)
--  * warehouse_stock: ürün başına depodaki adet (birim cinsinden) ve kritik koli eşiği
--  * warehouse_movements: her giriş/çıkış/sayım kaydı (kim, ne zaman, ne kadar)
--  * public.warehouse_apply(): toplu giriş/çıkış/sayım; tek işlemde, yetki kontrollü
--  * sevkiyata çıkan siparişler, depoda takip edilen ürünlerin stoğunu otomatik düşer

create table public.warehouse_stock (
  distributor_id uuid not null references public.organizations(id) on delete cascade,
  product_id     uuid not null references public.products(id) on delete cascade,
  qty_units      integer not null default 0 check (qty_units >= 0),
  min_cases      integer check (min_cases is null or min_cases >= 0),
  updated_at     timestamptz not null default now(),
  primary key (distributor_id, product_id)
);

create table public.warehouse_movements (
  id             uuid primary key default gen_random_uuid(),
  distributor_id uuid not null references public.organizations(id) on delete cascade,
  product_id     uuid not null references public.products(id) on delete cascade,
  delta_units    integer not null,
  balance_units  integer not null,
  kind           text not null check (kind in ('giris', 'cikis', 'sayim', 'sevkiyat')),
  note           text,
  order_id       uuid references public.orders(id) on delete set null,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
create index idx_wh_mov_dist_time on public.warehouse_movements (distributor_id, created_at desc);
create index idx_wh_mov_product on public.warehouse_movements (product_id);
create index idx_wh_mov_order on public.warehouse_movements (order_id) where order_id is not null;
create index idx_wh_stock_product on public.warehouse_stock (product_id);

alter table public.warehouse_stock enable row level security;
alter table public.warehouse_movements enable row level security;
create policy wh_stock_read on public.warehouse_stock for select using (private.is_member(distributor_id));
create policy wh_mov_read on public.warehouse_movements for select using (private.is_member(distributor_id));
-- yazma yalnızca aşağıdaki fonksiyonlarla

-- Toplu işlem. p_kind: giris | cikis | sayim. p_lines: [{"product_id": "...", "units": 24}]
-- sayim: units = sayılan toplam adet; giris/cikis: units = eklenen/çıkan adet
create or replace function public.warehouse_apply(p_distributor uuid, p_kind text, p_lines jsonb, p_note text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  l jsonb;
  v_prod uuid;
  v_units int;
  v_old int;
  v_new int;
  v_n int := 0;
  v_name text;
begin
  if not private.is_member(p_distributor) then
    raise exception 'Bu distribütör adına işlem yetkiniz yok';
  end if;
  if p_kind not in ('giris', 'cikis', 'sayim') then
    raise exception 'Geçersiz işlem türü';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'İşlenecek ürün yok';
  end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_prod := (l->>'product_id')::uuid;
    v_units := coalesce((l->>'units')::int, 0);
    if v_units < 0 or (v_units = 0 and p_kind <> 'sayim') then
      continue;
    end if;
    if not exists (select 1 from distributor_products dp where dp.distributor_id = p_distributor and dp.product_id = v_prod) then
      raise exception 'Ürün kataloğunuzda yok';
    end if;

    insert into warehouse_stock (distributor_id, product_id, qty_units)
    values (p_distributor, v_prod, 0)
    on conflict do nothing;

    select qty_units into v_old from warehouse_stock
      where distributor_id = p_distributor and product_id = v_prod for update;

    v_new := case p_kind when 'giris' then v_old + v_units
                         when 'cikis' then v_old - v_units
                         else v_units end;
    if v_new < 0 then
      select name into v_name from products where id = v_prod;
      raise exception 'Depoda yeterli ürün yok: % (depoda % adet)', v_name, v_old;
    end if;

    update warehouse_stock set qty_units = v_new, updated_at = now()
      where distributor_id = p_distributor and product_id = v_prod;
    insert into warehouse_movements (distributor_id, product_id, delta_units, balance_units, kind, note, created_by)
    values (p_distributor, v_prod, v_new - v_old, v_new, p_kind, nullif(trim(p_note), ''), auth.uid());
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.warehouse_apply(uuid, text, jsonb, text) from public, anon;
grant execute on function public.warehouse_apply(uuid, text, jsonb, text) to authenticated;

-- Kritik eşik (koli)
create or replace function public.warehouse_set_min(p_distributor uuid, p_product uuid, p_min_cases integer)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not private.is_member(p_distributor) then
    raise exception 'Bu distribütör adına işlem yetkiniz yok';
  end if;
  if not exists (select 1 from distributor_products dp where dp.distributor_id = p_distributor and dp.product_id = p_product) then
    raise exception 'Ürün kataloğunuzda yok';
  end if;
  insert into warehouse_stock (distributor_id, product_id, qty_units, min_cases)
  values (p_distributor, p_product, 0, p_min_cases)
  on conflict (distributor_id, product_id) do update set min_cases = excluded.min_cases, updated_at = now();
end;
$$;
revoke execute on function public.warehouse_set_min(uuid, uuid, integer) from public, anon;
grant execute on function public.warehouse_set_min(uuid, uuid, integer) to authenticated;

-- Sevkiyata çıkan sipariş, depoda takip edilen ürünlerin stoğunu düşer (depo yetmezse sıfıra kadar)
create or replace function private.warehouse_ship()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_old int;
  v_take int;
begin
  if new.status = 'shipped' and old.status is distinct from 'shipped' then
    for r in
      select ol.product_id, ol.cases * p.case_qty as units
      from order_lines ol join products p on p.id = ol.product_id
      where ol.order_id = new.id and ol.cases > 0
    loop
      select qty_units into v_old from warehouse_stock
        where distributor_id = new.distributor_id and product_id = r.product_id for update;
      if found then
        v_take := least(v_old, r.units);
        update warehouse_stock set qty_units = v_old - v_take, updated_at = now()
          where distributor_id = new.distributor_id and product_id = r.product_id;
        insert into warehouse_movements (distributor_id, product_id, delta_units, balance_units, kind, note, order_id)
        values (new.distributor_id, r.product_id, -v_take, v_old - v_take, 'sevkiyat', 'Sevkiyata çıktı', new.id);
      end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function private.warehouse_ship() from public, anon, authenticated;
create trigger orders_warehouse_ship after update of status on public.orders
for each row execute function private.warehouse_ship();
