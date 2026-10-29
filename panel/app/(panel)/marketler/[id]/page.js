'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { num, tl, shortDate, STOCK_SOURCE_LABEL, errorText } from '@/lib/format';

export default function MarketPage() {
  const { org } = useOrg();
  const params = useParams();
  const router = useRouter();
  const retailerId = params.id;

  const [rows, setRows] = useState(null);
  const [qty, setQty] = useState({});
  const [selected, setSelected] = useState(null);
  const [weeks, setWeeks] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [pending, setPending] = useState(null);

  useEffect(() => {
    async function load() {
      const { data: open } = await supabase
        .from('orders')
        .select('id, total, created_at')
        .eq('distributor_id', org.id)
        .eq('retailer_id', retailerId)
        .eq('origin', 'offer')
        .eq('status', 'sent')
        .limit(1);
      setPending(open && open.length ? open[0] : null);

      const [overview, camps] = await Promise.all([
        supabase.rpc('distributor_stock_overview', { p_distributor: org.id }),
        supabase
          .from('campaigns')
          .select('id, title, product_id, ends_at')
          .eq('distributor_id', org.id)
          .gt('ends_at', new Date().toISOString()),
      ]);
      if (overview.error) {
        setMessage({ kind: 'error', text: errorText(overview.error) });
        setRows([]);
        return;
      }
      const mine = (overview.data || [])
        .filter((r) => r.retailer_id === retailerId)
        .sort((a, b) => Number(a.days_left ?? 99) - Number(b.days_left ?? 99));
      setRows(mine);
      const initial = {};
      for (const r of mine) initial[r.product_id] = r.suggested_cases;
      setQty(initial);
      if (mine.length) setSelected(mine[0].product_id);
      setCampaigns(camps.data || []);
    }
    load();
  }, [org.id, retailerId]);

  useEffect(() => {
    if (!selected) return;
    supabase
      .rpc('weekly_sales', { p_retailer: retailerId, p_product: selected, p_weeks: 6 })
      .then(({ data }) => setWeeks(data || []));
  }, [selected, retailerId]);

  const total = useMemo(() => {
    if (!rows) return { cases: 0, value: 0 };
    let cases = 0;
    let value = 0;
    for (const r of rows) {
      const n = Number(qty[r.product_id] || 0);
      cases += n;
      value += n * Number(r.case_price);
    }
    return { cases, value };
  }, [rows, qty]);

  function loadSuggestion() {
    const next = {};
    for (const r of rows || []) next[r.product_id] = r.suggested_cases;
    setQty(next);
  }

  const maxWeek = Math.max(1, ...weeks.map((w) => Number(w.cases)));
  const selectedRow = rows ? rows.find((r) => r.product_id === selected) : null;

  async function sendOffer() {
    const lines = rows
      .filter((r) => Number(qty[r.product_id] || 0) > 0)
      .map((r) => ({ product_id: r.product_id, cases: Number(qty[r.product_id]), suggested_cases: r.suggested_cases }));
    if (!lines.length) {
      setMessage({ kind: 'error', text: 'En az bir ürün için koli adedi girin.' });
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('create_order', {
      p_retailer: retailerId,
      p_distributor: org.id,
      p_lines: lines,
      p_status: 'sent',
    });
    setBusy(false);
    if (error) {
      setMessage({
        kind: 'error',
        text: error.code === '23505' ? 'Bu markette zaten yanıt bekleyen bir teklifiniz var.' : errorText(error),
      });
      return;
    }
    router.push('/siparisler');
  }

  if (!rows) return <div className="center">Yükleniyor…</div>;

  const market = rows[0];

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/" className="small">← Genel bakış</Link>
          <h1>{market ? market.retailer_name : 'Market'}</h1>
          {market ? (
            <p className="sub">
              {market.district} · Veri kaynağı: {STOCK_SOURCE_LABEL[market.stock_source] || market.stock_source}
            </p>
          ) : null}
        </div>
      </div>

      <div className="notice">
        Marketin satış fiyatları gizlidir. Yalnızca sizin ürünlerinizin stoğu ve satış hızı görünür. Koli fiyatınız markete teklifte görünür.
      </div>

      {message ? <div className={`notice ${message.kind}`} role="alert">{message.text}</div> : null}

      {pending ? (
        <div className="notice error">
          Bu markete {shortDate(pending.created_at)} tarihinde gönderilmiş, yanıt bekleyen bir teklifiniz var ({tl(pending.total)}).
          Market onaylayana ya da reddedene kadar yeni teklif gönderilemez.{' '}
          <Link href="/siparisler">Siparişlere git</Link>
        </div>
      ) : null}

      {!rows.length ? (
        <div className="card"><p className="muted">Bu markette ürününüz için stok bilgisi yok ya da market veri paylaşımına onay vermemiş.</p></div>
      ) : (
        <div className="row">
          <section className="card grow">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h2>Ürünleriniz</h2>
              <button className="btn small outline" onClick={loadSuggestion}>Önerilen adetleri yükle</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ürün</th>
                    <th className="num">Kalan</th>
                    <th className="num">Haftalık satış</th>
                    <th className="num">Bitmesine</th>
                    <th className="num">Öneri</th>
                    <th className="num">Teklif (koli)</th>
                    <th className="num">Koli fiyatı</th>
                    <th className="num">Tutar</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const days = r.days_left === null ? null : Number(r.days_left);
                    const n = Number(qty[r.product_id] || 0);
                    return (
                      <tr key={r.product_id}>
                        <td className="strong">
                          <button
                            type="button"
                            onClick={() => setSelected(r.product_id)}
                            style={{ all: 'unset', cursor: 'pointer', textDecoration: selected === r.product_id ? 'underline' : 'none' }}
                          >
                            {r.product_name}
                          </button>
                          <div className="muted small">{r.gtin} · koli {r.case_qty} adet</div>
                        </td>
                        <td className="num">{num(r.stock_cases)} koli</td>
                        <td className="num">{num(r.weekly_cases)} koli</td>
                        <td className={`num ${days !== null && days <= 2 ? 'warn-text' : ''}`}>{days === null ? '–' : `${num(days)} gün`}</td>
                        <td className="num">
                          {r.suggested_cases > 0 ? <span className="badge warn">{r.suggested_cases} koli</span> : <span className="muted">–</span>}
                        </td>
                        <td className="num">
                          <label className="sr-only" htmlFor={`q-${r.product_id}`}>{r.product_name} teklif adedi</label>
                          <input
                            id={`q-${r.product_id}`}
                            className="input compact"
                            type="number"
                            min="0"
                            value={qty[r.product_id] ?? 0}
                            onChange={(e) => setQty({ ...qty, [r.product_id]: e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0) })}
                            style={{ textAlign: 'right' }}
                          />
                        </td>
                        <td className="num">{tl(r.case_price)}</td>
                        <td className="num strong">{tl(n * Number(r.case_price))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted small">
              Öneri = son 4 haftanın ortalama haftalık satışı + 2 günlük yedek − kalan stok (yukarı yuvarlanır).
            </p>
          </section>

          <aside className="aside" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <section className="card">
              <h2>Cumartesi teklifi</h2>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Toplam</span>
                <span className="strong">{num(total.cases, 0)} koli</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18 }}>
                <span>Tutar</span>
                <span style={{ fontWeight: 700 }}>{tl(total.value)}</span>
              </div>
              {campaigns.length ? (
                <div className="notice ok">
                  <div>
                    <strong>Aktif kampanyalar</strong>
                    {campaigns.map((c) => (
                      <div key={c.id} className="small">{c.title} · {shortDate(c.ends_at)} tarihine kadar</div>
                    ))}
                  </div>
                </div>
              ) : null}
              <button className="btn primary" onClick={sendOffer} disabled={busy || !!pending}>
                {busy ? 'Gönderiliyor…' : pending ? 'Yanıt bekleyen teklif var' : 'Teklifi markete gönder'}
              </button>
            </section>

            {selectedRow ? (
              <section className="card">
                <h3>{selectedRow.product_name}: son 6 hafta satış (koli)</h3>
                <div
                  className="bars"
                  style={{ gridTemplateColumns: `repeat(${weeks.length || 6}, minmax(0, 1fr))` }}
                  role="img"
                  aria-label={`Son 6 hafta: ${weeks.map((w) => num(w.cases)).join(', ')} koli`}
                >
                  {weeks.map((w, i) => {
                    const last = i === weeks.length - 1;
                    return (
                      <div key={w.week_start} className={`bar ${last ? 'current' : ''}`}>
                        <span>{num(w.cases)}</span>
                        <div className="fill" style={{ height: `${(Number(w.cases) / maxWeek) * 100}px` }} />
                        <span>{last ? 'Bu hafta' : shortDate(w.week_start)}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="muted small">Bu hafta henüz bitmedi; sütun hafta boyunca dolar.</p>
              </section>
            ) : null}
          </aside>
        </div>
      )}
    </>
  );
}
