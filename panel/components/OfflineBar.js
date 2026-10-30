'use client';

import { useCallback, useEffect, useState } from 'react';
import { tl } from '@/lib/format';
import { queuedSales, syncSales, dropQueuedSale, QUEUE_EVENT } from '@/lib/offline';

// İnternet durumu ve cihazda bekleyen satışlar. İnternet gelince satışları kendisi gönderir.
export default function OfflineBar({ retailerId }) {
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState(null);

  const refresh = useCallback(() => setQueue(queuedSales(retailerId)), [retailerId]);

  const sync = useCallback(async () => {
    if (!queuedSales(retailerId).length) return;
    setSyncing(true);
    const r = await syncSales(retailerId);
    setSyncing(false);
    if (r && r.sent) setLast(`${r.sent} bekleyen satış gönderildi.`);
    refresh();
  }, [retailerId, refresh]);

  useEffect(() => {
    setOnline(navigator.onLine !== false);
    refresh();
    sync();
    const on = () => {
      setOnline(true);
      sync();
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener(QUEUE_EVENT, refresh);
    const t = setInterval(() => {
      if (navigator.onLine !== false) sync();
    }, 30000);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener(QUEUE_EVENT, refresh);
      clearInterval(t);
    };
  }, [refresh, sync]);

  useEffect(() => {
    if (!last) return undefined;
    const t = setTimeout(() => setLast(null), 5000);
    return () => clearTimeout(t);
  }, [last]);

  const failed = queue.filter((s) => s.error);
  if (online && !queue.length && !last) return null;

  return (
    <div className={`offline-bar ${online ? (failed.length ? 'warn' : 'ok') : 'off'}`} role="status">
      <div className="row">
        <span>
          {!online ? 'İnternet yok. Satış yapmaya devam edebilirsiniz; ' : ''}
          {queue.length
            ? `${queue.length} satış cihazda bekliyor (${tl(queue.reduce((s, x) => s + Number(x.total || 0), 0))})${online ? (syncing ? ', gönderiliyor…' : '') : ', internet gelince gönderilecek.'}`
            : !online
              ? 'satışlar cihazda bekletilecek.'
              : last}
        </span>
        {queue.length ? (
          <button type="button" className="link" onClick={() => setOpen(!open)}>{open ? 'Gizle' : 'Ayrıntı'}</button>
        ) : null}
        {online && queue.length && !syncing ? (
          <button type="button" className="link" onClick={sync}>Şimdi gönder</button>
        ) : null}
      </div>
      {open ? (
        <ul>
          {queue.map((s) => (
            <li key={s.ref}>
              {new Date(s.at).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {s.count} ürün · {tl(s.total)}
              {s.error ? (
                <>
                  {' '}· <strong>gönderilemedi: {s.error}</strong>{' '}
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      // eslint-disable-next-line no-alert
                      if (window.confirm('Bu bekleyen satış silinsin mi? Stok ve ciroya hiç işlenmeyecek.')) dropQueuedSale(retailerId, s.ref);
                    }}
                  >
                    Sil
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
