-- Firma bilgilerini (ad, vergi no, il, ilçe) hesap sahibi güncelleyebilir
create or replace function public.update_org_profile(
  p_org uuid, p_name text, p_tax_no text default null, p_city text default null, p_district text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from memberships m where m.org_id = p_org and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'Firma bilgilerini yalnızca hesap sahibi değiştirebilir';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'Firma adı boş olamaz';
  end if;
  if nullif(trim(p_tax_no), '') is not null and trim(p_tax_no) !~ '^[0-9]{10,11}$' then
    raise exception 'Vergi / TC kimlik numarası 10 ya da 11 haneli olmalı';
  end if;
  update organizations
     set name = left(trim(p_name), 120),
         tax_no = nullif(trim(p_tax_no), ''),
         city = left(nullif(trim(p_city), ''), 80),
         district = left(nullif(trim(p_district), ''), 80)
   where id = p_org;
end;
$$;
revoke execute on function public.update_org_profile(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_org_profile(uuid, text, text, text, text) to authenticated;
