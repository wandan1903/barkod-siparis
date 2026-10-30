'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { tl, shortDate, errorText, parseAmount } from '@/lib/format';
import { normalizePhone } from '@/components/NotificationSettings';

// Veresiye defteri: müşteriler ve borçları. Bu bilgiler yalnızca marketin kendisinde görünür.
export default function CreditBookPage() {
  const { org } = useOrg();
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('debt');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', limit: '', note: '' });
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('customer_balances', { p_retailer: org.id });
    if (error) setMessage({ kind: 'error', text: errorText(error) });
    setRows(data || []);
  }, [org.id]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    const t = { debt: 0, debtors: 0, overLimit: 0 };
    for (const r of rows || []) {
      if (Number(r.balance) > 0) {
        t.debt += Number(r.balance);
        t.debtors += 1;
      }
      if (r.credit_limit != null && Number(r.balance) > Number(r.credit_limit)) t.overLimit += 1;
    }
    return t;
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    return (rows || []).filter((r) => {
      if (q && !r.name.toLocaleLowerCase('tr-TR').includes(q) && !(r.phone || '').includes(q.replace(/\s/g, ''))) return false;
      if (filter === 'debt') return r.active && Number(r.balance) > 0;
      if (filter === 'limit') return r.credit_limit != null && Number(r.balance) > Number(r.credit_limit);
      if (filter === 'passive') return !r.active;
      return r.active;
    });
  }, [rows, search, filter]);

  async function addCustomer(e) {
    e.preventDefault();
    const phone = form.phone.trim() ? normalizePhone(form.phone) : '';
    if (phone === null) {
      setMessage({ kind: 'error', text: 'Telefon numarası geçersiz (ör. 0532 111 22 33).' });
      return;
    }
    const limit = form.limit.trim() ? parseAmount(form.limit) : null;
    if (limit !== null && !(limit >= 0)) {
      setMessage({ kind: 'error', text: 'Geçerli bir limit girin ya da boş bırakın.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.rpc('save_customer', {
      p_retailer: org.id,
      p_id: null,
      p_name: form.name,
      p_phone: phone || null,
      p_note: form.note,
      p_credit_limit: limit,
      p_active: true,
    });
    setBusy(false);
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setForm({ name: '', phone: '', limit: '', note: '' });
    setAdding(false);
    setMessage({ kind: 'ok', text: 'Müşteri eklendi.' });
    load();
  }

  if (!rows) return <div className="center">Yükleniyor…</div>;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Veresiye defteri</h1>
        <button type="button" className="btn primary small" onClick={() => setAdding(!adding)}>{adding ? 'Vazgeç' : 'Yeni müşteri'}</button>
      </div>

      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}

      <section className="card" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <span className="muted small">Toplam veresiye alacağı</span>
          <div className="strong" style={{ fontSize: 24 }}>{tl(totals.debt)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className="muted small">{totals.debtors} borçlu müşteri</span>
          {totals.overLimit ? <div className="warn-text small strong">{totals.overLimit} müşteri limitini aştı</div> : null}
        </div>
      </section>

      {adding ? (
        <form className="card" onSubmit={addCustomer} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="field">
            <label htmlFor="c-name">Ad soyad</label>
            <input id="c-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ör. Ahmet Yılmaz" required maxLength={120} />
          </div>
          <div className="field">
            <label htmlFor="c-phone">Telefon (isteğe bağlı)</label>
            <input id="c-phone" className="input" type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0532 111 22 33" />
          </div>
          <div className="field">
            <label htmlFor="c-limit">Veresiye limiti (TL, isteğe bağlı)</label>
            <input id="c-limit" className="input" inputMode="decimal" value={form.limit} onChange={(e) => setForm({ ...form, limit: e.target.value })} placeholder="ör. 1.000" />
          </div>
          <div className="field">
            <label htmlFor="c-note">Not (isteğe bağlı)</label>
            <input id="c-note" className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="ör. 3 numaralı apartman" />
          </div>
          <p className="muted small" style={{ margin: 0 }}>Müşteri bilgileri yalnızca sizin hesabınızda saklanır; distribütör göremez.</p>
          <button className="btn primary" type="submit" disabled={busy || !form.name.trim()}>{busy ? 'Kaydediliyor…' : 'Müşteriyi ekle'}</button>
        </form>
      ) : null}

      <input className="input" placeholder="Müşteri adı veya telefon ara" aria-label="Müşteri ara" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[['debt', 'Borçlu'], ['all', 'Tümü'], ['limit', 'Limit aşan'], ['passive', 'Pasif']].map(([k, label]) => (
          <button key={k} type="button" className={`btn small ${filter === k ? 'primary' : ''}`} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>

      {!rows.length ? (
        <p className="muted">Henüz müşteri yok. "Yeni müşteri" ile ekleyin; sonra kasada "Veresiye yaz" ile satış yapabilirsiniz.</p>
      ) : (
        <section className="list">
          {visible.map((r) => {
            const over = r.credit_limit != null && Number(r.balance) > Number(r.credit_limit);
            return (
              <Link key={r.customer_id} href={`/market/veresiye/${r.customer_id}`} className="list-row" style={{ color: 'inherit', textDecoration: 'none' }}>
                <div className="grow-1">
                  <span className="strong">{r.name}</span>
                  <span className="muted small">
                    {r.oldest_open_days != null ? `${r.oldest_open_days} gündür borçlu` : r.last_activity ? `Son işlem ${shortDate(r.last_activity)}` : 'İşlem yok'}
                    {r.last_payment_date ? ` · son ödeme ${shortDate(r.last_payment_date)}` : ''}
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className={`strong ${over ? 'warn-text' : ''}`}>{tl(r.balance)}</span>
                  {over ? <span className="warn-text small" style={{ display: 'block' }}>limit {tl(r.credit_limit)}</span> : null}
                </div>
              </Link>
            );
          })}
          {!visible.length ? <p className="muted" style={{ padding: '12px 0' }}>Bu filtrede müşteri yok.</p> : null}
        </section>
      )}
    </>
  );
}
