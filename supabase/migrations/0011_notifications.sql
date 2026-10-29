-- Bildirimler: uygulama içi bildirim + WhatsApp gönderim kuyruğu
--  * notifications: kullanıcının gördüğü bildirimler (zil simgesi)
--  * notification_outbox: WhatsApp'a gidecek mesajlar (gönderici ayrı çalışır; bkz. supabase/functions/send-whatsapp)
--  * notification_settings: kuruluşun bildirim tercihleri ve WhatsApp numarası
--  * private.generate_low_stock_alerts(): "ürün teslimattan önce bitebilir" uyarısı (günde 2 kez)
--  * orders tetikleyicisi: teklif/sipariş durumu değişince karşı tarafa bildirim

create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- Tercihler
-- ---------------------------------------------------------------------------
create table public.notification_settings (
  org_id            uuid primary key references public.organizations(id) on delete cascade,
  low_stock_alerts  boolean not null default true,
  whatsapp_enabled  boolean not null default false,
  whatsapp_phone    text,
  updated_at        timestamptz not null default now(),
  constraint ns_phone_format check (whatsapp_phone is null or whatsapp_phone ~ '^\+[1-9][0-9]{9,14}$'),
  constraint ns_phone_required check (not whatsapp_enabled or whatsapp_phone is not null)
);
alter table public.notification_settings enable row level security;
create policy ns_member_all on public.notification_settings for all
  using (private.is_member(org_id)) with check (private.is_member(org_id));

-- ---------------------------------------------------------------------------
-- Bildirimler
-- ---------------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  kind        text not null check (kind in ('low_stock', 'offer', 'order', 'campaign', 'system')),
  title       text not null,
  body        text,
  link        text,
  dedupe_key  text unique,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_org_created_idx on public.notifications (org_id, created_at desc);
create index notifications_org_unread_idx on public.notifications (org_id) where read_at is null;

alter table public.notifications enable row level security;
create policy notif_member_read on public.notifications for select using (private.is_member(org_id));
create policy notif_member_update on public.notifications for update
  using (private.is_member(org_id)) with check (private.is_member(org_id));
