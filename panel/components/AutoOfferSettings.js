'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { errorText, shortDate } from '@/lib/format';

const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

/** Distribütör: haftalık sipariş önerilerini otomatik gönderme ayarı. */
export default function AutoOfferSettings() {
  const { org } = useOrg();
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [dow, setDow] = useState(5);
  const [hour, setHour] = useState(9);
  const [lastRun, setLastRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    Promise.all([
      supabase.from('distributor_settings').select('auto_send, auto_send_dow, auto_send_hour').eq('distributor_id', org.id).maybeSingle(),
      supabase.from('auto_offer_runs').select('run_date, sent, skipped').eq('distributor_id', org.id).order('run_date', { ascending: false }).limit(1),
    ]).then(([s, r]) => {
      if (s.data) {
        setEnabled(s.data.auto_send);
        setDow(s.data.auto_send_dow);
        setHour(s.data.auto_send_hour);
      }
      setLastRun(r.data && r.data[0] ? r.data[0] : null);
      setLoaded(true);
    });
  }, [org.id]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from('distributor_settings').upsert({
      distributor_id: org.id,
      auto_send: enabled,
      auto_send_dow: dow,
      auto_send_hour: hour,
      updated_at: new Date().toISOString(),
    });
    setBusy(false);
    setMessage(error ? { kind: 'error', text: errorText(error) } : { kind: 'ok', text: 'Ayar kaydedildi.' });
  }

  if (!loaded) return null;

  return (
    <section className="card">
      <h2>Otomatik haftalık öneri</h2>
      <p className="muted small">
        Açıkken sistem seçtiğiniz gün ve saatte, stoğu azalan her markete hesaplanmış öneriyi teklif olarak gönderir. Yanıt bekleyen teklifi olan marketler atlanır.
        Teslim günü marketin sipariş günüdür (varsayılan cumartesi); bu yüzden gönderimi bir gün önceye koymanız iyi olur.
      </p>
      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}
      <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label className="switch-row">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="strong">Her hafta otomatik gönder</span>
        </label>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div className="field">
            <label htmlFor="as-dow">Gün</label>
            <select id="as-dow" className="input" value={dow} onChange={(e) => setDow(Number(e.target.value))} disabled={!enabled}>
              {DAYS.map((d, i) => (
                <option key={d} value={i}>{d}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="as-hour">Saat (İstanbul)</label>
            <select id="as-hour" className="input" value={hour} onChange={(e) => setHour(Number(e.target.value))} disabled={!enabled}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
              ))}
            </select>
          </div>
        </div>
        {lastRun ? (
          <p className="muted small">
            Son otomatik gönderim: {shortDate(lastRun.run_date)} · {lastRun.sent} markete teklif gitti{lastRun.skipped ? `, ${lastRun.skipped} market atlandı` : ''}
          </p>
        ) : null}
        <button className="btn primary" disabled={busy} style={{ alignSelf: 'flex-start' }}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</button>
      </form>
    </section>
  );
}
