-- Otomatik haftalık öneri gönderimi
--  * distributor_settings: distribütör başına aç/kapa, gün ve saat
--  * private.send_offers_internal(): öneri gönderme çekirdeği (oturum gerektirmez; cron da kullanır)
--  * public.send_suggested_offers(): panel düğmesi; yetki kontrolü yapıp çekirdeği çağırır
--  * private.run_auto_offers(): her saat başı çalışır, günü/saati gelen distribütörlere gönderir
--  * auto_offer_runs: çalışma geçmişi (ayarlar ekranında son çalışma gösterilir)

create table public.distributor_settings (
  distributor_id   uuid primary key references public.organizations(id) on delete cascade,
  auto_send        boolean not null default false,
  auto_send_dow    smallint not null default 5 check (auto_send_dow between 0 and 6),   -- 5 = cuma
  auto_send_hour   smallint not null default 9 check (auto_send_hour between 0 and 23), -- İstanbul saati
  updated_at       timestamptz not null default now()
);
alter table public.distributor_settings enable row level security;
create policy ds_member_all on public.distributor_settings for all
  using (private.is_member(distributor_id)) with check (private.is_member(distributor_id));

create table public.auto_offer_runs (
  id              uuid primary key default gen_random_uuid(),
  distributor_id  uuid not null references public.organizations(id) on delete cascade,
  run_at          timestamptz not null default now(),
  run_date        date not null,
  sent            integer not null,
  skipped         integer not null,
  unique (distributor_id, run_date)
);
alter table public.auto_offer_runs enable row level security;
create policy aor_member_read on public.auto_offer_runs for select using (private.is_member(distributor_id));

-- Çekirdek: oturum gerektirmez
create or replace function private.send_offers_internal(p_distributor uuid, p_retailers uuid[] default null)
returns table (retailer_id uuid, retailer_name text, order_id uuid, line_count integer, total numeric, skipped_reason text)
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_order uuid;
  v_delivery date;
begin
  for r in
    select o.retailer_id as rid, max(o.retailer_name) as rname,
           jsonb_agg(jsonb_build_object('product_id', o.product_id, 'cases', o.suggested_cases,
                                        'suggested_cases', o.suggested_cases)) as lines,
           count(*)::int as n
    from distributor_stock_overview(p_distributor) o
    where o.suggested_cases > 0
      and (p_retailers is null or o.retailer_id = any(p_retailers))
    group by o.retailer_id
  loop
    if exists (select 1 from orders x
               where x.retailer_id = r.rid and x.distributor_id = p_distributor
                 and x.origin = 'offer' and x.status = 'sent') then
      retailer_id := r.rid; retailer_name := r.rname; order_id := null;
      line_count := r.n; total := null; skipped_reason := 'Yanıt bekleyen teklif var';
      return next;
      continue;
    end if;

    select current_date + ((7 + coalesce(l.order_day, 6) - extract(dow from current_date)::int) % 7)
      into v_delivery
    from retailer_distributor_links l
    where l.retailer_id = r.rid and l.distributor_id = p_distributor;

    insert into orders (retailer_id, distributor_id, status, delivery_date, note, created_by, origin)
    values (r.rid, p_distributor, 'sent', v_delivery, 'Haftalık sipariş önerisi', auth.uid(), 'offer')
    returning id into v_order;

    insert into order_lines (order_id, product_id, cases, case_price, suggested_cases)
    select v_order, (l->>'product_id')::uuid, (l->>'cases')::int, 0, (l->>'suggested_cases')::int
    from jsonb_array_elements(r.lines) l
    join distributor_products dp
      on dp.distributor_id = p_distributor and dp.product_id = (l->>'product_id')::uuid and dp.active
    where (l->>'cases')::int > 0;

    retailer_id := r.rid; retailer_name := r.rname; order_id := v_order;
    select count(*)::int, coalesce(sum(ol.cases * ol.case_price), 0) into line_count, total
    from order_lines ol where ol.order_id = v_order;
    skipped_reason := null;
    return next;
  end loop;
end;
$$;
revoke all on function private.send_offers_internal(uuid, uuid[]) from public, anon, authenticated;

-- Panel düğmesi: yetki kontrolü + çekirdek
create or replace function public.send_suggested_offers(p_distributor uuid, p_retailers uuid[] default null)
returns table (retailer_id uuid, retailer_name text, order_id uuid, line_count integer, total numeric, skipped_reason text)
language plpgsql security definer set search_path = public as $$
begin
  if not private.is_member(p_distributor) then
    raise exception 'Bu distribütör adına işlem yetkiniz yok';
  end if;
  return query select * from private.send_offers_internal(p_distributor, p_retailers);
end;
$$;
revoke execute on function public.send_suggested_offers(uuid, uuid[]) from public, anon;
grant execute on function public.send_suggested_offers(uuid, uuid[]) to authenticated;

-- Zamanlanmış çalışma
create or replace function private.run_auto_offers()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  s record;
  v_now timestamp := now() at time zone 'Europe/Istanbul';
  v_today date := v_now::date;
  v_sent int;
  v_skipped int;
  v_runs int := 0;
begin
  for s in
    select ds.* from distributor_settings ds
    where ds.auto_send
      and ds.auto_send_dow = extract(dow from v_now)::int
      and ds.auto_send_hour <= extract(hour from v_now)::int
      and not exists (select 1 from auto_offer_runs a where a.distributor_id = ds.distributor_id and a.run_date = v_today)
  loop
    select count(*) filter (where skipped_reason is null), count(*) filter (where skipped_reason is not null)
      into v_sent, v_skipped
    from private.send_offers_internal(s.distributor_id, null);

    insert into auto_offer_runs (distributor_id, run_date, sent, skipped)
    values (s.distributor_id, v_today, v_sent, v_skipped)
    on conflict do nothing;

    perform private.notify(
      s.distributor_id, 'system',
      'Haftalık öneriler otomatik gönderildi',
      v_sent || ' markete teklif gitti' || case when v_skipped > 0 then ', ' || v_skipped || ' market yanıt beklediği için atlandı' else '' end || '.',
      '/siparisler', 'auto:' || s.distributor_id || ':' || v_today
    );
    v_runs := v_runs + 1;
  end loop;
  return v_runs;
end;
$$;
revoke all on function private.run_auto_offers() from public, anon, authenticated;

select cron.schedule('auto-offers', '5 * * * *', $cron$select private.run_auto_offers()$cron$);
