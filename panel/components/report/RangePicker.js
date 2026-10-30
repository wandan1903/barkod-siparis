'use client';

import { useState } from 'react';

function iso(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function presetRange(key) {
  const today = new Date();
  switch (key) {
    case 'today':
      return { from: iso(today), to: iso(today) };
    case '7':
      return { from: iso(addDays(today, -6)), to: iso(today) };
    case 'month':
      return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) };
    case 'lastmonth': {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: iso(first), to: iso(last) };
    }
    case '90':
      return { from: iso(addDays(today, -89)), to: iso(today) };
    case 'year':
      return { from: iso(new Date(today.getFullYear(), 0, 1)), to: iso(today) };
    case '30':
    default:
      return { from: iso(addDays(today, -29)), to: iso(today) };
  }
}

const PRESETS = [
  ['today', 'Bugün'],
  ['7', 'Son 7 gün'],
  ['30', 'Son 30 gün'],
  ['month', 'Bu ay'],
  ['lastmonth', 'Geçen ay'],
  ['90', 'Son 90 gün'],
  ['year', 'Bu yıl'],
];

// Tarih aralığı seçici: hazır aralıklar + özel aralık
export default function RangePicker({ value, onChange }) {
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState({ from: value.from, to: value.to });
  const today = iso(new Date());

  return (
    <div className="range-picker" role="group" aria-label="Tarih aralığı">
      {PRESETS.map(([k, label]) => (
        <button
          key={k}
          type="button"
          className={`btn small ${!custom && value.key === k ? 'primary' : ''}`}
          onClick={() => {
            setCustom(false);
            onChange({ key: k, ...presetRange(k) });
          }}
        >
          {label}
        </button>
      ))}
      <button type="button" className={`btn small ${custom ? 'primary' : ''}`} onClick={() => setCustom(true)}>Özel</button>
      {custom ? (
        <form
          className="custom"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.from && draft.to && draft.from <= draft.to) onChange({ key: 'custom', ...draft });
          }}
        >
          <label className="sr-only" htmlFor="rp-from">Başlangıç</label>
          <input id="rp-from" className="input" type="date" max={today} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <span className="muted small">–</span>
          <label className="sr-only" htmlFor="rp-to">Bitiş</label>
          <input id="rp-to" className="input" type="date" max={today} min={draft.from} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          <button className="btn small" type="submit" disabled={!draft.from || !draft.to || draft.from > draft.to}>Uygula</button>
        </form>
      ) : null}
    </div>
  );
}
