-- Barkod Sipariş – ilk şema (pilot)
-- Kural 1: Marketin raf satış fiyatını yalnızca o marketin kullanıcıları görür.
-- Kural 2: Distribütör yalnızca kendi kataloğundaki ürünlerin stok ve hareketini görür,
--          ve yalnızca veri paylaşımına onay vermiş bağlı marketlerde.
-- Kural 3: Distribütörün koli fiyatı (markete satış fiyatı) bağlı marketlere siparişte görünür.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Kuruluşlar ve kullanıcılar
-- ---------------------------------------------------------------------------
create type org_type as enum ('retailer', 'distributor');

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  type        org_type not null,
  name        text not null,
  tax_no      text,
  city        text,
  district    text,
  created_at  timestamptz not null default now()
);

create type member_role as enum ('owner', 'staff');

create table memberships (
  user_id     uuid not null references auth.users(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete cascade,
  role        member_role not null default 'staff',
  created_at  timestamptz not null default now(),
  primary key (user_id, org_id)
);

-- Market ile distribütör arasındaki çalışma ilişkisi ve veri paylaşım onayı
create type link_status as enum ('pending', 'active', 'ended');

create table retailer_distributor_links (
  retailer_id        uuid not null references organizations(id) on delete cascade,
  distributor_id     uuid not null references organizations(id) on delete cascade,
  status             link_status not null default 'pending',
  stock_share_consent_at timestamptz,          -- KVKK / veri paylaşım onayı
  order_day          smallint check (order_day between 0 and 6) default 6, -- 6 = cumartesi
  created_at         timestamptz not null default now(),
  primary key (retailer_id, distributor_id)
);

-- ---------------------------------------------------------------------------
-- Ürünler ve fiyatlar
-- ---------------------------------------------------------------------------
create table products (
  id          uuid primary key default gen_random_uuid(),
  gtin        text unique not null,            -- barkod
  name        text not null,
  brand       text,
  unit        text not null default 'adet',
  case_qty    integer not null default 1 check (case_qty > 0), -- koli içi adet
  category    text,
  created_at  timestamptz not null default now()
);

-- Distribütörün kataloğu ve markete koli satış fiyatı
create table distributor_products (
  distributor_id uuid not null references organizations(id) on delete cascade,
  product_id     uuid not null references products(id) on delete cascade,
  case_price     numeric(12,2) not null check (case_price >= 0),
  active         boolean not null default true,
  updated_at     timestamptz not null default now(),
  primary key (distributor_id, product_id)
);

-- Marketin raf satış fiyatı: yalnızca market görür
create table retailer_prices (
  retailer_id  uuid not null references organizations(id) on delete cascade,
  product_id   uuid not null references products(id) on delete cascade,
  shelf_price  numeric(12,2) not null check (shelf_price >= 0),
  updated_at   timestamptz not null default now(),
  primary key (retailer_id, product_id)
);

-- ---------------------------------------------------------------------------
-- Stok
-- ---------------------------------------------------------------------------
create type stock_source as enum ('app', 'pos_integration', 'estimate', 'count');

create table stock_levels (
  retailer_id  uuid not null references organizations(id) on delete cascade,
  product_id   uuid not null references products(id) on delete cascade,
  qty_units    integer not null default 0,
  source       stock_source not null default 'app',
  updated_at   timestamptz not null default now(),
  primary key (retailer_id, product_id)
);

-- Hareketlerde fiyat YOK, sadece adet
create type movement_kind as enum ('sale', 'receipt', 'count_adjust', 'return');

create table stock_movements (
  id           bigint generated always as identity primary key,
  retailer_id  uuid not null references organizations(id) on delete cascade,
  product_id   uuid not null references products(id) on delete cascade,
  qty_delta    integer not null,               -- satış negatif, mal kabul pozitif
  kind         movement_kind not null,
  order_id     uuid,                           -- mal kabulde ilgili sipariş
  created_at   timestamptz not null default now()
);
create index on stock_movements (retailer_id, product_id, created_at desc);

-- Satış fişi: tutarlar burada, yalnızca market görür
create table sales (
  id           uuid primary key default gen_random_uuid(),
  retailer_id  uuid not null references organizations(id) on delete cascade,
  total        numeric(12,2) not null default 0,
  pos_ref      text,                           -- yazar kasa fiş/işlem no (Token vb.)
  created_at   timestamptz not null default now()
);

create table sale_lines (
  sale_id      uuid not null references sales(id) on delete cascade,
  product_id   uuid not null references products(id),
  qty_units    integer not null check (qty_units > 0),
  unit_price   numeric(12,2) not null,
  primary key (sale_id, product_id)
);

-- ---------------------------------------------------------------------------
-- Tahmin, kampanya, sipariş
-- ---------------------------------------------------------------------------
create table forecasts (
  id                 bigint generated always as identity primary key,
  retailer_id        uuid not null references organizations(id) on delete cascade,
  distributor_id     uuid not null references organizations(id) on delete cascade,
  product_id         uuid not null references products(id) on delete cascade,
  week_start         date not null,
  est_remaining_cases numeric(10,2) not null,
  weekly_consumption_cases numeric(10,2) not null,
  safety_stock_cases numeric(10,2) not null,
  suggested_cases    integer not null,
  retailer_reported_cases numeric(10,2),       -- marketin "kaç koli kaldı" yanıtı
  created_at         timestamptz not null default now(),
  unique (retailer_id, distributor_id, product_id, week_start)
);

create type campaign_target as enum ('low_stock', 'all', 'selected');

create table campaigns (
  id             uuid primary key default gen_random_uuid(),
  distributor_id uuid not null references organizations(id) on delete cascade,
  product_id     uuid not null references products(id),
  title          text not null,
  case_price     numeric(12,2),                -- kampanyalı koli fiyatı (varsa)
  rule           jsonb not null default '{}',  -- ör. {"buy":10,"free":1}
  target         campaign_target not null default 'low_stock',
  starts_at      timestamptz not null default now(),
  ends_at        timestamptz not null,
  created_at     timestamptz not null default now()
);

create table campaign_targets (
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  retailer_id  uuid not null references organizations(id) on delete cascade,
  primary key (campaign_id, retailer_id)
);

create type order_status as enum (
  'draft', 'sent', 'changes_requested', 'approved', 'rejected', 'shipped', 'delivered'
);

create table orders (
  id             uuid primary key default gen_random_uuid(),
  retailer_id    uuid not null references organizations(id) on delete cascade,
  distributor_id uuid not null references organizations(id) on delete cascade,
  status         order_status not null default 'draft',
  delivery_date  date,
  total          numeric(12,2) not null default 0,  -- distribütör fiyatıyla
  note           text,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table order_lines (
  order_id       uuid not null references orders(id) on delete cascade,
  product_id     uuid not null references products(id),
  cases          integer not null check (cases >= 0),
  case_price     numeric(12,2) not null,       -- sipariş anındaki distribütör fiyatı
  campaign_id    uuid references campaigns(id),
  suggested_cases integer,                     -- yapay zekanın önerisi (karşılaştırma için)
  accepted_cases integer,                      -- mal kabulde teslim alınan
  primary key (order_id, product_id)
);

-- ---------------------------------------------------------------------------
-- Entegrasyonlar
-- ---------------------------------------------------------------------------
create type integration_provider as enum ('token', 'hugin', 'logo', 'netsis', 'akinsoft', 'genius', 'pera');

create table integrations (
  id           uuid primary key default gen_random_uuid(),
  retailer_id  uuid not null references organizations(id) on delete cascade,
  provider     integration_provider not null,
  external_ref text,                           -- ör. terminal seri no / şube kodu
  status       text not null default 'pending',
  last_sync_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (retailer_id, provider)
);
-- Not: API anahtarları bu tabloda tutulmaz; Supabase Vault'ta saklanır.

-- ---------------------------------------------------------------------------
-- Yardımcı fonksiyonlar
-- ---------------------------------------------------------------------------
create or replace function is_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m where m.org_id = p_org and m.user_id = auth.uid()
  );
$$;

-- Kullanıcı, bu marketle aktif ve onaylı ilişkisi olan bir distribütörde mi?
create or replace function is_linked_distributor(p_retailer uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from retailer_distributor_links l
    join memberships m on m.org_id = l.distributor_id and m.user_id = auth.uid()
    where l.retailer_id = p_retailer and l.status = 'active'
      and l.stock_share_consent_at is not null
  );
$$;

-- Distribütör bu ürünü bu markete satıyor mu? (stok görünürlüğü için)
create or replace function distributor_can_see_product(p_retailer uuid, p_product uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from retailer_distributor_links l
    join memberships m on m.org_id = l.distributor_id and m.user_id = auth.uid()
    join distributor_products dp on dp.distributor_id = l.distributor_id
                                and dp.product_id = p_product and dp.active
    where l.retailer_id = p_retailer and l.status = 'active'
      and l.stock_share_consent_at is not null
  );
$$;

-- Kullanıcı bu distribütörle çalışan bir markette mi? (koli fiyatı görünürlüğü için)
create or replace function is_linked_retailer_of(p_distributor uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from retailer_distributor_links l
    join memberships m on m.org_id = l.retailer_id and m.user_id = auth.uid()
    where l.distributor_id = p_distributor and l.status = 'active'
  );
$$;

-- ---------------------------------------------------------------------------
-- Satır bazlı güvenlik (RLS)
-- ---------------------------------------------------------------------------
alter table organizations              enable row level security;
alter table memberships                enable row level security;
alter table retailer_distributor_links enable row level security;
alter table products                   enable row level security;
alter table distributor_products       enable row level security;
alter table retailer_prices            enable row level security;
alter table stock_levels               enable row level security;
alter table stock_movements            enable row level security;
alter table sales                      enable row level security;
alter table sale_lines                 enable row level security;
alter table forecasts                  enable row level security;
alter table campaigns                  enable row level security;
alter table campaign_targets           enable row level security;
alter table orders                     enable row level security;
alter table order_lines                enable row level security;
alter table integrations               enable row level security;

-- Kuruluşlar: üyesi olduğun ve ilişkide olduğun kuruluşları görürsün
create policy org_read on organizations for select using (
  is_member(id)
  or exists (select 1 from retailer_distributor_links l
             where (l.retailer_id = id and is_member(l.distributor_id))
                or (l.distributor_id = id and is_member(l.retailer_id)))
);

create policy membership_read on memberships for select using (user_id = auth.uid() or is_member(org_id));

create policy link_read on retailer_distributor_links for select
  using (is_member(retailer_id) or is_member(distributor_id));
-- Onayı yalnızca market verir/geri alır
create policy link_retailer_update on retailer_distributor_links for update
  using (is_member(retailer_id)) with check (is_member(retailer_id));

-- Ürün kataloğu herkese açık (barkod → ürün adı)
create policy products_read on products for select using (auth.uid() is not null);

-- Distribütör kataloğu ve koli fiyatı: distribütör yönetir, bağlı marketler görür
create policy dp_dist_all on distributor_products for all
  using (is_member(distributor_id)) with check (is_member(distributor_id));
create policy dp_retailer_read on distributor_products for select
  using (is_linked_retailer_of(distributor_id));

-- Raf fiyatı: YALNIZCA market
create policy rp_retailer_all on retailer_prices for all
  using (is_member(retailer_id)) with check (is_member(retailer_id));

-- Stok seviyesi: market tamamen, distribütör yalnızca kendi ürünlerini okur
create policy sl_retailer_all on stock_levels for all
  using (is_member(retailer_id)) with check (is_member(retailer_id));
create policy sl_dist_read on stock_levels for select
  using (distributor_can_see_product(retailer_id, product_id));

-- Stok hareketi (fiyatsız): aynı kural
create policy sm_retailer_all on stock_movements for all
  using (is_member(retailer_id)) with check (is_member(retailer_id));
create policy sm_dist_read on stock_movements for select
  using (distributor_can_see_product(retailer_id, product_id));

-- Satış fişleri (tutarlı): YALNIZCA market
create policy sales_retailer_all on sales for all
  using (is_member(retailer_id)) with check (is_member(retailer_id));
create policy sale_lines_retailer_all on sale_lines for all
  using (exists (select 1 from sales s where s.id = sale_id and is_member(s.retailer_id)))
  with check (exists (select 1 from sales s where s.id = sale_id and is_member(s.retailer_id)));

-- Tahmin: iki taraf da görür; market kendi "kaç koli kaldı" yanıtını yazar
create policy fc_read on forecasts for select
  using (is_member(retailer_id) or is_member(distributor_id));
create policy fc_dist_write on forecasts for insert
  with check (is_member(distributor_id));
create policy fc_retailer_update on forecasts for update
  using (is_member(retailer_id)) with check (is_member(retailer_id));

-- Kampanyalar: distribütör yönetir; hedefteki marketler görür
create policy camp_dist_all on campaigns for all
  using (is_member(distributor_id)) with check (is_member(distributor_id));
create policy camp_retailer_read on campaigns for select using (
  is_linked_retailer_of(distributor_id)
  and (target <> 'selected'
       or exists (select 1 from campaign_targets t
                  where t.campaign_id = id and is_member(t.retailer_id)))
);
create policy ct_dist_all on campaign_targets for all
  using (exists (select 1 from campaigns c where c.id = campaign_id and is_member(c.distributor_id)))
  with check (exists (select 1 from campaigns c where c.id = campaign_id and is_member(c.distributor_id)));

-- Siparişler: iki taraf görür ve günceller (durum geçişleri uygulamada kontrol edilir)
create policy orders_read on orders for select
  using (is_member(retailer_id) or is_member(distributor_id));
create policy orders_insert on orders for insert
  with check (is_member(retailer_id) or is_member(distributor_id));
create policy orders_update on orders for update
  using (is_member(retailer_id) or is_member(distributor_id))
  with check (is_member(retailer_id) or is_member(distributor_id));

create policy ol_all on order_lines for all
  using (exists (select 1 from orders o where o.id = order_id
                 and (is_member(o.retailer_id) or is_member(o.distributor_id))))
  with check (exists (select 1 from orders o where o.id = order_id
                 and (is_member(o.retailer_id) or is_member(o.distributor_id))));

-- Entegrasyonlar: yalnızca market
create policy int_retailer_all on integrations for all
  using (is_member(retailer_id)) with check (is_member(retailer_id));

-- ---------------------------------------------------------------------------
-- Tahmin fonksiyonu (seçenek 3): belgedeki basit hesap
--   tahmini kalan = son durum - günlük ort. tüketim x geçen gün
--   öneri = haftalık tüketim + emniyet stoğu - tahmini kalan
-- ---------------------------------------------------------------------------
create or replace function suggest_order(
  p_retailer uuid, p_distributor uuid, p_product uuid,
  p_weeks integer default 4, p_safety_days numeric default 2
)
returns table (
  weekly_consumption_cases numeric,
  est_remaining_cases numeric,
  safety_stock_cases numeric,
  suggested_cases integer
)
language sql stable as $$
  with p as (
    select case_qty from products where id = p_product
  ),
  sold as (
    select coalesce(-sum(qty_delta), 0)::numeric as units
    from stock_movements
    where retailer_id = p_retailer and product_id = p_product and kind = 'sale'
      and created_at >= now() - make_interval(weeks => p_weeks)
  ),
  cur as (
    select coalesce(qty_units, 0)::numeric as units
    from stock_levels where retailer_id = p_retailer and product_id = p_product
  ),
  calc as (
    select
      (select units from sold) / p_weeks / (select case_qty from p)          as weekly,
      coalesce((select units from cur), 0) / (select case_qty from p)        as remaining
  )
  select
    round(weekly, 2),
    round(remaining, 2),
    round(weekly / 7 * p_safety_days, 2),
    greatest(0, ceil(weekly + weekly / 7 * p_safety_days - remaining))::integer
  from calc;
$$;
