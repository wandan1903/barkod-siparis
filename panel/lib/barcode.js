// Barkod çizimi için modül (çubuk/boşluk) dizisi üretir. Dış kütüphane yok.
// EAN-13 ve EAN-8 (market ürünleri), diğer her şey için Code 128-B.
// Çıktı: { type, modules: '1010...', text }  ('1' = siyah modül)

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function eanCheckDigit(digits) {
  // digits: kontrol hanesi hariç (12 ya da 7 hane)
  let sum = 0;
  const n = digits.length;
  for (let i = 0; i < n; i += 1) {
    const d = Number(digits[n - 1 - i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10;
}

function ean13(code) {
  const first = Number(code[0]);
  let m = '101';
  for (let i = 1; i <= 6; i += 1) {
    const d = Number(code[i]);
    m += PARITY[first][i - 1] === 'L' ? L[d] : G[d];
  }
  m += '01010';
  for (let i = 7; i <= 12; i += 1) m += R[Number(code[i])];
  m += '101';
  return m;
}

function ean8(code) {
  let m = '101';
  for (let i = 0; i < 4; i += 1) m += L[Number(code[i])];
  m += '01010';
  for (let i = 4; i < 8; i += 1) m += R[Number(code[i])];
  m += '101';
  return m;
}

// Code 128 desen tablosu (çubuk/boşluk genişlikleri), 0–105; 106 = bitiş
const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

function widthsToModules(w) {
  let m = '';
  for (let i = 0; i < w.length; i += 1) m += (i % 2 === 0 ? '1' : '0').repeat(Number(w[i]));
  return m;
}

function code128b(text) {
  const vals = [104];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error('Barkodda desteklenmeyen karakter');
    vals.push(c - 32);
  }
  let sum = vals[0];
  for (let i = 1; i < vals.length; i += 1) sum += vals[i] * i;
  vals.push(sum % 103);
  let m = '';
  for (const v of vals) m += widthsToModules(C128[v]);
  m += widthsToModules(C128[106]);
  return m;
}

export function encodeBarcode(raw) {
  const value = String(raw || '').trim();
  if (/^\d{13}$/.test(value) && eanCheckDigit(value.slice(0, 12)) === Number(value[12])) {
    return { type: 'EAN-13', modules: ean13(value), text: value };
  }
  if (/^\d{12}$/.test(value)) {
    // UPC-A → başına 0 eklenmiş EAN-13
    const v = `0${value}`;
    if (eanCheckDigit(v.slice(0, 12)) === Number(v[12])) return { type: 'EAN-13', modules: ean13(v), text: v };
  }
  if (/^\d{8}$/.test(value) && eanCheckDigit(value.slice(0, 7)) === Number(value[7])) {
    return { type: 'EAN-8', modules: ean8(value), text: value };
  }
  if (!value) return null;
  return { type: 'Code128', modules: code128b(value), text: value };
}
