'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { num, dateTime, errorText } from '@/lib/format';
import BarcodeInput from '@/components/BarcodeInput';

const MODES = [
  { key: 'giris', label: 'Depoya giriş', hint: 'Okuttuğunuz her ürün depoya eklenir (mal kabul, üretim, iade).', save: 'Girişi kaydet' },
  { key: 'cikis', label: 'Depodan çıkış', hint: 'Okuttuğunuz her ürün depodan düşer (fire, numune, elden satış).', save: 'Çıkışı kaydet' },
  { key: 'sayim', label: 'Sayım', hint: 'Rafta saydığınız toplam miktarı girin; depo stoğu bu sayıya eşitlenir.', save: 'Sayımı kaydet' },
];
const KIND_LABEL = { giris: 'Giriş', cikis: 'Çıkış', sayim: 'Sayım', sevkiyat: 'Sevkiyat' };

function split(units, caseQty) {
  const q = Math.max(1, Number(caseQty) || 1);
  return { cases: Math.floor(units / q), rest: units % q };
}
function qtyLabel(units, caseQty) {
  const { cases, rest } = split(units, caseQty);
  if (!units) return '0';
  return [cases ? `${num(cases, 0)} koli` : '', rest ? `${num(rest, 0)} adet` : ''].filter(Boolean).join(' ');
}

