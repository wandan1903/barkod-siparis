-- Cari hesap / vade (distribütör ↔ market)
--  * retailer_distributor_links: vade günü ve kredi limiti
--  * account_entries: hesap hareketleri (borç +, alacak −). Kayıt silinmez; iptal ters kayıtla yapılır.
--  * Teslim alınan sipariş otomatik borç yazar (teslim alınan koli × koli fiyatı), vade = teslim + vade günü
--  * record_account_entry(): tahsilat / iade / düzeltme (yalnızca distribütör)
--  * reverse_account_entry(): ters kayıt ile iptal
--  * set_account_terms(): vade günü ve kredi limiti
--  * account_balances(p_org): her iki taraf için bakiye, vadesi geçen, en eski gecikme (FIFO)
--  * Her sabah vadesi geçen alacak özeti distribütöre bildirim olarak gider

alter table public.retailer_distributor_links
  add column payment_term_days integer not null default 0 check (payment_term_days between 0 and 365),
  add column credit_limit numeric(12,2) check (credit_limit is null or credit_limit >= 0);

create table public.account_entries (
  id             uuid primary key default gen_random_uuid(),
  distributor_id uuid not null references public.organizations(id) on delete cascade,
  retailer_id    uuid not null references public.organizations(id) on delete cascade,
  kind           text not null check (kind in ('siparis', 'tahsilat', 'iade', 'duzeltme', 'iptal')),
  amount         numeric(12,2) not null check (amount <> 0),  -- + marketin borcu artar, − azalır
  method         text check (method in ('nakit', 'havale', 'kart', 'cek', 'senet', 'diger')),
  entry_date     date not null default (now() at time zone 'Europe/Istanbul')::date,
  due_date       date,                                        -- yalnızca borç kayıtlarında
  order_id       uuid references public.orders(id) on delete set null,
  reverses_id    uuid references public.account_entries(id),
  note           text,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
create index idx_acc_pair_date on public.account_entries (distributor_id, retailer_id, entry_date, created_at);
create index idx_acc_retailer on public.account_entries (retailer_id);
create unique index uq_acc_order on public.account_entries (order_id) where kind = 'siparis';
create unique index uq_acc_reverses on public.account_entries (reverses_id) where reverses_id is not null;

alter table public.account_entries enable row level security;
create policy acc_read on public.account_entries for select
  using (private.is_member(distributor_id) or private.is_member(retailer_id));
-- yazma yalnızca aşağıdaki fonksiyonlarla

-- ---------------------------------------------------------------------------
-- Teslim alınan sipariş → borç kaydı
-- ---------------------------------------------------------------------------
create or replace function private.order_to_account()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_amount numeric(12,2);
  v_term int;
  v_date date := (now() at time zone 'Europe/Istanbul')::date;
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    select coalesce(sum(coalesce(ol.accepted_cases, ol.cases) * ol.case_price), 0) into v_amount
    from order_lines ol where ol.order_id = new.id;
    if v_amount > 0 then
      select coalesce(payment_term_days, 0) into v_term from retailer_distributor_links
      where retailer_id = new.retailer_id and distributor_id = new.distributor_id;
      insert into account_entries (distributor_id, retailer_id, kind, amount, entry_date, due_date, order_id, note)
      values (new.distributor_id, new.retailer_id, 'siparis', v_amount, v_date, v_date + coalesce(v_term, 0), new.id, 'Teslim alınan sipariş')
      on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.order_to_account() from public, anon, authenticated;
create trigger orders_to_account after update of status on public.orders
for each row execute function private.order_to_account();

-- Mevcut teslim edilmiş siparişleri işle (teslim günü olarak son güncelleme)
insert into public.account_entries (distributor_id, retailer_id, kind, amount, entry_date, due_date, order_id, note)
select o.distributor_id, o.retailer_id, 'siparis', t.amount,
       (o.updated_at at time zone 'Europe/Istanbul')::date,
       (o.updated_at at time zone 'Europe/Istanbul')::date + coalesce(l.payment_term_days, 0),
       o.id, 'Teslim alınan sipariş'
from public.orders o
join lateral (select sum(coalesce(ol.accepted_cases, ol.cases) * ol.case_price) as amount
              from public.order_lines ol where ol.order_id = o.id) t on true
left join public.retailer_distributor_links l on l.retailer_id = o.retailer_id and l.distributor_id = o.distributor_id
where o.status = 'delivered' and t.amount > 0
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Tahsilat / iade / düzeltme
--   tahsilat, iade: p_amount pozitif girilir, bakiyeyi düşürür
--   duzeltme: p_amount işaretli (+ borç ekler, − düşer)
-- ---------------------------------------------------------------------------
create or replace function public.record_account_entry(
  p_distributor uuid, p_retailer uuid, p_kind text, p_amount numeric,
  p_method text default null, p_date date default null, p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_amount numeric(12,2);
begin
  if not private.is_member(p_distributor) then
    raise exception 'Bu distribütör adına işlem yetkiniz yok';
  end if;
  if not exists (select 1 from retailer_distributor_links where retailer_id = p_retailer and distributor_id = p_distributor) then
    raise exception 'Bu market ile çalışma ilişkiniz yok';
  end if;
  if p_amount is null or p_amount = 0 then
    raise exception 'Tutar girin';
  end if;
  if abs(p_amount) > 100000000 then
    raise exception 'Tutar çok yüksek';
  end if;
  if p_date is not null and p_date > (now() at time zone 'Europe/Istanbul')::date then
    raise exception 'İleri tarihli kayıt girilemez';
  end if;

  if p_kind in ('tahsilat', 'iade') then
    if p_amount < 0 then raise exception 'Tutarı pozitif girin'; end if;
    v_amount := -round(p_amount, 2);
  elsif p_kind = 'duzeltme' then
    v_amount := round(p_amount, 2);
    if nullif(trim(p_note), '') is null then raise exception 'Düzeltme için açıklama yazın'; end if;
  else
    raise exception 'Geçersiz kayıt türü';
  end if;

  insert into account_entries (distributor_id, retailer_id, kind, amount, method, entry_date, note, created_by)
  values (p_distributor, p_retailer, p_kind, v_amount,
          case when p_kind = 'tahsilat' then coalesce(p_method, 'nakit') else null end,
          coalesce(p_date, (now() at time zone 'Europe/Istanbul')::date),
          left(nullif(trim(p_note), ''), 300), auth.uid())
  returning id into v_id;

  if p_kind = 'tahsilat' then
    perform private.notify(p_retailer, 'system', 'Ödemeniz kaydedildi',
      (select name from organizations where id = p_distributor) || ' ' ||
      translate(to_char(abs(v_amount), 'FM999,999,990.00'), ',.', '.,') || ' TL ödemenizi kaydetti.',
      '/market/cari', 'pay:' || v_id);
  end if;
  return v_id;
end;
$$;
revoke execute on function public.record_account_entry(uuid, uuid, text, numeric, text, date, text) from public, anon;
grant execute on function public.record_account_entry(uuid, uuid, text, numeric, text, date, text) to authenticated;

-- Ters kayıt ile iptal (bir kayıt yalnızca bir kez iptal edilebilir; iptal kaydı iptal edilemez)
create or replace function public.reverse_account_entry(p_entry uuid, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  e account_entries%rowtype;
  v_id uuid;
begin
  select * into e from account_entries where id = p_entry for update;
  if not found or not private.is_member(e.distributor_id) then
    raise exception 'Kayıt bulunamadı';
  end if;
  if e.kind = 'iptal' then
    raise exception 'İptal kaydı tekrar iptal edilemez';
  end if;
  if exists (select 1 from account_entries where reverses_id = p_entry) then
    raise exception 'Bu kayıt zaten iptal edilmiş';
  end if;
  insert into account_entries (distributor_id, retailer_id, kind, amount, entry_date, reverses_id, note, created_by)
  values (e.distributor_id, e.retailer_id, 'iptal', -e.amount, (now() at time zone 'Europe/Istanbul')::date, e.id,
          left(coalesce(nullif(trim(p_note), ''), 'Kayıt iptali'), 300), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.reverse_account_entry(uuid, text) from public, anon;
grant execute on function public.reverse_account_entry(uuid, text) to authenticated;

-- Vade ve kredi limiti
create or replace function public.set_account_terms(p_distributor uuid, p_retailer uuid, p_term_days integer, p_credit_limit numeric)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not private.is_member(p_distributor) then
    raise exception 'Bu distribütör adına işlem yetkiniz yok';
  end if;
  if p_term_days is null or p_term_days < 0 or p_term_days > 365 then
    raise exception 'Vade 0 ile 365 gün arasında olmalı';
  end if;
  if p_credit_limit is not null and p_credit_limit < 0 then
    raise exception 'Kredi limiti negatif olamaz';
  end if;
  update retailer_distributor_links
     set payment_term_days = p_term_days, credit_limit = p_credit_limit
   where retailer_id = p_retailer and distributor_id = p_distributor;
  if not found then
    raise exception 'Bu market ile çalışma ilişkiniz yok';
  end if;
end;
$$;
revoke execute on function public.set_account_terms(uuid, uuid, integer, numeric) from public, anon;
grant execute on function public.set_account_terms(uuid, uuid, integer, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Bakiye özeti. Ödemeler en eski borçtan başlayarak kapatılır (FIFO);
-- vadesi geçen = vadesi bugünden önce olan borçların kapanmamış kısmı.
-- p_org distribütörse her market için, marketse her distribütör için bir satır.
-- ---------------------------------------------------------------------------
create or replace function public.account_balances(p_org uuid)
returns table (
  distributor_id uuid, distributor_name text, retailer_id uuid, retailer_name text,
  balance numeric, overdue numeric, oldest_overdue_days integer,
  last_payment_date date, last_payment_amount numeric,
  payment_term_days integer, credit_limit numeric
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
begin
  if not private.is_member(p_org) then
    raise exception 'Bu kuruluş adına işlem yetkiniz yok';
  end if;
  return query
  with pairs as (
    select l.distributor_id, l.retailer_id, l.payment_term_days, l.credit_limit
    from retailer_distributor_links l
    where l.distributor_id = p_org or l.retailer_id = p_org
  ),
  credits as (  -- borcu düşüren toplam (ödeme, iade, eksi düzeltme, iptal)
    select e.distributor_id, e.retailer_id, -sum(e.amount) as pool
    from account_entries e join pairs p using (distributor_id, retailer_id)
    where e.amount < 0
    group by 1, 2
  ),
  debits as (   -- borç kayıtları, eskiden yeniye birikimli
    select e.distributor_id, e.retailer_id, e.amount, coalesce(e.due_date, e.entry_date) as due,
           sum(e.amount) over (partition by e.distributor_id, e.retailer_id
                               order by e.entry_date, e.created_at, e.id) as cum
    from account_entries e join pairs p using (distributor_id, retailer_id)
    where e.amount > 0
  ),
  open_debits as (
    select d.distributor_id, d.retailer_id, d.due,
           greatest(0, least(d.amount, d.cum - coalesce(c.pool, 0))) as remaining
    from debits d left join credits c using (distributor_id, retailer_id)
  ),
  od as (
    select o.distributor_id, o.retailer_id,
           sum(o.remaining) filter (where o.due < v_today) as overdue,
           min(o.due) filter (where o.due < v_today and o.remaining > 0) as oldest_due
    from open_debits o group by 1, 2
  ),
  bal as (
    select e.distributor_id, e.retailer_id, sum(e.amount) as balance
    from account_entries e join pairs p using (distributor_id, retailer_id)
    group by 1, 2
  ),
  lastpay as (
    select distinct on (e.distributor_id, e.retailer_id) e.distributor_id, e.retailer_id, e.entry_date, -e.amount as amt
    from account_entries e join pairs p using (distributor_id, retailer_id)
    where e.kind = 'tahsilat'
      and not exists (select 1 from account_entries r where r.reverses_id = e.id)
    order by e.distributor_id, e.retailer_id, e.entry_date desc, e.created_at desc
  )
  select p.distributor_id, dn.name, p.retailer_id, rn.name,
         coalesce(b.balance, 0)::numeric,
         coalesce(od.overdue, 0)::numeric,
         case when od.oldest_due is null then null else (v_today - od.oldest_due)::int end,
         lp.entry_date, lp.amt::numeric,
         p.payment_term_days, p.credit_limit::numeric
  from pairs p
  join organizations dn on dn.id = p.distributor_id
  join organizations rn on rn.id = p.retailer_id
  left join bal b using (distributor_id, retailer_id)
  left join od using (distributor_id, retailer_id)
  left join lastpay lp using (distributor_id, retailer_id)
  order by coalesce(od.overdue, 0) desc, coalesce(b.balance, 0) desc;
end;
$$;
revoke execute on function public.account_balances(uuid) from public, anon;
grant execute on function public.account_balances(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Her sabah: vadesi geçen alacak özeti (distribütöre)
-- ---------------------------------------------------------------------------
create or replace function private.generate_overdue_alerts()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  d record;
  v_n int := 0;
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
begin
  for d in
    with credits as (
      select distributor_id, retailer_id, -sum(amount) as pool
      from account_entries where amount < 0 group by 1, 2
    ),
    debits as (
      select distributor_id, retailer_id, amount, coalesce(due_date, entry_date) as due,
             sum(amount) over (partition by distributor_id, retailer_id order by entry_date, created_at, id) as cum
      from account_entries where amount > 0
    ),
    per_pair as (
      select db.distributor_id, db.retailer_id,
             sum(greatest(0, least(db.amount, db.cum - coalesce(c.pool, 0)))) filter (where db.due < v_today) as overdue
      from debits db left join credits c using (distributor_id, retailer_id)
      group by 1, 2
    )
    select distributor_id, count(*) filter (where overdue > 0) as markets, sum(overdue) as total
    from per_pair group by 1 having sum(overdue) > 0
  loop
    perform private.notify(
      d.distributor_id, 'system',
      'Vadesi geçen alacak: ' || translate(to_char(d.total, 'FM999,999,990.00'), ',.', '.,') || ' TL',
      d.markets || ' marketin ödemesi gecikmiş. Cari hesaplardan takip edin.',
      '/cari', 'overdue:' || d.distributor_id || ':' || v_today
    );
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.generate_overdue_alerts() from public, anon, authenticated;

select cron.schedule('overdue-alerts', '0 5 * * *', $cron$select private.generate_overdue_alerts()$cron$);  -- 08:00 İstanbul