-- Kullanıcı yalnızca "okundu" bilgisini değiştirebilir
revoke update on public.notifications from authenticated, anon;
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- WhatsApp kuyruğu: istemciden erişilemez (politika yok), yalnızca sunucu tarafı
-- ---------------------------------------------------------------------------
create table public.notification_outbox (
  id               uuid primary key default gen_random_uuid(),
  notification_id  uuid not null references public.notifications(id) on delete cascade,
  channel          text not null default 'whatsapp' check (channel in ('whatsapp')),
  to_phone         text not null,
  status           text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts         integer not null default 0,
  last_error       text,
  provider_id      text,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz
);
create index outbox_pending_idx on public.notification_outbox (created_at) where status = 'pending';
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Bildirim oluşturucu (yalnızca sunucu tarafı fonksiyonlar çağırır)
-- ---------------------------------------------------------------------------
create or replace function private.notify(
  p_org uuid, p_kind text, p_title text, p_body text, p_link text, p_key text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  s notification_settings%rowtype;
  v_has boolean;
begin
  select * into s from notification_settings where org_id = p_org;
  v_has := found;
  if p_kind = 'low_stock' and v_has and not s.low_stock_alerts then
    return null;
  end if;

  insert into notifications (org_id, kind, title, body, link, dedupe_key)
  values (p_org, p_kind, p_title, p_body, p_link, p_key)
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  if v_id is not null and v_has and s.whatsapp_enabled and s.whatsapp_phone is not null then
    insert into notification_outbox (notification_id, to_phone) values (v_id, s.whatsapp_phone);
  end if;
  return v_id;
end;
$$;
revoke all on function private.notify(uuid, text, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sipariş / teklif olayları
-- ---------------------------------------------------------------------------
create or replace function private.orders_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_retailer text;
  v_distributor text;
  v_target uuid;
  v_title text;
  v_body text;
  v_link text;
  v_kind text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  select name into v_retailer from organizations where id = new.retailer_id;
  select name into v_distributor from organizations where id = new.distributor_id;
  v_kind := case when new.origin = 'offer' then 'offer' else 'order' end;

  if new.origin = 'offer' then
    case new.status
      when 'sent' then
        v_target := new.retailer_id; v_link := '/market/teklifler';
        v_title := v_distributor || ' sana sipariş önerisi gönderdi';
        v_body := 'Önerileri incele, onayla ya da değişiklik iste.';
      when 'approved' then
        v_target := new.distributor_id; v_link := '/siparisler';
        v_title := v_retailer || ' öneriyi onayladı'; v_body := 'Sevkiyata hazırlayabilirsin.';
      when 'changes_requested' then
        v_target := new.distributor_id; v_link := '/siparisler';
        v_title := v_retailer || ' değişiklik istedi'; v_body := 'Teklifi gözden geçir.';
      when 'rejected' then
        v_target := new.distributor_id; v_link := '/siparisler';
        v_title := v_retailer || ' öneriyi reddetti'; v_body := null;
      when 'shipped' then
        v_target := new.retailer_id; v_link := '/market/teslimat';
        v_title := 'Siparişin yola çıktı'; v_body := v_distributor || ' teslimatı sevk etti.';
      when 'delivered' then
        v_target := new.distributor_id; v_link := '/siparisler';
        v_title := v_retailer || ' teslimatı kabul etti'; v_body := null;
      else return new;
    end case;
  else
    case new.status
      when 'sent' then
        v_target := new.distributor_id; v_link := '/siparisler';
        v_title := v_retailer || ' sipariş verdi'; v_body := 'Onayını bekliyor.';
      when 'approved' then
        v_target := new.retailer_id; v_link := '/market/teklifler';
        v_title := 'Siparişin onaylandı'; v_body := v_distributor || ' siparişini onayladı.';
      when 'rejected' then
        v_target := new.retailer_id; v_link := '/market/teklifler';
        v_title := 'Siparişin reddedildi'; v_body := v_distributor || ' siparişini kabul edemedi.';
      when 'shipped' then
        v_target := new.retailer_id; v_link := '/market/teslimat';
        v_title := 'Siparişin yola çıktı'; v_body := v_distributor || ' teslimatı sevk etti.';
      when 'delivered' then
        v_target := new.distributor_id; v_link := '/siparisler';
        v_title := v_retailer || ' teslimatı kabul etti'; v_body := null;
      else return new;
    end case;
  end if;

  perform private.notify(v_target, v_kind, v_title, v_body, v_link, 'order:' || new.id || ':' || new.status);
  return new;
end;
$$;
revoke all on function private.orders_notify() from public, anon, authenticated;

create trigger orders_notify_ins after insert on public.orders
  for each row execute function private.orders_notify();
create trigger orders_notify_upd after update of status on public.orders
  for each row execute function private.orders_notify();

-- ---------------------------------------------------------------------------
-- Azalan ürün uyarısı
--  Bir ürün, bir sonraki teslimata kadar yetmeyecekse (ya da son 3 günde tahminden hızlı
--  satılıyorsa ve bu yüzden yetmeyecekse) markete tek bir özet bildirim gider.
--  Zaten açık siparişi/teklifi olan ürünler atlanır.
-- ---------------------------------------------------------------------------
create or replace function private.generate_low_stock_alerts()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_dow int := extract(dow from (now() at time zone 'Europe/Istanbul'))::int;
  v_n int;
  v_list text;
  v_fast boolean;
  v_hash text;
  v_body text;
  v_id uuid;
  v_created int := 0;
begin
  for r in
    select l.retailer_id as rid,
           min(case when (7 + coalesce(l.order_day, 6) - v_dow) % 7 = 0 then 7
                    else (7 + coalesce(l.order_day, 6) - v_dow) % 7 end)::numeric as gap
    from retailer_distributor_links l
    where l.status = 'active'
    group by l.retailer_id
  loop
    select count(*)::int,
           string_agg(x.label, ', ' order by x.eff) filter (where x.rn <= 5),
           coalesce(bool_or(x.fast), false),
           md5(string_agg(x.product_id::text, ',' order by x.product_id))
      into v_n, v_list, v_fast, v_hash
    from (
      select c.product_id, c.eff, c.fast,
             row_number() over (order by c.eff) as rn,
             c.product_name || ' (' ||
               case when c.eff < 1 then '1 günden az'
                    else replace(round(c.eff, 1)::text, '.', ',') || ' gün' end || ')' as label
      from (
        select ov.product_id, ov.product_name,
               least(coalesce(ov.days_left, 999),
                     coalesce(case when rc.units > 0 then ov.stock_units / (rc.units / 3.0) end, 999)) as eff,
               coalesce(rc.units > 0 and ov.days_left is not null
                        and ov.stock_units / (rc.units / 3.0) < ov.days_left * 0.7, false) as fast
        from retailer_stock_overview(r.rid) ov
        left join (
          select sm.product_id, (-sum(sm.qty_delta))::numeric as units
          from stock_movements sm
          where sm.retailer_id = r.rid and sm.kind = 'sale' and sm.created_at >= now() - interval '3 days'
          group by 1
        ) rc on rc.product_id = ov.product_id
        where not exists (
          select 1 from orders o join order_lines ol on ol.order_id = o.id
          where o.retailer_id = r.rid and o.status in ('sent', 'approved', 'shipped')
            and ol.product_id = ov.product_id
        )
      ) c
      where c.eff < 999 and c.eff < r.gap
    ) x;

    if v_n > 0 then
      v_body := v_list
        || case when v_n > 5 then ' ve ' || (v_n - 5) || ' ürün daha' else '' end
        || '. '
        || case when v_fast then 'Bazıları beklenenden hızlı satılıyor. ' else '' end
        || 'Sipariş vermeyi unutma.';
      v_id := private.notify(
        r.rid, 'low_stock', v_n || ' ürün teslimattan önce bitebilir', v_body,
        '/market/siparis-ver', 'low:' || r.rid || ':' || v_today || ':' || v_hash
      );
      if v_id is not null then v_created := v_created + 1; end if;
    end if;
  end loop;
  return v_created;
end;
$$;
revoke all on function private.generate_low_stock_alerts() from public, anon, authenticated;

-- Günde iki kez (08:30 ve 13:30 TSİ = 05:30 ve 10:30 UTC)
select cron.schedule('low-stock-alerts', '30 5,10 * * *', $cron$select private.generate_low_stock_alerts()$cron$);
