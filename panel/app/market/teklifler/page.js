'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { num, tl, shortDate, ORDER_STATUS_LABEL, errorText } from '@/lib/format';

const ORDER_SELECT =
  'id, status, origin, total, delivery_date, created_at, distributor_id, note, ' +
  'distributor:organizations!orders_distributor_id_fkey(name), ' +
  'order_lines(product_id, cases, case_price, suggested_cases, campaign_id, products(name, case_qty))';

export default function OffersPage() {
  const { org } = useOrg();
  const [offers, setOffers] = useState(null);
  const [myOrders, setMyOrders] = useState([]);
  const [history, setHistory] = useState([]);
  const [stock, setStock] = useState(new Map());
  const [campaigns, setCampaigns] = useState([]);
  const [qty, setQty] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const [o, m, h, s, c] = await Promise.all([
      supabase.from('orders').select(ORDER_SELECT).eq('retailer_id', org.id).eq('origin', 'offer').eq('status', 'sent').order('created_at', { ascending: false }),
      supabase
        .from('orders')
        .select(ORDER_SELECT)
        .eq('retailer_id', org.id)
        .eq('origin', 'order')
        .in('status', ['sent', 'approved', 'shipped'])
        .order('created_at', { ascending: false }),
      supabase
        .from('orders')
        .select('id, status, origin, total, created_at, distributor:organizations!orders_distributor_id_fkey(name)')
        .eq('retailer_id', org.id)
        .in('status', ['delivered', 'rejected'])
        .order('created_at', { ascending: false })
        .limit(10),
      supabase.rpc('retailer_stock_overview', { p_retailer: org.id }),
      supabase.from('campaigns').select('id, kind, distributor_id, distributor:organizations!campaigns_distributor_id_fkey(name), product_id, title, case_price, rule, ends_at, products!campaigns_product_id_fkey(name), campaign_items(product_id, cases, case_price, products(name))').gt('ends_at', new Date().toISOString()).lte('starts_at', new Date().toISOString()),
    ]);
    if (o.error) setMessage({ kind: 'error', text: errorText(o.error) });
    const list = o.data || [];
    setOffers(list);
    setMyOrders(m.data || []);
    setHistory(h.data || []);
    setStock(new Map((s.data || []).map((r) => [r.product_id, r])));
    setCampaigns(c.data || []);
    const initial = {};
    for (const order of list) for (const l of order.order_lines || []) initial[`${order.id}:${l.product_id}`] = l.cases;
    setQty(initial);
  }, [org.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('gonderildi=1')) {
      setMessage({ kind: 'ok', text: 'Siparişiniz distribütöre gönderildi. Onaylandığında burada göreceksiniz.' });
    }
  }, []);

  async function cancelOrder(order) {
    setBusy(order.id + 'cancel');
    const { error } = await supabase.from('orders').update({ status: 'rejected' }).eq('id', order.id);
    setBusy('');
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setMessage({ kind: 'ok', text: 'Sipariş iptal edildi.' });
    load();
  }

  function setLineQty(orderId, productId, value) {
    setQty({ ...qty, [`${orderId}:${productId}`]: Math.max(0, value) });
  }

  function orderTotal(order) {
    return (order.order_lines || []).reduce(
      (s, l) => s + Number(qty[`${order.id}:${l.product_id}`] ?? l.cases) * Number(l.case_price),
      0
    );
  }

  async function respond(order, action) {
    setBusy(order.id + action);
    setMessage(null);
    const lines = (order.order_lines || []).map((l) => ({
      product_id: l.product_id,
      cases: Number(qty[`${order.id}:${l.product_id}`] ?? l.cases),
    }));
    const { error } = await supabase.rpc('respond_order', {
      p_order: order.id,
      p_action: action,
      p_lines: action === 'approve' ? lines : null,
    });
    setBusy('');
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setMessage({
      kind: 'ok',
      text: action === 'approve' ? 'Sipariş onaylandı. Distribütör sevkiyatı hazırlayacak.' : 'Teklif reddedildi.',
    });
    load();
  }

  async function addCampaign(order, campaign) {
    const rule = campaign.rule || {};
    const cases = Number(rule.buy || rule.min_cases || 1);
    const { error } = await supabase
      .from('order_lines')
      .insert({ order_id: order.id, product_id: campaign.product_id, cases, case_price: 0, campaign_id: campaign.id });
    if (error) {
      setMessage({ kind: 'error', text: error.code === '23505' ? 'Bu ürün siparişte zaten var; adedini değiştirebilirsiniz.' : errorText(error) });
      return;
    }
    load();
  }

  async function addBundle(order, campaign) {
    setMessage(null);
    const { error } = await supabase.rpc('add_bundle_to_order', { p_order: order.id, p_campaign: campaign.id });
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    load();
  }

  if (!offers) return <div className="center">Yükleniyor…</div>;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 style={{ fontSize: 22 }}>Siparişler</h1>
        <Link href="/market/siparis-ver" className="btn primary">Sipariş ver</Link>
      </div>
      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}

      {myOrders.length ? (
        <section className="card">
          <h2>Verdiğiniz siparişler</h2>
          {myOrders.map((o) => {
            const cases = (o.order_lines || []).reduce((s, l) => s + l.cases, 0);
            const label = o.status === 'sent' ? 'Distribütör onayı bekliyor' : o.status === 'approved' ? 'Onaylandı, hazırlanıyor' : 'Yolda';
            return (
              <div key={o.id} className="list-row" style={{ padding: '10px 0' }}>
                <div className="grow-1">
                  <span className="strong">{o.distributor ? o.distributor.name : 'Distribütör'}</span>
                  <span className="muted small">{shortDate(o.created_at)} · {cases} koli · {tl(o.total)}</span>
                  <span className={`badge ${o.status === 'sent' ? 'info' : 'ok'}`} style={{ alignSelf: 'flex-start' }}>{label}</span>
                </div>
                {o.status === 'sent' ? (
                  <button className="btn small" onClick={() => cancelOrder(o)} disabled={!!busy}>İptal et</button>
                ) : o.status === 'shipped' ? (
                  <Link href="/market/teslimat" className="btn small outline">Teslim al</Link>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

      {campaigns.length ? (
        <>
          <h2 style={{ marginTop: 4 }}>Aktif kampanyalar</h2>
          {campaigns.map((c) => (
            <div key={c.id} className="campaign">
              <span className="tag">{c.kind === 'bundle' ? 'PAKET KAMPANYA' : 'KAMPANYA'}</span>
              <span className="strong">{c.title}</span>
              <span className="muted small">{c.distributor ? c.distributor.name : 'Distribütör'}</span>
              {c.kind === 'bundle' ? (
                <>
                  {(c.campaign_items || []).map((it) => (
                    <span key={it.product_id} className="small">{it.cases} koli {it.products ? it.products.name : 'Ürün'} · koli {tl(it.case_price)}</span>
                  ))}
                  <span className="small">{shortDate(c.ends_at)} tarihine kadar · paketin tamamı alınmalı</span>
                </>
              ) : (
                <span className="small">
                  {c.products ? c.products.name : 'Ürün'}{c.case_price ? ` · koli ${tl(c.case_price)}` : ''} · {shortDate(c.ends_at)} tarihine kadar
                  {c.rule && c.rule.min_cases > 1 ? ` · en az ${c.rule.min_cases} koli` : ''}
                </span>
              )}
              <Link href={`/market/siparis-ver?kampanya=${c.id}`} className="btn small" style={{ alignSelf: 'flex-start' }}>
                Bu kampanyayla sipariş ver
              </Link>
            </div>
          ))}
        </>
      ) : null}

      <h2 style={{ marginTop: 4 }}>Distribütörden gelen öneriler</h2>
      {!offers.length ? <p className="muted">Bekleyen sipariş önerisi yok.</p> : null}

      {offers.map((order) => {
        const lines = order.order_lines || [];
        const inOrder = new Set(lines.map((l) => l.product_id));
        const usedCampaigns = new Set(lines.map((l) => l.campaign_id).filter(Boolean));
        const offerCampaigns = campaigns.filter(
          (c) =>
            c.distributor_id === order.distributor_id &&
            !usedCampaigns.has(c.id) &&
            (c.kind === 'bundle' || !inOrder.has(c.product_id))
        );
        const cases = lines.reduce((s, l) => s + Number(qty[`${order.id}:${l.product_id}`] ?? l.cases), 0);
        return (
          <section key={order.id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="muted small">
              {order.distributor ? order.distributor.name : 'Distribütör'} · teslim {shortDate(order.delivery_date)}
            </div>
            <div className="list">
              {lines.map((l) => {
                const key = `${order.id}:${l.product_id}`;
                const n = Number(qty[key] ?? l.cases);
                const s = stock.get(l.product_id);
                return (
                  <div key={l.product_id} className="list-row" style={{ flexWrap: 'wrap' }}>
                    <div className="grow-1">
                      <span className="strong">{l.products ? l.products.name : 'Ürün'}</span>
                      <span className="muted small">
                        Koli {tl(l.case_price)}
                        {l.products ? ` · ${l.products.case_qty} adet` : ''}
                        {s ? ` · kalan ${num(s.stock_cases)} koli` : ''}
                        {l.campaign_id ? ' · kampanya' : ''}
                      </span>
                    </div>
                    <div className="stepper">
                      <button type="button" aria-label="Azalt" onClick={() => setLineQty(order.id, l.product_id, n - 1)}>−</button>
                      <span className="val">{n}</span>
                      <button type="button" aria-label="Artır" onClick={() => setLineQty(order.id, l.product_id, n + 1)}>+</button>
                    </div>
                  </div>
                );
              })}
            </div>

            {offerCampaigns.map((c) => (
              <div key={c.id} className="campaign">
                <span className="tag">BU HAFTA KAMPANYA</span>
                <span className="strong">{c.title}</span>
                {c.kind === 'bundle' ? (
                  <>
                    {(c.campaign_items || []).map((it) => (
                      <span key={it.product_id} className="small">{it.cases} koli {it.products ? it.products.name : 'Ürün'} · koli {tl(it.case_price)}</span>
                    ))}
                    <span className="small">{shortDate(c.ends_at)} tarihine kadar · paketin tamamı alınmalı</span>
                  </>
                ) : (
                  <>
                    {c.case_price ? <span className="small">Koli {tl(c.case_price)} · {shortDate(c.ends_at)} tarihine kadar</span> : null}
                    {c.rule && c.rule.min_cases > 1 ? <span className="small">En az {c.rule.min_cases} koli</span> : null}
                  </>
                )}
                <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => (c.kind === 'bundle' ? addBundle(order, c) : addCampaign(order, c))}>
                  {c.kind === 'bundle' ? 'Paketi siparişe ekle' : 'Siparişe ekle'}
                </button>
              </div>
            ))}

            <div className="sticky-foot">
              <div className="total-row"><span>{cases} koli toplam</span><strong>{tl(orderTotal(order))}</strong></div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn" style={{ flex: 1 }} onClick={() => respond(order, 'reject')} disabled={!!busy}>Reddet</button>
                <button className="btn primary" style={{ flex: 2 }} onClick={() => respond(order, 'approve')} disabled={!!busy || cases === 0}>
                  {busy === order.id + 'approve' ? 'Onaylanıyor…' : 'Onayla'}
                </button>
              </div>
            </div>
          </section>
        );
      })}

      {history.length ? (
        <section className="card">
          <h2>Son siparişler</h2>
          {history.map((o) => (
            <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 14 }}>
              <span>{shortDate(o.created_at)} · {o.distributor ? o.distributor.name : ''}</span>
              <span className="muted">
                {o.origin === 'order' && o.status === 'rejected' ? 'İptal / reddedildi' : ORDER_STATUS_LABEL[o.status]} · {tl(o.total)}
              </span>
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}
