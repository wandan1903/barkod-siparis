'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { tl, errorText } from '@/lib/format';
import BarcodeInput from '@/components/BarcodeInput';
import { newRef, isNetworkError, enqueueSale, saveCatalog, loadCatalog as loadCachedCatalog } from '@/lib/offline';

export default function SalePage() {
  const { org } = useOrg();
  const [catalog, setCatalog] = useState(new Map());
  const [cart, setCart] = useState([]);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [credit, setCredit] = useState(null); // veresiye: { customers, customerId }

  const loadCatalog = useCallback(async () => {
    let rows = null;
    try {
      const { data, error } = await supabase.rpc('retailer_stock_overview', { p_retailer: org.id });
      if (!error && data) {
        rows = data.map((r) => ({ product_id: r.product_id, product_name: r.product_name, gtin: r.gtin, shelf_price: r.shelf_price, stock_units: r.stock_units }));
        saveCatalog(org.id, rows);
      }
    } catch (e) {
      rows = null;
    }
    if (!rows) {
      // internet yok: bu cihazda saklanan son ürün listesiyle devam
      const cached = loadCachedCatalog(org.id);
      rows = cached ? cached.rows : [];
    }
    const map = new Map();
    for (const r of rows) {
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
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setMessage({ kind: 'error', text: `${code} bu cihazdaki ürün listesinde yok. İnternet gelince tekrar deneyin.` });
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
    const sale = {
      ref: newRef(),
      at: new Date().toISOString(),
      lines: cart.map((x) => ({ product_id: x.product_id, qty_units: x.qty })),
      total,
      count: cart.reduce((s, x) => s + x.qty, 0),
    };
    let error = null;
    try {
      ({ error } = await supabase.rpc('record_sale_offline', {
        p_retailer: org.id,
        p_lines: sale.lines,
        p_client_ref: sale.ref,
        p_sold_at: sale.at,
      }));
    } catch (e) {
      error = e;
    }
    setBusy(false);
    if (error && isNetworkError(error)) {
      // internet yok: satış cihazda bekler, internet gelince otomatik gönderilir
      if (!enqueueSale(org.id, sale)) {
        setMessage({ kind: 'error', text: 'İnternet yok ve satış bu cihaza kaydedilemedi (tarayıcı depolaması kapalı).' });
        return;
      }
      setMessage({ kind: 'ok', text: `İnternet yok: ${tl(total)} satış cihazda bekletildi, internet gelince gönderilecek.` });
      setCart([]);
      return;
    }
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setMessage({ kind: 'ok', text: `Satış kaydedildi: ${tl(total)}. Stok güncellendi.` });
    setCart([]);
    loadCatalog();
  }

  async function openCredit() {
    setMessage(null);
    let data = null;
    let error = null;
    try {
      ({ data, error } = await supabase.rpc('customer_balances', { p_retailer: org.id }));
    } catch (e) {
      error = e;
    }
    if (error) {
      setMessage({ kind: 'error', text: isNetworkError(error) ? 'Veresiyeye yazmak için internet gerekir. Satışı normal tamamlayabilirsiniz.' : errorText(error) });
      return;
    }
    const list = (data || []).filter((c) => c.active).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    setCredit({ customers: list, customerId: list.length === 1 ? list[0].customer_id : '' });
  }

  async function completeOnCredit() {
    if (!cart.length || !credit || !credit.customerId) return;
    const cust = credit.customers.find((c) => c.customer_id === credit.customerId);
    setBusy(true);
    const { error } = await supabase.rpc('record_credit_sale', {
      p_retailer: org.id,
      p_lines: cart.map((x) => ({ product_id: x.product_id, qty_units: x.qty })),
      p_customer: credit.customerId,
      p_note: null,
    });
    setBusy(false);
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setMessage({ kind: 'ok', text: `${tl(total)} ${cust ? cust.name : 'müşteri'} adına veresiyeye yazıldı. Stok güncellendi.` });
    setCart([]);
    setCredit(null);
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
          {credit ? (
            <>
              {credit.customers.length ? (
                <div className="field">
                  <label htmlFor="credit-cust">Veresiye yazılacak müşteri</label>
                  <select id="credit-cust" className="input" value={credit.customerId} onChange={(e) => setCredit({ ...credit, customerId: e.target.value })}>
                    <option value="">Müşteri seçin</option>
                    {credit.customers.map((c) => (
                      <option key={c.customer_id} value={c.customer_id}>
                        {c.name}{Number(c.balance) > 0 ? ` · borç ${tl(c.balance)}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <span className="muted small">Kayıtlı müşteri yok. Önce <Link href="/market/veresiye">Veresiye</Link> sayfasından müşteri ekleyin.</span>
              )}
              {(() => {
                const c = credit.customers.find((x) => x.customer_id === credit.customerId);
                return c && c.credit_limit != null && Number(c.balance) + total > Number(c.credit_limit) ? (
                  <div className="notice error" role="status">{c.name} bu satışla limitini ({tl(c.credit_limit)}) aşıyor.</div>
                ) : null;
              })()}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" style={{ flex: 1 }} onClick={() => setCredit(null)} disabled={busy}>Vazgeç</button>
                <button className="btn primary" style={{ flex: 2, minHeight: 52 }} onClick={completeOnCredit} disabled={busy || !credit.customerId}>
                  {busy ? 'Kaydediliyor…' : 'Veresiyeye yaz'}
                </button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" style={{ flex: 1, minHeight: 52 }} onClick={openCredit} disabled={busy}>Veresiye</button>
              <button className="btn primary" style={{ flex: 2, minHeight: 52 }} onClick={complete} disabled={busy}>
                {busy ? 'Kaydediliyor…' : 'Satışı tamamla'}
              </button>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
