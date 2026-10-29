-- Düzeltme: campaigns ↔ campaign_targets politikaları birbirini çağırıyordu (sonsuz döngü).
-- Çapraz kontroller, RLS'e takılmayan (security definer) yardımcı fonksiyonlara taşındı.

create or replace function private.is_campaign_owner(p_campaign uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from campaigns c where c.id = p_campaign and private.is_member(c.distributor_id));
$$;

create or replace function private.is_campaign_target(p_campaign uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from campaign_targets t where t.campaign_id = p_campaign and private.is_member(t.retailer_id));
$$;

revoke all on function private.is_campaign_owner(uuid) from public;
revoke all on function private.is_campaign_target(uuid) from public;
grant execute on function private.is_campaign_owner(uuid) to authenticated, anon;
grant execute on function private.is_campaign_target(uuid) to authenticated, anon;

drop policy camp_retailer_read on public.campaigns;
create policy camp_retailer_read on public.campaigns for select using (
  private.is_linked_retailer_of(distributor_id)
  and (target <> 'selected' or private.is_campaign_target(id))
);

drop policy ct_dist_all on public.campaign_targets;
create policy ct_dist_all on public.campaign_targets for all
  using (private.is_campaign_owner(campaign_id))
  with check (private.is_campaign_owner(campaign_id));

create policy ct_retailer_read on public.campaign_targets for select
  using (private.is_member(retailer_id));
