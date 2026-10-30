-- Veresiye defteri (yalnızca market; distribütör ve başka hiç kimse göremez)
--  * customers: marketin müşterileri (ad, isteğe bağlı telefon, limit)
--  * customer_entries: veresiye (+), ödeme (−), düzeltme (±), iptal (ters kayıt). Silme yok.
--  * record_credit_sale(): kasada satışı yapar ve tutarı müşterinin veresiyesine yazar (tek işlem)
--  * customer_balances(): müşteri başına bakiye, en eski açık borcun yaşı (FIFO), son ödeme
--  Kişisel veri (KVKK): telefon isteğe bağlıdır; müşteri silinmez, pasife alınır.

create table public.customers (
  id           uuid primary key default gen_random_uuid(),
  retailer_id  uuid not null references public.organizations(id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 120),
  phone        text check (phone is null or phone ~ '^\+[1-9][0-9]{9,14}$'),
  note         text,
  credit_limit numeric(12,2) check (credit_limit is null or credit_limit >= 0),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index idx_customers_retailer on public.customers (retailer_id, active, name);

create table public.customer_entries (
  id           uuid primary key default gen_random_uuid(),
  retailer_id  uuid not null references public.organizations(id) on delete cascade,
  customer_id  uuid not null references public.customers(id) on delete cascade,
  kind         text not null check (kind in ('veresiye', 'odeme', 'duzeltme', 'iptal')),
  amount       numeric(12,2) not null check (amount <> 0),   -- + müşterinin borcu artar
  method       text check (method in ('nakit', 'kart', 'havale', 'diger')),
  sale_id      uuid references public.sales(id) on delete set null,
  reverses_id  uuid references public.customer_entries(id),
  note         text,
  entry_date   date not null default (now() at time zone 'Europe/Istanbul')::date,
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create index idx_cust_entries_customer on public.customer_entries (customer_id, entry_date, created_at);
create index idx_cust_entries_retailer on public.customer_entries (retailer_id, created_at desc);
create index idx_cust_entries_sale on public.customer_entries (sale_id) where sale_id is not null;
create unique index uq_cust_entries_reverses on public.customer_entries (reverses_id) where reverses_id is not null;

alter table public.customers enable row level security;
alter table public.customer_entries enable row level security;
create policy customers_member_read on public.customers for select using (private.is_member(retailer_id));
create policy cust_entries_member_read on public.customer_entries for select using (private.is_member(retailer_id));
-- yazma yalnızca fonksiyonlarla

create or replace function private.assert_retailer_member(p_retailer uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not private.is_member(p_retailer)
     or not exists (select 1 from organizations where id = p_retailer and type = 'retailer') then
    raise exception 'Bu market adına işlem yetkiniz yok';
  end if;
end;
$$;
revoke all on function private.assert_retailer_member(uuid) from public, anon, authenticated;

-- Müşteri ekle / güncelle (p_id boşsa yeni)
create or replace function public.save_customer(
  p_retailer uuid, p_id uuid, p_name text, p_phone text default null, p_note text default null,
  p_credit_limit numeric default null, p_active boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform private.assert_retailer_member(p_retailer);
  if nullif(trim(p_name), '') is null then raise exception 'Müşteri adı girin'; end if;
  if p_credit_limit is not null and p_credit_limit < 0 then raise exception 'Limit negatif olamaz'; end if;
  if p_id is null then
    insert into customers (retailer_id, name, phone, note, credit_limit, active)
    values (p_retailer, trim(p_name), nullif(trim(p_phone), ''), left(nullif(trim(p_note), ''), 300), p_credit_limit, coalesce(p_active, true))
    returning id into v_id;
  else
    update customers
       set name = trim(p_name), phone = nullif(trim(p_phone), ''), note = left(nullif(trim(p_note), ''), 300),
           credit_limit = p_credit_limit, active = coalesce(p_active, true)
     where id = p_id and retailer_id = p_retailer
    returning id into v_id;
    if v_id is null then raise exception 'Müşteri bulunamadı'; end if;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.save_customer(uuid, uuid, text, text, text, numeric, boolean) from public, anon;
grant execute on function public.save_customer(uuid, uuid, text, text, text, numeric, boolean) to authenticated;

-- Veresiye / ödeme / düzeltme
create or replace function public.record_customer_entry(
  p_retailer uuid, p_customer uuid, p_kind text, p_amount numeric,
  p_method text default null, p_note text default null, p_sale uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_amount numeric(12,2);
  v_id uuid;
begin
  perform private.assert_retailer_member(p_retailer);
  if not exists (select 1 from customers where id = p_customer and retailer_id = p_retailer) then
    raise exception 'Müşteri bulunamadı';
  end if;
  if p_amount is null or p_amount = 0 then raise exception 'Tutar girin'; end if;
  if abs(p_amount) > 10000000 then raise exception 'Tutar çok yüksek'; end if;
  if p_sale is not null and not exists (select 1 from sales where id = p_sale and retailer_id = p_retailer) then
    raise exception 'Satış bulunamadı';
  end if;

  if p_kind = 'veresiye' then
    if p_amount < 0 then raise exception 'Tutarı pozitif girin'; end if;
    v_amount := round(p_amount, 2);
  elsif p_kind = 'odeme' then
    if p_amount < 0 then raise exception 'Tutarı pozitif girin'; end if;
    v_amount := -round(p_amount, 2);
  elsif p_kind = 'duzeltme' then
    if nullif(trim(p_note), '') is null then raise exception 'Düzeltme için açıklama yazın'; end if;
    v_amount := round(p_amount, 2);
  else
    raise exception 'Geçersiz kayıt türü';
  end if;

  insert into customer_entries (retailer_id, customer_id, kind, amount, method, sale_id, note, created_by)
  values (p_retailer, p_customer, p_kind, v_amount,
          case when p_kind = 'odeme' then coalesce(p_method, 'nakit') end,
          p_sale, left(nullif(trim(p_note), ''), 300), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.record_customer_entry(uuid, uuid, text, numeric, text, text, uuid) from public, anon;
grant execute on function public.record_customer_entry(uuid, uuid, text, numeric, text, text, uuid) to authenticated;

create or replace function public.reverse_customer_entry(p_entry uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  e customer_entries%rowtype;
  v_id uuid;
begin
  select * into e from customer_entries where id = p_entry for update;
  if not found then raise exception 'Kayıt bulunamadı'; end if;
  perform private.assert_retailer_member(e.retailer_id);
  if e.kind = 'iptal' then raise exception 'İptal kaydı tekrar iptal edilemez'; end if;
  if exists (select 1 from customer_entries where reverses_id = p_entry) then raise exception 'Bu kayıt zaten iptal edilmiş'; end if;
  insert into customer_entries (retailer_id, customer_id, kind, amount, reverses_id, note, created_by)
  values (e.retailer_id, e.customer_id, 'iptal', -e.amount, e.id, 'Kayıt iptali', auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.reverse_customer_entry(uuid) from public, anon;
grant execute on function public.reverse_customer_entry(uuid) to authenticated;

-- Kasada veresiyeye satış: satış + stok düşümü + veresiye kaydı tek işlemde
create or replace function public.record_credit_sale(p_retailer uuid, p_lines jsonb, p_customer uuid, p_note text default null)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_sale uuid;
  v_total numeric;
begin
  if not exists (select 1 from customers where id = p_customer and retailer_id = p_retailer and active) then
    raise exception 'Müşteri bulunamadı ya da pasif';
  end if;
  v_sale := public.record_sale(p_retailer, p_lines, null);
  select total into v_total from sales where id = v_sale;
  if coalesce(v_total, 0) <= 0 then
    raise exception 'Sepet tutarı 0. Ürünlere raf fiyatı girin';
  end if;
  perform public.record_customer_entry(p_retailer, p_customer, 'veresiye', v_total, null, coalesce(nullif(trim(p_note), ''), 'Kasadan veresiye satış'), v_sale);
  return v_sale;
end;
$$;
revoke execute on function public.record_credit_sale(uuid, jsonb, uuid, text) from public, anon;
grant execute on function public.record_credit_sale(uuid, jsonb, uuid, text) to authenticated;

-- Müşteri bakiyeleri. İptal edilen kayıtlar ve iptal kayıtları borç yaşı hesabına katılmaz.
create or replace function public.customer_balances(p_retailer uuid)
returns table (
  customer_id uuid, name text, phone text, note text, credit_limit numeric, active boolean,
  balance numeric, oldest_open_days integer, last_payment_date date, last_payment_amount numeric,
  last_activity date
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_today date := (now() at time zone 'Europe/Istanbul')::date;
begin
  perform private.assert_retailer_member(p_retailer);
  return query
  with e as (
    select ce.* from customer_entries ce
    where ce.retailer_id = p_retailer
  ),
  live as (
    select * from e
    where e.kind <> 'iptal' and not exists (select 1 from customer_entries x where x.reverses_id = e.id)
  ),
  credits as (
    select customer_id, -sum(amount) as pool from live where amount < 0 group by 1
  ),
  debits as (
    select customer_id, amount, entry_date,
           sum(amount) over (partition by customer_id order by entry_date, created_at, id) as cum
    from live where amount > 0
  ),
  oldest as (
    select d.customer_id, min(d.entry_date) filter (where d.cum - coalesce(c.pool, 0) > 0) as oldest_open
    from debits d left join credits c using (customer_id)
    group by 1
  ),
  bal as (
    select customer_id, sum(amount) as balance, max(entry_date) as last_activity from e group by 1
  ),
  lastpay as (
    select distinct on (customer_id) customer_id, entry_date, -amount as amt
    from live where kind = 'odeme'
    order by customer_id, entry_date desc, created_at desc
  )
  select c.id, c.name, c.phone, c.note, c.credit_limit::numeric, c.active,
         coalesce(b.balance, 0)::numeric,
         case when coalesce(b.balance, 0) > 0 and o.oldest_open is not null then (v_today - o.oldest_open)::int end,
         lp.entry_date, lp.amt::numeric, b.last_activity
  from customers c
  left join bal b on b.customer_id = c.id
  left join oldest o on o.customer_id = c.id
  left join lastpay lp on lp.customer_id = c.id
  where c.retailer_id = p_retailer
  order by coalesce(b.balance, 0) desc, c.name;
end;
$$;
revoke execute on function public.customer_balances(uuid) from public, anon;
grant execute on function public.customer_balances(uuid) to authenticated;
