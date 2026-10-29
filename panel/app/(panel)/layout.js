'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase, signOutSafely } from '@/lib/supabase';
import { OrgContext } from '@/lib/org-context';
import { loadMemberships } from '@/lib/memberships';
import { useUnreadCount, UnreadBadge } from '@/components/NotificationBell';

const NAV = [
  { href: '/', label: 'Genel bakış' },
  { href: '/siparisler', label: 'Siparişler' },
  { href: '/marketler', label: 'Marketler' },
  { href: '/urunler', label: 'Ürünler ve fiyatlar' },
  { href: '/depo', label: 'Depo' },
  { href: '/kampanyalar', label: 'Kampanyalar' },
  { href: '/entegrasyonlar', label: 'Entegrasyonlar' },
  { href: '/bildirimler', label: 'Bildirimler', bell: true },
  { href: '/ayarlar', label: 'Ayarlar' },
];

function NavLink({ item, active, orgId }) {
  return (
    <Link href={item.href} className={active ? 'active' : ''}>
      {item.label}
      {item.bell ? <BellCount orgId={orgId} /> : null}
    </Link>
  );
}

function BellCount({ orgId }) {
  const count = useUnreadCount(orgId);
  return <UnreadBadge count={count} />;
}

export default function PanelLayout({ children }) {
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
      if (!m.distributor && m.retailer) {
        // Market hesabı: market ekranlarına yönlendir
        router.replace('/market');
        return;
      }
      setState({
        loading: false,
        session,
        org: m.distributor,
        error: m.error || (m.distributor ? '' : 'Bu hesap bir distribütöre ya da markete bağlı değil.'),
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
    await signOutSafely();
    router.replace('/giris');
  }

  if (state.loading) {
    return <div className="center">Yükleniyor…</div>;
  }

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
    <OrgContext.Provider value={{ org: state.org, user: state.session.user }}>
      <div className="shell">
        <nav className="side" aria-label="Panel menüsü">
          <span className="brand">Barkod Sipariş</span>
          <span className="org">{state.org.name}</span>
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' || pathname.startsWith('/marketler/') : pathname.startsWith(item.href) && !(item.href === '/marketler' && pathname.startsWith('/marketler/'));
            return (
              <NavLink key={item.href} item={item} active={active} orgId={state.org.id} />
            );
          })}
          <span className="spacer" />
          <button className="link" onClick={signOut}>Çıkış yap</button>
        </nav>
        <main className="main">{children}</main>
      </div>
    </OrgContext.Provider>
  );
}
