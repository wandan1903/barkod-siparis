-- 1) Depo azalınca / bitince distribütöre anında bildirim
-- 2) Davet sistemi: distribütör market davet eder; her kuruluş ekibine kullanıcı davet eder
--    * invites: tek kullanımlık, 14 gün geçerli, tahmin edilemez bağlantı kodu
--    * create_invite / get_invite (herkese açık, yalnızca ad bilgisi) / accept_invite / revoke_invite
--    * org_members: kuruluşun kullanıcıları (e-posta ile)

-- ---------------------------------------------------------------------------
-- 1) Depo uyarısı
-- ---------------------------------------------------------------------------
create or replace function private.warehouse_alert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p products%rowtype;
  v_new text;
  v_old text;
  v_cases int;
  v_body text;
  v_today text := to_char(now() at time zone 'Europe/Istanbul', 'YYYY-MM-DD');
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  select * into p from products where id = new.product_id;
  if not found then return new; end if;

  v_cases := new.qty_units / p.case_qty;
  v_new := case when new.qty_units = 0 then 'out'
                when new.min_cases is not null and v_cases < new.min_cases then 'low'
                else 'ok' end;
  v_old := case when old.qty_units = 0 then 'out'
                when old.min_cases is not null and (old.qty_units / p.case_qty) < old.min_cases then 'low'
                else 'ok' end;

  if v_new <> 'ok' and v_new <> v_old then
    v_body := case v_new
      when 'out' then 'Depoda kalmadı. Tedarikçiden yeni mal girişi gerekebilir.'
      else v_cases || ' koli kaldı (kritik eşik ' || new.min_cases || ' koli).' end;
    perform private.notify(
      new.distributor_id, 'low_stock',
      case v_new when 'out' then 'Depoda bitti: ' else 'Depoda azaldı: ' end || p.name,
      v_body, '/depo',
      'wh:' || new.distributor_id || ':' || new.product_id || ':' || v_new || ':' || v_today
    );
  end if;
  return new;
end;
$$;
revoke all on function private.warehouse_alert() from public, anon, authenticated;
create trigger warehouse_stock_alert after update of qty_units, min_cases on public.warehouse_stock
for each row execute function private.warehouse_alert();

-- ---------------------------------------------------------------------------
-- 2) Davetler
-- ---------------------------------------------------------------------------
create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  kind        text not null check (kind in ('market', 'member')),
  org_id      uuid not null references public.organizations(id) on delete cascade, -- davet eden kuruluş
  name        text,                      -- market daveti: önerilen market adı; ekip daveti: kişinin adı/notu
  created_by  uuid,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  used_at     timestamptz,
  used_by     uuid,
  used_org_id uuid references public.organizations(id) on delete set null,
  revoked_at  timestamptz
);
create index idx_invites_org on public.invites (org_id, created_at desc);
create index idx_invites_used_org on public.invites (used_org_id) where used_org_id is not null;
alter table public.invites enable row level security;
create policy invites_member_read on public.invites for select using (private.is_member(org_id));
-- yazma yalnızca fonksiyonlarla

