'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { num, tl, shortDate, errorText } from '@/lib/format';
import MiniCalendar from '@/components/MiniCalendar';

export default function MarketHome() {
  const { org } = useOrg();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const [stock, orders, sales] = await Promise.all([
        supabase.rpc('retailer_stock_overview', { p_retailer: org.id }),
        supabase
          .from('orders')
          .select('id, status, origin, total, delivery_date, distributor:organizations!orders_distributor_id_fkey(name), order_lines(cases)')
          .eq('retailer_id', org.id)
          .in('status', ['sent', 'shipped']),
        supabase.from('sales').select('id, total').eq('retailer_id', org.id).gte('created_at', startOfDay.toISOString()),
      ]);
      if (stock.error) setError(errorText(stock.error));
      const low = (stock.data || [])
        .filter((r) => r.days_left !== null && Number(r.days_left) <= 3)
        .sort((a, b) => Number(a.days_left) - Number(b.days_left));
      setData({
        low,
        offers: (orders.data || []).filter((o) => o.status === 'sent' && o.origin === 'offer'),
        myPending: (orders.data || []).filter((o) => o.status === 'sent' && o.origin === 'order'),
        shipments: (orders.data || []).filter((o) => o.status === 'shipped'),
        salesCount: (sales.data || []).length,
        salesTotal: (sales.data || []).reduce((s, x) => s + Number(x.total || 0), 0),
      });
    }
    load();
  }, [org.id]);

  if (!data) return <div className="center">Yükleniyor…</div>;

  const firstOffer = data.offers[0];
  const offerCases = firstOffer ? (firstOffer.order_lines || []).reduce((s, l) => s + l.cases, 0) : 0;

  return (
    <>
      {error ? <div className="notice error">{error}</div> : null}

      {firstOffer ? (
        <section className="hero">
          <span className="eyebrow">{firstOffer.distributor ? firstOffer.distributor.name : 'Distribütör'} · sipariş önerisi</span>
          <span className="title">
            {data.offers.length > 1 ? `${data.offers.length} sipariş önerin hazır` : `${(firstOffer.order_lines || []).length} ürün için sipariş önerin hazır`}
          </span>
          <span style={{ fontSize: 14, opacity: 0.92 }}>{offerCases} koli · {tl(firstOffer.total)}</span>
          <Link href="/market/teklifler" className="btn">Öneriyi incele</Link>
        </section>
      ) : null}

      {data.myPending.length ? (
        <section className="list">
          <div className="list-row">
            <div className="grow-1">
              <span className="strong">Siparişiniz onay bekliyor</span>
              <span className="muted small">
                {data.myPending.length} sipariş · {tl(data.myPending.reduce((s, o) => s + Number(o.total || 0), 0))}
              </span>
            </div>
            <Link href="/market/teklifler" className="btn small">Gör</Link>
          </div>
        </section>
      ) : null}

      {data.shipments.map((s) => (
        <section key={s.id} className="list">
          <div className="list-row">
            <div className="grow-1">
              <span className="strong">Teslimat geliyor</span>
              <span className="muted small">
                {s.distributor ? s.distributor.name : ''} · {(s.order_lines || []).reduce((x, l) => x + l.cases, 0)} koli · {shortDate(s.delivery_date)}
              </span>
            </div>
            <Link href="/market/teslimat" className="btn small outline">Teslim al</Link>
          </div>
        </section>
      ))}

      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2>Azalan ürünler</h2>
          <span className="muted small">3 gün ve altı</span>
        </div>
        {!data.low.length ? (
          <p className="muted">Şu an bitmek üzere olan ürün yok.</p>
        ) : (
          data.low.slice(0, 6).map((r) => {
            const pct = Math.max(4, Math.min(100, (Number(r.days_left) / 7) * 100));
            const critical = Number(r.days_left) <= 2;
            return (
              <div key={r.product_id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 14 }}>
                  <span>{r.product_name}</span>
                  <span className={critical ? 'warn-text' : 'strong'}>{num(r.stock_cases)} koli · ~{num(r.days_left)} gün</span>
                </div>
                <div className="meter"><div className={critical ? 'low' : ''} style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })
        )}
        {data.low.length > 6 ? <Link href="/market/stok" className="small">Tümünü gör ({data.low.length})</Link> : null}
      </section>

      <MiniCalendar compact />

      <section className="kpis" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <div className="kpi"><span className="label">Bugünkü satış</span><span className="value">{data.salesCount}</span></div>
        <div className="kpi"><span className="label">Bugünkü ciro</span><span className="value" style={{ fontSize: 22 }}>{tl(data.salesTotal)}</span></div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        <Link href="/market/satis" className="btn primary" style={{ minHeight: 52 }}>Satış yap</Link>
        <Link href="/market/siparis-ver" className="btn outline" style={{ minHeight: 52 }}>Sipariş ver</Link>
      </div>
    </>
  );
}
