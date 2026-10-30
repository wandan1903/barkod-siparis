'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { tl, shortDate, errorText } from '@/lib/format';
import LabelPrinter from '@/components/LabelPrinter';
import LabelPicker from '@/components/LabelPicker';

// Raf etiketi: ürün adı, büyük fiyat, barkod. Fiyatı yeni değişen ürünleri tek tuşla seçer.
export default function ShelfLabelsPage() {
  const { org } = useOrg();
  const [items, setItems] = useState(null);
  const [copies, setCopies] = useState({});
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([
      supabase.rpc('retailer_stock_overview', { p_retailer: org.id }),
      supabase.from('retailer_prices').select('product_id, updated_at').eq('retailer_id', org.id),
    ]);
    const err = s.error || p.error;
    if (err) setMessage({ kind: 'error', text: errorText(err) });
    const changed = new Map((p.data || []).map((r) => [r.product_id, r.updated_at]));
    const list = (s.data || [])
      .map((r) => ({ id: r.product_id, name: r.product_name, gtin: r.gtin, price: r.shelf_price, priceAt: changed.get(r.product_id) || null }))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    setItems(list);
  }, [org.id]);

  useEffect(() => {
    load();
  }, [load]);

  const weekAgo = Date.now() - 7 * 86400000;
  const filters = useMemo(
    () => [
      { key: 'changed', label: 'Fiyatı son 7 günde değişen', test: (it) => it.priceAt && new Date(it.priceAt).getTime() >= weekAgo },
      { key: 'noprice', label: 'Fiyatı girilmemiş', test: (it) => it.price == null },
    ],
    [weekAgo]
  );

  const withCopies = useMemo(() => (items || []).map((it) => ({ ...it, copies: copies[it.id] || 0 })), [items, copies]);
  const today = new Date().toLocaleDateString('tr-TR');

  if (!items) return <div className="center">Yükleniyor…</div>;

  return (
    <>
      <div>
        <Link href="/market/stok" className="small">← Stok</Link>
        <h1 style={{ fontSize: 22, margin: 0 }}>Raf etiketi yazdır</h1>
      </div>
      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}

      <LabelPrinter items={withCopies} kind="shelf" footer={`${org.name}\n${today}`.split('\n').map((l, i) => <span key={i} style={{ display: 'block' }}>{l}</span>)} storageKey="bs_label_market" />

      <LabelPicker
        items={items}
        copies={copies}
        setCopies={setCopies}
        filters={filters}
        describe={(it) => `${it.gtin} · ${it.price != null ? tl(it.price) : 'fiyat yok'}${it.priceAt ? ` · fiyat ${shortDate(it.priceAt)}` : ''}`}
      />
      <p className="muted small">Fiyatları Stok ekranından değiştirebilirsiniz. Fiyatı değişen ürünler "Fiyatı son 7 günde değişen" filtresinde listelenir.</p>
    </>
  );
}
