'use client';

import { useOrg } from '@/lib/org-context';
import NotificationSettings from '@/components/NotificationSettings';

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
      <NotificationSettings />
    </>
  );
}
