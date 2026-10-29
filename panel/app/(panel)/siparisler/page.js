'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { tl, shortDate, ORDER_STATUS_LABEL, errorText } from '@/lib/format';

// Sütunlar: her biri siparişleri bir koşulla süzer
const LANES = [
  { key: 'incoming', title: 'Marketten gelen siparişler', match: (o) => o.origin === 'order' && o.status === 'sent' },
  { key: 'offers', title: 'Teklif: market onayı bekliyor', match: (o) => o.origin === 'offer' && o.status === 'sent' },
  { key: 'changes', title: ORDER_STATUS_LABEL.changes_requested, match: (o) => o.status === 'changes_requested' },
  { key: 'approved', title: ORDER_STATUS_LABEL.approved, match: (o) => o.status === 'approved' },
  { key: 'shipped', title: ORDER_STATUS_LABEL.shipped, match: (o) => o.status === 'shipped' },
  { key: 'delivered', title: ORDER_STATUS_LABEL.delivered, match: (o) => o.status === 'delivered' },
];

export default function OrdersPage() {
  const { org } = useOrg();
  const [orders, setOrders] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('orders')
      .select(
        'id, status, origin, total, note, delivery_date, created_at, ' +
          'retailer:organizations!orders_retailer_id_fkey(name), ' +
          'order_lines(product_id, cases, accepted_cases, case_price, products(name))'
      )
      .eq('distributor_id', org.id)
      .order('created_at', { ascending: false });
    if (loadError) {
      setMessage({ kind: 'error', text: errorText(loadError) });
      setOrders([]);
      return;
    }
    setOrders(data || []);
  }, [org.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(order, status, okText) {
    setBusy(order.id + status);
    setMessage(null);
    const { error } = await supabase
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', order.id);
    setBusy('');
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setMessage({ kind: 'ok', text: okText });
    load();
  }

  if (!orders) return <div className="center">Yükleniyor…</div>;

  const incoming = orders.filter(LANES[0].match).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Siparişler</h1>
          <p className="sub">
            Marketten gelen sipariş ya da sizin teklifiniz → onay → sevkiyat → teslim (mal kabul stoğu günceller)
          </p>
        </div>
      </div>

      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}
      {incoming ? (
        <div className="notice ok">
          <strong>{incoming} market siparişi onayınızı bekliyor.</strong>
        </div>
      ) : null}

      <div className="board">
        {LANES.map((lane) => {
          const items = orders.filter(lane.match);
          return (
            <section key={lane.key} className="lane">
              <h2>{lane.title} · {items.length}</h2>
              {items.map((o) => {
                const lines = o.order_lines || [];
                const cases = lines.reduce((s, l) => s + Number(l.cases || 0), 0);
                const accepted = lines.reduce((s, l) => s + Number(l.accepted_cases || 0), 0);
                return (
                  <div key={o.id} className="ticket">
                    <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <span className="strong">{o.retailer ? o.retailer.name : 'Market'}</span>
                      {o.origin === 'order' ? <span className="badge info">Market siparişi</span> : null}
                    </span>
                    <span className="muted small">{cases} koli · {tl(o.total)}</span>
                    <span className="muted small">
                      {lane.key === 'delivered'
                        ? `${accepted} / ${cases} koli kabul edildi`
                        : `Oluşturuldu ${shortDate(o.created_at)}${o.delivery_date ? ` · teslim ${shortDate(o.delivery_date)}` : ''}`}
                    </span>

                    {lane.key === 'incoming' ? (
                      <>
                        <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {lines.map((l) => (
                            <span key={l.product_id} className="small" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                              <span>{l.products ? l.products.name : 'Ürün'}</span>
                              <span className="strong">{l.cases} koli</span>
                            </span>
                          ))}
                        </div>
                        {o.note ? <span className="small muted">Not: {o.note}</span> : null}
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn small"
                            style={{ flex: 1 }}
                            disabled={!!busy}
                            onClick={() => setStatus(o, 'rejected', 'Sipariş reddedildi.')}
                          >
                            Reddet
                          </button>
                          <button
                            className="btn primary small"
                            style={{ flex: 2 }}
                            disabled={!!busy}
                            onClick={() => setStatus(o, 'approved', 'Sipariş onaylandı. Sevkiyata hazır.')}
                          >
                            Onayla
                          </button>
                        </div>
                      </>
                    ) : null}

                    {lane.key === 'approved' ? (
                      <button
                        className="btn primary small"
                        disabled={!!busy}
                        onClick={() => setStatus(o, 'shipped', 'Sipariş yola çıktı. Market teslim aldığında stoğuna eklenecek.')}
                      >
                        Sevkiyata gönder
                      </button>
                    ) : null}
                  </div>
                );
              })}
              {!items.length ? <span className="muted small" style={{ padding: '0 4px' }}>Boş</span> : null}
            </section>
          );
        })}
      </div>
    </>
  );
}
