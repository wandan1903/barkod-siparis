'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { shortDate, errorText } from '@/lib/format';
import InviteLink from '@/components/InviteLink';

export default function MarketsPage() {
  const { org } = useOrg();
  const [links, setLinks] = useState(null);
  const [invites, setInvites] = useState([]);
  const [name, setName] = useState('');
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [l, i] = await Promise.all([
      supabase
        .from('retailer_distributor_links')
        .select('retailer_id, status, stock_share_consent_at, created_at, retailer:organizations!retailer_distributor_links_retailer_id_fkey(name, district)')
        .eq('distributor_id', org.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('invites')
        .select('id, token, name, created_at, expires_at')
        .eq('org_id', org.id)
        .eq('kind', 'market')
        .is('used_at', null)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false }),
    ]);
    const err = l.error || i.error;
    if (err) setMessage({ kind: 'error', text: errorText(err) });
    setLinks(l.data || []);
    setInvites(i.data || []);
  }, [org.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.rpc('create_invite', { p_org: org.id, p_kind: 'market', p_name: name });
    setBusy(false);
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setName('');
    setMessage({ kind: 'ok', text: 'Davet hazır. Bağlantıyı kopyalayın ya da WhatsApp ile marketin sahibine gönderin.' });
    load();
  }

  async function revoke(id) {
    const { error } = await supabase.rpc('revoke_invite', { p_invite: id });
    if (error) setMessage({ kind: 'error', text: errorText(error) });
    else load();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Marketler</h1>
          <p className="sub">Çalıştığınız market ve bakkallar. Yeni market eklemek için davet bağlantısı gönderin; market kendi hesabını kendisi açar.</p>
        </div>
      </div>

      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Yeni market davet et</h2>
        <form onSubmit={create} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label className="sr-only" htmlFor="market-name">Market adı</label>
          <input id="market-name" className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Market / bakkal adı (ör. Yıldız Market)" value={name} onChange={(e) => setName(e.target.value)} required />
          <button className="btn primary" type="submit" disabled={busy || !name.trim()}>{busy ? 'Hazırlanıyor…' : 'Davet bağlantısı oluştur'}</button>
        </form>
        {invites.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="strong small">Bekleyen davetler</span>
            {invites.map((i) => (
              <InviteLink
                key={i.id}
                invite={i}
                title={i.name || 'Market daveti'}
                shareText={`${org.name} olarak seni Barkod Sipariş'e davet ediyoruz. Stoğunu takip edip haftalık siparişini kolayca verebilirsin:`}
                onRevoke={() => revoke(i.id)}
              />
            ))}
          </div>
        ) : null}
        <p className="muted small" style={{ margin: 0 }}>
          Market daveti kabul ederken yalnızca stok miktarlarını sizinle paylaşmayı onaylar. Raf fiyatlarını göremezsiniz.
        </p>
      </section>

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Bağlı marketler{links ? ` · ${links.length}` : ''}</h2>
        {!links ? (
          <p className="muted">Yükleniyor…</p>
        ) : !links.length ? (
          <p className="muted">Henüz bağlı market yok. Yukarıdan ilk marketi davet edin.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Market</th><th>Durum</th><th>Stok paylaşımı</th><th>Bağlandı</th><th /></tr></thead>
              <tbody>
                {links.map((l) => (
                  <tr key={l.retailer_id}>
                    <td className="strong">
                      {l.retailer ? l.retailer.name : 'Market'}
                      {l.retailer && l.retailer.district ? <span className="muted small" style={{ display: 'block' }}>{l.retailer.district}</span> : null}
                    </td>
                    <td><span className={`badge ${l.status === 'active' ? 'ok' : 'info'}`}>{l.status === 'active' ? 'Aktif' : l.status === 'pending' ? 'Bekliyor' : 'Sona erdi'}</span></td>
                    <td>{l.stock_share_consent_at ? <span className="badge ok">Açık</span> : <span className="badge warn">Kapalı</span>}</td>
                    <td className="small">{shortDate(l.created_at)}</td>
                    <td><Link href={`/marketler/${l.retailer_id}`} className="btn small outline">Detay</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
