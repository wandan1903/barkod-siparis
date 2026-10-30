'use client';

import { useMemo } from 'react';
import { encodeBarcode } from '@/lib/barcode';

// Barkodu SVG olarak çizer (yazdırmada keskin kalır). Genişlik/yükseklik dışarıdan (mm ya da px) verilir.
export default function Barcode({ value, width = '100%', height = '12mm', showText = true, fontSize = '2.6mm' }) {
  const code = useMemo(() => {
    try {
      return encodeBarcode(value);
    } catch (e) {
      return null;
    }
  }, [value]);

  if (!code) return <span style={{ fontSize }}>{value}</span>;

  const quiet = code.type === 'Code128' ? 10 : 9;
  const total = code.modules.length + quiet * 2;
  const rects = [];
  let i = 0;
  while (i < code.modules.length) {
    if (code.modules[i] === '1') {
      let j = i;
      while (j < code.modules.length && code.modules[j] === '1') j += 1;
      rects.push(<rect key={i} x={quiet + i} y={0} width={j - i} height={100} />);
      i = j;
    } else {
      i += 1;
    }
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', width }}>
      <svg
        viewBox={`0 0 ${total} 100`}
        preserveAspectRatio="none"
        width="100%"
        style={{ height, display: 'block' }}
        shapeRendering="crispEdges"
        role="img"
        aria-label={`Barkod ${code.text}`}
      >
        <rect x="0" y="0" width={total} height="100" fill="#fff" />
        <g fill="#000">{rects}</g>
      </svg>
      {showText ? (
        <span style={{ fontSize, letterSpacing: '0.08em', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{code.text}</span>
      ) : null}
    </span>
  );
}
