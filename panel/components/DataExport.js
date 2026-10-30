'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { ORDER_STATUS_LABEL, errorText } from '@/lib/format';
import { KIND_LABEL as ACC_KIND, METHOD_LABEL } from '@/lib/account';
import { exportRows } from '@/lib/report';
import { slug } from '@/lib/account';

const PAGE = 1000;
const MAX_ROWS = 50000;

// Supabase tek seferde en fazla 1000 satır döndürür; sayfa sayfa çeker
async function fetchAll(build) {
  const out = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const dt = (v) => (v ? new Date(v).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const d = (v) => {
  if (!v) return '';
  const [y, m, day] = String(v).slice(0, 10).split('-');
  return `${day}.${m}.${y}`;
};
const n = (v) => (v === null || v === undefined || v === '' ? '' : Number(v));

const MOVE_LABEL = { sale: 'Satış', receipt: 'Mal kabul', count_adjust: 'Sayım düzeltmesi', return: 'İade' };
const WH_LABEL = { giris: 'Giriş', cikis: 'Çıkış', sayim: 'Sayım', sevkiyat: 'Sevkiyat' };

function orderRows(orders, partyKey) {
  const rows = [];
  for (const o of orders) {
    const base = [d(o.created_at), o[partyKey] ? o[partyKey].name : '', o.origin === 'offer' ? 'Distribütör önerisi' : 'Market siparişi', ORDER_STATUS_LABEL[o.status] || o.status, d(o.delivery_date), n(o.total)];
    const lines = o.order_lines || [];
    if (!lines.length) rows.push([...base, '', '', '', '', '', '', o.note || '']);
    for (const l of lines) {
      rows.push([
        ...base,
        l.products ? l.products.gtin : '',
        l.products ? l.products.name : '',
        n(l.requested_cases ?? l.cases),
        n(l.cases),
        n(l.accepted_cases),
        n(l.case_price),
        o.note || '',
      ]);
    }
  }
  return rows;
}
const ORDER_HEADER = (party) => ['Tarih', party, 'Kaynak', 'Durum', 'Teslim tarihi', 'Sipariş toplamı', 'Barkod', 'Ürün', 'İstenen koli', 'Onaylanan koli', 'Teslim alınan koli', 'Koli fiyatı', 'Not'];
const ORDER_SELECT = (party) =>
  `id, created_at, status, origin, total, delivery_date, note, ${party}, order_lines(cases, requested_cases, accepted_cases, case_price, products(gtin, name))`;

function accountRows(entries, partyKey) {
  return entries.map((e) => [
    d(e.entry_date),
    e[partyKey] ? e[partyKey].name : '',
    ACC_KIND[e.kind] || e.kind,
    e.method ? METHOD_LABEL[e.method] || e.method : '',
    Number(e.amount) > 0 ? Number(e.amount) : '',
    Number(e.amount) < 0 ? -Number(e.amount) : '',
    d(e.due_date),
    e.note || '',
  ]);
}

const DISTRIBUTOR_SETS = [
  {
    key: 'katalog',
    label: 'Ürün kataloğu ve fiyatlar',
    run: async (org) => {
      const data = await fetchAll(() =>
        supabase.from('distributor_products').select('case_price, active, updated_at, products(gtin, name, brand, category, case_qty)').eq('distributor_id', org.id).order('product_id')
      );
      return {
        header: ['Barkod', 'Ürün', 'Marka', 'Kategori', 'Koli içi adet', 'Koli fiyatı', 'Aktif', 'Güncelleme'],
        rows: data.map((r) => [r.products?.gtin, r.products?.name, r.products?.brand || '', r.products?.category || '', n(r.products?.case_qty), n(r.case_price), r.active ? 'Evet' : 'Hayır', dt(r.updated_at)]),
      };
    },
  },
  {
    key: 'depo',
    label: 'Depo stoğu',
    run: async (org) => {
      const data = await fetchAll(() => supabase.from('warehouse_stock').select('qty_units, min_cases, updated_at, products(gtin, name, case_qty)').eq('distributor_id', org.id).order('product_id'));
      return {
        header: ['Barkod', 'Ürün', 'Koli içi', 'Depodaki adet', 'Koli', 'Kritik eşik (koli)', 'Güncelleme'],
        rows: data.map((r) => [r.products?.gtin, r.products?.name, n(r.products?.case_qty), n(r.qty_units), r.products ? Math.floor(r.qty_units / r.products.case_qty) : '', n(r.min_cases), dt(r.updated_at)]),
      };
    },
  },
  {
    key: 'depo-hareketleri',
    label: 'Depo hareketleri',
    run: async (org) => {
      const data = await fetchAll(() =>
        supabase.from('warehouse_movements').select('created_at, kind, delta_units, balance_units, note, products(gtin, name)').eq('distributor_id', org.id).order('created_at')
      );
      return {
        header: ['Zaman', 'İşlem', 'Barkod', 'Ürün', 'Miktar (adet)', 'Kalan (adet)', 'Not'],
        rows: data.map((r) => [dt(r.created_at), WH_LABEL[r.kind] || r.kind, r.products?.gtin, r.products?.name, n(r.delta_units), n(r.balance_units), r.note || '']),
      };
    },
  },
  {
    key: 'siparisler',
    label: 'Siparişler (satır satır)',
    run: async (org) => {
      const data = await fetchAll(() =>
        supabase.from('orders').select(ORDER_SELECT('retailer:organizations!orders_retailer_id_fkey(name)')).eq('distributor_id', org.id).order('created_at')
      );
      return { header: ORDER_HEADER('Market'), rows: orderRows(data, 'retailer') };
    },
  },
  {
    key: 'marketler',
    label: 'Marketler',
    run: async (org) => {
      const data = await fetchAll(() =>
        supabase
          .from('retailer_distributor_links')
          .select('status, stock_share_consent_at, payment_term_days, credit_limit, created_at, retailer:organizations!retailer_distributor_links_retailer_id_fkey(name, city, district, tax_no)')
          .eq('distributor_id', org.id)
          .order('created_at')
      );
      return {
        header: ['Market', 'Vergi no', 'İl', 'İlçe', 'Durum', 'Stok paylaşımı', 'Vade (gün)', 'Kredi limiti', 'Bağlandı'],
        rows: data.map((r) => [r.retailer?.name, r.retailer?.tax_no || '', r.retailer?.city || '', r.retailer?.district || '', r.status === 'active' ? 'Aktif' : r.status, r.stock_share_consent_at ? 'Açık' : 'Kapalı', n(r.payment_term_days), n(r.credit_limit), d(r.created_at)]),
      };
    },
  },
  {
    key: 'cari',
    label: 'Cari hesap hareketleri',
    run: async (org) => {
      const data = await fetchAll(() =>
        supabase
          .from('account_entries')
          .select('entry_date, kind, method, amount, due_date, note, retailer:organizations!account_entries_retailer_id_fkey(name)')
          .eq('distributor_id', org.id)
          .order('entry_date')
          .order('created_at')
      );
      return { header: ['Tarih', 'Market', 'İşlem', 'Ödeme şekli', 'Borç', 'Alacak', 'Vade', 'Açıklama'], rows: accountRows(data, 'retailer') };
    },
  },
  {
    key: 'kampanyalar',
    label: 'Kampanyalar',
    run: async (org) => {
      const data = await fetchAll(() =>
        supabase
          .from('campaigns')
          .select('title, kind, case_price, rule, target, starts_at, ends_at, products!campaigns_product_id_fkey(name), campaign_items(cases, case_price, products(name))')
          .eq('distributor_id', org.id)
          .order('starts_at')
      );
      return {
        header: ['Kampanya', 'Tür', 'Ürün / paket içeriği', 'Koli fiyatı', 'En az koli', 'Hedef', 'Başlangıç', 'Bitiş'],
        rows: data.map((c) => [
          c.title,
          c.kind === 'bundle' ? 'Paket' : 'Ürün',
          c.kind === 'bundle' ? (c.campaign_items || []).map((i) => `${i.cases} koli ${i.products?.name || ''} (${Number(i.case_price).toLocaleString('tr-TR')} TL)`).join(' + ') : c.products?.name || '',
          n(c.case_price),
          n(c.rule?.min_cases),
          c.target === 'all' ? 'Tüm marketler' : c.target === 'selected' ? 'Seçili marketler' : 'Stoğu azalanlar',
          dt(c.starts_at),
          dt(c.ends_at),
        ]),
      };
    },
  },
];

const RETAILER_SETS = [
  {
    key: 'urunler',
    label: 'Ürünler, raf fiyatları ve stok',
    run: async (org) => {
      const { data, error } = await supabase.rpc('retailer_stock_overview', { p_retailer: org.id });
      if (error) throw error;
      return {
        header: ['Barkod', 'Ürün', 'Koli içi', 'Stok (adet)', 'Raf fiyatı', 'Haftalık satış (adet)', 'Kaç güne yeter', 'Distribütör'],
        rows: (data || []).map((r) => [r.gtin, r.product_name, n(r.case_qty), n(r.stock_units), n(r.shelf_price), n(r.weekly_units), n(r.days_left), r.distributor_names || '']),
      };
    },
  },
  {
    key: 'satislar',
    label: 'Satışlar (fiş satırları)',
    run: async (org) => {
      const data = await fetchAll(() =>
        supabase.from('sales').select('id, created_at, total, pos_ref, sale_lines(qty_units, unit_price, products(gtin, name))').eq('retailer_id', org.id).order('created_at')
      );
      const rows = [];
      for (const s of data) {
        for (const l of s.sale_lines || []) {
          rows.push([dt(s.created_at), s.pos_ref || '', l.products?.gtin, l.products?.name, n(l.qty_units), n(l.unit_price), Number(l.qty_units) * Number(l.unit_price), n(s.total)]);
        }
      }
      return { header: ['Zaman', 'Fiş no', 'Barkod', 'Ürün', 'Adet', 'Birim fiyat', 'Tutar', 'Fiş toplamı'], rows };
    },
  },
  {
    key: 'stok-hareketleri',
    label: 'Stok hareketleri',
    run: async (org) => {
      const data = await fetchAll(() =>
        supabase.from('stock_movements').select('created_at, kind, qty_delta, products(gtin, name)').eq('retailer_id', org.id).order('created_at')
      );
      return {
        header: ['Zaman', 'İşlem', 'Barkod', 'Ürün', 'Miktar (adet)'],
        rows: data.map((r) => [dt(r.created_at), MOVE_LABEL[r.kind] || r.kind, r.products?.gtin, r.products?.name, n(r.qty_delta)]),
      };
    },
  },
  {
    key: 'siparisler',
    label: 'Siparişler (satır satır)',
    run: async (org) => {
      const data = await fetchAll(() =>
        supabase.from('orders').select(ORDER_SELECT('distributor:organizations!orders_distributor_id_fkey(name)')).eq('retailer_id', org.id).order('created_at')
      );
      return { header: ORDER_HEADER('Distribütör'), rows: orderRows(data, 'distributor') };
    },
  },
  {
    key: 'cari',
    label: 'Cari hesap hareketleri',
    run: async (org) => {
      const data = await fetchAll(() =>
        supabase
          .from('account_entries')
          .select('entry_date, kind, method, amount, due_date, note, distributor:organizations!account_entries_distributor_id_fkey(name)')
          .eq('retailer_id', org.id)
          .order('entry_date')
          .order('created_at')
      );
      return { header: ['Tarih', 'Distribütör', 'İşlem', 'Ödeme şekli', 'Borç', 'Alacak', 'Vade', 'Açıklama'], rows: accountRows(data, 'distributor') };
    },
  },
];

// "Verilerimi indir": her veri seti Excel'de açılan bir CSV olarak iner
export default function DataExport({ side }) {
  const { org } = useOrg();
  const sets = side === 'retailer' ? RETAILER_SETS : DISTRIBUTOR_SETS;
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState({});
  const [message, setMessage] = useState(null);

  async function run(set) {
    setBusy(set.key);
    setMessage(null);
    try {
      const { header, rows } = await set.run(org);
      const today = new Date().toISOString().slice(0, 10);
      exportRows(`${slug(org.name)}-${set.key}-${today}.csv`, `${org.name} · ${set.label} · ${new Date().toLocaleDateString('tr-TR')}`, header, rows);
      setDone((x) => ({ ...x, [set.key]: rows.length }));
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) });
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <h2 style={{ margin: 0 }}>Verilerimi indir</h2>
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          Verileriniz sizindir. Her listeyi Excel'de açılan bir dosya olarak istediğiniz zaman indirebilir, kendi bilgisayarınızda saklayabilirsiniz.
        </p>
      </div>
      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}
      <div className="list">
        {sets.map((s) => (
          <div key={s.key} className="list-row">
            <span className="grow-1">
              <span className="strong">{s.label}</span>
              {done[s.key] !== undefined ? <span className="muted small">{done[s.key]} satır indirildi</span> : null}
            </span>
            <button type="button" className="btn small" onClick={() => run(s)} disabled={!!busy}>
              {busy === s.key ? 'Hazırlanıyor…' : 'İndir'}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
