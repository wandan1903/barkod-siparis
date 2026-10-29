'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/** Okunmamış bildirim sayısı. Dakikada bir ve sekmeye dönüldüğünde yenilenir. */
export function useUnreadCount(orgId) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    const { count: c } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .is('read_at', null);
    setCount(c || 0);
  }, [orgId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 60000);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener('notifications-changed', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('notifications-changed', onFocus);
    };
  }, [refresh]);

  return count;
}

export function UnreadBadge({ count }) {
  if (!count) return null;
  return <span className="unread-badge" aria-label={`${count} okunmamış bildirim`}>{count > 99 ? '99+' : count}</span>;
}
