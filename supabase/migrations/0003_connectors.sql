-- Değiştirilebilir entegrasyonlar (bağlayıcılar)
--
-- Amaç: Market ya da distribütör kasa / ERP yazılımını değiştirdiğinde,
-- uygulamayı güncellemeden, uygulamanın içinden yeni sistemi seçip bağlayabilmesi.
--
-- 1) connectors          : Desteklenen sistemlerin kataloğu (biz yönetiriz).
--                          Yeni bir sistem = katalogda yeni satır + koddaki adaptörü.
-- 2) org_integrations    : Bir kuruluşun bağladığı sistemler. Market VE distribütör.
--                          Sistem değişince eskisi 'replaced' olur, yenisi eklenir; geçmiş kalır.
-- 3) external_product_map: Diğer sistemdeki ürün kodu ↔ bizim ürünümüz (barkodla eşleşmeyenler için).
-- 4) integration_events  : Bağlantı testi, senkronizasyon, hata kaydı.

-- Eski, yalnızca markete bağlı ve sabit listeli tabloyu kaldır (henüz veri yok).
drop table if exists public.integrations;
drop type if exists public.integration_provider;

create type connector_kind as enum ('device', 'software', 'file', 'manual');
create type connector_status as enum ('available', 'beta', 'planned', 'retired');

create table public.connectors (
  code          text primary key,                 -- 'token_x_connect', 'logo_tiger', 'csv_upload' …
  name          text not null,                    -- ekranda görünen ad
  vendor        text,                             -- 'Token / Beko', 'Logo', 'Akınsoft' …
  kind          connector_kind not null,
  status        connector_status not null default 'planned',
  for_retailer    boolean not null default true,
  for_distributor boolean not null default false,
  -- Neler yapabilir: send_basket, read_sales, read_stock, read_catalog,
  --                  read_prices, push_order, read_delivery
  capabilities  text[] not null default '{}',
  -- Kurulum sihirbazında sorulacak alanlar (ekran bu listeden otomatik oluşur)
  -- ör. [{"key":"terminal_serial","label":"Cihaz seri no","type":"text","required":true},
  --      {"key":"api_key","label":"API anahtarı","type":"secret","required":true}]
  config_fields jsonb not null default '[]',
  setup_help    text,                             -- kullanıcıya kısa kurulum açıklaması
  sort_order    integer not null default 100,
  created_at    timestamptz not null default now()
);

create type integration_state as enum ('draft', 'testing', 'active', 'error', 'replaced', 'disabled');

