-- Bir market için aynı distribütörden aynı anda yalnızca bir yanıt bekleyen teklif olabilir.
create unique index if not exists uq_one_open_offer
  on public.orders (retailer_id, distributor_id)
  where origin = 'offer' and status = 'sent';
