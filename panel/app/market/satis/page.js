'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { tl, errorText } from '@/lib/format';
import BarcodeInput from '@/components/BarcodeInput';

export default function SalePage() {
  const { org } = useOrg();
  const [catalog, setCatalog] = useState(new Map());
  const [cart, setCart] = useState([]);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadCatalog = useCallback(async () => {
    const { data } = await supabase.rpc('retailer_stock_overview', { p_retailer: org.id });
    const map = new Map();
    for (const r of data || []) {
      map.set(r.gtin, {
        product_id: r.product_id,
        name: r.product_name,
        gtin: r.gtin,
        unit_price: r.shelf_price,
        stock_units: r.stock_units,
      });
    }
    setCatalog(map);
  }, [org.id]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const addToCart = useCallback((item) => {
    setCart((prev) => {
      const i = prev.findIndex((x) => x.product_id === item.product_id);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], qty: next[i].qty + 1 };
        return next;
      }
      return [{ ...item, qty: 1 }, ...prev];
    });
  }, []);

  const onCode = useCallback(
    async (code) => {
      setMessage(null);
      const known = catalog.get(code);
      if (known) {
        addToCart(known);
        return;
      }
      const { data: product } = await supabase.from('products').select('id, name, gtin').eq('gtin', code).maybeSingle();
      if (!product) {
        setMessage({ kind: 'error', text: `${code} barkodlu ürün kayıtlı değil.` });
        return;
      }
      const { data: price } = await supabase
        .from('retailer_prices')
        .select('shelf_price')
        .eq('retailer_id', org.id)
        .eq('product_id', product.id)
        .maybeSingle();
      addToCart({ product_id: product.id, name: product.name, gtin: product.gtin, unit_price: price ? price.shelf_price : null });
    },
    [catalog, addToCart, org.id]
  );

  function changeQty(productId, delta) {
    setCart((prev) =>
      prev
        .map((x) => (x.product_id === productId ? { ...x, qty: x.qty + delta } : x))
        .filter((x) => x.qty > 0)
    );
  }

  const total = useMemo(() => cart.reduce((s, x) => s + x.qty * Number(x.unit_price || 0), 0), [cart]);
  const missingPrice = cart.some((x) => x.unit_price === null || x.unit_price === undefined);

  async function complete() {
    if (!cart.length) return;
    setBusy(true);
    const { error } = await supabase.rpc('record_sale', {
      p_retailer: org.id,
      p_lines: cart.map((x) => ({ product_id: x.product_id, qty_units: x.qty })),
    });
    setBusy(false);
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setMessage({ kind: 'ok', text: `Satış kaydedildi: ${tl(total)}. Stok güncellendi.` });
    setCart([]);
    loadCatalog();
  }

  return (
    <>
      <h1 style={{ fontSize: 22 }}>Satış</h1>
      <BarcodeInput onCode={onCode} />

      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}

      <div className="notice small">Satış fiyatlarınızı yalnızca siz görürsünüz.</div>

      {cart.length ? (
        <section className="list" aria-label="Sepet">
          {cart.map((x) => (
            <div key={x.product_id} className="list-row">
              <div className="grow-1">
                <span className="strong">{x.name}</span>
                <span className="muted small">
                  {x.gtin} · {x.unit_price !== null && x.unit_price !== undefined ? `${tl(x.unit_price)} / adet` : 'raf fiyatı yok'}
                </span>
              </div>
              <div className="stepper">
                <button type="button" aria-label={`${x.name} azalt`} onClick={() => changeQty(x.product_id, -1)}>−</button>
                <span className="val">{x.qty}</span>
                <button type="button" aria-label={`${x.name} artır`} onClick={() => changeQty(x.product_id, 1)}>+</button>
              </div>
            </div>
          ))}
        </section>
      ) : (
        <p className="muted" style={{ textAlign: 'center', padding: '12px 0' }}>Sepet boş. Ürünün barkodunu okutun.</p>
      )}

      {cart.length ? (
        <section className="sticky-foot">
          <div className="total-row"><span>Toplam</span><strong>{tl(total)}</strong></div>
          {missingPrice ? <span className="muted small">Fiyatı girilmemiş ürünler 0 ₺ sayılır. Fiyatları Stok ekranından girebilirsiniz.</span> : null}
          <button className="btn primary" style={{ minHeight: 52 }} onClick={complete} disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Satışı tamamla'}
          </button>
        </section>
      ) : null}
    </>
  );
}
