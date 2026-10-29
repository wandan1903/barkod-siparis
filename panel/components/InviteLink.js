'use client';

import { useState } from 'react';
import { shortDate } from '@/lib/format';

export function inviteUrl(token) {
  return `${typeof window !== 'undefined' ? window.location.origin : ''}/davet/${token}`;
}

// Tek bir davet bağlantısı: kopyala, WhatsApp'tan paylaş, iptal et
export default function InviteLink({ invite, title, shareText, onRevoke }) {
  const [copied, setCopied] = useState(false);
  const url = inviteUrl(invite.token);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      window.prompt('Bağlantıyı kopyalayın:', url);
    }
  }

  return (
    <div className="list-row" style={{ flexWrap: 'wrap', gap: 8 }}>
      <span className="grow-1" style={{ minWidth: 160 }}>
        <span className="strong">{title}</span>
        <span className="muted small">{shortDate(invite.expires_at)} tarihine kadar geçerli · tek kullanımlık</span>
      </span>
      <button type="button" className="btn small" onClick={copy}>{copied ? 'Kopyalandı' : 'Bağlantıyı kopyala'}</button>
      <a
        className="btn small outline"
        href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${url}`)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        WhatsApp'tan gönder
      </a>
      <button type="button" className="btn small" onClick={onRevoke}>İptal et</button>
    </div>
  );
}
