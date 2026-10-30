// Rapor yardımcıları
import { tl } from '@/lib/format';
import { downloadText } from '@/lib/account';

const DAY = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
const WD = new Intl.DateTimeFormat('tr-TR', { weekday: 'short', day: 'numeric', month: 'short' });

function parse(d) {
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, day);
}

export function rangeLabel(from, to) {
  return from === to ? DAY.format(parse(from)) : `${DAY.format(parse(from))} – ${DAY.format(parse(to))}`;
}

// Sunucudan gelen seriyi grafik verisine çevirir
export function seriesToBars(series, weekly, key = 'revenue', tipFn) {
  return (series || []).map((s) => {
    const d = parse(s.d);
    return {
      label: weekly ? `${DAY.format(d)} haftası` : WD.format(d),
      short: DAY.format(d),
      value: Number(s[key]) || 0,
      tip: tipFn ? tipFn(s) : null,
    };
  });
}

export const money = (v) => tl(v);

// Basit tablo → Excel (CSV, noktalı virgül, Türkçe ondalık)
export function exportRows(filename, title, header, rows) {
  const esc = (v) => {
    const s = typeof v === 'number' ? v.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) : String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [esc(title), header.map(esc).join(';'), ...rows.map((r) => r.map(esc).join(';'))];
  downloadText(filename, '﻿' + lines.join('\r\n'));
}
