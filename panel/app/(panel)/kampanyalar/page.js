'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { num, tl, shortDate, errorText } from '@/lib/format';

const TARGET_LABEL = { all: 'Tüm marketler', selected: 'Seçili marketler', low_stock: 'Ürünü azalan marketler' };

function dayInput(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function status(c) {
  const now = Date.now();
  if (new Date(c.ends_at).getTime() <= now) return { key: 'ended', label: 'Bitti', cls: 'info' };
  if (new Date(c.starts_at).getTime() > now) return { key: 'upcoming', label: 'Başlayacak', cls: 'warn' };
  return { key: 'active', label: 'Aktif', cls: 'ok' };
}

const EMPTY = {
  kind: 'product',
  title: '',
  product: '',
  price: '',
  minCases: '1',
  items: [
    { product_id: '', cases: '1', case_price: '' },
    { product_id: '', cases: '1', case_price: '' },
  ],
  target: 'all',
  retailers: [],
  starts: dayInput(0),
  ends: dayInput(7),
};

export default function CampaignsPage() {
  const { org } = useOrg();
  const [campaigns, setCampaigns] = useState(null);
  const [usage, setUsage] = useState({});
  const [catalog, setCatalog] = useState([]);
  const [markets, setMarkets] = useState([]);
  const [message, setMessage] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [c, p, l] = await Promise.all([
      supabase
        .from('campaigns')
        .select(
          'id, kind, title, product_id, case_price, rule, target, starts_at, ends_at, created_at, products!campaigns_product_id_fkey(name), campaign_items(product_id, cases, case_price, products(name))'
        )
        .eq('distributor_id', org.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('distributor_products')
        .select('product_id, case_price, products(name, case_qty)')
        .eq('distributor_id', org.id)
        .eq('active', true),
      supabase
        .from('retailer_distributor_links')
        .select('retailer_id, retailer:organizations!retailer_distributor_links_retailer_id_fkey(name)')
        .eq('distributor_id', org.id)
        .eq('status', 'active'),
    ]);
    if (c.error) setMessage({ kind: 'error', text: errorText(c.error) });
    const list = c.data || [];
    setCampaigns(list);
    setCatalog((p.data || []).sort((a, b) => (a.products?.name || '').localeCompare(b.products?.name || '', 'tr')));
    setMarkets((l.data || []).map((x) => ({ id: x.retailer_id, name: x.retailer ? x.retailer.name : 'Market' })));

    if (list.length) {
      const { data: lines } = await supabase
        .from('order_lines')
        .select('campaign_id, cases, order_id, orders!inner(retailer_id, status)')
        .in('campaign_id', list.map((x) => x.id));
      const u = {};
      for (const ln of lines || []) {
        if (['rejected', 'draft'].includes(ln.orders.status)) continue;
        const e = (u[ln.campaign_id] ||= { markets: new Set(), cases: 0 });
        e.markets.add(ln.orders.retailer_id);
        e.cases += Number(ln.cases || 0);
      }
      setUsage(u);
    }
  }, [org.id]);

  useEffect(() => {
    load();
  }, [load]);

  const priceOf = useMemo(() => new Map(catalog.map((x) => [x.product_id, Number(x.case_price)])), [catalog]);

  function set(patch) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function setItem(i, patch) {
    setForm((f) => ({ ...f, items: f.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) }));
  }

  const bundleTotals = useMemo(() => {
    if (!form || form.kind !== 'bundle') return null;
    let normal = 0;
    let promo = 0;
    for (const it of form.items) {
      const n = Number(it.cases) || 0;
      normal += n * (priceOf.get(it.product_id) || 0);
      promo += n * (Number(String(it.case_price).replace(',', '.')) || 0);
    }
    return { normal, promo, pct: normal > 0 ? Math.round(((normal - promo) / normal) * 100) : 0 };
  }, [form, priceOf]);

  async function submit(e) {
    e.preventDefault();
    setMessage(null);
    const startsLocal = new Date(`${form.starts}T00:00:00`);
    const endsLocal = new Date(`${form.ends}T23:59:00`);
    const startsAt = startsLocal.getTime() <= Date.now() ? new Date() : startsLocal;

    const price = Number(String(form.price).replace(',', '.'));
    const items =
      form.kind === 'bundle'
        ? form.items.map((it) => ({
            product_id: it.product_id,
            cases: Number(it.cases),
            case_price: Number(String(it.case_price).replace(',', '.')),
          }))
        : null;

    if (form.kind === 'product' && !form.product) {
      setMessage({ kind: 'error', text: 'Ürün seçin.' });
      return;
    }
    if (form.kind === 'bundle') {
      const ids = form.items.map((i) => i.product_id);
      if (ids.some((x) => !x)) return setMessage({ kind: 'error', text: 'Paketteki her satır için ürün seçin.' });
      if (new Set(ids).size !== ids.length) return setMessage({ kind: 'error', text: 'Aynı ürünü pakete iki kez eklemeyin.' });
    }

    setBusy(true);
    const { error } = await supabase.rpc('create_campaign', {
      p_distributor: org.id,
      p_kind: form.kind,
      p_title: form.title,
      p_product: form.kind === 'product' ? form.product : null,
      p_case_price: form.kind === 'product' ? price : null,
      p_min_cases: form.kind === 'product' ? Number(form.minCases) || 1 : null,
      p_items: items,
      p_target: form.target,
      p_retailers: form.target === 'selected' ? form.retailers : null,
      p_starts: startsAt.toISOString(),
      p_ends: endsLocal.toISOString(),
    });
    setBusy(false);
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setMessage({ kind: 'ok', text: 'Kampanya oluşturuldu. Hedef marketlere bildirim gönderildi.' });
    setForm(null);
    load();
  }

  async function endNow(c) {
    const { error } = await supabase.from('campaigns').update({ ends_at: new Date().toISOString() }).eq('id', c.id);
    if (error) return setMessage({ kind: 'error', text: errorText(error) });
    setMessage({ kind: 'ok', text: 'Kampanya bitirildi.' });
    load();
  }

  async function remove(c) {
    const { error } = await supabase.from('campaigns').delete().eq('id', c.id);
    if (error) return setMessage({ kind: 'error', text: errorText(error) });
    setMessage({ kind: 'ok', text: 'Kampanya silindi.' });
    load();
  }

  if (!campaigns) return <div className="center">Yükleniyor…</div>;

  const sorted = [...campaigns].sort((a, b) => {
    const order = { active: 0, upcoming: 1, ended: 2 };
    return order[status(a).key] - order[status(b).key];
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Kampanyalar</h1>
          <p className="sub">Tek ürün ya da paket kampanyası kurun; hedef marketlere bildirim gider, teklifte "Siparişe ekle" olarak görünür.</p>
        </div>
        {!form ? (
          <button className="btn primary" onClick={() => setForm({ ...EMPTY })}>Yeni kampanya</button>
        ) : null}
      </div>

      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}

      {form ? (
        <form className="card" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2>Yeni kampanya</h2>

          <div role="radiogroup" aria-label="Kampanya türü" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" role="radio" aria-checked={form.kind === 'product'} className={`btn ${form.kind === 'product' ? 'primary' : ''}`} onClick={() => set({ kind: 'product' })}>
              Ürün kampanyası
            </button>
            <button type="button" role="radio" aria-checked={form.kind === 'bundle'} className={`btn ${form.kind === 'bundle' ? 'primary' : ''}`} onClick={() => set({ kind: 'bundle' })}>
              Paket kampanyası
            </button>
          </div>

          <div className="field">
            <label htmlFor="c-title">Kampanya adı</label>
            <input id="c-title" className="input" required maxLength={80} value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder={form.kind === 'product' ? 'Örn. Hafta sonu tereyağı fırsatı' : 'Örn. Kahvaltı paketi'} />
          </div>

          {form.kind === 'product' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <div className="field">
                <label htmlFor="c-prod">Ürün</label>
                <select id="c-prod" className="input" required value={form.product} onChange={(e) => set({ product: e.target.value })}>
                  <option value="">Seçin…</option>
                  {catalog.map((p) => (
                    <option key={p.product_id} value={p.product_id}>{p.products?.name} · {tl(p.case_price)}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="c-price">Kampanyalı koli fiyatı (₺)</label>
                <input id="c-price" className="input" required inputMode="decimal" value={form.price} onChange={(e) => set({ price: e.target.value })} />
                {form.product && priceOf.get(form.product) ? (
                  <span className="muted small">Normal fiyat {tl(priceOf.get(form.product))}</span>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor="c-min">Asgari koli adedi</label>
                <input id="c-min" className="input" type="number" min="1" value={form.minCases} onChange={(e) => set({ minCases: e.target.value })} />
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span className="strong">Paket içeriği</span>
              {form.items.map((it, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 3fr) 90px 150px auto', gap: 8, alignItems: 'end' }}>
                  <div className="field">
                    <label htmlFor={`b-p-${i}`}>Ürün</label>
                    <select id={`b-p-${i}`} className="input" value={it.product_id} onChange={(e) => setItem(i, { product_id: e.target.value })}>
                      <option value="">Seçin…</option>
                      {catalog.map((p) => (
                        <option key={p.product_id} value={p.product_id}>{p.products?.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`b-c-${i}`}>Koli</label>
                    <input id={`b-c-${i}`} className="input" type="number" min="1" value={it.cases} onChange={(e) => setItem(i, { cases: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor={`b-f-${i}`}>Paket içi koli ₺</label>
                    <input id={`b-f-${i}`} className="input" inputMode="decimal" value={it.case_price} onChange={(e) => setItem(i, { case_price: e.target.value })} />
                    {it.product_id ? <span className="muted small">Normal {tl(priceOf.get(it.product_id))}</span> : null}
                  </div>
                  <button type="button" className="btn small" disabled={form.items.length <= 2} onClick={() => set({ items: form.items.filter((_, idx) => idx !== i) })} aria-label="Satırı çıkar">Çıkar</button>
                </div>
              ))}
              <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => set({ items: [...form.items, { product_id: '', cases: '1', case_price: '' }] })}>
                Ürün ekle
              </button>
              {bundleTotals && bundleTotals.normal > 0 ? (
                <div className="notice ok">
                  Paket toplamı {tl(bundleTotals.promo)} (normalde {tl(bundleTotals.normal)}) · markete %{bundleTotals.pct} avantaj
                </div>
              ) : null}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <div className="field">
              <label htmlFor="c-start">Başlangıç</label>
              <input id="c-start" className="input" type="date" required min={dayInput(0)} value={form.starts} onChange={(e) => set({ starts: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="c-end">Bitiş (gün sonuna kadar)</label>
              <input id="c-end" className="input" type="date" required min={form.starts} value={form.ends} onChange={(e) => set({ ends: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="c-target">Kime</label>
              <select id="c-target" className="input" value={form.target} onChange={(e) => set({ target: e.target.value })}>
                {Object.entries(TARGET_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>

          {form.target === 'selected' ? (
            <fieldset style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 12 }}>
              <legend className="small muted">Marketleri seçin</legend>
              {markets.map((m) => (
                <label key={m.id} className="switch-row" style={{ padding: '6px 0' }}>
                  <input
                    type="checkbox"
                    checked={form.retailers.includes(m.id)}
                    onChange={(e) =>
                      set({ retailers: e.target.checked ? [...form.retailers, m.id] : form.retailers.filter((x) => x !== m.id) })
                    }
                  />
                  <span>{m.name}</span>
                </label>
              ))}
            </fieldset>
          ) : null}

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary" disabled={busy}>{busy ? 'Oluşturuluyor…' : 'Kampanyayı başlat'}</button>
            <button type="button" className="btn" onClick={() => setForm(null)} disabled={busy}>Vazgeç</button>
          </div>
        </form>
      ) : null}

      <section className="card">
        <h2>Kampanyalarınız · {campaigns.length}</h2>
        {!campaigns.length ? (
          <p className="muted">Henüz kampanya yok. "Yeni kampanya" ile başlayın.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kampanya</th>
                  <th>İçerik</th>
                  <th>Tarih</th>
                  <th>Kime</th>
                  <th className="num">Kullanan market</th>
                  <th className="num">Satılan koli</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((c) => {
                  const st = status(c);
                  const u = usage[c.id];
                  return (
                    <tr key={c.id}>
                      <td className="strong">
                        {c.title} <span className={`badge ${st.cls}`}>{st.label}</span>
                        <div className="muted small">{c.kind === 'bundle' ? 'Paket' : 'Ürün'} kampanyası</div>
                      </td>
                      <td>
                        {c.kind === 'bundle' ? (
                          (c.campaign_items || []).map((it) => (
                            <div key={it.product_id} className="small">{it.cases} koli {it.products?.name} · {tl(it.case_price)}</div>
                          ))
                        ) : (
                          <>
                            <div className="small">{c.products?.name}</div>
                            <div className="small">Koli {tl(c.case_price)}{c.rule?.min_cases > 1 ? ` · en az ${c.rule.min_cases} koli` : ''}</div>
                          </>
                        )}
                      </td>
                      <td className="small">{shortDate(c.starts_at)} – {shortDate(c.ends_at)}</td>
                      <td className="small">{TARGET_LABEL[c.target]}</td>
                      <td className="num">{u ? u.markets.size : 0}</td>
                      <td className="num">{u ? num(u.cases, 0) : 0}</td>
                      <td>
                        {st.key === 'active' ? <button className="btn small" onClick={() => endNow(c)}>Bitir</button> : null}
                        {st.key === 'upcoming' && !u ? <button className="btn small" onClick={() => remove(c)}>Sil</button> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
