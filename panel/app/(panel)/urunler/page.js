'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { tl, dateTime, errorText } from '@/lib/format';
import { parseProductCsv, parsePrice, TEMPLATE_CSV } from '@/lib/csv';

export default function ProductsPage() {
  const { org } = useOrg();
  const [items, setItems] = useState(null);
  const [edits, setEdits] = useState({});
  const [message, setMessage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('distributor_products')
      .select('product_id, case_price, active, updated_at, products(gtin, name, case_qty, category)')
      .eq('distributor_id', org.id);
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      setItems([]);
      return;
    }
    const sorted = (data || []).sort((a, b) => (a.products?.name || '').localeCompare(b.products?.name || '', 'tr'));
    setItems(sorted);
  }, [org.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function savePrice(productId) {
    const value = parsePrice(edits[productId]);
    if (!(value >= 0)) {
      setMessage({ kind: 'error', text: 'Geçerli bir fiyat girin (ör. 480,00).' });
      return;
    }
    const { error } = await supabase
      .from('distributor_products')
      .update({ case_price: value, updated_at: new Date().toISOString() })
      .eq('distributor_id', org.id)
      .eq('product_id', productId);
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    const next = { ...edits };
    delete next[productId];
    setEdits(next);
    setMessage({ kind: 'ok', text: 'Koli fiyatı güncellendi. Yeni teklifler bu fiyatla hazırlanır.' });
    load();
  }

  async function onFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const text = await file.text();
    setPreview({ fileName: file.name, ...parseProductCsv(text) });
    event.target.value = '';
  }

  async function importRows() {
    if (!preview || !preview.rows.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const rows = preview.rows;
      const { error: insertError } = await supabase
        .from('products')
        .upsert(
          rows.map((r) => ({ gtin: r.gtin, name: r.name, case_qty: r.case_qty, unit: 'adet' })),
          { onConflict: 'gtin', ignoreDuplicates: true }
        );
      if (insertError) throw insertError;

      const { data: found, error: findError } = await supabase
        .from('products')
        .select('id, gtin')
        .in('gtin', rows.map((r) => r.gtin));
      if (findError) throw findError;
      const idByGtin = new Map((found || []).map((p) => [p.gtin, p.id]));

      const links = rows
        .filter((r) => idByGtin.has(r.gtin))
        .map((r) => ({
          distributor_id: org.id,
          product_id: idByGtin.get(r.gtin),
          case_price: r.case_price,
          active: true,
          updated_at: new Date().toISOString(),
        }));
      const { error: linkError } = await supabase
        .from('distributor_products')
        .upsert(links, { onConflict: 'distributor_id,product_id' });
      if (linkError) throw linkError;

      // Excel/CSV bağlantısının son senkron zamanını güncelle
      const { data: integ } = await supabase
        .from('org_integrations')
        .select('id')
        .eq('org_id', org.id)
        .eq('connector_code', 'csv_upload')
        .eq('state', 'active')
        .limit(1);
      if (integ && integ.length) {
        await supabase.from('org_integrations').update({ last_sync_at: new Date().toISOString() }).eq('id', integ[0].id);
        await supabase.from('integration_events').insert({
          integration_id: integ[0].id,
          kind: 'sync',
          ok: true,
          detail: { file: preview.fileName, rows: links.length },
        });
      }

      setMessage({ kind: 'ok', text: `${links.length} ürün yüklendi veya güncellendi.` });
      setPreview(null);
      load();
    } catch (err) {
      setMessage({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent('﻿' + TEMPLATE_CSV)}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ürünler ve fiyatlar</h1>
          <p className="sub">Koli fiyatınız marketlere teklifte görünür. Marketlerin raf fiyatlarını göremezsiniz.</p>
        </div>
      </div>

      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}

      <section className="card">
        <h2>Excel / CSV ile toplu yükleme</h2>
        <p className="muted small">
          Muhasebe programınızdan ürün listesini Excel olarak alın, &quot;CSV (noktalı virgülle ayrılmış)&quot; olarak kaydedin ve buraya yükleyin.
          Sütunlar: barkod; urun_adi; koli_ici_adet; koli_fiyati. Var olan ürünlerin fiyatı güncellenir, yeni ürünler eklenir.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <label className="btn outline" htmlFor="csv-file">Dosya seç</label>
          <input id="csv-file" type="file" accept=".csv,.txt,text/csv" onChange={onFile} className="sr-only" />
          <a className="small" href={templateHref} download="urun-listesi-sablon.csv">Örnek şablonu indir</a>
        </div>
        {preview ? (
          <div className="notice" style={{ flexDirection: 'column' }}>
            <strong>{preview.fileName}: {preview.rows.length} ürün okundu{preview.errors.length ? `, ${preview.errors.length} satırda sorun var` : ''}.</strong>
            {preview.errors.slice(0, 8).map((e) => <span key={e} className="small">{e}</span>)}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn primary small" onClick={importRows} disabled={busy || !preview.rows.length}>
                {busy ? 'Yükleniyor…' : `${preview.rows.length} ürünü yükle`}
              </button>
              <button className="btn small" onClick={() => setPreview(null)} disabled={busy}>Vazgeç</button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2>Kataloğunuz {items ? `· ${items.length} ürün` : ''}</h2>
        {!items ? (
          <p className="muted">Yükleniyor…</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ürün</th>
                  <th>Barkod</th>
                  <th className="num">Koli içi</th>
                  <th className="num">Koli fiyatı</th>
                  <th className="num">Yeni fiyat</th>
                  <th>Son güncelleme</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.product_id}>
                    <td className="strong">{it.products?.name}</td>
                    <td className="muted">{it.products?.gtin}</td>
                    <td className="num">{it.products?.case_qty} adet</td>
                    <td className="num strong">{tl(it.case_price)}</td>
                    <td className="num">
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <label className="sr-only" htmlFor={`p-${it.product_id}`}>{it.products?.name} yeni koli fiyatı</label>
                        <input
                          id={`p-${it.product_id}`}
                          className="input compact"
                          inputMode="decimal"
                          placeholder="₺"
                          value={edits[it.product_id] ?? ''}
                          onChange={(e) => setEdits({ ...edits, [it.product_id]: e.target.value })}
                        />
                        <button
                          className="btn small"
                          onClick={() => savePrice(it.product_id)}
                          disabled={!edits[it.product_id]}
                        >
                          Kaydet
                        </button>
                      </div>
                    </td>
                    <td className="muted small">{dateTime(it.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
