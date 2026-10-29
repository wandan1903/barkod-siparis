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
  const [review, setReview] = useState(null); // { order, qty, note }

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('orders')
      .select(
        'id, status, origin, total, note, delivery_date, created_at, ' +
          'retailer:organizations!orders_retailer_id_fkey(name), ' +
          'order_lines(product_id, cases, requested_cases, accepted_cases, case_price, products(name, case_qty))'
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

  function openReview(order) {
    const qty = {};
    for (const l of order.order_lines || []) qty[l.product_id] = Number(l.requested_cases ?? l.cases);
    setReview({ order, qty, note: '' });
  }

  function reviewQty(l, delta) {
    const max = Number(l.requested_cases ?? l.cases);
    const next = Math.min(max, Math.max(0, Number(review.qty[l.product_id]) + delta));
    setReview({ ...review, qty: { ...review.qty, [l.product_id]: next } });
  }

  async function submitReview() {
    const { order, qty, note } = review;
    setBusy('review');
    setMessage(null);
    const lines = (order.order_lines || []).map((l) => ({ product_id: l.product_id, cases: Number(qty[l.product_id]) }));
    const { data, error } = await supabase.rpc('approve_order_partial', { p_order: order.id, p_lines: lines, p_note: note });
    setBusy('');
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setReview(null);
    setMessage({
      kind: 'ok',
      text: data === 'rejected' ? 'Hiç ürün gönderilemediği için sipariş reddedildi.' : 'Sipariş onaylandı. Sevkiyata hazır.',
    });
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
                          <button className="btn primary small" style={{ flex: 2 }} disabled={!!busy} onClick={() => openReview(o)}>
                            İncele ve onayla
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
      {review ? (() => {
        const { order, qty, note } = review;
        const lines = order.order_lines || [];
        const req = lines.reduce((t, l) => t + Number(l.requested_cases ?? l.cases), 0);
        const sendCases = lines.reduce((t, l) => t + Number(qty[l.product_id]), 0);
        const sendValue = lines.reduce((t, l) => t + Number(qty[l.product_id]) * Number(l.case_price), 0);
        const cut = lines.some((l) => Number(qty[l.product_id]) < Number(l.requested_cases ?? l.cases));
        return (
          <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Sipariş önizleme" onClick={() => setReview(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ margin: 0 }}>{order.retailer ? order.retailer.name : 'Market'} siparişi</h2>
                  <span className="muted small">Oluşturuldu {shortDate(order.created_at)} · istenen {req} koli</span>
                </div>
                <button className="btn small" onClick={() => setReview(null)}>Kapat</button>
              </div>
              {order.note ? <div className="notice">Market notu: {order.note}</div> : null}
              <p className="muted small" style={{ margin: 0 }}>
                Elinizde yeterli ürün yoksa göndereceğiniz koli adedini düşürün. Market istediği ve onaylanan adedi görür.
              </p>
              <table>
                <thead>
                  <tr><th>Ürün</th><th>İstenen</th><th>Koli fiyatı</th><th>Göndereceğim</th></tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const max = Number(l.requested_cases ?? l.cases);
                    const n = Number(qty[l.product_id]);
                    return (
                      <tr key={l.product_id}>
                        <td>{l.products ? l.products.name : 'Ürün'}</td>
                        <td>{max} koli</td>
                        <td>{tl(l.case_price)}</td>
                        <td>
                          <span className="stepper">
                            <button type="button" aria-label="Azalt" onClick={() => reviewQty(l, -1)}>−</button>
                            <span className="val" style={n < max ? { color: 'var(--warn, #b45309)' } : undefined}>{n}</span>
                            <button type="button" aria-label="Artır" onClick={() => reviewQty(l, 1)}>+</button>
                          </span>
                          {n < max ? <span className="small muted" style={{ display: 'block' }}>{max - n} koli eksik</span> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {cut ? (
                <div className="field">
                  <label htmlFor="rv-note">Markete not (isteğe bağlı)</label>
                  <input id="rv-note" className="input" placeholder="ör. Süt bu hafta kısıtlı, kalanı gelecek hafta" value={note} onChange={(e) => setReview({ ...review, note: e.target.value })} />
                </div>
              ) : null}
              <div className="total-row"><span>{sendCases} / {req} koli gönderilecek</span><strong>{tl(sendValue)}</strong></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" disabled={!!busy} onClick={() => { const o = order; setReview(null); setStatus(o, 'rejected', 'Sipariş reddedildi.'); }}>Tümünü reddet</button>
                <button className="btn primary" style={{ flex: 1 }} disabled={!!busy || sendCases === 0} onClick={submitReview}>
                  {busy === 'review' ? 'Onaylanıyor…' : cut ? 'Kısmen onayla' : 'Siparişi onayla'}
                </button>
              </div>
            </div>
          </div>
        );
      })() : null}
    </>
  );
}
