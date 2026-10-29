'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { OrgContext } from '@/lib/org-context';
import { loadMemberships } from '@/lib/memberships';
import { useUnreadCount, UnreadBadge } from '@/components/NotificationBell';
import './market.css';

const ICON = {
  home: <path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  sale: <path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14" />,
  offer: (
    <>
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </>
  ),
  stock: (
    <>
      <path d="M9 11l3 3 8-8" />
      <path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
};

const NAV = [
  { href: '/market', label: 'Ana sayfa', icon: 'home' },
  { href: '/market/satis', label: 'Satış', icon: 'sale' },
  { href: '/market/teklifler', label: 'Sipariş', icon: 'offer' },
  { href: '/market/stok', label: 'Stok', icon: 'stock' },
  { href: '/market/ayarlar', label: 'Ayarlar', icon: 'settings' },
];

function BellLink({ orgId }) {
  const count = useUnreadCount(orgId);
  return (
    <Link href="/market/bildirimler" className="bell" aria-label={count ? `Bildirimler, ${count} yeni` : 'Bildirimler'}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="24" height="24">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      {count ? <span className="bell-count"><UnreadBadge count={count} /></span> : null}
    </Link>
  );
}

export default function MarketLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState({ loading: true, session: null, org: null, error: '' });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session) {
        router.replace('/giris');
        return;
      }
      const m = await loadMemberships(session.user.id);
      if (cancelled) return;
      if (!m.retailer && m.distributor) {
        router.replace('/');
        return;
      }
      setState({
        loading: false,
        session,
        org: m.retailer,
        error: m.error || (m.retailer ? '' : 'Bu hesap bir markete bağlı değil.'),
      });
    }

    load();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') router.replace('/giris');
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/giris');
  }

  if (state.loading) return <div className="center">Yükleniyor…</div>;

  if (!state.org) {
    return (
      <div className="login-wrap">
        <div className="card login">
          <h1>Erişim yok</h1>
          <p className="muted">{state.error}</p>
          <button className="btn" onClick={signOut}>Çıkış yap</button>
        </div>
      </div>
    );
  }

  return (
    <OrgContext.Provider value={{ org: state.org, user: state.session.user, signOut }}>
      <div className="m-shell">
        <header className="m-top">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="hello">Barkod Sipariş</span>
            <span className="name">{state.org.name}</span>
          </div>
          <BellLink orgId={state.org.id} />
        </header>
        <main className="m-main">{children}</main>
        <nav className="m-nav" aria-label="Ana menü">
          <div className="inner">
            {NAV.map((item) => {
              const active =
                item.href === '/market'
                  ? pathname === '/market' || pathname.startsWith('/market/teslimat')
                  : item.href === '/market/teklifler'
                    ? pathname.startsWith('/market/teklifler') || pathname.startsWith('/market/siparis-ver')
                    : pathname.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href} className={active ? 'active' : ''}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {ICON[item.icon]}
                  </svg>
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </OrgContext.Provider>
  );
}
