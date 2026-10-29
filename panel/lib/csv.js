// Basit ürün listesi okuyucu: Excel'den "CSV (noktalı virgülle ayrılmış)" olarak kaydedilen
// dosyalar ve virgüllü CSV'ler. Beklenen sütunlar: barkod, urun_adi, koli_ici_adet, koli_fiyati

export const TEMPLATE_CSV =
  'barkod;urun_adi;koli_ici_adet;koli_fiyati\n' +
  '2000000000015;Tam yağlı süt 1 L;12;480,00\n' +
  '2000000000039;Ayran 200 ml;24;216,00\n';

function normalizeHeader(h) {
  return h
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

const ALIASES = {
  barkod: 'gtin', barcode: 'gtin', gtin: 'gtin', ean: 'gtin',
  urun_adi: 'name', urun: 'name', ad: 'name', name: 'name',
  koli_ici_adet: 'case_qty', koli_ici: 'case_qty', koli_adet: 'case_qty', case_qty: 'case_qty',
  koli_fiyati: 'case_price', koli_fiyat: 'case_price', fiyat: 'case_price', case_price: 'case_price',
};

function splitLine(line, delimiter) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; } else { quoted = !quoted; }
    } else if (ch === delimiter && !quoted) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parsePrice(raw) {
  if (raw === undefined || raw === null) return NaN;
  let s = String(raw).replace(/[₺\sTLtl]/g, '');
  if (s.includes(',')) {
    // Türkçe yazım: 1.680,50
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // Kuruşsuz Türkçe binlik: 2.100 → 2100
    s = s.replace(/\./g, '');
  }
  if (s === '') return NaN;
  return Number(s);
}

export function parseProductCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return { rows: [], errors: ['Dosyada başlık satırı ve en az bir ürün olmalı.'] };

  const delimiter = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
  const headers = splitLine(lines[0], delimiter).map((h) => ALIASES[normalizeHeader(h)] || null);
  const missing = ['gtin', 'name', 'case_qty', 'case_price'].filter((k) => !headers.includes(k));
  if (missing.length) {
    return { rows: [], errors: ['Eksik sütun. Beklenen başlıklar: barkod; urun_adi; koli_ici_adet; koli_fiyati'] };
  }

  const rows = [];
  const errors = [];
  const seen = new Set();
  lines.slice(1).forEach((line, idx) => {
    const cells = splitLine(line, delimiter);
    const rec = {};
    headers.forEach((key, i) => { if (key) rec[key] = cells[i]; });
    const lineNo = idx + 2;
    const gtin = (rec.gtin || '').replace(/\s/g, '');
    const caseQty = parseInt(rec.case_qty, 10);
    const price = parsePrice(rec.case_price);
    if (!/^\d{8,14}$/.test(gtin)) { errors.push(`Satır ${lineNo}: barkod 8–14 rakam olmalı.`); return; }
    if (!rec.name) { errors.push(`Satır ${lineNo}: ürün adı boş.`); return; }
    if (!(caseQty > 0)) { errors.push(`Satır ${lineNo}: koli içi adet 1 veya daha büyük olmalı.`); return; }
    if (!(price >= 0)) { errors.push(`Satır ${lineNo}: koli fiyatı okunamadı.`); return; }
    if (seen.has(gtin)) { errors.push(`Satır ${lineNo}: ${gtin} barkodu dosyada iki kez geçiyor.`); return; }
    seen.add(gtin);
    rows.push({ gtin, name: rec.name, case_qty: caseQty, case_price: Math.round(price * 100) / 100 });
  });
  return { rows, errors };
}
