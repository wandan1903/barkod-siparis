'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { tl, errorText } from '@/lib/format';
import LabelPrinter from '@/components/LabelPrinter';
import LabelPicker from '@/components/LabelPicker';

// Ürün / koli etiketi: ürün adı, koli içi adet, büyük barkod (isteğe bağlı koli fiyatı)
export default function ProductLabelsPage() {
  const { org } = useOrg();
  const [items, setItems] = useState(null);
  const [copies, setCopies] = useState({});
  const [showPrice, setShowPrice] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    const [c, w] = await Promise.all([
      supabase.from('distributor_products').select('product_id, case_price, products(name, gtin, case_qty)').eq('distributor_id', org.id).eq('active', true),
      supabase.from('warehouse_stock').select('product_id, qty_units').eq('distributor_id', org.id),
    ]);
    const err = c.error || w.error;
    if (err) setMessage({ kind: 'error', text: errorText(err) });
    const stock = new Map((w.data || []).map((r) => [r.product_id, r.qty_units]));
    setItems(
      (c.data || [])
        .filter((r) => r.products)
        .map((r) => ({
          id: r.product_id,
          name: r.products.name,
          gtin: r.products.gtin,
          caseQty: r.products.case_qty,
          casePrice: r.case_price,
          depotCases: stock.has(r.product_id) ? Math.floor(stock.get(r.product_id) / r.products.case_qty) : null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
    );
  }, [org.id]);

  useEffect(() => {
    load();
  }, [load]);

  const filters = useMemo(() => [{ key: 'depot', label: 'Depoda olanlar', test: (it) => it.depotCases > 0 }], []);

  const withCopies = useMemo(
    () =>
      (items || []).map((it) => ({
        ...it,
        copies: copies[it.id] || 0,
        sub: `Koli içi ${it.caseQty} adet${showPrice ? ` · koli ${tl(it.casePrice)}` : ''}`,
      })),
    [items, copies, showPrice]
  );

  function depotCopies() {
    const next = {};
    for (const it of items || []) if (it.depotCases > 0) next[it.id] = Math.min(500, it.depotCases);
    setCopies(next);
  }

  if (!items) return <div className="center">Yükleniyor…</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/depo" className="small">← Depo</Link>
          <h1>Ürün / koli etiketi</h1>
          <p className="sub">Depodaki raflar ve koliler için barkodlu etiket. Barkod okuyucuyla okunur.</p>
        </div>
      </div>
      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="switch-row" style={{ margin: 0 }}>
          <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />
          <span className="small">Etikette koli fiyatı yazsın</span>
        </label>
        <button type="button" className="btn small" onClick={depotCopies}>Depodaki koli sayısı kadar seç</button>
      </div>

      <LabelPrinter items={withCopies} kind="product" defaultPreset="t100x50" storageKey="bs_label_dist" />

      <LabelPicker
        items={items}
        copies={copies}
        setCopies={setCopies}
        filters={filters}
        describe={(it) => `${it.gtin} · koli ${it.caseQty} adet${it.depotCases != null ? ` · depoda ${it.depotCases} koli` : ''}`}
      />
    </>
  );
}
