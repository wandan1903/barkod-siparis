-- Güvenlik ve performans düzeltmeleri (Supabase denetim önerileri)

-- 1) Yardımcı fonksiyonları API'de görünmeyen ayrı bir şemaya taşı.
--    Politikalar fonksiyona OID ile bağlı olduğu için çalışmaya devam eder.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, anon;

alter function public.is_member(uuid)                         set schema private;
alter function public.is_linked_distributor(uuid)             set schema private;
alter function public.distributor_can_see_product(uuid, uuid) set schema private;
alter function public.is_linked_retailer_of(uuid)             set schema private;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated, anon;

-- 2) suggest_order: sabit search_path, giriş yapmamış kullanıcıya kapalı.
--    SECURITY INVOKER kalır, böylece RLS kuralları burada da geçerlidir.
alter function public.suggest_order(uuid, uuid, uuid, integer, numeric)
  set search_path = public;
revoke execute on function public.suggest_order(uuid, uuid, uuid, integer, numeric) from public, anon;
grant execute on function public.suggest_order(uuid, uuid, uuid, integer, numeric) to authenticated;

-- 3) auth.uid() satır başına değil sorgu başına bir kez hesaplansın
drop policy membership_read on public.memberships;
create policy membership_read on public.memberships for select
  using (user_id = (select auth.uid()) or private.is_member(org_id));

drop policy products_read on public.products;
create policy products_read on public.products for select
  using ((select auth.uid()) is not null);

-- 4) Yabancı anahtar indeksleri
create index if not exists idx_memberships_org            on public.memberships (org_id);
create index if not exists idx_links_distributor          on public.retailer_distributor_links (distributor_id);
create index if not exists idx_dp_product                 on public.distributor_products (product_id);
create index if not exists idx_rp_product                 on public.retailer_prices (product_id);
create index if not exists idx_sl_product                 on public.stock_levels (product_id);
create index if not exists idx_sm_product                 on public.stock_movements (product_id);
create index if not exists idx_sales_retailer             on public.sales (retailer_id);
create index if not exists idx_sale_lines_product         on public.sale_lines (product_id);
create index if not exists idx_forecasts_distributor      on public.forecasts (distributor_id);
create index if not exists idx_forecasts_product          on public.forecasts (product_id);
create index if not exists idx_campaigns_distributor      on public.campaigns (distributor_id);
create index if not exists idx_campaigns_product          on public.campaigns (product_id);
create index if not exists idx_campaign_targets_retailer  on public.campaign_targets (retailer_id);
create index if not exists idx_orders_retailer            on public.orders (retailer_id);
create index if not exists idx_orders_distributor         on public.orders (distributor_id);
create index if not exists idx_orders_created_by          on public.orders (created_by);
create index if not exists idx_order_lines_product        on public.order_lines (product_id);
create index if not exists idx_order_lines_campaign       on public.order_lines (campaign_id);
