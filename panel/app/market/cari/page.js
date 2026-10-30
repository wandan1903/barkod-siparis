'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { tl, shortDate, errorText } from '@/lib/format';
import { withRunningBalance } from '@/lib/account';
import Statement from '@/components/Statement';

// Market: distribütörlere borç durumu ve ekstre (yalnızca görüntüleme)
export default function MarketAccountPage() {
  const { org } = useOrg();
  const [rows, setRows] = useState(null);
  const [entries, setEntries] = useState([]);
  const [open, setOpen] = useState('');
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    const [b, e] = await Promise.all([
      supabase.rpc('account_balances', { p_org: org.id }),
      supabase
        .from('account_entries')
        .select('id, distributor_id, kind, amount, method, entry_date, due_date, reverses_id, note, created_at')
        .eq('retailer_id', org.id),
    ]);
    const err = b.error || e.error;
    if (err) setMessage({ kind: 'error', text: errorText(err) });
    const list = b.data || [];
    setRows(list);
    setEntries(e.data || []);
    if (list.length === 1) setOpen(list[0].distributor_id);
  }, [org.id]);

  useEffect(() => {
    load();
  }, [load]);

  const byDist = useMemo(() => {
    const m = new Map();
    for (const e of entries) {
      if (!m.has(e.distributor_id)) m.set(e.distributor_id, []);
      m.get(e.distributor_id).push(e);
    }
    return m;
  }, [entries]);

  if (!rows) return <div className="center">Yükleniyor…</div>;

  return (
    <>
      <h1 style={{ fontSize: 22 }}>Cari hesabım</h1>
      <p className="muted small" style={{ marginTop: -6 }}>
        Distribütörlere borcunuz. Teslim aldığınız siparişler borç olarak, ödemeleriniz distribütör kaydettiğinde alacak olarak işlenir.
      </p>
      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}
      {!rows.length ? <p className="muted">Çalıştığınız distribütör yok.</p> : null}

      {rows.map((r) => {
        const overdue = Number(r.overdue) > 0;
        const isOpen = open === r.distributor_id;
        const list = withRunningBalance(byDist.get(r.distributor_id) || []);
        return (
          <section key={r.distributor_id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <div>
                <span className="strong">{r.distributor_name}</span>
                <span className="muted small" style={{ display: 'block' }}>
                  Vade {r.payment_term_days ? `${r.payment_term_days} gün` : 'yok (peşin)'}
                  {r.last_payment_date ? ` · son ödeme ${shortDate(r.last_payment_date)} (${tl(r.last_payment_amount)})` : ''}
                </span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="strong" style={{ fontSize: 20 }}>{tl(r.balance)}</span>
                <span className="muted small" style={{ display: 'block' }}>borç</span>
              </div>
            </div>
            {overdue ? (
              <div className="notice error" role="status">
                Vadesi geçen: <strong>{tl(r.overdue)}</strong> ({r.oldest_overdue_days} gündür bekliyor)
              </div>
            ) : Number(r.balance) > 0 ? (
              <div className="notice ok" role="status">Vadesi geçmiş borcunuz yok.</div>
            ) : null}
            <button type="button" className="btn small outline" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(isOpen ? '' : r.distributor_id)}>
              {isOpen ? 'Ekstreyi gizle' : 'Ekstreyi göster'}
            </button>
            {isOpen ? <Statement rows={list} /> : null}
          </section>
        );
      })}
    </>
  );
}
