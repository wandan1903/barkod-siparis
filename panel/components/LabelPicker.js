'use client';

import { useMemo, useState } from 'react';

// Ürün listesi: her satırda kaç etiket basılacağı. filters: [{ key, label, test(item) }]
export default function LabelPicker({ items, copies, setCopies, filters = [], describe }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    const f = filters.find((x) => x.key === filter);
    return items.filter((it) => {
      if (q && !it.name.toLocaleLowerCase('tr-TR').includes(q) && !String(it.gtin).includes(q)) return false;
      return f ? f.test(it) : true;
    });
  }, [items, search, filter, filters]);

  const selected = items.filter((it) => Number(copies[it.id]) > 0).length;

  function setAll(n) {
    const next = { ...copies };
    for (const it of visible) next[it.id] = typeof n === 'function' ? n(it) : n;
    setCopies(next);
  }

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Ürünler <span className="muted small">· {selected} seçili</span></h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn small" onClick={() => setAll(1)}>Görünenlerin hepsi 1</button>
          <button type="button" className="btn small" onClick={() => setAll(0)}>Temizle</button>
        </div>
      </div>
      <input className="input" placeholder="Ürün adı veya barkod ara" aria-label="Ürün ara" value={search} onChange={(e) => setSearch(e.target.value)} />
      {filters.length ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[{ key: 'all', label: 'Hepsi' }, ...filters].map((f) => (
            <button key={f.key} type="button" className={`btn small ${filter === f.key ? 'primary' : ''}`} onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>
      ) : null}
      <div>
        {visible.map((it) => (
          <div key={it.id} className="pick-row">
            <input
              type="checkbox"
              aria-label={`${it.name} seç`}
              checked={Number(copies[it.id]) > 0}
              onChange={(e) => setCopies({ ...copies, [it.id]: e.target.checked ? 1 : 0 })}
            />
            <span className="grow">
              <span className="strong">{it.name}</span>
              <span className="muted small">{describe(it)}</span>
            </span>
            <label className="sr-only" htmlFor={`cp-${it.id}`}>{it.name} adet</label>
            <input
              id={`cp-${it.id}`}
              className="input"
              type="number"
              min="0"
              max="500"
              value={copies[it.id] ?? 0}
              onChange={(e) => setCopies({ ...copies, [it.id]: Math.max(0, Math.min(500, Number(e.target.value) || 0)) })}
            />
          </div>
        ))}
        {!visible.length ? <p className="muted" style={{ padding: '8px 0' }}>Ürün bulunamadı.</p> : null}
      </div>
    </section>
  );
}
