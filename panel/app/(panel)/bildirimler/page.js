'use client';

import NotificationList from '@/components/NotificationList';

export default function BildirimlerPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bildirimler</h1>
          <p className="sub">Market siparişleri, teklif yanıtları ve teslimat haberleri</p>
        </div>
      </div>
      <NotificationList />
    </>
  );
}
