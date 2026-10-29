'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { tl, shortDate, errorText } from '@/lib/format';

export default function DeliveryPage() {
  const { org } = useOrg();
  const router = useRouter();
  const [orders, setOrders] = useState(null);
  const [accepted, setAccepted] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('id, total, delivery_date, distributor:organizations!orders_distributor_id_fkey(name), order_lines(product_id, cases, case_price, products(name))')
      .eq('retailer_id', org.id)
      .eq('status', 'shipped')
      .order('delivery_date');
    if (error) setMessage({ kind: 'error', text: errorText(error) });
    const list = data || [];
    setOrders(list);
    const init = {};
    for (const o of list) for (const l of o.order_lines || []) init[`${o.id}:${l.product_id}`] = l.cases;
    setAccepted(init);
  }, [org.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function receive(order) {
    setBusy(true);
    const lines = (order.order_lines || []).map((l) => ({
      product_id: l.product_id,
      accepted_cases: Number(accepted[`${order.id}:${l.product_id}`] ?? l.cases),
    }));
    const { error } = await supabase.rpc('receive_order', { p_order: order.id, p_lines: lines });
    setBusy(false);
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    router.push('/market');
  }

  if (!orders) return <div className="center">Yükleniyor…</div>;

  return (
    <>
      <h1 style={{ fontSize: 22 }}>Mal kabul</h1>
      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}
      {!orders.length ? <p className="muted">Yolda olan teslimat yok.</p> : null}

      {orders.map((o) => {
        const lines = (o.order_lines || []).filter((l) => l.cases > 0);
        const total = lines.reduce((s, l) => s + Number(accepted[`${o.id}:${l.product_id}`] ?? l.cases), 0);
        const ordered = lines.reduce((s, l) => s + l.cases, 0);
        return (
          <section key={o.id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="notice ok small">
              {o.distributor ? o.distributor.name : ''} · teslim {shortDate(o.delivery_date)} · {tl(o.total)}.
              Gelen koli sayısını kontrol edin; eksik gelen ürünün adedini düşürün. Teslim aldığınız ürünler stoğunuza kendiliğinden eklenir.
            </div>
            <div className="list">
              {lines.map((l) => {
                const key = `${o.id}:${l.product_id}`;
                const n = Number(accepted[key] ?? l.cases);
                return (
                  <div key={l.product_id} className="list-row">
                    <div className="grow-1">
                      <span className="strong">{l.products ? l.products.name : 'Ürün'}</span>
                      <span className={n < l.cases ? 'warn-text small' : 'muted small'}>
                        {n < l.cases ? `Eksik: ${l.cases - n} koli` : `Sipariş: ${l.cases} koli`}
                      </span>
                    </div>
                    <div className="stepper">
                      <button type="button" aria-label="Azalt" onClick={() => setAccepted({ ...accepted, [key]: Math.max(0, n - 1) })}>−</button>
                      <span className="val">{n}</span>
                      <button type="button" aria-label="Artır" onClick={() => setAccepted({ ...accepted, [key]: Math.min(l.cases, n + 1) })}>+</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <button className="btn primary" style={{ minHeight: 52 }} onClick={() => receive(o)} disabled={busy}>
              {busy ? 'Kaydediliyor…' : `Teslim aldım (${total} / ${ordered} koli)`}
            </button>
          </section>
        );
      })}
    </>
  );
}
