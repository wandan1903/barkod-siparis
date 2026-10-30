'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Barcode from '@/components/Barcode';

// Etiket ölçüleri (mm). Termal yazıcıda her etiket bir sayfa; A4'te ızgara.
export const LABEL_PRESETS = {
  't58x40': { label: 'Termal 58 × 40 mm', w: 58, h: 40, sheet: null },
  't50x30': { label: 'Termal 50 × 30 mm', w: 50, h: 30, sheet: null },
  't40x30': { label: 'Termal 40 × 30 mm', w: 40, h: 30, sheet: null },
  't100x50': { label: 'Termal 100 × 50 mm (koli)', w: 100, h: 50, sheet: null },
  'a4-24': { label: "A4 etiket kâğıdı 24'lü (70 × 37 mm)", w: 70, h: 37, sheet: { cols: 3, rows: 8, pw: 210, ph: 297 } },
  'a4-65': { label: "A4 etiket kâğıdı 65'li (38 × 21 mm)", w: 38.1, h: 21.2, sheet: { cols: 5, rows: 13, pw: 210, ph: 297 } },
};

function priceParts(v) {
  const s = Number(v || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [int, dec] = s.split(',');
  return { int, dec };
}

// Tek etiket. kind: 'shelf' (raf: büyük fiyat) | 'product' (ürün/koli: büyük barkod)
export function Label({ item, preset, kind, footer }) {
  const p = LABEL_PRESETS[preset];
  const small = p.h < 25;
  const base = { width: `${p.w}mm`, height: `${p.h}mm`, padding: small ? '1mm 1.5mm' : '2mm 2.5mm', boxSizing: 'border-box', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#fff', color: '#000', fontFamily: 'Inter, Arial, sans-serif' };
  const nameSize = small ? '2.4mm' : p.h >= 45 ? '4.4mm' : '3.2mm';

  if (kind === 'shelf') {
    const { int, dec } = priceParts(item.price);
    return (
      <div style={base}>
        <div style={{ fontSize: nameSize, fontWeight: 700, lineHeight: 1.15, maxHeight: small ? '5mm' : '8mm', overflow: 'hidden' }}>{item.name}</div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5mm' }}>
          {item.price != null ? (
            <>
              <span style={{ fontSize: small ? '6mm' : p.h >= 45 ? '15mm' : '11mm', fontWeight: 800, lineHeight: 1, letterSpacing: '-0.02em' }}>{int}</span>
              <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
                <span style={{ fontSize: small ? '3mm' : '5mm', fontWeight: 800 }}>,{dec}</span>
                <span style={{ fontSize: small ? '2.4mm' : '3.6mm', fontWeight: 700 }}>₺</span>
              </span>
            </>
          ) : (
            <span style={{ fontSize: '3mm' }}>Fiyat girilmemiş</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '1.5mm' }}>
          <Barcode value={item.gtin} width={small ? '55%' : '58%'} height={small ? '4mm' : '7mm'} fontSize={small ? '1.8mm' : '2.2mm'} />
          <span style={{ fontSize: small ? '1.7mm' : '2.1mm', textAlign: 'right', lineHeight: 1.2 }}>{footer}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={base}>
      <div style={{ fontSize: nameSize, fontWeight: 700, lineHeight: 1.15, maxHeight: small ? '5mm' : '9mm', overflow: 'hidden' }}>{item.name}</div>
      {item.sub ? <div style={{ fontSize: small ? '2mm' : '2.8mm', marginTop: '0.5mm' }}>{item.sub}</div> : null}
      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <Barcode value={item.gtin} width="92%" height={small ? '6mm' : p.h >= 45 ? '20mm' : '12mm'} fontSize={small ? '2mm' : '3mm'} />
      </div>
    </div>
  );
}

// Yazdırma alanı: yalnızca yazdırırken görünür (globals.css #print-root)
function PrintRoot({ labels, preset, kind, footer }) {
  const p = LABEL_PRESETS[preset];
  const pageCss = p.sheet
    ? `@page { size: ${p.sheet.pw}mm ${p.sheet.ph}mm; margin: 0; }`
    : `@page { size: ${p.w}mm ${p.h}mm; margin: 0; }`;

  let body;
  if (p.sheet) {
    const per = p.sheet.cols * p.sheet.rows;
    const pages = [];
    for (let i = 0; i < labels.length; i += per) pages.push(labels.slice(i, i + per));
    const padX = Math.max(0, (p.sheet.pw - p.sheet.cols * p.w) / 2);
    const padY = Math.max(0, (p.sheet.ph - p.sheet.rows * p.h) / 2);
    body = pages.map((pg, pi) => (
      <div
        key={pi}
        style={{
          width: `${p.sheet.pw}mm`,
          height: `${p.sheet.ph}mm`,
          padding: `${padY}mm ${padX}mm`,
          boxSizing: 'border-box',
          display: 'grid',
          gridTemplateColumns: `repeat(${p.sheet.cols}, ${p.w}mm)`,
          gridAutoRows: `${p.h}mm`,
          breakAfter: pi < pages.length - 1 ? 'page' : 'auto',
          pageBreakAfter: pi < pages.length - 1 ? 'always' : 'auto',
        }}
      >
        {pg.map((it, i) => <Label key={i} item={it} preset={preset} kind={kind} footer={footer} />)}
      </div>
    ));
  } else {
    body = labels.map((it, i) => (
      <div key={i} style={{ breakAfter: i < labels.length - 1 ? 'page' : 'auto', pageBreakAfter: i < labels.length - 1 ? 'always' : 'auto' }}>
        <Label item={it} preset={preset} kind={kind} footer={footer} />
      </div>
    ));
  }

  return (
    <div id="print-root">
      <style>{pageCss}</style>
      {body}
    </div>
  );
}

// Etiket seçimi + önizleme + yazdır. items: [{ id, name, gtin, price?, sub?, copies }]
export default function LabelPrinter({ items, kind, footer, defaultPreset = 't58x40', storageKey }) {
  const [preset, setPreset] = useState(defaultPreset);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = storageKey ? window.localStorage.getItem(storageKey) : null;
      if (saved && LABEL_PRESETS[saved]) setPreset(saved);
    } catch (e) {
      // tarayıcı depolaması kapalı olabilir
    }
  }, [storageKey]);

  function choose(v) {
    setPreset(v);
    try {
      if (storageKey) window.localStorage.setItem(storageKey, v);
    } catch (e) {
      // yok say
    }
  }

  const labels = useMemo(() => {
    const out = [];
    for (const it of items) for (let i = 0; i < Math.max(0, Math.min(500, Number(it.copies) || 0)); i += 1) out.push(it);
    return out;
  }, [items]);

  const p = LABEL_PRESETS[preset];
  const sheets = p.sheet ? Math.ceil(labels.length / (p.sheet.cols * p.sheet.rows)) : labels.length;

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1, minWidth: 220 }}>
          <label htmlFor="lbl-preset">Etiket ölçüsü</label>
          <select id="lbl-preset" className="input" value={preset} onChange={(e) => choose(e.target.value)}>
            {Object.entries(LABEL_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <button type="button" className="btn primary" disabled={!labels.length} onClick={() => window.print()}>
          Yazdır ({labels.length} etiket{p.sheet ? ` · ${sheets} sayfa` : ''})
        </button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Yazdırma penceresinde yazıcınızı seçin, kenar boşluğunu "Yok", ölçeği "%100" yapın. Termal yazıcıda kâğıt boyutu etiket ölçüsüyle aynı olmalı.
      </p>
      {labels.length ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', background: 'var(--line-soft)', padding: 12, borderRadius: 10 }} aria-label="Önizleme">
          {items.filter((it) => Number(it.copies) > 0).slice(0, 6).map((it) => (
            <div key={it.id} style={{ boxShadow: '0 1px 4px rgba(0,0,0,.15)' }}>
              <Label item={it} preset={preset} kind={kind} footer={footer} />
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>Yazdırmak için aşağıdan ürün seçin.</p>
      )}
      {mounted && labels.length ? createPortal(<PrintRoot labels={labels} preset={preset} kind={kind} footer={footer} />, document.body) : null}
    </section>
  );
}
