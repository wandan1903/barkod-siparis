-- Gecikme hesabında (FIFO) iptal edilmiş kayıtlar ve iptal kayıtları dışarıda bırakılır (birbirini sıfırlar)
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
    where e.amount < 0 and e.kind <> 'iptal'
      and not exists (select 1 from account_entries x where x.reverses_id = e.id)
    group by 1, 2
  ),
  debits as (   -- borç kayıtları, eskiden yeniye birikimli
    select e.distributor_id, e.retailer_id, e.amount, coalesce(e.due_date, e.entry_date) as due,
           sum(e.amount) over (partition by e.distributor_id, e.retailer_id
                               order by e.entry_date, e.created_at, e.id) as cum
    from account_entries e join pairs p using (distributor_id, retailer_id)
    where e.amount > 0 and e.kind <> 'iptal'
      and not exists (select 1 from account_entries x where x.reverses_id = e.id)
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
      from account_entries e where amount < 0 and kind <> 'iptal'
        and not exists (select 1 from account_entries x where x.reverses_id = e.id)
      group by 1, 2
    ),
    debits as (
      select distributor_id, retailer_id, amount, coalesce(due_date, entry_date) as due,
             sum(amount) over (partition by distributor_id, retailer_id order by entry_date, created_at, id) as cum
      from account_entries e where amount > 0 and kind <> 'iptal'
        and not exists (select 1 from account_entries x where x.reverses_id = e.id)
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

-- Demo verisi: bağlı marketlere 30 gün vade; geçmişe işlenen teslimatların vadesi buna göre
update public.retailer_distributor_links set payment_term_days = 30 where payment_term_days = 0;
update public.account_entries e
   set due_date = e.entry_date + l.payment_term_days
  from public.retailer_distributor_links l
 where l.retailer_id = e.retailer_id and l.distributor_id = e.distributor_id
   and e.kind = 'siparis' and e.created_by is null;