create or replace function public.create_invite(p_org uuid, p_kind text, p_name text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_type org_type;
  v_token text;
begin
  if not private.is_member(p_org) then
    raise exception 'Bu kuruluş adına işlem yetkiniz yok';
  end if;
  select type into v_type from organizations where id = p_org;
  if p_kind = 'market' and v_type <> 'distributor' then
    raise exception 'Market daveti yalnızca distribütörler gönderebilir';
  end if;
  if p_kind not in ('market', 'member') then
    raise exception 'Geçersiz davet türü';
  end if;
  if (select count(*) from invites where org_id = p_org and used_at is null and revoked_at is null and expires_at > now()) >= 50 then
    raise exception 'Çok fazla açık davet var; eskilerini iptal edin';
  end if;
  insert into invites (kind, org_id, name, created_by)
  values (p_kind, p_org, left(nullif(trim(p_name), ''), 120), auth.uid())
  returning token into v_token;
  return v_token;
end;
$$;
revoke execute on function public.create_invite(uuid, text, text) from public, anon;
grant execute on function public.create_invite(uuid, text, text) to authenticated;

-- Giriş yapmadan da çağrılabilir: yalnızca davetin geçerliliği ve gösterilecek adlar
create or replace function public.get_invite(p_token text)
returns table (kind text, org_name text, org_type text, suggested_name text, valid boolean, reason text)
language plpgsql security definer set search_path = public as $$
declare
  i invites%rowtype;
  o organizations%rowtype;
begin
  select * into i from invites where token = p_token;
  if not found then
    return query select null::text, null::text, null::text, null::text, false, 'Davet bulunamadı'::text;
    return;
  end if;
  select * into o from organizations where id = i.org_id;
  if i.revoked_at is not null then
    return query select i.kind, o.name, o.type::text, i.name, false, 'Bu davet iptal edilmiş'::text;
  elsif i.used_at is not null then
    return query select i.kind, o.name, o.type::text, i.name, false, 'Bu davet daha önce kullanılmış'::text;
  elsif i.expires_at < now() then
    return query select i.kind, o.name, o.type::text, i.name, false, 'Davetin süresi dolmuş'::text;
  else
    return query select i.kind, o.name, o.type::text, i.name, true, null::text;
  end if;
end;
$$;
revoke execute on function public.get_invite(text) from public;
grant execute on function public.get_invite(text) to anon, authenticated;

create or replace function public.accept_invite(p_token text, p_name text default null, p_consent boolean default false)
returns text   -- 'market' | 'panel'
language plpgsql security definer set search_path = public as $$
declare
  i invites%rowtype;
  v_uid uuid := auth.uid();
  v_retailer uuid;
  v_name text := left(nullif(trim(p_name), ''), 120);
begin
  if v_uid is null then
    raise exception 'Önce giriş yapın';
  end if;
  select * into i from invites where token = p_token for update;
  if not found or i.revoked_at is not null or i.used_at is not null or i.expires_at < now() then
    raise exception 'Davet geçerli değil';
  end if;

  if i.kind = 'member' then
    insert into memberships (user_id, org_id, role) values (v_uid, i.org_id, 'staff')
    on conflict do nothing;
    update invites set used_at = now(), used_by = v_uid, used_org_id = i.org_id where id = i.id;
    return case when (select type from organizations where id = i.org_id) = 'retailer' then 'market' else 'panel' end;
  end if;

  -- market daveti
  if not coalesce(p_consent, false) then
    raise exception 'Stok bilgisini distribütörle paylaşma onayı gerekli';
  end if;
  select m.org_id into v_retailer
  from memberships m join organizations o on o.id = m.org_id
  where m.user_id = v_uid and o.type = 'retailer' limit 1;

  if v_retailer is null then
    if v_name is null then raise exception 'Market adı gerekli'; end if;
    insert into organizations (type, name) values ('retailer', v_name) returning id into v_retailer;
    insert into memberships (user_id, org_id, role) values (v_uid, v_retailer, 'owner');
  end if;

  insert into retailer_distributor_links (retailer_id, distributor_id, status, stock_share_consent_at)
  values (v_retailer, i.org_id, 'active', now())
  on conflict (retailer_id, distributor_id) do update
    set status = 'active', stock_share_consent_at = now();

  update invites set used_at = now(), used_by = v_uid, used_org_id = v_retailer where id = i.id;

  perform private.notify(i.org_id, 'system', 'Yeni market bağlandı',
    coalesce((select name from organizations where id = v_retailer), 'Market') || ' davetinizi kabul etti.',
    '/marketler', 'invite:' || i.id);
  return 'market';
end;
$$;
revoke execute on function public.accept_invite(text, text, boolean) from public, anon;
grant execute on function public.accept_invite(text, text, boolean) to authenticated;

create or replace function public.revoke_invite(p_invite uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from invites where id = p_invite;
  if v_org is null or not private.is_member(v_org) then
    raise exception 'Davet bulunamadı';
  end if;
  update invites set revoked_at = now() where id = p_invite and used_at is null and revoked_at is null;
end;
$$;
revoke execute on function public.revoke_invite(uuid) from public, anon;
grant execute on function public.revoke_invite(uuid) to authenticated;

-- Kuruluşun kullanıcıları (e-posta yalnızca aynı kuruluşun üyelerine gösterilir)
create or replace function public.org_members(p_org uuid)
returns table (user_id uuid, email text, role text, joined_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not private.is_member(p_org) then
    raise exception 'Bu kuruluş adına işlem yetkiniz yok';
  end if;
  return query
    select m.user_id, u.email::text, m.role::text, m.created_at
    from memberships m join auth.users u on u.id = m.user_id
    where m.org_id = p_org
    order by m.created_at;
end;
$$;
revoke execute on function public.org_members(uuid) from public, anon;
grant execute on function public.org_members(uuid) to authenticated;
