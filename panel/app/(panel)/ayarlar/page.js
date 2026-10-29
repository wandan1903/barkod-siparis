'use client';

import { useOrg } from '@/lib/org-context';
import NotificationSettings from '@/components/NotificationSettings';
import AutoOfferSettings from '@/components/AutoOfferSettings';

export default function AyarlarPage() {
  const { org, user } = useOrg();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ayarlar</h1>
          <p className="sub">{org.name} · {user.email}</p>
        </div>
      </div>
      <AutoOfferSettings />
      <NotificationSettings />
    </>
  );
}