create table public.org_integrations (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  connector_code text not null references public.connectors(code),
  label          text,                            -- ör. "Kasa 1", "Merkez depo"
  state          integration_state not null default 'draft',
  config         jsonb not null default '{}',     -- gizli OLMAYAN ayarlar (seri no, şube kodu)
  secret_ref     uuid,                            -- şifre / API anahtarı: Supabase Vault'taki kaydın id'si
  -- Hangi veri bu bağlantıdan gelsin? (aynı anda iki sistem çakışmasın diye)
  is_primary_stock_source boolean not null default false,
  replaces_id    uuid references public.org_integrations(id),  -- hangi bağlantının yerine geldi
  last_test_at   timestamptz,
  last_test_ok   boolean,
  last_sync_at   timestamptz,
  last_error     text,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_org_integrations_org on public.org_integrations (org_id);
create index idx_org_integrations_connector on public.org_integrations (connector_code);
create index idx_org_integrations_replaces on public.org_integrations (replaces_id);
create index idx_org_integrations_created_by on public.org_integrations (created_by);
-- Bir kuruluşta aynı anda tek "ana stok kaynağı"
create unique index uq_primary_stock_source on public.org_integrations (org_id)
  where is_primary_stock_source and state = 'active';

create table public.external_product_map (
  integration_id uuid not null references public.org_integrations(id) on delete cascade,
  external_code  text not null,                   -- diğer sistemdeki stok kodu
  product_id     uuid not null references public.products(id) on delete cascade,
  matched_by     text not null default 'barcode', -- 'barcode' | 'manual' | 'suggested'
  created_at     timestamptz not null default now(),
  primary key (integration_id, external_code)
);
create index idx_epm_product on public.external_product_map (product_id);

create table public.integration_events (
  id             bigint generated always as identity primary key,
  integration_id uuid not null references public.org_integrations(id) on delete cascade,
  kind           text not null,                   -- 'test' | 'sync' | 'error' | 'state_change'
  ok             boolean,
  detail         jsonb not null default '{}',
  created_at     timestamptz not null default now()
);
create index idx_ie_integration on public.integration_events (integration_id, created_at desc);

-- stock_levels.source zaten 'pos_integration' değerini taşıyor; hangi bağlantıdan geldiğini de tut
alter table public.stock_levels add column integration_id uuid references public.org_integrations(id) on delete set null;
create index idx_sl_integration on public.stock_levels (integration_id);

-- ---------------------------------------------------------------------------
-- Sistemi değiştirme: eskisini 'replaced' yap, yenisini bağla, ana stok kaynağını taşı.
-- Tek işlemde yapılır; yarım kalırsa hiçbir şey değişmez.
-- ---------------------------------------------------------------------------
create or replace function public.replace_integration(
  p_old_id uuid, p_connector_code text, p_label text default null, p_config jsonb default '{}'
)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_old public.org_integrations;
  v_new_id uuid;
begin
  select * into v_old from public.org_integrations where id = p_old_id for update;
  if not found then
    raise exception 'Bağlantı bulunamadı veya yetkiniz yok';
  end if;

  update public.org_integrations
     set state = 'replaced', is_primary_stock_source = false, updated_at = now()
   where id = p_old_id;

  insert into public.org_integrations
    (org_id, connector_code, label, state, config, replaces_id, created_by)
  values
    (v_old.org_id, p_connector_code, coalesce(p_label, v_old.label), 'draft', p_config, p_old_id, auth.uid())
  returning id into v_new_id;

  insert into public.integration_events (integration_id, kind, ok, detail)
  values (p_old_id, 'state_change', true, jsonb_build_object('to', 'replaced', 'by', v_new_id)),
         (v_new_id, 'state_change', true, jsonb_build_object('to', 'draft', 'replaces', p_old_id));

  return v_new_id;
end;
$$;
revoke execute on function public.replace_integration(uuid, text, text, jsonb) from public, anon;
grant execute on function public.replace_integration(uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.connectors           enable row level security;
alter table public.org_integrations     enable row level security;
alter table public.external_product_map enable row level security;
alter table public.integration_events   enable row level security;

-- Katalog: giriş yapan herkes okur; yalnızca biz (servis rolü) yazarız
create policy connectors_read on public.connectors for select
  using ((select auth.uid()) is not null);

-- Bağlantılar: yalnızca kuruluşun kendi üyeleri
create policy oi_member_all on public.org_integrations for all
  using (private.is_member(org_id)) with check (private.is_member(org_id));

create policy epm_member_all on public.external_product_map for all
  using (exists (select 1 from public.org_integrations i
                 where i.id = integration_id and private.is_member(i.org_id)))
  with check (exists (select 1 from public.org_integrations i
                 where i.id = integration_id and private.is_member(i.org_id)));

create policy ie_member_read on public.integration_events for select
  using (exists (select 1 from public.org_integrations i
                 where i.id = integration_id and private.is_member(i.org_id)));
create policy ie_member_insert on public.integration_events for insert
  with check (exists (select 1 from public.org_integrations i
                 where i.id = integration_id and private.is_member(i.org_id)));

-- ---------------------------------------------------------------------------
-- Başlangıç kataloğu
-- ---------------------------------------------------------------------------
insert into public.connectors
  (code, name, vendor, kind, status, for_retailer, for_distributor, capabilities, config_fields, setup_help, sort_order)
values
 ('app_barcode', 'Uygulama ile barkod okutma', 'Barkod Sipariş', 'manual', 'available', true, false,
  array['read_sales','read_stock'],
  '[]',
  'Kasa programı yoksa: satışları telefon kamerasıyla okutun, stok kendiliğinden düşer.', 10),

 ('token_x_connect', 'Beko / Token yazar kasa POS', 'Token', 'device', 'beta', true, false,
  array['send_basket','read_sales'],
  '[{"key":"terminal_serial","label":"Cihaz seri numarası","type":"text","required":true},
    {"key":"branch_code","label":"Şube kodu (varsa)","type":"text","required":false}]',
  'Uygulamada okuttuğunuz sepet yazar kasaya gider, fiş yazar kasadan çıkar. Desteklenen cihazlar: Beko 300 TR, Beko X30 TR.', 20),

 ('hugin_okc', 'Hugin yazar kasa POS', 'Hugin', 'device', 'planned', true, false,
  array['send_basket','read_sales'],
  '[{"key":"terminal_serial","label":"Cihaz seri numarası","type":"text","required":true}]',
  'Hugin ile iş ortaklığı görüşmesi sürüyor.', 30),

 ('logo_tiger', 'Logo Tiger / Go', 'Logo', 'software', 'planned', true, true,
  array['read_stock','read_sales','read_catalog','read_prices','push_order'],
  '[{"key":"server_url","label":"Sunucu adresi","type":"url","required":true},
    {"key":"firm_no","label":"Firma numarası","type":"text","required":true},
    {"key":"username","label":"Kullanıcı adı","type":"text","required":true},
    {"key":"password","label":"Şifre","type":"secret","required":true}]',
  'Logo j-Platform REST arayüzü üzerinden stok ve satış miktarı okunur.', 40),

 ('logo_netsis', 'Logo Netsis', 'Logo', 'software', 'planned', true, true,
  array['read_stock','read_sales','read_catalog','read_prices','push_order'],
  '[{"key":"server_url","label":"Sunucu adresi","type":"url","required":true},
    {"key":"company_db","label":"Şirket veritabanı","type":"text","required":true},
    {"key":"username","label":"Kullanıcı adı","type":"text","required":true},
    {"key":"password","label":"Şifre","type":"secret","required":true}]',
  'Netsis entegrasyon arayüzü üzerinden bağlanılır.', 50),

 ('logo_pera', 'Logo Pera', 'Logo', 'software', 'planned', true, false,
  array['read_stock','read_sales'],
  '[]', 'Logo ile görüşülecek.', 60),

 ('akinsoft_wolvox', 'Akınsoft Wolvox', 'Akınsoft', 'software', 'planned', true, true,
  array['read_stock','read_catalog','read_prices','push_order'],
  '[{"key":"site_url","label":"Web entegrasyon adresi","type":"url","required":true},
    {"key":"api_user","label":"API kullanıcısı","type":"text","required":true},
    {"key":"api_password","label":"API şifresi","type":"secret","required":true}]',
  'Wolvox web entegrasyonundaki API kullanıcısı ile bağlanılır.', 70),

 ('genius_pos', 'Genius (POS A.Ş.)', 'POS A.Ş.', 'software', 'planned', true, false,
  array['read_stock','read_sales'],
  '[]', 'Zincir marketler için; POS A.Ş. ile görüşülecek.', 80),

 ('csv_upload', 'Excel / CSV dosyası yükleme', 'Genel', 'file', 'available', true, true,
  array['read_stock','read_catalog','read_prices'],
  '[]',
  'Hiçbir sistem desteklenmiyorsa: programınızdan stok veya ürün listesini Excel olarak alıp yükleyin.', 900);
