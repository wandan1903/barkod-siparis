'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { num, tl, errorText } from '@/lib/format';
import { parsePrice } from '@/lib/csv';

export default function StockPage() {
  const { org } = useOrg();
  const [rows, setRows] = useState(null);
  const [mode, setMode] = useState('view'); // view | count | price
  const [counts, setCounts] = useState({});
  const [prices, setPrices] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('retailer_stock_overview', { p_retailer: org.id });
    if (error) setMessage({ kind: 'error', text: errorText(error) });
    const list = (data || []).sort((a, b) => Number(a.days_left ?? 999) - Number(b.days_left ?? 999));
    setRows(list);
  }, [org.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveCounts() {
    const payload = Object.entries(counts)
      .filter(([, v]) => v !== '' && v !== undefined)
      .map(([product_id, v]) => ({ product_id, qty_units: Math.max(0, parseInt(v, 10) || 0) }));
    if (!payload.length) {
      setMessage({ kind: 'error', text: 'En az bir ürünün sayısını girin.' });
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('record_count', { p_retailer: org.id, p_counts: payload });
    setBusy(false);
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setMessage({ kind: 'ok', text: `${payload.length} ürünün sayımı kaydedildi. Sipariş önerileri bu sayıma göre hesaplanır.` });
    setCounts({});
    setMode('view');
    load();
  }

  async function savePrices() {
    const payload = [];
    for (const [product_id, v] of Object.entries(prices)) {
      if (v === '' || v === undefined) continue;
      const value = parsePrice(v);
      if (!(value >= 0)) {
        setMessage({ kind: 'error', text: 'Geçerli bir fiyat girin (ör. 42,50).' });
        return;
      }
      payload.push({ retailer_id: org.id, product_id, shelf_price: value, updated_at: new Date().toISOString() });
    }
    if (!payload.length) {
      setMode('view');
      return;
    }
    setBusy(true);
    const { error } = await supabase.from('retailer_prices').upsert(payload, { onConflict: 'retailer_id,product_id' });
    setBusy(false);
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setMessage({ kind: 'ok', text: `${payload.length} ürünün raf fiyatı güncellendi.` });
    setPrices({});
    setMode('view');
    load();
  }

  if (!rows) return <div className="center">Yükleniyor…</div>;

  return (
    <>
      <h1 style={{ fontSize: 22 }}>Stok</h1>
      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className={`btn small ${mode === 'view' ? 'primary' : ''}`} onClick={() => setMode('view')}>Stok durumu</button>
        <button className={`btn small ${mode === 'count' ? 'primary' : ''}`} onClick={() => setMode('count')}>Sayım yap</button>
        <button className={`btn small ${mode === 'price' ? 'primary' : ''}`} onClick={() => setMode('price')}>Raf fiyatları</button>
      </div>

      {mode === 'count' ? <div className="notice small">Raftaki gerçek adedi yazın. Boş bıraktığınız ürünler değişmez.</div> : null}
      {mode === 'price' ? <div className="notice small">Raf fiyatlarınızı yalnızca siz görürsünüz; distribütörünüz göremez.</div> : null}

      <section className="list">
        {rows.map((r) => {
          const days = r.days_left === null ? null : Number(r.days_left);
          return (
            <div key={r.product_id} className="list-row">
              <div className="grow-1">
                <label className="strong" htmlFor={`in-${r.product_id}`}>{r.product_name}</label>
                <span className="muted small">
                  {mode === 'price'
                    ? `Şu an: ${r.shelf_price !== null ? tl(r.shelf_price) : 'fiyat yok'}`
                    : `${r.stock_units} adet (${num(r.stock_cases)} koli)${days !== null ? ` · ~${num(days)} gün` : ''}`}
                </span>
                {mode === 'view' && r.distributor_names ? <span className="muted small">{r.distributor_names}</span> : null}
              </div>
              {mode === 'view' ? (
                <span className={days !== null && days <= 2 ? 'warn-text' : 'muted small'}>
                  {days !== null && days <= 2 ? 'Kritik' : r.shelf_price !== null ? tl(r.shelf_price) : ''}
                </span>
              ) : null}
              {mode === 'count' ? (
                <input
                  id={`in-${r.product_id}`}
                  className="input compact"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder={String(r.stock_units)}
                  value={counts[r.product_id] ?? ''}
                  onChange={(e) => setCounts({ ...counts, [r.product_id]: e.target.value })}
                  style={{ textAlign: 'center' }}
                />
              ) : null}
              {mode === 'price' ? (
                <input
                  id={`in-${r.product_id}`}
                  className="input compact"
                  inputMode="decimal"
                  placeholder="₺"
                  value={prices[r.product_id] ?? ''}
                  onChange={(e) => setPrices({ ...prices, [r.product_id]: e.target.value })}
                  style={{ textAlign: 'right' }}
                />
              ) : null}
            </div>
          );
        })}
      </section>

      {mode === 'count' ? (
        <button className="btn primary" style={{ minHeight: 52 }} onClick={saveCounts} disabled={busy}>
          {busy ? 'Kaydediliyor…' : 'Sayımı kaydet'}
        </button>
      ) : null}
      {mode === 'price' ? (
        <button className="btn primary" style={{ minHeight: 52 }} onClick={savePrices} disabled={busy}>
          {busy ? 'Kaydediliyor…' : 'Fiyatları kaydet'}
        </button>
      ) : null}
    </>
  );
}
