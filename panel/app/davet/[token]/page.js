'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase, signOutSafely } from '@/lib/supabase';
import { errorText } from '@/lib/format';
import { loadMemberships } from '@/lib/memberships';

export default function InvitePage() {
  const { token } = useParams();
  const router = useRouter();
  const [invite, setInvite] = useState(null);
  const [session, setSession] = useState(undefined);
  const [mode, setMode] = useState('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [mem, setMem] = useState(null); // giriş yapan hesabın üyelikleri

  const load = useCallback(async () => {
    const [{ data: inv, error: invError }, { data: s }] = await Promise.all([
      supabase.rpc('get_invite', { p_token: String(token) }),
      supabase.auth.getSession(),
    ]);
    if (invError) setError(errorText(invError));
    const row = inv && inv[0] ? inv[0] : { valid: false, reason: 'Davet bulunamadı' };
    setInvite(row);
    if (row.suggested_name) setName((n) => n || row.suggested_name);
    setSession(s.session || null);
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!session) {
      setMem(null);
      return;
    }
    loadMemberships(session.user.id).then(setMem);
  }, [session]);

  async function onAuth(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    if (mode === 'signup') {
      const { data, error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: typeof window !== 'undefined' ? window.location.href : undefined },
      });
      setBusy(false);
      if (err) {
        setError(err.message.toLowerCase().includes('already') ? 'Bu e-posta ile hesap var; "Giriş yap" sekmesini kullanın.' : errorText(err));
        return;
      }
      if (data.session) {
        setSession(data.session);
      } else {
        setInfo('E-posta adresinize bir doğrulama bağlantısı gönderdik. Doğruladıktan sonra bu davet bağlantısına tekrar gelin.');
      }
      return;
    }
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) {
      setError('E-posta veya şifre hatalı.');
      return;
    }
    setSession(data.session);
  }

  async function onAccept(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { data, error: err } = await supabase.rpc('accept_invite', { p_token: String(token), p_name: name, p_consent: consent });
    setBusy(false);
    if (err) {
      setError(errorText(err));
      return;
    }
    router.replace(data === 'market' ? '/market' : '/');
  }

  async function switchAccount() {
    await signOutSafely();
    setSession(null);
  }

  if (!invite || session === undefined) return <div className="center">Yükleniyor…</div>;

  const isMarket = invite.kind === 'market';
  const isDistributorAccount = !!(mem && mem.distributor);
  const existingMarket = mem && mem.retailer && !mem.distributor ? mem.retailer : null;
  const alreadyMember = !isMarket && mem && [mem.distributor, mem.retailer].some((o) => o && invite.org_name && o.name === invite.org_name);
  const blocked = isMarket && isDistributorAccount;

  return (
    <div className="login-wrap">
      <div className="card login">
        <div>
          <h1>Barkod Sipariş</h1>
          {invite.valid ? (
            <p className="muted" style={{ marginTop: 4 }}>
              {isMarket
                ? `${invite.org_name} sizi davet etti: stoğunuzu takip edin, haftalık siparişlerinizi kolayca verin.`
                : `${invite.org_name} ekibine katılmaya davet edildiniz.`}
            </p>
          ) : null}
        </div>

        {!invite.valid ? (
          <div className="notice error" role="alert">{invite.reason || 'Davet geçerli değil'}. Davet eden kişiden yeni bir bağlantı isteyin.</div>
        ) : !session ? (
          <form onSubmit={onAuth} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className={`btn small ${mode === 'signup' ? 'primary' : ''}`} onClick={() => { setMode('signup'); setError(''); }}>Yeni hesap aç</button>
              <button type="button" className={`btn small ${mode === 'login' ? 'primary' : ''}`} onClick={() => { setMode('login'); setError(''); }}>Hesabım var</button>
            </div>
            <div className="field">
              <label htmlFor="email">E-posta</label>
              <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="password">Şifre {mode === 'signup' ? '(en az 8 karakter)' : ''}</label>
              <input id="password" className="input" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={mode === 'signup' ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error ? <div className="notice error" role="alert">{error}</div> : null}
            {info ? <div className="notice ok" role="status">{info}</div> : null}
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? 'Lütfen bekleyin…' : mode === 'signup' ? 'Hesap aç ve devam et' : 'Giriş yap ve devam et'}
            </button>
          </form>
        ) : (
          <form onSubmit={onAccept} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p className="muted small" style={{ margin: 0 }}>Giriş yapan hesap: <span className="strong">{session.user.email}</span></p>
            {blocked ? (
              <div className="notice error" role="alert">
                Bu hesap <strong>{mem.distributor.name}</strong> distribütör hesabı; market olarak katılamaz. Aşağıdaki düğmeyle çıkış yapıp market için başka bir e-posta ile devam edin.
              </div>
            ) : null}
            {!isMarket && alreadyMember ? (
              <div className="notice ok" role="status">Bu hesap zaten {invite.org_name} ekibinde. Davet gerekmiyor.</div>
            ) : null}
            {isMarket && !blocked ? (
              <>
                {existingMarket ? (
                  <div className="notice ok" role="status">
                    Mevcut marketiniz <strong>{existingMarket.name}</strong>, {invite.org_name} ile bağlanacak.
                  </div>
                ) : (
                  <div className="field">
                    <label htmlFor="mname">Market adı</label>
                    <input id="mname" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="ör. Yıldız Market" required />
                  </div>
                )}
                <label className="switch-row">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span className="small">
                    Rafımdaki ürünlerin <strong>kalan miktarının</strong> {invite.org_name} ile paylaşılmasını onaylıyorum. Raf satış fiyatlarım paylaşılmaz; bu izni istediğim zaman Ayarlar'dan kapatabilirim.
                  </span>
                </label>
              </>
            ) : null}
            {error ? <div className="notice error" role="alert">{error}</div> : null}
            <button className="btn primary" type="submit" disabled={busy || !mem || blocked || (isMarket && (!consent || (!existingMarket && !name.trim())))}>
              {busy ? 'Bağlanıyor…' : isMarket ? 'Daveti kabul et' : 'Ekibe katıl'}
            </button>
            <button type="button" className={blocked ? 'btn' : 'link'} onClick={switchAccount}>
              {blocked ? 'Çıkış yap, başka e-posta ile devam et' : 'Başka bir hesapla devam et'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
