'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase, signOutSafely } from '@/lib/supabase';
import { authErrorText } from '@/lib/format';

// İki aşama: (1) e-posta adresini girip sıfırlama bağlantısı iste,
// (2) e-postadaki bağlantıdan gelince yeni şifreyi belirle.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [stage, setStage] = useState('loading'); // loading | request | sent | set | done
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('email');
      if (q) setEmail(q);
    } catch (e) {}

    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const linkError = /error_code=otp_expired|error=access_denied/.test(hash);
    const fromLink = /type=recovery/.test(hash);

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setStage('set');
    });

    if (linkError) {
      setError('Bu bağlantının süresi dolmuş ya da daha önce kullanılmış. Aşağıdan yeni bir bağlantı isteyin.');
      setStage('request');
    } else if (fromLink) {
      // supabase-js adresteki kodu işleyip PASSWORD_RECOVERY olayını gönderir
      setTimeout(() => setStage((s) => (s === 'loading' ? 'request' : s)), 3000);
    } else {
      setStage('request');
    }
    return () => sub.subscription.unsubscribe();
  }, []);

  async function onRequest(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/sifre-yenile`,
    });
    setBusy(false);
    if (err) {
      setError(authErrorText(err));
      return;
    }
    setStage('sent');
  }

  async function onSet(e) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Şifre en az 8 karakter olmalı.');
      return;
    }
    if (password !== again) {
      setError('İki şifre aynı değil.');
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) {
      setError(authErrorText(err));
      return;
    }
    await signOutSafely();
    setStage('done');
    setTimeout(() => router.replace('/giris'), 2500);
  }

  if (stage === 'loading') return <div className="center">Yükleniyor…</div>;

  return (
    <div className="login-wrap">
      <div className="card login" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <h1>Barkod Sipariş</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            {stage === 'set' ? 'Yeni şifrenizi belirleyin' : 'Şifre sıfırlama'}
          </p>
        </div>

        {stage === 'request' ? (
          <form onSubmit={onRequest} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p className="muted small" style={{ margin: 0 }}>
              Hesabınızın e-posta adresini yazın. Şifrenizi yenilemeniz için size bir bağlantı göndereceğiz.
            </p>
            <div className="field">
              <label htmlFor="email">E-posta</label>
              <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            {error ? <div className="notice error" role="alert">{error}</div> : null}
            <button className="btn primary" type="submit" disabled={busy || !email.trim()}>
              {busy ? 'Gönderiliyor…' : 'Sıfırlama bağlantısı gönder'}
            </button>
            <Link href="/giris" className="small" style={{ textAlign: 'center' }}>Girişe dön</Link>
          </form>
        ) : null}

        {stage === 'sent' ? (
          <>
            <div className="notice ok" role="status">
              Bu adresle kayıtlı bir hesap varsa şifre sıfırlama bağlantısı gönderildi. E-postanızı (gelen kutusu ve gereksiz klasörü) kontrol edin. Bağlantı kısa süre geçerlidir ve tek kullanımlıktır.
            </div>
            <button className="btn" type="button" onClick={() => { setStage('request'); setError(''); }}>Tekrar gönder</button>
            <Link href="/giris" className="small" style={{ textAlign: 'center' }}>Girişe dön</Link>
          </>
        ) : null}

        {stage === 'set' ? (
          <form onSubmit={onSet} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="field">
              <label htmlFor="np">Yeni şifre (en az 8 karakter)</label>
              <input id="np" className="input" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="np2">Yeni şifre (tekrar)</label>
              <input id="np2" className="input" type="password" autoComplete="new-password" minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} required />
            </div>
            {error ? <div className="notice error" role="alert">{error}</div> : null}
            <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Kaydediliyor…' : 'Şifreyi kaydet'}</button>
          </form>
        ) : null}

        {stage === 'done' ? (
          <div className="notice ok" role="status">Şifreniz değiştirildi. Giriş sayfasına yönlendiriliyorsunuz…</div>
        ) : null}
      </div>
    </div>
  );
}
