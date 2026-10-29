'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { dateTime, errorText } from '@/lib/format';

const KIND_LABEL = { low_stock: 'Stok uyarısı', offer: 'Teklif', order: 'Sipariş', campaign: 'Kampanya', system: 'Sistem' };

export default function NotificationList() {
  const { org } = useOrg();
  const router = useRouter();
  const [items, setItems] = useState(null);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('notifications')
      .select('id, kind, title, body, link, read_at, created_at')
      .eq('org_id', org.id)
      .order('created_at', { ascending: false })
      .limit(60);
    if (error) setMessage({ kind: 'error', text: errorText(error) });
    setItems(data || []);
  }, [org.id]);

  useEffect(() => {
    load();
  }, [load]);

  function changed() {
    window.dispatchEvent(new Event('notifications-changed'));
  }

  async function open(n) {
    if (!n.read_at) {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id);
      changed();
    }
    if (n.link) router.push(n.link);
    else load();
  }

  async function readAll() {
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('org_id', org.id)
      .is('read_at', null);
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    changed();
    load();
  }

  if (!items) return <div className="center">Yükleniyor…</div>;
  const unread = items.filter((n) => !n.read_at).length;

  return (
    <section className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2>Bildirimler{unread ? ` · ${unread} yeni` : ''}</h2>
        {unread ? <button className="btn small" onClick={readAll}>Tümünü okundu yap</button> : null}
      </div>
      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}
      {!items.length ? (
        <p className="muted">Henüz bildirim yok. Teklif, sipariş ve stok uyarıları burada görünür.</p>
      ) : (
        <ul className="notif-list">
          {items.map((n) => (
            <li key={n.id}>
              <button type="button" className={`notif ${n.read_at ? '' : 'unread'}`} onClick={() => open(n)}>
                <span className="notif-top">
                  <span className="badge info">{KIND_LABEL[n.kind] || n.kind}</span>
                  <span className="muted small">{dateTime(n.created_at)}</span>
                </span>
                <span className="strong">{n.title}</span>
                {n.body ? <span className="small muted">{n.body}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
