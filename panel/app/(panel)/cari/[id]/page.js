'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { tl, shortDate, errorText } from '@/lib/format';
import { METHOD_LABEL, withRunningBalance, statementCsv, downloadText, slug } from '@/lib/account';
import Statement from '@/components/Statement';

function parseAmount(raw) {
  let s = String(raw || '').trim().replace(/\s|TL|₺/gi, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return Number(s);
}

function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function AccountDetailPage() {
  const { id: retailerId } = useParams();
  const { org } = useOrg();
  const [summary, setSummary] = useState(null);
  const [entries, setEntries] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState('');
  const [pay, setPay] = useState({ amount: '', method: 'nakit', date: todayIso(), note: '' });
  const [adj, setAdj] = useState({ type: 'iade', amount: '', note: '' });
  const [terms, setTerms] = useState(null);

  const load = useCallback(async () => {
    const [b, e] = await Promise.all([
      supabase.rpc('account_balances', { p_org: org.id }),
      supabase
        .from('account_entries')
        .select('id, kind, amount, method, entry_date, due_date, order_id, reverses_id, note, created_at')
        .eq('distributor_id', org.id)
        .eq('retailer_id', retailerId),
    ]);
    const err = b.error || e.error;
    if (err) setMessage({ kind: 'error', text: errorText(err) });
    const row = (b.data || []).find((r) => r.retailer_id === retailerId) || null;
    setSummary(row);
    setEntries(e.data || []);
    if (row) {
      setTerms((t) => t || { days: String(row.payment_term_days ?? 0), limit: row.credit_limit != null ? String(row.credit_limit).replace('.', ',') : '' });
    }
  }, [org.id, retailerId]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => withRunningBalance(entries || []), [entries]);

  async function submitPayment(e) {
    e.preventDefault();
    const amount = parseAmount(pay.amount);
    if (!(amount > 0)) {
      setMessage({ kind: 'error', text: 'Geçerli bir tutar girin (ör. 1.250,00).' });
      return;
    }
    setBusy('pay');
    setMessage(null);
    const { error } = await supabase.rpc('record_account_entry', {
      p_distributor: org.id,
      p_retailer: retailerId,
      p_kind: 'tahsilat',
      p_amount: amount,
      p_method: pay.method,
      p_date: pay.date || null,
      p_note: pay.note,
    });
    setBusy('');
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setPay({ amount: '', method: pay.method, date: todayIso(), note: '' });
    setMessage({ kind: 'ok', text: `${tl(amount)} tahsilat kaydedildi. Markete bildirim gitti.` });
    load();
  }

  async function submitAdjustment(e) {
    e.preventDefault();
    const amount = parseAmount(adj.amount);
    if (!(amount > 0)) {
      setMessage({ kind: 'error', text: 'Geçerli bir tutar girin.' });
      return;
    }
    const kind = adj.type === 'iade' ? 'iade' : 'duzeltme';
    const signed = adj.type === 'borc_ekle' ? amount : adj.type === 'borc_dus' ? -amount : amount;
    setBusy('adj');
    setMessage(null);
    const { error } = await supabase.rpc('record_account_entry', {
      p_distributor: org.id,
      p_retailer: retailerId,
      p_kind: kind,
      p_amount: signed,
      p_method: null,
      p_date: null,
      p_note: adj.note,
    });
    setBusy('');
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setAdj({ type: adj.type, amount: '', note: '' });
    setMessage({ kind: 'ok', text: 'Kayıt eklendi.' });
    load();
  }

  async function saveTerms(e) {
    e.preventDefault();
    const days = Number(terms.days);
    const limit = terms.limit.trim() === '' ? null : parseAmount(terms.limit);
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      setMessage({ kind: 'error', text: 'Vade 0 ile 365 gün arasında olmalı.' });
      return;
    }
    if (limit !== null && !(limit >= 0)) {
      setMessage({ kind: 'error', text: 'Geçerli bir kredi limiti girin ya da boş bırakın.' });
      return;
    }
    setBusy('terms');
    setMessage(null);
    const { error } = await supabase.rpc('set_account_terms', {
      p_distributor: org.id,
      p_retailer: retailerId,
      p_term_days: days,
      p_credit_limit: limit,
    });
    setBusy('');
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setMessage({ kind: 'ok', text: 'Vade ve limit kaydedildi. Yeni vade bundan sonra teslim edilen siparişlere uygulanır.' });
    load();
  }

  async function reverse(row) {
    const label = `${shortDate(row.entry_date)} tarihli ${tl(Math.abs(Number(row.amount)))} tutarlı kayıt`;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`${label} iptal edilsin mi? Kayıt silinmez; ters kayıtla sıfırlanır.`)) return;
    setBusy(row.id);
    setMessage(null);
    const { error } = await supabase.rpc('reverse_account_entry', { p_entry: row.id, p_note: null });
    setBusy('');
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setMessage({ kind: 'ok', text: 'Kayıt iptal edildi.' });
    load();
  }

  function exportCsv() {
    const name = summary ? summary.retailer_name : 'market';
    downloadText(`cari-${slug(name)}-${todayIso()}.csv`, statementCsv(rows, `${org.name} – ${name} hesap ekstresi (${shortDate(todayIso())})`));
  }

  if (!entries) return <div className="center">Yükleniyor…</div>;
  if (!summary) {
    return (
      <>
        <Link href="/cari" className="small">← Cari hesaplar</Link>
        <div className="notice error">Bu market ile çalışma ilişkiniz bulunamadı.</div>
      </>
    );
  }

  const over = summary.credit_limit != null && Number(summary.balance) > Number(summary.credit_limit);

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/cari" className="small">← Cari hesaplar</Link>
          <h1>{summary.retailer_name}</h1>
          <p className="sub">
            Vade {summary.payment_term_days ? `${summary.payment_term_days} gün` : 'yok (peşin)'}
            {summary.credit_limit != null ? ` · kredi limiti ${tl(summary.credit_limit)}` : ' · kredi limiti yok'}
          </p>
        </div>
        <button type="button" className="btn outline" onClick={exportCsv} disabled={!rows.length}>Ekstreyi indir (Excel)</button>
      </div>

      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}

      <section className="kpis" aria-label="Hesap özeti">
        <div className="kpi"><span className="label">Bakiye (borç)</span><span className={`value ${over ? 'warn' : ''}`}>{tl(summary.balance)}</span></div>
        <div className="kpi"><span className="label">Vadesi geçen</span><span className={`value ${Number(summary.overdue) > 0 ? 'warn' : ''}`}>{tl(summary.overdue)}</span></div>
        <div className="kpi"><span className="label">En eski gecikme</span><span className={`value ${summary.oldest_overdue_days ? 'warn' : ''}`}>{summary.oldest_overdue_days ? `${summary.oldest_overdue_days} gün` : '–'}</span></div>
        <div className="kpi"><span className="label">Son ödeme</span><span className="value" style={{ fontSize: 18 }}>{summary.last_payment_date ? `${shortDate(summary.last_payment_date)} · ${tl(summary.last_payment_amount)}` : 'Yok'}</span></div>
      </section>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ margin: 0 }}>Tahsilat ekle</h2>
          <form onSubmit={submitPayment} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="field">
              <label htmlFor="p-amount">Tutar (TL)</label>
              <input id="p-amount" className="input" inputMode="decimal" placeholder="ör. 12.500,00" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} required />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="p-method">Ödeme şekli</label>
                <select id="p-method" className="input" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                  {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="p-date">Tarih</label>
                <input id="p-date" className="input" type="date" max={todayIso()} value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="p-note">Açıklama (isteğe bağlı)</label>
              <input id="p-note" className="input" placeholder="ör. Dekont no, çek no" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} />
            </div>
            <button className="btn primary" type="submit" disabled={busy === 'pay'}>{busy === 'pay' ? 'Kaydediliyor…' : 'Tahsilatı kaydet'}</button>
          </form>
        </section>

        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ margin: 0 }}>İade / düzeltme</h2>
          <form onSubmit={submitAdjustment} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="field">
              <label htmlFor="a-type">İşlem</label>
              <select id="a-type" className="input" value={adj.type} onChange={(e) => setAdj({ ...adj, type: e.target.value })}>
                <option value="iade">İade (borçtan düş)</option>
                <option value="borc_dus">Düzeltme: borçtan düş</option>
                <option value="borc_ekle">Düzeltme: borç ekle</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="a-amount">Tutar (TL)</label>
              <input id="a-amount" className="input" inputMode="decimal" placeholder="ör. 480,00" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} required />
            </div>
            <div className="field">
              <label htmlFor="a-note">Açıklama {adj.type === 'iade' ? '(isteğe bağlı)' : '(zorunlu)'}</label>
              <input id="a-note" className="input" placeholder="ör. Bozuk ürün iadesi, açılış bakiyesi" value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} required={adj.type !== 'iade'} />
            </div>
            <button className="btn" type="submit" disabled={busy === 'adj'}>{busy === 'adj' ? 'Kaydediliyor…' : 'Kaydet'}</button>
          </form>
        </section>

        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ margin: 0 }}>Vade ve kredi limiti</h2>
          {terms ? (
            <form onSubmit={saveTerms} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="field">
                <label htmlFor="t-days">Vade (gün, 0 = peşin)</label>
                <input id="t-days" className="input" type="number" min="0" max="365" value={terms.days} onChange={(e) => setTerms({ ...terms, days: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="t-limit">Kredi limiti (TL, boş = limitsiz)</label>
                <input id="t-limit" className="input" inputMode="decimal" placeholder="ör. 150.000" value={terms.limit} onChange={(e) => setTerms({ ...terms, limit: e.target.value })} />
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                Limit aşıldığında sipariş önizlemesinde uyarı görürsünüz. Açılış bakiyesi için "Düzeltme: borç ekle" kullanın.
              </p>
              <button className="btn" type="submit" disabled={busy === 'terms'}>{busy === 'terms' ? 'Kaydediliyor…' : 'Kaydet'}</button>
            </form>
          ) : null}
        </section>
      </div>

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Hesap ekstresi</h2>
        <Statement rows={rows} onReverse={reverse} busyId={busy} />
      </section>
    </>
  );
}
