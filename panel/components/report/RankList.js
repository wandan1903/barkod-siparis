'use client';

// Sıralı liste + satır içi büyüklük çubuğu (tek renk, en büyüğe göre ölçekli)
export default function RankList({ items, value, format, sub, emptyText = 'Veri yok.' }) {
  if (!items.length) return <p className="muted">{emptyText}</p>;
  const max = Math.max(...items.map((it) => Number(value(it)) || 0), 1);
  return (
    <div className="rank">
      {items.map((it, i) => {
        const v = Number(value(it)) || 0;
        return (
          <div key={`${it.name}-${i}`} className="rank-row">
            <div className="top">
              <span>
                <span className="muted small" style={{ marginRight: 6 }}>{i + 1}.</span>
                {it.name}
              </span>
              <span className="v">{format(v)}</span>
            </div>
            <div className="track" aria-hidden="true"><div style={{ width: `${(v / max) * 100}%` }} /></div>
            {sub ? <span className="muted small">{sub(it)}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

export function Delta({ pct, suffix = 'önceki döneme göre' }) {
  if (pct === null || pct === undefined) return <span className="muted small">Önceki dönemle kıyas yok</span>;
  const up = Number(pct) >= 0;
  return (
    <span className={`delta ${up ? 'up' : 'down'}`}>
      {up ? '▲' : '▼'} %{Math.abs(Number(pct)).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} <span className="muted" style={{ fontWeight: 400 }}>{suffix}</span>
    </span>
  );
}
