'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { num, tl, shortDate, STOCK_SOURCE_LABEL, errorText } from '@/lib/format';
import MiniCalendar from '@/components/MiniCalendar';

const REFRESH_MS = 60 * 1000;

function timeLabel(d) {
  return d ? d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '–';
}

export default function OverviewPage() {
  const { org } = useOrg();
  const [rows, setRows] = useState(null);
  const [pendingOffers, setPendingOffers] = useState(new Map()); // retailer_id -> teklif
  const [incoming, setIncoming] = useState(0);
  const [campaigns, setCampaigns] = useState(0);
  const [loadedAt, setLoadedAt] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  const [horizon, setHorizon] = useState(3); // azalan ürün eşiği (gün)
  const [marketFilter, setMarketFilter] = useState('');

  const load = useCallback(async () => {
    const [overview, orders, camps] = await Promise.all([
      supabase.rpc('distributor_stock_overview', { p_distributor: org.id }),
      supabase
        .from('orders')
        .select('id, retailer_id, status, origin, total, created_at')
        .eq('distributor_id', org.id)
        .in('status', ['sent', 'changes_requested']),
      supabase.from('campaigns').select('id').eq('distributor_id', org.id).gt('ends_at', new Date().toISOString()),
    ]);
    if (overview.error) {
      setMessage({ kind: 'error', text: errorText(overview.error) });
      setRows([]);
      return;
    }
    setRows(overview.data || []);
    const list = orders.data || [];
    const offers = new Map();
    for (const o of list) if (o.origin === 'offer' && o.status === 'sent') offers.set(o.retailer_id, o);
    setPendingOffers(offers);
    setIncoming(list.filter((o) => (o.origin === 'order' && o.status === 'sent') || o.status === 'changes_requested').length);
    setCampaigns((camps.data || []).length);
    setLoadedAt(new Date());
  }, [org.id]);

  // İlk yükleme, dakikada bir ve sekmeye geri dönüldüğünde yenile
  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const markets = useMemo(() => {
    if (!rows) return [];
    const map = new Map();
    for (const r of rows) {
      const cur = map.get(r.retailer_id) || {
        id: r.retailer_id,
        name: r.retailer_name,
        district: r.district,
        source: r.stock_source,
        updatedAt: r.stock_updated_at,
        critical: 0,
        low: 0,
        minDays: null,
        suggestedCases: 0,
        suggestedValue: 0,
        suggestedLines: 0,
      };
      const days = r.days_left === null ? null : Number(r.days_left);
      if (days !== null && days <= 2) cur.critical += 1;
      if (days !== null && days <= 3) cur.low += 1;
      if (days !== null && (cur.minDays === null || days < cur.minDays)) cur.minDays = days;
      if (r.suggested_cases > 0) {
        cur.suggestedCases += r.suggested_cases;
        cur.suggestedValue += r.suggested_cases * Number(r.case_price);
        cur.suggestedLines += 1;
      }
      if (r.stock_updated_at && (!cur.updatedAt || r.stock_updated_at > cur.updatedAt)) cur.updatedAt = r.stock_updated_at;
      map.set(r.retailer_id, cur);
    }
    return Array.from(map.values()).sort((a, b) => (a.minDays ?? 99) - (b.minDays ?? 99));
  }, [rows]);

  const totals = useMemo(() => {
    const sendable = markets.filter((m) => m.suggestedLines > 0 && !pendingOffers.has(m.id));
    return {
      critical: markets.reduce((s, m) => s + m.critical, 0),
      weeklyCases: markets.reduce((s, m) => s + m.suggestedCases, 0),
      weeklyValue: markets.reduce((s, m) => s + m.suggestedValue, 0),
      sendable,
      sendableCases: sendable.reduce((s, m) => s + m.suggestedCases, 0),
      sendableValue: sendable.reduce((s, m) => s + m.suggestedValue, 0),
    };
  }, [markets, pendingOffers]);

  const lowItems = useMemo(() => {
    if (!rows) return [];
    return rows
      .filter((r) => r.days_left !== null && Number(r.days_left) <= horizon)
      .filter((r) => !marketFilter || r.retailer_id === marketFilter)
      .sort((a, b) => Number(a.days_left) - Number(b.days_left));
  }, [rows, horizon, marketFilter]);

  async function send(retailerIds) {
    setBusy(retailerIds ? retailerIds.join(',') : 'all');
    setConfirmAll(false);
    setMessage(null);
    const { data, error } = await supabase.rpc('send_suggested_offers', {
      p_distributor: org.id,
      p_retailers: retailerIds,
    });
    setBusy('');
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    const sent = (data || []).filter((x) => x.order_id);
    const skipped = (data || []).filter((x) => !x.order_id);
    if (!sent.length) {
      setMessage({ kind: 'error', text: skipped.length ? 'Gönderilecek yeni öneri yok: bu marketlerde yanıt bekleyen teklif var.' : 'Gönderilecek öneri yok.' });
    } else {
      const value = sent.reduce((s, x) => s + Number(x.total || 0), 0);
      setMessage({
        kind: 'ok',
        text:
          `${sent.length} markete sipariş önerisi gönderildi (${tl(value)}). Marketler telefonlarında onaylayacak.` +
          (skipped.length ? ` ${skipped.length} market atlandı: yanıt bekleyen teklifleri var.` : ''),
      });
    }
    load();
  }

  if (!rows) return <div className="center">Yükleniyor…</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Genel bakış</h1>
          <p className="sub">Bağlı marketlerdeki ürünlerinizin stok durumu · cumartesi sipariş haftası</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="muted small">Son güncelleme {timeLabel(loadedAt)}</span>
          <button className="btn small" onClick={load}>Yenile</button>
        </div>
      </div>

      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}

      <div className="row">
        <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section className="kpis" aria-label="Özet">
        <div className="kpi"><span className="label">Bağlı market</span><span className="value">{markets.length}</span></div>
        <div className="kpi"><span className="label">Kritik ürün (2 gün ve altı)</span><span className={`value ${totals.critical ? 'warn' : ''}`}>{totals.critical}</span></div>
        <div className="kpi">
          <span className="label">Bu haftaki önerilen sipariş</span>
          <span className="value">{num(totals.weeklyCases, 0)} koli</span>
          <span className="label">{tl(totals.weeklyValue)}</span>
        </div>
        <Link href="/siparisler" className="kpi" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="label">Onayınızı bekleyen sipariş</span>
          <span className={`value ${incoming ? 'warn' : ''}`}>{incoming}</span>
        </Link>
        <div className="kpi"><span className="label">Aktif kampanya</span><span className="value">{campaigns}</span></div>
      </section>

      <section className="card" style={{ border: '2px solid var(--green)' }}>
        <div className="page-head">
          <div>
            <h2>Sipariş önerileri</h2>
            <p className="sub">
              Öneri = son 4 haftanın ortalama haftalık satışı + 2 günlük yedek − kalan stok. Teklif markete gider, market telefonundan onaylar.
            </p>
          </div>
          {totals.sendable.length ? (
            confirmAll ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="small strong">{totals.sendable.length} markete teklif gidecek. Emin misiniz?</span>
                <button className="btn primary" onClick={() => send(null)} disabled={!!busy}>Evet, gönder</button>
                <button className="btn" onClick={() => setConfirmAll(false)}>Vazgeç</button>
              </div>
            ) : (
              <button className="btn primary" onClick={() => setConfirmAll(true)} disabled={!!busy}>
                {busy === 'all' ? 'Gönderiliyor…' : `Tüm önerileri gönder · ${totals.sendable.length} market · ${num(totals.sendableCases, 0)} koli · ${tl(totals.sendableValue)}`}
              </button>
            )
          ) : null}
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Market</th>
                <th>Veri kaynağı</th>
                <th className="num">Kritik ürün</th>
                <th className="num">En kısa</th>
                <th className="num">Önerilen</th>
                <th className="num">Tutar</th>
                <th>Durum</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {markets.map((m) => {
                const pending = pendingOffers.get(m.id);
                return (
                  <tr key={m.id}>
                    <td className="strong">
                      {m.name}
                      <div className="muted small">{m.district} · stok {shortDate(m.updatedAt)}</div>
                    </td>
                    <td className="muted">{STOCK_SOURCE_LABEL[m.source] || m.source}</td>
                    <td className={`num ${m.critical ? 'warn-text' : ''}`}>{m.critical}</td>
                    <td className={`num ${m.minDays !== null && m.minDays <= 2 ? 'warn-text' : ''}`}>
                      {m.minDays === null ? '–' : `${num(m.minDays)} gün`}
                    </td>
                    <td className="num strong">{m.suggestedCases ? `${num(m.suggestedCases, 0)} koli` : '–'}</td>
                    <td className="num">{m.suggestedValue ? tl(m.suggestedValue) : '–'}</td>
                    <td>
                      {pending ? (
                        <span className="badge info">Teklif gönderildi · {tl(pending.total)}</span>
                      ) : m.suggestedLines ? (
                        <span className="badge warn">Öneri hazır · {m.suggestedLines} ürün</span>
                      ) : (
                        <span className="badge ok">Stok yeterli</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {!pending && m.suggestedLines ? (
                          <button className="btn primary small" onClick={() => send([m.id])} disabled={!!busy}>
                            {busy === m.id ? 'Gönderiliyor…' : 'Öneriyi gönder'}
                          </button>
                        ) : null}
                        <Link href={`/marketler/${m.id}`} className="btn small">Düzenle</Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="page-head">
          <div>
            <h2>Azalan ürünler · {lowItems.length}</h2>
            <p className="sub">Marketlerdeki ürünleriniz, bitmesine kalan güne göre sıralı.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label className="sr-only" htmlFor="mf">Market</label>
            <select id="mf" className="input" style={{ width: 200 }} value={marketFilter} onChange={(e) => setMarketFilter(e.target.value)}>
              <option value="">Tüm marketler</option>
              {markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <label className="sr-only" htmlFor="hz">Eşik</label>
            <select id="hz" className="input" style={{ width: 150 }} value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
              <option value={2}>2 gün ve altı</option>
              <option value={3}>3 gün ve altı</option>
              <option value={7}>7 gün ve altı</option>
            </select>
          </div>
        </div>
        {!lowItems.length ? (
          <p className="muted">Bu eşikte azalan ürün yok.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ürün</th>
                  <th>Market</th>
                  <th className="num">Kalan</th>
                  <th className="num">Haftalık satış</th>
                  <th className="num">Bitmesine</th>
                  <th className="num">Öneri</th>
                  <th className="num">Tutar</th>
                </tr>
              </thead>
              <tbody>
                {lowItems.map((r) => {
                  const days = Number(r.days_left);
                  return (
                    <tr key={`${r.retailer_id}:${r.product_id}`}>
                      <td className="strong">{r.product_name}</td>
                      <td><Link href={`/marketler/${r.retailer_id}`}>{r.retailer_name}</Link></td>
                      <td className="num">{num(r.stock_cases)} koli</td>
                      <td className="num">{num(r.weekly_cases)} koli</td>
                      <td className={`num ${days <= 2 ? 'warn-text' : ''}`}>{num(days)} gün</td>
                      <td className="num strong">{r.suggested_cases} koli</td>
                      <td className="num">{tl(r.suggested_cases * Number(r.case_price))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
        </div>
        <aside className="aside" style={{ position: 'sticky', top: 20 }}>
          <MiniCalendar />
        </aside>
      </div>
    </>
  );
}
