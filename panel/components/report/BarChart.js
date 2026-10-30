'use client';

import { useMemo, useRef, useState } from 'react';

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}

function compact(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Mn`;
  if (a >= 1e3) return `${(v / 1e3).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} B`;
  return v.toLocaleString('tr-TR', { maximumFractionDigits: 0 });
}

// Tek seri sütun grafiği. data: [{ label, short, value, tip }]
// Fareyle / klavyeyle üzerine gelince değer kutusu; "Tablo" düğmesi aynı veriyi tablo olarak gösterir.
export default function BarChart({ data, title, format = (v) => v, emptyText = 'Bu aralıkta veri yok.' }) {
  const [hover, setHover] = useState(null);
  const [table, setTable] = useState(false);
  const plotRef = useRef(null);
  const max = useMemo(() => niceMax(Math.max(0, ...data.map((d) => d.value))), [data]);
  const ticks = [max, max / 2, 0];
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));
  const empty = !data.some((d) => d.value > 0);

  function show(i, el) {
    const plot = plotRef.current;
    if (!plot || !el) return;
    const pr = plot.getBoundingClientRect();
    const br = el.getBoundingClientRect();
    const h = (data[i].value / max) * pr.height;
    setHover({ i, x: br.left - pr.left + br.width / 2, y: pr.height - h - 6 });
  }

  return (
    <div className="chart">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <button type="button" className="btn small" onClick={() => setTable(!table)} aria-pressed={table}>
          {table ? 'Grafik' : 'Tablo'}
        </button>
      </div>
      {empty ? (
        <p className="muted">{emptyText}</p>
      ) : table ? (
        <div className="table-wrap" style={{ maxHeight: 260, overflow: 'auto' }}>
          <table>
            <thead><tr><th>Dönem</th><th className="num">Değer</th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.label}><td>{d.label}</td><td className="num">{format(d.value)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="chart-plot" ref={plotRef} role="img" aria-label={`${title}: ${data.length} dönem, en yüksek ${format(Math.max(...data.map((d) => d.value)))}`} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <div key={t} className="chart-grid" style={{ bottom: `${(t / max) * 100}%` }}>
                <span>{compact(t)}</span>
              </div>
            ))}
            {data.map((d, i) => (
              <div
                key={d.label}
                className="chart-bar"
                tabIndex={0}
                aria-label={`${d.label}: ${format(d.value)}`}
                onMouseEnter={(e) => show(i, e.currentTarget)}
                onFocus={(e) => show(i, e.currentTarget)}
                onBlur={() => setHover(null)}
              >
                <div className="fill" style={{ height: `${(d.value / max) * 100}%` }} />
              </div>
            ))}
            {hover ? (
              <div className="chart-tip" style={{ left: hover.x, top: hover.y }}>
                {data[hover.i].label}
                <strong>{format(data[hover.i].value)}</strong>
                {data[hover.i].tip ? <span>{data[hover.i].tip}</span> : null}
              </div>
            ) : null}
          </div>
          <div className="chart-x" aria-hidden="true">
            {data.map((d, i) => (
              <span key={d.label}>{i % labelEvery === 0 ? d.short : ''}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
