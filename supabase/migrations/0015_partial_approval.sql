-- Gelen market siparişi önizleme + kısmi onay
--  * order_lines.requested_cases: marketin istediği koli (cases = distribütörün onayladığı)
--  * orders.distributor_note: distribütörün markete notu
--  * public.approve_order_partial(): koli adetlerini düşürerek onaylar; hepsi 0 ise reddeder

alter table public.order_lines add column requested_cases integer;
update public.order_lines set requested_cases = cases where requested_cases is null;
alter table public.order_lines add constraint order_lines_requested_ok check (requested_cases is null or requested_cases >= cases);
alter table public.orders add column distributor_note text;

create or replace function private.order_line_requested()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.requested_cases := coalesce(new.requested_cases, new.cases);
  elsif new.cases > coalesce(new.requested_cases, old.cases) and new.requested_cases is not distinct from old.requested_cases then
    new.requested_cases := new.cases;  -- market/teklif düzenlemesi: istenen de artar
  end if;
  return new;
end;
$$;
create trigger order_lines_requested before insert or update on public.order_lines
for each row execute function private.order_line_requested();

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
        v_title := 'Siparişin onaylandı';
        v_body := v_distributor || ' siparişini onayladı.';
        if exists (select 1 from order_lines ol where ol.order_id = new.id and ol.cases < ol.requested_cases) then
          v_title := 'Siparişin kısmen onaylandı';
          v_body := v_distributor || ' bazı ürünleri eksik gönderecek. Ayrıntı için siparişe bak.';
        end if;
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

create or replace function public.approve_order_partial(p_order uuid, p_lines jsonb, p_note text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_order orders;
  v_total int := 0;
  l jsonb;
  v_req int;
  v_n int;
begin
  select * into v_order from orders where id = p_order for update;
  if not found or not private.is_member(v_order.distributor_id) then
    raise exception 'Sipariş bulunamadı';
  end if;
  if v_order.origin <> 'order' or v_order.status <> 'sent' then
    raise exception 'Bu sipariş artık onaylanamaz';
  end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    select requested_cases into v_req from order_lines
      where order_id = p_order and product_id = (l->>'product_id')::uuid;
    if not found then raise exception 'Siparişte olmayan ürün'; end if;
    v_n := greatest(coalesce((l->>'cases')::int, 0), 0);
    if v_n > v_req then raise exception 'İstenenden fazla koli onaylanamaz'; end if;
    update order_lines set cases = v_n
      where order_id = p_order and product_id = (l->>'product_id')::uuid;
    v_total := v_total + v_n;
  end loop;

  if v_total = 0 then
    update orders set status = 'rejected', distributor_note = nullif(trim(p_note), '') where id = p_order;
    return 'rejected';
  end if;

  update orders set status = 'approved', distributor_note = nullif(trim(p_note), '') where id = p_order;
  return 'approved';
end;
$$;
revoke execute on function public.approve_order_partial(uuid, jsonb, text) from public, anon;
grant execute on function public.approve_order_partial(uuid, jsonb, text) to authenticated;
