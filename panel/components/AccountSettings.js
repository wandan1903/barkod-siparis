'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, signOutSafely } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { errorText, authErrorText } from '@/lib/format';

// Firma bilgileri (ad, vergi no, il/ilçe), kullanıcı hesabı ve şifre değiştirme
export default function AccountSettings({ withSignOut = false }) {
  const { org, user } = useOrg();
  const router = useRouter();
  const canEdit = true; // rol ayrımı yok: hesaba bağlı herkes düzenleyebilir
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ next: '', again: '' });
  const [pwMessage, setPwMessage] = useState(null);
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    let off = false;
    supabase
      .from('organizations')
      .select('name, tax_no, city, district')
      .eq('id', org.id)
      .single()
      .then(({ data, error }) => {
        if (off) return;
        if (error) {
          setMessage({ kind: 'error', text: errorText(error) });
          return;
        }
        const f = { name: data.name || '', tax_no: data.tax_no || '', city: data.city || '', district: data.district || '' };
        setForm(f);
        setSaved(f);
      });
    return () => {
      off = true;
    };
  }, [org.id]);

  const dirty = form && saved && JSON.stringify(form) !== JSON.stringify(saved);

  async function saveProfile(e) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.rpc('update_org_profile', {
      p_org: org.id,
      p_name: form.name,
      p_tax_no: form.tax_no,
      p_city: form.city,
      p_district: form.district,
    });
    setBusy(false);
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
      return;
    }
    setSaved(form);
    setMessage({ kind: 'ok', text: 'Firma bilgileri güncellendi.' });
    // Menüdeki ve sayfalardaki ad da yenilensin
    setTimeout(() => window.location.reload(), 700);
  }

  async function changePassword(e) {
    e.preventDefault();
    setPwMessage(null);
    if (pw.next.length < 8) {
      setPwMessage({ kind: 'error', text: 'Şifre en az 8 karakter olmalı.' });
      return;
    }
    if (pw.next !== pw.again) {
      setPwMessage({ kind: 'error', text: 'İki şifre aynı değil.' });
      return;
    }
    setPwBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw.next });
    setPwBusy(false);
    if (error) {
      setPwMessage({ kind: 'error', text: authErrorText(error) });
      return;
    }
    setPw({ next: '', again: '' });
    setPwMessage({ kind: 'ok', text: 'Şifreniz değiştirildi.' });
  }

  async function signOut() {
    await signOutSafely();
    router.replace('/giris');
  }

  const set = (patch) => setForm({ ...form, ...patch });

  return (
    <>
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Firma bilgileri</h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            {org.type === 'distributor' ? 'Marketler sizi bu adla görür.' : 'Distribütörler sizi bu adla görür.'}
          </p>
        </div>
        {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}
        {!form ? (
          <p className="muted">Yükleniyor…</p>
        ) : (
          <form onSubmit={saveProfile} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="field">
              <label htmlFor="acc-name">Firma adı</label>
              <input id="acc-name" className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} disabled={!canEdit} required maxLength={120} />
            </div>
            <div className="field">
              <label htmlFor="acc-tax">Vergi no / TC kimlik no (isteğe bağlı)</label>
              <input id="acc-tax" className="input" inputMode="numeric" value={form.tax_no} onChange={(e) => set({ tax_no: e.target.value.replace(/\D/g, '').slice(0, 11) })} disabled={!canEdit} />
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div className="field" style={{ flex: 1, minWidth: 160 }}>
                <label htmlFor="acc-city">İl</label>
                <input id="acc-city" className="input" value={form.city} onChange={(e) => set({ city: e.target.value })} disabled={!canEdit} maxLength={80} />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 160 }}>
                <label htmlFor="acc-district">İlçe</label>
                <input id="acc-district" className="input" value={form.district} onChange={(e) => set({ district: e.target.value })} disabled={!canEdit} maxLength={80} />
              </div>
            </div>
            <button className="btn primary" type="submit" disabled={busy || !dirty} style={{ alignSelf: 'flex-start' }}>
              {busy ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </form>
        )}
      </section>

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Hesabım</h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            {user.email}
          </p>
        </div>
        {pwMessage ? <div className={`notice ${pwMessage.kind}`} role="status">{pwMessage.text}</div> : null}
        <form onSubmit={changePassword} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, minWidth: 180 }}>
              <label htmlFor="pw-new">Yeni şifre (en az 8 karakter)</label>
              <input id="pw-new" className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 180 }}>
              <label htmlFor="pw-again">Yeni şifre (tekrar)</label>
              <input id="pw-again" className="input" type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" type="submit" disabled={pwBusy || !pw.next}>{pwBusy ? 'Değiştiriliyor…' : 'Şifreyi değiştir'}</button>
            {withSignOut ? <button className="btn" type="button" onClick={signOut}>Çıkış yap</button> : null}
          </div>
        </form>
      </section>
    </>
  );
}
