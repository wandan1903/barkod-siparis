'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { num, tl, errorText } from '@/lib/format';

export default function PlaceOrderPage() {
  const { org } = useOrg();
  const router = useRouter();
  const [distributors, setDistributors] = useState(null);
  const [distributorId, setDistributorId] = useState('');
  const [rows, setRows] = useState(null);
  const [qty, setQty] = useState({});
  const [search, setSearch] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [campaign, setCampaign] = useState(null);
  const [campaignId, setCampaignId] = useState(null);

  useEffect(() => {
    try {
      const id = new URLSearchParams(window.location.search).get('kampanya');
      if (id) setCampaignId(id);
    } catch (e) {}
  }, []);

  useEffect(() => {
    if (!campaignId) return;
    supabase
      .from('campaigns')
      .select('id, kind, distributor_id, product_id, title, case_price, rule, ends_at, campaign_items(product_id, cases, case_price)')
      .eq('id', campaignId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setCampaign(data);
          setDistributorId(data.distributor_id);
        }
      });
  }, [campaignId]);

  useEffect(() => {
    async function loadDistributors() {
      const { data, error } = await supabase
        .from('retailer_distributor_links')
        .select('distributor_id, distributor:organizations!retailer_distributor_links_distributor_id_fkey(name)')
        .eq('retailer_id', org.id)
        .eq('status', 'active');
      if (error) setMessage({ kind: 'error', text: errorText(error) });
      const list = (data || []).map((l) => ({ id: l.distributor_id, name: l.distributor ? l.distributor.name : 'Distribütör' }));
      setDistributors(list);
      if (list.length === 1) setDistributorId(list[0].id);
    }
    loadDistributors();
  }, [org.id]);

  const loadCatalog = useCallback(async () => {
    if (!distributorId) return;
    setRows(null);
    const { data, error } = await supabase.rpc('retailer_order_catalog', { p_retailer: org.id, p_distributor: distributorId });
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      setRows([]);
      return;
    }
    const list = (data || []).sort((a, b) => {
      const sa = a.suggested_cases > 0 ? 0 : 1;
      const sb = b.suggested_cases > 0 ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return Number(a.days_left ?? 999) - Number(b.days_left ?? 999);
    });
    setRows(list);
    const pre = {};
    if (campaign && campaign.distributor_id === distributorId) {
      if (campaign.kind === 'bundle') for (const it of campaign.campaign_items || []) pre[it.product_id] = it.cases;
      else if (campaign.product_id) pre[campaign.product_id] = Number((campaign.rule && campaign.rule.min_cases) || 1);
    }
    setQty(pre);
  }, [org.id, distributorId, campaign]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const visible = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLocaleLowerCase('tr-TR');
    if (!q) return rows;
    return rows.filter((r) => r.product_name.toLocaleLowerCase('tr-TR').includes(q) || r.gtin.includes(q));
  }, [rows, search]);

  const campPrice = useMemo(() => {
    const m = new Map();
    if (campaign && campaign.distributor_id === distributorId) {
      if (campaign.kind === 'bundle') for (const it of campaign.campaign_items || []) m.set(it.product_id, Number(it.case_price));
      else if (campaign.product_id && campaign.case_price) m.set(campaign.product_id, Number(campaign.case_price));
    }
    return m;
  }, [campaign, distributorId]);

  const total = useMemo(() => {
    let cases = 0;
    let value = 0;
    for (const r of rows || []) {
      const n = Number(qty[r.product_id] || 0);
      cases += n;
      value += n * Number(campPrice.get(r.product_id) ?? r.case_price);
    }
    return { cases, value };
  }, [rows, qty, campPrice]);

  function applySuggestion() {
    const next = {};
    for (const r of rows || []) if (r.suggested_cases > 0) next[r.product_id] = r.suggested_cases;
    setQty(next);
    setMessage(
      Object.keys(next).length
        ? { kind: 'ok', text: `${Object.keys(next).length} ürün için önerilen adetler eklendi. Dilediğiniz gibi değiştirebilirsiniz.` }
        : { kind: 'ok', text: 'Şu an öneri yok; stoklarınız yeterli görünüyor.' }
    );
  }

  function change(productId, delta) {
    const n = Math.max(0, Number(qty[productId] || 0) + delta);
    setQty({ ...qty, [productId]: n });
  }

  async function submit() {
    const lines = (rows || [])
      .filter((r) => Number(qty[r.product_id] || 0) > 0)
      .map((r) => ({ product_id: r.product_id, cases: Number(qty[r.product_id]), suggested_cases: r.suggested_cases, campaign_id: campPrice.has(r.product_id) ? campaign.id : null }));
    if (!lines.length) {
      setMessage({ kind: 'error', text: 'En az bir ürün seçin.' });
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('create_order', {
      p_retailer: org.id,
      p_distributor: distributorId,
      p_lines: lines,
      p_status: 'sent',
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    router.push('/market/teklifler?gonderildi=1');
  }

  if (!distributors) return <div className="center">Yükleniyor…</div>;

  return (
    <>
      <div>
        <Link href="/market/teklifler" className="small">← Siparişler</Link>
        <h1 style={{ fontSize: 22 }}>Sipariş ver</h1>
      </div>

      {campaign ? (
        <div className="campaign">
          <span className="tag">KAMPANYA</span>
          <span className="strong">{campaign.title}</span>
          <span className="small">{campaign.kind === 'bundle' ? 'Paket ürünleri sepete eklendi; paketin tamamı alınmalı.' : 'Ürün kampanya fiyatıyla sepete eklendi.'}</span>
        </div>
      ) : null}

      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}

      {!distributors.length ? (
        <div className="card"><p className="muted">Çalıştığınız bir distribütör yok. Distribütörünüzden sizi sisteme eklemesini isteyin.</p></div>
      ) : (
        <>
          {distributors.length > 1 ? (
            <div className="field">
              <label htmlFor="dist">Distribütör</label>
              <select id="dist" className="input" value={distributorId} onChange={(e) => setDistributorId(e.target.value)}>
                <option value="">Seçin</option>
                {distributors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          ) : (
            <div className="muted small">Distribütör: <span className="strong">{distributors[0].name}</span></div>
          )}

          {distributorId && rows ? (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                <label className="sr-only" htmlFor="search">Ürün ara</label>
                <input
                  id="search"
                  className="input"
                  placeholder="Ürün adı veya barkod ara"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button className="btn outline" onClick={applySuggestion} style={{ whiteSpace: 'nowrap' }}>Öneriyi uygula</button>
              </div>

              <section className="list">
                {visible.map((r) => {
                  const n = Number(qty[r.product_id] || 0);
                  const days = r.days_left === null ? null : Number(r.days_left);
                  return (
                    <div key={r.product_id} className="list-row">
                      <div className="grow-1">
                        <span className="strong">{r.product_name}</span>
                        <span className="muted small">Koli {tl(campPrice.get(r.product_id) ?? r.case_price)}{campPrice.has(r.product_id) ? ' (kampanya)' : ''} · {r.case_qty} adet</span>
                        <span className={days !== null && days <= 2 ? 'warn-text small' : 'muted small'}>
                          Kalan {num(r.stock_cases)} koli{days !== null ? ` · ~${num(days)} gün` : ''}
                          {r.suggested_cases > 0 ? ` · öneri ${r.suggested_cases} koli` : ''}
                        </span>
                      </div>
                      <div className="stepper">
                        <button type="button" aria-label={`${r.product_name} azalt`} onClick={() => change(r.product_id, -1)}>−</button>
                        <span className="val">{n}</span>
                        <button type="button" aria-label={`${r.product_name} artır`} onClick={() => change(r.product_id, 1)}>+</button>
                      </div>
                    </div>
                  );
                })}
                {!visible.length ? <p className="muted" style={{ padding: '12px 0' }}>Ürün bulunamadı.</p> : null}
              </section>

              <div className="field">
                <label htmlFor="note">Not (isteğe bağlı)</label>
                <input id="note" className="input" placeholder="ör. Cumartesi sabah teslim" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>

              <section className="sticky-foot">
                <div className="total-row"><span>{total.cases} koli</span><strong>{tl(total.value)}</strong></div>
                <span className="muted small">Fiyatlar distribütörün güncel koli fiyatlarıdır. Sipariş distribütör onayından sonra kesinleşir.</span>
                <button className="btn primary" style={{ minHeight: 52 }} onClick={submit} disabled={busy || total.cases === 0}>
                  {busy ? 'Gönderiliyor…' : 'Siparişi gönder'}
                </button>
              </section>
            </>
          ) : distributorId ? (
            <div className="center">Yükleniyor…</div>
          ) : null}
        </>
      )}
    </>
  );
}
