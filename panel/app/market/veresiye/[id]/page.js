'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { tl, shortDate, errorText, parseAmount } from '@/lib/format';
import { withRunningBalance, downloadText, slug } from '@/lib/account';
import { normalizePhone } from '@/components/NotificationSettings';

const KIND = { veresiye: 'Veresiye', odeme: 'Ödeme', duzeltme: 'Düzeltme', iptal: 'İptal' };
const METHOD = { nakit: 'Nakit', kart: 'Kart', havale: 'Havale', diger: 'Diğer' };

export default function CustomerPage() {
  const { id } = useParams();
  const { org } = useOrg();
  const [c, setC] = useState(null);
  const [entries, setEntries] = useState(null);
  const [mode, setMode] = useState('odeme');
  const [entry, setEntry] = useState({ amount: '', method: 'nakit', note: '' });
  const [edit, setEdit] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const [b, e] = await Promise.all([
      supabase.rpc('customer_balances', { p_retailer: org.id }),
      supabase
        .from('customer_entries')
        .select('id, kind, amount, method, sale_id, reverses_id, note, entry_date, created_at')
        .eq('retailer_id', org.id)
        .eq('customer_id', id),
    ]);
    const err = b.error || e.error;
    if (err) setMessage({ kind: 'error', text: errorText(err) });
    setC((b.data || []).find((r) => r.customer_id === id) || null);
    setEntries(e.data || []);
  }, [org.id, id]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => withRunningBalance(entries || []), [entries]);

  async function submit(e) {
    e.preventDefault();
    const amount = parseAmount(entry.amount);
    if (!(amount > 0)) {
      setMessage({ kind: 'error', text: 'Geçerli bir tutar girin (ör. 150 ya da 1.250,50).' });
      return;
    }
    setBusy('entry');
    setMessage(null);
    const { error } = await supabase.rpc('record_customer_entry', {
      p_retailer: org.id,
      p_customer: id,
      p_kind: mode,
      p_amount: mode === 'duzeltme_eksi' ? -amount : amount,
      p_method: mode === 'odeme' ? entry.method : null,
      p_note: entry.note,
      p_sale: null,
    });
    setBusy('');
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setEntry({ amount: '', method: entry.method, note: '' });
    setMessage({ kind: 'ok', text: mode === 'odeme' ? `${tl(amount)} ödeme alındı.` : `${tl(amount)} veresiye yazıldı.` });
    load();
  }

  async function reverse(r) {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`${shortDate(r.entry_date)} tarihli ${tl(Math.abs(Number(r.amount)))} kaydı iptal edilsin mi?`)) return;
    setBusy(r.id);
    const { error } = await supabase.rpc('reverse_customer_entry', { p_entry: r.id });
    setBusy('');
    if (error) setMessage({ kind: 'error', text: errorText(error) });
    else {
      setMessage({ kind: 'ok', text: 'Kayıt iptal edildi.' });
      load();
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    const phone = edit.phone.trim() ? normalizePhone(edit.phone) : '';
    if (phone === null) {
      setMessage({ kind: 'error', text: 'Telefon numarası geçersiz.' });
      return;
    }
    const limit = edit.limit.trim() ? parseAmount(edit.limit) : null;
    if (limit !== null && !(limit >= 0)) {
      setMessage({ kind: 'error', text: 'Geçerli bir limit girin ya da boş bırakın.' });
      return;
    }
    setBusy('edit');
    const { error } = await supabase.rpc('save_customer', {
      p_retailer: org.id,
      p_id: id,
      p_name: edit.name,
      p_phone: phone || null,
      p_note: edit.note,
      p_credit_limit: limit,
      p_active: edit.active,
    });
    setBusy('');
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setEdit(null);
    setMessage({ kind: 'ok', text: 'Müşteri bilgileri kaydedildi.' });
    load();
  }

  function exportCsv() {
    const lines = ['Tarih;İşlem;Açıklama;Borç;Ödeme;Bakiye'];
    const money = (v) => Number(v).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    for (const r of rows) {
      const a = Number(r.amount);
      lines.push([shortDate(r.entry_date), KIND[r.kind] + (r.method ? ` (${METHOD[r.method]})` : ''), (r.note || '').replace(/;/g, ','), a > 0 ? money(a) : '', a < 0 ? money(-a) : '', money(r.running)].join(';'));
    }
    downloadText(`veresiye-${slug(c.name)}.csv`, '﻿' + `${org.name} · ${c.name} veresiye ekstresi\r\n` + lines.join('\r\n'));
  }

  if (!entries) return <div className="center">Yükleniyor…</div>;
  if (!c) {
    return (
      <>
        <Link href="/market/veresiye" className="small">← Veresiye defteri</Link>
        <div className="notice error">Müşteri bulunamadı.</div>
      </>
    );
  }

  const over = c.credit_limit != null && Number(c.balance) > Number(c.credit_limit);
  const waText = `Merhaba ${c.name}, ${org.name} veresiye hesabınızda ${tl(c.balance)} borç bulunmaktadır. Uygun olduğunuzda ödemenizi rica ederiz. İyi günler.`;

  return (
    <>
      <Link href="/market/veresiye" className="small">← Veresiye defteri</Link>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>{c.name}</h1>
          <span className="muted small">
            {c.phone || 'Telefon yok'}
            {c.note ? ` · ${c.note}` : ''}
            {!c.active ? ' · pasif' : ''}
          </span>
        </div>
        <button type="button" className="btn small" onClick={() => setEdit(edit ? null : { name: c.name, phone: c.phone || '', limit: c.credit_limit != null ? String(c.credit_limit).replace('.', ',') : '', note: c.note || '', active: c.active })}>
          {edit ? 'Vazgeç' : 'Düzenle'}
        </button>
      </div>

      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}

      {edit ? (
        <form className="card" onSubmit={saveEdit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="field"><label htmlFor="e-name">Ad soyad</label><input id="e-name" className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required /></div>
          <div className="field"><label htmlFor="e-phone">Telefon</label><input id="e-phone" className="input" type="tel" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></div>
          <div className="field"><label htmlFor="e-limit">Veresiye limiti (TL)</label><input id="e-limit" className="input" inputMode="decimal" value={edit.limit} onChange={(e) => setEdit({ ...edit, limit: e.target.value })} placeholder="Boş = limitsiz" /></div>
          <div className="field"><label htmlFor="e-note">Not</label><input id="e-note" className="input" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></div>
          <label className="switch-row">
            <input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />
            <span className="small">Aktif (pasif müşteriye kasada veresiye yazılamaz; geçmişi saklanır)</span>
          </label>
          <button className="btn primary" type="submit" disabled={busy === 'edit'}>{busy === 'edit' ? 'Kaydediliyor…' : 'Kaydet'}</button>
        </form>
      ) : null}

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="muted small">Bakiye (borç)</span>
        <span className={`strong ${over ? 'warn-text' : ''}`} style={{ fontSize: 28 }}>{tl(c.balance)}</span>
        <span className="muted small">
          {c.oldest_open_days != null ? `${c.oldest_open_days} gündür ödenmemiş borç var` : 'Açık borç yok'}
          {c.credit_limit != null ? ` · limit ${tl(c.credit_limit)}${over ? ' (aşıldı)' : ''}` : ''}
          {c.last_payment_date ? ` · son ödeme ${shortDate(c.last_payment_date)} (${tl(c.last_payment_amount)})` : ''}
        </span>
        {c.phone && Number(c.balance) > 0 ? (
          <a className="btn small outline" style={{ alignSelf: 'flex-start' }} href={`https://wa.me/${c.phone.replace('+', '')}?text=${encodeURIComponent(waText)}`} target="_blank" rel="noopener noreferrer">
            WhatsApp ile hatırlat
          </a>
        ) : null}
      </section>

      <form className="card" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[['odeme', 'Ödeme al'], ['veresiye', 'Veresiye yaz']].map(([k, label]) => (
            <button key={k} type="button" className={`btn small ${mode === k ? 'primary' : ''}`} onClick={() => setMode(k)}>{label}</button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="x-amount">Tutar (TL)</label>
          <input id="x-amount" className="input" inputMode="decimal" value={entry.amount} onChange={(e) => setEntry({ ...entry, amount: e.target.value })} placeholder="ör. 150" required />
        </div>
        {mode === 'odeme' ? (
          <div className="field">
            <label htmlFor="x-method">Ödeme şekli</label>
            <select id="x-method" className="input" value={entry.method} onChange={(e) => setEntry({ ...entry, method: e.target.value })}>
              {Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="x-note">Açıklama (isteğe bağlı)</label>
          <input id="x-note" className="input" value={entry.note} onChange={(e) => setEntry({ ...entry, note: e.target.value })} placeholder={mode === 'odeme' ? 'ör. Elden ödedi' : 'ör. Ekmek, süt'} />
        </div>
        {mode === 'veresiye' && c.credit_limit != null && Number(c.balance) + (parseAmount(entry.amount) || 0) > Number(c.credit_limit) ? (
          <div className="notice error" role="status">Bu tutarla müşteri limitini ({tl(c.credit_limit)}) aşıyor.</div>
        ) : null}
        <button className="btn primary" type="submit" disabled={busy === 'entry' || (mode === 'veresiye' && !c.active)}>
          {busy === 'entry' ? 'Kaydediliyor…' : mode === 'odeme' ? 'Ödemeyi kaydet' : 'Veresiyeye yaz'}
        </button>
      </form>

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h2 style={{ margin: 0 }}>Hesap dökümü</h2>
          <button type="button" className="btn small outline" onClick={exportCsv} disabled={!rows.length}>Excel'e indir</button>
        </div>
        {!rows.length ? (
          <p className="muted">Henüz kayıt yok.</p>
        ) : (
          <div className="list" style={{ padding: 0 }}>
            {rows.slice().reverse().map((r) => {
              const a = Number(r.amount);
              const struck = r.isReversed || r.kind === 'iptal';
              return (
                <div key={r.id} className="list-row" style={struck ? { opacity: 0.55 } : undefined}>
                  <div className="grow-1">
                    <span className="strong" style={r.isReversed ? { textDecoration: 'line-through' } : undefined}>
                      {KIND[r.kind]}{r.method ? ` · ${METHOD[r.method]}` : ''}{r.sale_id ? ' · kasa' : ''}
                    </span>
                    <span className="muted small">{shortDate(r.entry_date)}{r.note ? ` · ${r.note}` : ''} · bakiye {tl(r.running)}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className={`strong ${a < 0 ? '' : 'warn-text'}`}>{a > 0 ? '+' : '−'}{tl(Math.abs(a))}</span>
                    {!struck ? (
                      <button type="button" className="link small" style={{ display: 'block', marginLeft: 'auto' }} onClick={() => reverse(r)} disabled={busy === r.id}>
                        İptal et
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
