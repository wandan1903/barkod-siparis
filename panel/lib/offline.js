'use client';

// İnternetsiz satış kuyruğu ve çevrimdışı önbellek (tarayıcı depolaması).
// Satışlar cihazda bekler; internet gelince record_sale_offline ile gönderilir.
// Her satışın benzersiz kimliği (ref) sayesinde aynı satış iki kez yazılmaz.
import { supabase } from '@/lib/supabase';

const QKEY = (rid) => `bs_offline_sales_${rid}`;
const CKEY = (rid) => `bs_catalog_${rid}`;
export const CTX_KEY = 'bs_market_ctx';
export const QUEUE_EVENT = 'bs-offline-queue';

function read(key, fallback) {
  try {
    const v = window.localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) {
    return fallback;
  }
}
function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

export function newRef() {
  try {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  } catch (e) {
    // yok say
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function isNetworkError(error) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = String((error && (error.message || error.details)) || error || '');
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|timeout/i.test(msg);
}

// --- satış kuyruğu ---
export function queuedSales(rid) {
  return read(QKEY(rid), []);
}
function notify() {
  try {
    window.dispatchEvent(new Event(QUEUE_EVENT));
  } catch (e) {
    // yok say
  }
}
export function enqueueSale(rid, sale) {
  const q = queuedSales(rid);
  q.push(sale);
  const ok = write(QKEY(rid), q);
  notify();
  return ok;
}
function setQueue(rid, q) {
  write(QKEY(rid), q);
  notify();
}
export function dropQueuedSale(rid, ref) {
  setQueue(rid, queuedSales(rid).filter((s) => s.ref !== ref));
}

let syncing = false;
// Bekleyen satışları sırayla gönderir. Dönüş: { sent, failed, left }
export async function syncSales(rid) {
  if (syncing) return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  syncing = true;
  let sent = 0;
  let failed = 0;
  try {
    for (const sale of queuedSales(rid)) {
      const { error } = await supabase.rpc('record_sale_offline', {
        p_retailer: rid,
        p_lines: sale.lines,
        p_client_ref: sale.ref,
        p_sold_at: sale.at,
      });
      if (!error) {
        dropQueuedSale(rid, sale.ref);
        sent += 1;
      } else if (isNetworkError(error)) {
        break; // internet yine gitti; sonra tekrar denenir
      } else {
        failed += 1;
        setQueue(rid, queuedSales(rid).map((s) => (s.ref === sale.ref ? { ...s, error: error.message } : s)));
      }
    }
  } finally {
    syncing = false;
  }
  return { sent, failed, left: queuedSales(rid).length };
}

// --- katalog önbelleği (barkod → ürün, fiyat) ---
export function saveCatalog(rid, rows) {
  write(CKEY(rid), { at: new Date().toISOString(), rows });
}
export function loadCatalog(rid) {
  return read(CKEY(rid), null);
}

// --- oturum bağlamı (internet yokken açılış için) ---
export function saveContext(ctx) {
  write(CTX_KEY, ctx);
}
export function loadContext() {
  return read(CTX_KEY, null);
}
export function clearContext() {
  try {
    window.localStorage.removeItem(CTX_KEY);
  } catch (e) {
    // yok say
  }
}
