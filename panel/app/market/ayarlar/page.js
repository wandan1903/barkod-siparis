'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { shortDate, errorText } from '@/lib/format';
import Integrations from '@/components/Integrations';
import NotificationSettings from '@/components/NotificationSettings';
import TeamInvites from '@/components/TeamInvites';
import AccountSettings from '@/components/AccountSettings';
import DataExport from '@/components/DataExport';

export default function SettingsPage() {
  const { org } = useOrg();
  const [links, setLinks] = useState(null);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('retailer_distributor_links')
      .select('distributor_id, status, stock_share_consent_at, distributor:organizations!retailer_distributor_links_distributor_id_fkey(name)')
      .eq('retailer_id', org.id);
    if (error) setMessage({ kind: 'error', text: errorText(error) });
    setLinks(data || []);
  }, [org.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleConsent(link) {
    const value = link.stock_share_consent_at ? null : new Date().toISOString();
    const { error } = await supabase
      .from('retailer_distributor_links')
      .update({ stock_share_consent_at: value })
      .eq('retailer_id', org.id)
      .eq('distributor_id', link.distributor_id);
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setMessage({
      kind: 'ok',
      text: value
        ? 'Stok paylaşımı açıldı. Distribütör yalnızca kendi ürünlerinin stoğunu görür.'
        : 'Stok paylaşımı kapatıldı. Distribütör artık stoğunuzu göremez ve size öneri hazırlayamaz.',
    });
    load();
  }

  return (
    <>
      <h1 style={{ fontSize: 22 }}>Ayarlar</h1>
      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}

      <section className="card">
        <h2>Çalıştığınız distribütörler</h2>
        <p className="muted small">
          Stok paylaşımı açıkken distribütör yalnızca kendi sattığı ürünlerin kalan miktarını görür. Raf fiyatlarınızı ve
          başka distribütörlerin ürünlerini hiçbir zaman göremez.
        </p>
        {!links ? (
          <p className="muted">Yükleniyor…</p>
        ) : !links.length ? (
          <p className="muted">Henüz bağlı distribütör yok.</p>
        ) : (
          links.map((l) => (
            <label key={l.distributor_id} className="switch-row">
              <input type="checkbox" checked={!!l.stock_share_consent_at} onChange={() => toggleConsent(l)} />
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="strong">{l.distributor ? l.distributor.name : 'Distribütör'}</span>
                <span className="muted small">
                  {l.stock_share_consent_at ? `Stok paylaşımı açık · ${shortDate(l.stock_share_consent_at)} tarihinden beri` : 'Stok paylaşımı kapalı'}
                </span>
              </span>
            </label>
          ))
        )}
      </section>

      <NotificationSettings />

      <TeamInvites />

      <DataExport side="retailer" />

      <Integrations side="retailer" />

      <AccountSettings withSignOut />
    </>
  );
}
