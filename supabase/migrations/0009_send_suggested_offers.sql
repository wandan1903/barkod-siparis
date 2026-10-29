-- Toplu öneri gönderme: "cumartesi sipariş günü" akışı
-- Distribütör tek tuşla, seçtiği (ya da tüm) marketlere hesaplanmış önerileri teklif olarak gönderir.
-- Markette zaten yanıt bekleyen bir teklif varsa o market atlanır (çift teklif gitmez).

create or replace function public.send_suggested_offers(
  p_distributor uuid,
  p_retailers uuid[] default null
)
returns table (retailer_id uuid, retailer_name text, order_id uuid, line_count integer, total numeric, skipped_reason text)
language plpgsql security invoker set search_path = public as $$
declare
  r record;
  v_order uuid;
  v_delivery date;
begin
  if not private.is_member(p_distributor) then
    raise exception 'Bu distribütör adına işlem yetkiniz yok';
  end if;

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

    -- Teslim günü: bu çalışma ilişkisinin sipariş günü (varsayılan cumartesi); bugünse bugün
    select current_date + ((7 + coalesce(l.order_day, 6) - extract(dow from current_date)::int) % 7)
      into v_delivery
    from retailer_distributor_links l
    where l.retailer_id = r.rid and l.distributor_id = p_distributor;

    v_order := public.create_order(r.rid, p_distributor, r.lines, 'sent', v_delivery, 'Haftalık sipariş önerisi');

    retailer_id := r.rid; retailer_name := r.rname; order_id := v_order;
    select count(*)::int, coalesce(sum(ol.cases * ol.case_price), 0) into line_count, total
    from order_lines ol where ol.order_id = v_order;
    skipped_reason := null;
    return next;
  end loop;
end;
$$;

revoke execute on function public.send_suggested_offers(uuid, uuid[]) from public, anon;
grant execute on function public.send_suggested_offers(uuid, uuid[]) to authenticated;
