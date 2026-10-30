'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { tl, num, errorText } from '@/lib/format';
import { rangeLabel, seriesToBars, exportRows } from '@/lib/report';
import RangePicker, { presetRange } from '@/components/report/RangePicker';
import BarChart from '@/components/report/BarChart';
import RankList, { Delta } from '@/components/report/RankList';

// Market satış raporu. Ciro raf fiyatınızla hesaplanır; kâr son alış fiyatınıza göredir.
// Bu sayfadaki fiyat ve kâr bilgisi yalnızca sizde görünür.
export default function MarketReportPage() {
  const { org } = useOrg();
  const [range, setRange] = useState(() => ({ key: '30', ...presetRange('30') }));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: res, error } = await supabase.rpc('retailer_report', { p_retailer: org.id, p_from: range.from, p_to: range.to });
    setLoading(false);
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setMessage(null);
    setData(res);
  }, [org.id, range.from, range.to]);

  useEffect(() => {
    load();
  }, [load]);

  function exportExcel() {
    if (!data) return;
    exportRows(
      `satis-raporu-${data.from}-${data.to}.csv`,
      `${org.name} satış raporu (${rangeLabel(data.from, data.to)})`,
      ['Ürün', 'Barkod', 'Satılan adet', 'Ciro', 'Raf fiyatı', 'Alış (adet)', 'Brüt kâr'],
      data.top.map((t) => [t.name, t.gtin, Number(t.units), Number(t.revenue), Number(t.price), t.unit_cost != null ? Number(t.unit_cost) : '', t.profit != null ? Number(t.profit) : ''])
    );
  }

  const k = data ? data.kpis : null;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>Satış raporu</h1>
          <span className="muted small">{data ? rangeLabel(data.from, data.to) : ''}</span>
        </div>
        <button type="button" className="btn small outline" onClick={exportExcel} disabled={!data || !data.top.length}>Excel'e indir</button>
      </div>

      <RangePicker value={range} onChange={setRange} />
      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}

      {!data ? (
        <div className="center">Yükleniyor…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, opacity: loading ? 0.6 : 1 }}>
          <section className="kpis" aria-label="Özet">
            <div className="kpi">
              <span className="label">Ciro</span>
              <span className="value">{tl(k.revenue)}</span>
              <Delta pct={k.change_pct} />
            </div>
            <div className="kpi">
              <span className="label">Brüt kâr</span>
              <span className="value">{tl(k.profit)}</span>
              <span className="muted small">
                {k.margin_pct != null ? `Marj %${num(k.margin_pct, 1)}` : 'Alış fiyatı bilinmiyor'}
                {k.cost_coverage_pct != null && k.cost_coverage_pct < 100 ? ` · cironun %${k.cost_coverage_pct}'i için` : ''}
              </span>
            </div>
            <div className="kpi">
              <span className="label">Satılan ürün</span>
              <span className="value">{num(k.units, 0)} adet</span>
              <span className="muted small">{k.products} çeşit</span>
            </div>
            {k.receipts > 0 ? (
              <div className="kpi">
                <span className="label">Fiş / ortalama sepet</span>
                <span className="value">{k.receipts}</span>
                <span className="muted small">Ortalama {tl(k.avg_basket)}</span>
              </div>
            ) : null}
          </section>

          {k.units_unpriced > 0 ? (
            <div className="notice" role="status">
              {num(k.units_unpriced, 0)} adet satışın raf fiyatı girilmemiş, ciroya katılmadı. <Link href="/market/stok">Stok sayfasından fiyat girin</Link>.
            </div>
          ) : null}

          <section className="card">
            <BarChart
              title={data.weekly ? 'Haftalık ciro' : 'Günlük ciro'}
              data={seriesToBars(data.series, data.weekly, 'revenue', (s) => `${num(s.units, 0)} adet`)}
              format={tl}
              emptyText="Bu aralıkta satış yok."
            />
          </section>

          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 style={{ margin: 0 }}>En çok satanlar</h2>
            <RankList
              items={data.top.slice(0, 10)}
              value={(t) => t.revenue}
              format={tl}
              sub={(t) => `${num(t.units, 0)} adet${t.profit != null ? ` · kâr ${tl(t.profit)}` : ''}`}
              emptyText="Bu aralıkta satış yok."
            />
          </section>

          {data.low_margin.length ? (
            <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <h2 style={{ margin: 0 }}>Kârı en düşük ürünler</h2>
                <p className="muted small" style={{ margin: '4px 0 0' }}>Raf fiyatını gözden geçirmek isteyebilirsiniz.</p>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Ürün</th><th className="num">Alış</th><th className="num">Raf</th><th className="num">Marj</th></tr></thead>
                  <tbody>
                    {data.low_margin.map((r) => (
                      <tr key={r.name}>
                        <td>{r.name}</td>
                        <td className="num">{tl(r.unit_cost)}</td>
                        <td className="num">{tl(r.price)}</td>
                        <td className="num strong">%{num(r.m, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <p className="muted small">
            Ciro, satılan adet × güncel raf fiyatınızla hesaplanır (kasa entegrasyonundan gelen satışlar dahil). Kâr, distribütörden son teslim aldığınız koli fiyatına göredir. Bu bilgileri distribütör göremez.
          </p>
        </div>
      )}
    </>
  );
}