export default function WarehousePage() {
  const { org } = useOrg();
  const [catalog, setCatalog] = useState(null);
  const [stock, setStock] = useState(new Map());
  const [moves, setMoves] = useState([]);
  const [mode, setMode] = useState('giris');
  const [step, setStep] = useState('adet'); // bir okutmada eklenen: adet | koli
  const [pending, setPending] = useState([]); // [{ productId, units }]
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState('');

  const load = useCallback(async () => {
    const [c, s, m] = await Promise.all([
      supabase
        .from('distributor_products')
        .select('product_id, products(id, gtin, name, case_qty, category)')
        .eq('distributor_id', org.id)
        .eq('active', true),
      supabase.from('warehouse_stock').select('product_id, qty_units, min_cases, updated_at').eq('distributor_id', org.id),
      supabase
        .from('warehouse_movements')
        .select('id, product_id, delta_units, balance_units, kind, note, created_at, products(name, case_qty)')
        .eq('distributor_id', org.id)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);
    const err = c.error || s.error || m.error;
    if (err) setMessage({ kind: 'error', text: errorText(err) });
    const list = (c.data || []).map((r) => r.products).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    setCatalog(list);
    setStock(new Map((s.data || []).map((r) => [r.product_id, r])));
    setMoves(m.data || []);
  }, [org.id]);

  useEffect(() => {
    load();
  }, [load]);

  const byId = useMemo(() => new Map((catalog || []).map((p) => [p.id, p])), [catalog]);
  const byGtin = useMemo(() => new Map((catalog || []).map((p) => [p.gtin, p])), [catalog]);

  function addUnits(product, units) {
    setPending((cur) => {
      const i = cur.findIndex((l) => l.productId === product.id);
      if (i === -1) return [{ productId: product.id, units }, ...cur];
      const next = cur.slice();
      next[i] = { ...next[i], units: next[i].units + units };
      return next;
    });
  }

  function onScan(raw) {
    const code = String(raw || '').trim();
    if (!code) return;
    const product = byGtin.get(code);
    if (!product) {
      setMessage({ kind: 'error', text: `${code} barkodu kataloğunuzda yok. Önce "Ürünler ve fiyatlar" sayfasından ekleyin.` });
      return;
    }
    setMessage(null);
    addUnits(product, step === 'koli' ? product.case_qty : 1);
  }

  function setLine(productId, cases, rest) {
    const p = byId.get(productId);
    const units = Math.max(0, Number(cases) || 0) * p.case_qty + Math.max(0, Number(rest) || 0);
    setPending((cur) => cur.map((l) => (l.productId === productId ? { ...l, units } : l)));
  }

  function removeLine(productId) {
    setPending((cur) => cur.filter((l) => l.productId !== productId));
  }

  async function save() {
    const mode_ = MODES.find((m) => m.key === mode);
    const lines = pending.map((l) => ({ product_id: l.productId, units: l.units }));
    if (!lines.length) return;
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.rpc('warehouse_apply', { p_distributor: org.id, p_kind: mode, p_lines: lines, p_note: note });
    setBusy(false);
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setMessage({ kind: 'ok', text: `${mode_.label} kaydedildi (${lines.length} ürün).` });
    setPending([]);
    setNote('');
    load();
  }

  async function saveMin(productId, value) {
    const v = value === '' ? null : Math.max(0, Number(value));
    const { error } = await supabase.rpc('warehouse_set_min', { p_distributor: org.id, p_product: productId, p_min_cases: v });
    if (error) setMessage({ kind: 'error', text: errorText(error) });
    else load();
  }

  function statusOf(p) {
    const s = stock.get(p.id);
    if (!s) return { key: 'none', label: 'Takipte değil', cls: 'info' };
    if (s.qty_units === 0) return { key: 'out', label: 'Bitti', cls: 'warn' };
    if (s.min_cases != null && split(s.qty_units, p.case_qty).cases < s.min_cases) return { key: 'low', label: 'Azalıyor', cls: 'warn' };
    return { key: 'ok', label: 'Yeterli', cls: 'ok' };
  }

  const counts = useMemo(() => {
    const c = { tracked: 0, out: 0, low: 0 };
    for (const p of catalog || []) {
      const st = statusOf(p).key;
      if (st !== 'none') c.tracked += 1;
      if (st === 'out') c.out += 1;
      if (st === 'low') c.low += 1;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, stock]);

  const rows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    return (catalog || []).filter((p) => {
      if (q && !p.name.toLocaleLowerCase('tr-TR').includes(q) && !p.gtin.includes(q)) return false;
      const st = statusOf(p).key;
      if (filter === 'out') return st === 'out';
      if (filter === 'low') return st === 'low' || st === 'out';
      if (filter === 'none') return st === 'none';
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, stock, search, filter]);

  if (!catalog) return <div className="center">Yükleniyor…</div>;

  const modeInfo = MODES.find((m) => m.key === mode);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Depo</h1>
          <p className="sub">Kendi stoğunuz: barkod okutarak depoya ekleyin, çıkarın ya da sayın. Sevkiyata çıkan siparişler stoğu otomatik düşer.</p>
        </div>
        <Link href="/etiket" className="btn outline">Etiket yazdır</Link>
      </div>

      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}

      <section className="kpis" aria-label="Depo özeti">
        <div className="kpi"><span className="label">Depoda takip edilen ürün</span><span className="value">{counts.tracked}</span></div>
        <div className="kpi"><span className="label">Biten ürün</span><span className={`value ${counts.out ? 'warn' : ''}`}>{counts.out}</span></div>
        <div className="kpi"><span className="label">Azalan ürün</span><span className={`value ${counts.low ? 'warn' : ''}`}>{counts.low}</span></div>
      </section>

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              className={`btn small ${mode === m.key ? 'primary' : ''}`}
              onClick={() => { setMode(m.key); setPending([]); setMessage(null); }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="muted small" style={{ margin: 0 }}>{modeInfo.hint}</p>

        <BarcodeInput onCode={onScan} />

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="small muted">Her okutuşta eklenen:</span>
          <button type="button" className={`btn small ${step === 'adet' ? 'primary' : ''}`} onClick={() => setStep('adet')}>1 adet</button>
          <button type="button" className={`btn small ${step === 'koli' ? 'primary' : ''}`} onClick={() => setStep('koli')}>1 koli</button>
          <span className="small muted" style={{ marginLeft: 8 }}>ya da listeden seç:</span>
          <select className="input" style={{ maxWidth: 260 }} value={pick} onChange={(e) => {
            const p = byId.get(e.target.value);
            setPick('');
            if (p) addUnits(p, step === 'koli' ? p.case_qty : 1);
          }}>
            <option value="">Ürün seçin…</option>
            {catalog.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {pending.length ? (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ürün</th>
                    <th>Depoda şimdi</th>
                    <th>{mode === 'sayim' ? 'Sayılan toplam' : mode === 'giris' ? 'Eklenecek' : 'Çıkacak'}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pending.map((l) => {
                    const p = byId.get(l.productId);
                    const cur = stock.get(l.productId);
                    const { cases, rest } = split(l.units, p.case_qty);
                    const over = mode === 'cikis' && l.units > (cur ? cur.qty_units : 0);
                    return (
                      <tr key={l.productId}>
                        <td>
                          <span className="strong">{p.name}</span>
                          <span className="muted small" style={{ display: 'block' }}>{p.gtin} · koli {p.case_qty} adet</span>
                        </td>
                        <td>{cur ? qtyLabel(cur.qty_units, p.case_qty) : 'Takipte değil'}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <input aria-label="Koli" className="input" type="number" min="0" style={{ width: 72 }} value={cases} onChange={(e) => setLine(l.productId, e.target.value, rest)} />
                            <span className="small muted">koli</span>
                            <input aria-label="Adet" className="input" type="number" min="0" style={{ width: 72 }} value={rest} onChange={(e) => setLine(l.productId, cases, e.target.value)} />
                            <span className="small muted">adet</span>
                          </div>
                          {over ? <span className="small warn-text">Depoda bu kadar yok</span> : null}
                        </td>
                        <td><button type="button" className="btn small" onClick={() => removeLine(l.productId)}>Kaldır</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="field">
              <label htmlFor="wh-note">Not (isteğe bağlı)</label>
              <input id="wh-note" className="input" placeholder="ör. Fabrikadan mal kabul, irsaliye 1234" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setPending([])} disabled={busy}>Listeyi temizle</button>
              <button type="button" className="btn primary" style={{ flex: 1 }} onClick={save} disabled={busy}>
                {busy ? 'Kaydediliyor…' : `${modeInfo.save} (${pending.length} ürün)`}
              </button>
            </div>
          </>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>Henüz ürün okutulmadı. Barkod okuyucuyla okutun, barkodu yazın ya da listeden seçin.</p>
        )}
      </section>

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Depo durumu</h2>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[['all', 'Hepsi'], ['low', 'Biten / azalan'], ['out', 'Biten'], ['none', 'Takipte değil']].map(([k, label]) => (
              <button key={k} type="button" className={`btn small ${filter === k ? 'primary' : ''}`} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </div>
        </div>
        <input className="input" placeholder="Ürün adı veya barkod ara" aria-label="Ürün ara" value={search} onChange={(e) => setSearch(e.target.value)} />
        {!catalog.length ? (
          <p className="muted">Kataloğunuzda ürün yok. <Link href="/urunler">Ürünler ve fiyatlar</Link> sayfasından ekleyin.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Ürün</th><th>Depoda</th><th>Kritik eşik (koli)</th><th>Durum</th></tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const s = stock.get(p.id);
                  const st = statusOf(p);
                  return (
                    <tr key={p.id}>
                      <td>
                        <span className="strong">{p.name}</span>
                        <span className="muted small" style={{ display: 'block' }}>{p.gtin} · koli {p.case_qty} adet</span>
                      </td>
                      <td className="strong">{s ? qtyLabel(s.qty_units, p.case_qty) : '–'}</td>
                      <td>
                        <input
                          key={`${p.id}:${s ? s.min_cases : ''}`}
                          aria-label={`${p.name} kritik eşik`}
                          className="input"
                          type="number"
                          min="0"
                          style={{ width: 84 }}
                          placeholder="–"
                          defaultValue={s && s.min_cases != null ? s.min_cases : ''}
                          onBlur={(e) => {
                            const cur = s && s.min_cases != null ? String(s.min_cases) : '';
                            if (e.target.value !== cur) saveMin(p.id, e.target.value);
                          }}
                        />
                      </td>
                      <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                    </tr>
                  );
                })}
                {!rows.length ? <tr><td colSpan={4} className="muted">Ürün bulunamadı.</td></tr> : null}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {moves.length ? (
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 style={{ margin: 0 }}>Son hareketler</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Zaman</th><th>Ürün</th><th>İşlem</th><th>Miktar</th><th>Kalan</th></tr></thead>
              <tbody>
                {moves.map((m) => {
                  const q = m.products ? m.products.case_qty : 1;
                  const d = Math.abs(m.delta_units);
                  return (
                    <tr key={m.id}>
                      <td className="small">{dateTime(m.created_at)}</td>
                      <td>
                        {m.products ? m.products.name : 'Ürün'}
                        {m.note ? <span className="muted small" style={{ display: 'block' }}>{m.note}</span> : null}
                      </td>
                      <td>{KIND_LABEL[m.kind] || m.kind}</td>
                      <td className={m.delta_units < 0 ? 'warn-text' : ''}>{m.delta_units < 0 ? '−' : m.delta_units > 0 ? '+' : ''}{qtyLabel(d, q)}</td>
                      <td>{qtyLabel(m.balance_units, q)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
