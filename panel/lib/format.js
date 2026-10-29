const tlFormatter = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  maximumFractionDigits: 2,
});

export function tl(value) {
  if (value === null || value === undefined || value === '') return '–';
  return tlFormatter.format(Number(value));
}

export function num(value, digits = 1) {
  if (value === null || value === undefined || value === '') return '–';
  return Number(value).toLocaleString('tr-TR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

export function shortDate(value) {
  if (!value) return '–';
  return new Date(value).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

export function dateTime(value) {
  if (!value) return '–';
  return new Date(value).toLocaleString('tr-TR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const STOCK_SOURCE_LABEL = {
  app: 'Uygulama (barkod)',
  pos_integration: 'Kasa entegrasyonu',
  estimate: 'Tahmin',
  count: 'Sayım',
};

export const ORDER_STATUS_LABEL = {
  draft: 'Taslak',
  sent: 'Market onayı bekliyor',
  changes_requested: 'Değişiklik istendi',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  shipped: 'Yolda',
  delivered: 'Teslim edildi',
};

export const INTEGRATION_STATE_LABEL = {
  draft: 'Kurulum bekliyor',
  testing: 'Test ediliyor',
  active: 'Çalışıyor',
  error: 'Hata',
  replaced: 'Yerine yenisi geldi',
  disabled: 'Kapalı',
};

export const CONNECTOR_STATUS_LABEL = {
  available: 'Hazır',
  beta: 'Deneme',
  planned: 'Yakında',
  retired: 'Kullanımdan kalktı',
};

export function errorText(error) {
  if (!error) return '';
  return error.message || String(error);
}
