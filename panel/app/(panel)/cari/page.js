'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { tl, shortDate, errorText } from '@/lib/format';

export default function AccountsPage() {
  const { org } = useOrg();
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('all');
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('account_balances', { p_org: org.id });
    if (error) setMessage({ kind: 'error', text: errorText(error) });
    setRows(data || []);
  }, [org.id]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    const t = { balance: 0, overdue: 0, overdueMarkets: 0, overLimit: 0 };
    for (const r of rows || []) {
      t.balance += Number(r.balance);
      t.overdue += Number(r.overdue);
      if (Number(r.overdue) > 0) t.overdueMarkets += 1;
      if (r.credit_limit != null && Number(r.balance) > Number(r.credit_limit)) t.overLimit += 1;
    }
    return t;
  }, [rows]);

  const visible = useMemo(() => {
    return (rows || []).filter((r) => {
      if (filter === 'overdue') return Number(r.overdue) > 0;
      if (filter === 'open') return Number(r.balance) > 0;
      if (filter === 'limit') return r.credit_limit != null && Number(r.balance) > Number(r.credit_limit);
      return true;
    });
  }, [rows, filter]);

  if (!rows) return <div className="center">Yükleniyor…</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Cari hesaplar</h1>
          <p className="sub">
            Marketlerin size borcu. Teslim alınan her sipariş otomatik borç yazar; ödemeler en eski borçtan başlayarak kapatılır.
          </p>
        </div>
      </div>

      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}

      <section className="kpis" aria-label="Cari özeti">
        <div className="kpi"><span className="label">Toplam alacak</span><span className="value">{tl(totals.balance)}</span></div>
        <div className="kpi"><span className="label">Vadesi geçen</span><span className={`value ${totals.overdue > 0 ? 'warn' : ''}`}>{tl(totals.overdue)}</span></div>
        <div className="kpi"><span className="label">Ödemesi geciken market</span><span className={`value ${totals.overdueMarkets ? 'warn' : ''}`}>{totals.overdueMarkets}</span></div>
        <div className="kpi"><span className="label">Limiti aşan market</span><span className={`value ${totals.overLimit ? 'warn' : ''}`}>{totals.overLimit}</span></div>
      </section>

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[['all', 'Hepsi'], ['overdue', 'Vadesi geçen'], ['open', 'Borcu olan'], ['limit', 'Limit aşımı']].map(([k, label]) => (
            <button key={k} type="button" className={`btn small ${filter === k ? 'primary' : ''}`} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
        {!rows.length ? (
          <p className="muted">Bağlı market yok. <Link href="/marketler">Marketler</Link> sayfasından davet edin.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Market</th>
                  <th className="num">Bakiye</th>
                  <th className="num">Vadesi geçen</th>
                  <th>Gecikme</th>
                  <th>Son ödeme</th>
                  <th>Vade / limit</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const over = r.credit_limit != null && Number(r.balance) > Number(r.credit_limit);
                  return (
                    <tr key={r.retailer_id}>
                      <td className="strong">{r.retailer_name}</td>
                      <td className="num strong">{tl(r.balance)}</td>
                      <td className={`num ${Number(r.overdue) > 0 ? 'warn-text strong' : 'muted'}`}>{Number(r.overdue) > 0 ? tl(r.overdue) : '–'}</td>
                      <td>{r.oldest_overdue_days ? <span className="badge warn">{r.oldest_overdue_days} gün</span> : <span className="muted small">–</span>}</td>
                      <td className="small">{r.last_payment_date ? `${shortDate(r.last_payment_date)} · ${tl(r.last_payment_amount)}` : <span className="muted">Yok</span>}</td>
                      <td className="small">
                        {r.payment_term_days ? `${r.payment_term_days} gün` : 'Peşin'}
                        {r.credit_limit != null ? (
                          <span className={over ? 'warn-text' : 'muted'} style={{ display: 'block' }}>
                            Limit {tl(r.credit_limit)}{over ? ' · aşıldı' : ''}
                          </span>
                        ) : null}
                      </td>
                      <td><Link href={`/cari/${r.retailer_id}`} className="btn small outline">Ekstre / tahsilat</Link></td>
                    </tr>
                  );
                })}
                {!visible.length ? <tr><td colSpan={7} className="muted">Bu filtrede market yok.</td></tr> : null}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
