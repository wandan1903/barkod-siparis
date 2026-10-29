-- Distribütör hesabı market daveti kabul edemez (tek hesap, tek rol)
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
  if exists (select 1 from memberships m join organizations o on o.id = m.org_id
             where m.user_id = v_uid and o.type = 'distributor') then
    raise exception 'Bu hesap bir distribütör hesabı. Market olarak katılmak için başka bir e-posta ile kayıt olun';
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
