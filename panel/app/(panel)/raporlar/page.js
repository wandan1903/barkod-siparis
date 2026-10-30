'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { tl, num, errorText } from '@/lib/format';
import { rangeLabel, seriesToBars, exportRows } from '@/lib/report';
import RangePicker, { presetRange } from '@/components/report/RangePicker';
import BarChart from '@/components/report/BarChart';
import RankList, { Delta } from '@/components/report/RankList';

export default function DistributorReportPage() {
  const { org } = useOrg();
  const [range, setRange] = useState(() => ({ key: '30', ...presetRange('30') }));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: res, error } = await supabase.rpc('distributor_report', { p_distributor: org.id, p_from: range.from, p_to: range.to });
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
    const title = `${org.name} satış raporu (${rangeLabel(data.from, data.to)})`;
    const rows = [
      ['Teslim edilen ciro', Number(data.kpis.revenue)],
      ['Tahsilat', Number(data.kpis.collected)],
      ['Teslimat sayısı', Number(data.kpis.deliveries)],
      ['Ortalama sipariş', Number(data.kpis.avg_order || 0)],
      ['Aktif market', Number(data.kpis.active_markets)],
      ['Öneri kabul oranı (%)', data.kpis.offer_accept_pct ?? ''],
      [],
      ['En çok satan ürünler', 'Koli', 'Ciro'],
      ...data.top_products.map((p) => [p.name, Number(p.cases), Number(p.revenue)]),
      [],
      ['En çok alan marketler', 'Teslimat', 'Ciro'],
      ...data.top_markets.map((m) => [m.name, Number(m.deliveries), Number(m.revenue)]),
      [],
      ['Markette satılan (sell-out)', 'Koli', 'Adet'],
      ...data.sellout.map((s) => [s.name, Number(s.cases), Number(s.units)]),
    ];
    exportRows(`rapor-${data.from}-${data.to}.csv`, title, ['Kalem', 'Değer', ''], rows);
  }

  const k = data ? data.kpis : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Raporlar</h1>
          <p className="sub">{data ? rangeLabel(data.from, data.to) : ''} · teslim edilen siparişler, tahsilat ve marketteki satış</p>
        </div>
        <button type="button" className="btn outline" onClick={exportExcel} disabled={!data}>Excel'e indir</button>
      </div>

      <RangePicker value={range} onChange={setRange} />
      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}

      {!data ? (
        <div className="center">Yükleniyor…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, opacity: loading ? 0.6 : 1 }}>
          <section className="kpis" aria-label="Özet">
            <div className="kpi">
              <span className="label">Teslim edilen ciro</span>
              <span className="value">{tl(k.revenue)}</span>
              <Delta pct={k.change_pct} />
            </div>
            <div className="kpi">
              <span className="label">Tahsilat</span>
              <span className="value">{tl(k.collected)}</span>
              <span className="muted small">Cari hesaplara girilen ödemeler</span>
            </div>
            <div className="kpi">
              <span className="label">Teslimat / ortalama sipariş</span>
              <span className="value">{k.deliveries}</span>
              <span className="muted small">{k.avg_order ? `Ortalama ${tl(k.avg_order)}` : '–'}</span>
            </div>
            <div className="kpi">
              <span className="label">Sipariş veren market</span>
              <span className="value">{k.active_markets} / {k.linked_markets}</span>
              <span className="muted small">Bu dönemde teslimat alan / bağlı</span>
            </div>
            <div className="kpi">
              <span className="label">Öneri kabul oranı</span>
              <span className="value">{k.offer_accept_pct != null ? `%${k.offer_accept_pct}` : '–'}</span>
              <span className="muted small">{k.offers_sent} öneri gönderildi · {k.offers_accepted} onaylandı</span>
            </div>
            <div className="kpi">
              <span className="label">Rafı boş ürün</span>
              <span className={`value ${k.empty_shelves ? 'warn' : ''}`}>{k.empty_shelves}</span>
              <span className="muted small">Şu an, stok paylaşan marketlerde</span>
            </div>
          </section>

          <section className="card">
            <BarChart
              title={data.weekly ? 'Haftalık teslim edilen ciro' : 'Günlük teslim edilen ciro'}
              data={seriesToBars(data.series, data.weekly)}
              format={tl}
              emptyText="Bu aralıkta teslim edilen sipariş yok."
            />
          </section>

          <div className="report-grid">
            <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h2 style={{ margin: 0 }}>En çok satan ürünler</h2>
              <RankList items={data.top_products} value={(p) => p.revenue} format={tl} sub={(p) => `${num(p.cases, 0)} koli`} emptyText="Teslim edilen sipariş yok." />
            </section>
            <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h2 style={{ margin: 0 }}>En çok alan marketler</h2>
              <RankList items={data.top_markets} value={(m) => m.revenue} format={tl} sub={(m) => `${m.deliveries} teslimat`} emptyText="Teslim edilen sipariş yok." />
            </section>
            <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <h2 style={{ margin: 0 }}>Markette satılan (sell-out)</h2>
                <p className="muted small" style={{ margin: '4px 0 0' }}>
                  Ürünlerinizin raftan satışı · stok paylaşan {data.sellout_markets} market
                </p>
              </div>
              <RankList items={data.sellout} value={(s) => s.cases} format={(v) => `${num(v, 1)} koli`} sub={(s) => `${num(s.units, 0)} adet`} emptyText="Bu aralıkta satış verisi yok." />
            </section>
          </div>
        </div>
      )}
    </>
  );
}
