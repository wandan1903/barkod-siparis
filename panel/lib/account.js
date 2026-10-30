// Cari hesap yardımcıları (distribütör ve market ekranlarında ortak)

export const KIND_LABEL = {
  siparis: 'Sipariş (teslim)',
  tahsilat: 'Tahsilat',
  iade: 'İade',
  duzeltme: 'Düzeltme',
  iptal: 'İptal',
};

export const METHOD_LABEL = {
  nakit: 'Nakit',
  havale: 'Havale / EFT',
  kart: 'Kredi kartı',
  cek: 'Çek',
  senet: 'Senet',
  diger: 'Diğer',
};

function sortAsc(a, b) {
  if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? -1 : 1;
  return a.created_at < b.created_at ? -1 : 1;
}

// Kayıtları tarih sırasına koyup her satıra yürüyen bakiye ekler; iptal edilenleri işaretler
export function withRunningBalance(entries) {
  const reversed = new Set(entries.filter((e) => e.reverses_id).map((e) => e.reverses_id));
  let run = 0;
  return entries
    .slice()
    .sort(sortAsc)
    .map((e) => {
      run += Number(e.amount);
      return { ...e, running: Math.round(run * 100) / 100, isReversed: reversed.has(e.id) };
    });
}

function money(n) {
  return Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function trDate(d) {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${day}.${m}.${y}`;
}

// Excel'in Türkçe ayarlarıyla düzgün açılan CSV (noktalı virgül, virgüllü ondalık, BOM)
export function statementCsv(rows, title) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Tarih', 'İşlem', 'Ödeme şekli', 'Açıklama', 'Borç', 'Alacak', 'Bakiye', 'Vade'];
  const lines = [esc(title), head.join(';')];
  for (const r of rows) {
    const amt = Number(r.amount);
    lines.push(
      [
        trDate(r.entry_date),
        KIND_LABEL[r.kind] || r.kind,
        r.method ? METHOD_LABEL[r.method] || r.method : '',
        r.note || '',
        amt > 0 ? money(amt) : '',
        amt < 0 ? money(-amt) : '',
        money(r.running),
        trDate(r.due_date),
      ]
        .map(esc)
        .join(';')
    );
  }
  return '﻿' + lines.join('\r\n');
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slug(s) {
  return String(s || 'cari')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
