'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { errorText } from '@/lib/format';

/** Girilen numarayı +90… biçimine çevirir; geçersizse null döner. */
export function normalizePhone(raw) {
  let s = String(raw || '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('+')) return /^\+[1-9]\d{9,14}$/.test(s) ? s : null;
  if (s.startsWith('0')) s = s.slice(1);
  if (/^5\d{9}$/.test(s)) return '+90' + s;
  if (/^90\d{10}$/.test(s)) return '+' + s;
  return null;
}

export default function NotificationSettings() {
  const { org } = useOrg();
  const [loaded, setLoaded] = useState(false);
  const [lowStock, setLowStock] = useState(true);
  const [wa, setWa] = useState(false);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    supabase
      .from('notification_settings')
      .select('low_stock_alerts, whatsapp_enabled, whatsapp_phone')
      .eq('org_id', org.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setLowStock(data.low_stock_alerts);
          setWa(data.whatsapp_enabled);
          setPhone(data.whatsapp_phone || '');
        }
        setLoaded(true);
      });
  }, [org.id]);

  async function save(e) {
    e.preventDefault();
    const normalized = normalizePhone(phone);
    if (phone && normalized === null) {
      setMessage({ kind: 'error', text: 'Telefon numarası geçersiz. Örnek: 0532 123 45 67 ya da +90 532 123 45 67' });
      return;
    }
    if (wa && !normalized) {
      setMessage({ kind: 'error', text: 'WhatsApp bildirimi için telefon numarası girin.' });
      return;
    }
    setBusy(true);
    const { error } = await supabase.from('notification_settings').upsert({
      org_id: org.id,
      low_stock_alerts: lowStock,
      whatsapp_enabled: wa,
      whatsapp_phone: normalized || null,
      updated_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setPhone(normalized || '');
    setMessage({ kind: 'ok', text: 'Bildirim ayarları kaydedildi.' });
  }

  if (!loaded) return null;

  return (
    <section className="card">
      <h2>Bildirimler</h2>
      <p className="muted small">
        Teklif, sipariş ve stok uyarıları uygulamadaki zil bölümünde görünür. WhatsApp'ı da açarsanız aynı bildirimler telefonunuza gelir.
      </p>
      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}
      <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {org.type === 'retailer' ? (
          <label className="switch-row">
            <input type="checkbox" checked={lowStock} onChange={(e) => setLowStock(e.target.checked)} />
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="strong">Azalan ürün uyarısı</span>
              <span className="muted small">Bir ürün sonraki teslimata kadar yetmeyecekse sabah ve öğleden sonra haber ver.</span>
            </span>
          </label>
        ) : null}
        <label className="switch-row">
          <input type="checkbox" checked={wa} onChange={(e) => setWa(e.target.checked)} />
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="strong">WhatsApp ile de gönder</span>
            <span className="muted small">Mesajlar WhatsApp Business üzerinden, kayıtlı numaranıza gelir.</span>
          </span>
        </label>
        <div className="field">
          <label htmlFor="wa-phone">WhatsApp numarası</label>
          <input
            id="wa-phone"
            className="input"
            type="tel"
            inputMode="tel"
            placeholder="0532 123 45 67"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
          />
        </div>
        <button className="btn primary" disabled={busy} style={{ alignSelf: 'flex-start' }}>
          {busy ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
      </form>
    </section>
  );
}
