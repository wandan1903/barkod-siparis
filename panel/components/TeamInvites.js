'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { shortDate, errorText } from '@/lib/format';
import InviteLink from '@/components/InviteLink';

// Kuruluşun kullanıcıları + ekibe kullanıcı daveti (distribütör ve market ayarlarında ortak)
export default function TeamInvites() {
  const { org } = useOrg();
  const [members, setMembers] = useState(null);
  const [invites, setInvites] = useState([]);
  const [name, setName] = useState('');
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [m, i] = await Promise.all([
      supabase.rpc('org_members', { p_org: org.id }),
      supabase
        .from('invites')
        .select('id, token, name, created_at, expires_at')
        .eq('org_id', org.id)
        .eq('kind', 'member')
        .is('used_at', null)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false }),
    ]);
    if (m.error) setMessage({ kind: 'error', text: errorText(m.error) });
    setMembers(m.data || []);
    setInvites(i.data || []);
  }, [org.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.rpc('create_invite', { p_org: org.id, p_kind: 'member', p_name: name });
    setBusy(false);
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setName('');
    load();
  }

  async function revoke(id) {
    const { error } = await supabase.rpc('revoke_invite', { p_invite: id });
    if (error) setMessage({ kind: 'error', text: errorText(error) });
    else load();
  }

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <h2 style={{ margin: 0 }}>Ekip</h2>
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          {org.name} hesabına çalışanlarınızı ekleyin. Davet bağlantısıyla kayıt olan kişi aynı verileri görür ve işlem yapabilir.
        </p>
      </div>
      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}

      {!members ? (
        <p className="muted">Yükleniyor…</p>
      ) : (
        <div className="list">
          {members.map((m) => (
            <div key={m.user_id} className="list-row">
              <span className="grow-1">
                <span className="strong">{m.email}</span>
                <span className="muted small">{m.role === 'owner' ? 'Sahip' : 'Çalışan'} · {shortDate(m.joined_at)} tarihinden beri</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {invites.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="strong small">Bekleyen davetler</span>
          {invites.map((i) => (
            <InviteLink
              key={i.id}
              invite={i}
              title={i.name || 'Ekip daveti'}
              shareText={`${org.name} ekibine katılman için davet:`}
              onRevoke={() => revoke(i.id)}
            />
          ))}
        </div>
      ) : null}

      <form onSubmit={create} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label className="sr-only" htmlFor="member-name">Davet edilecek kişi</label>
        <input id="member-name" className="input" style={{ flex: 1, minWidth: 180 }} placeholder="Kişinin adı (isteğe bağlı)" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Hazırlanıyor…' : 'Davet bağlantısı oluştur'}</button>
      </form>
    </section>
  );
}
