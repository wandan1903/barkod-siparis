'use client';

import { tl, shortDate } from '@/lib/format';
import { KIND_LABEL, METHOD_LABEL } from '@/lib/account';

// Hesap ekstresi tablosu (en yeni üstte). onReverse verilirse satırda "İptal et" düğmesi çıkar.
export default function Statement({ rows, onReverse, busyId }) {
  if (!rows.length) return <p className="muted">Henüz hesap hareketi yok.</p>;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Tarih</th>
            <th>İşlem</th>
            <th className="num">Borç</th>
            <th className="num">Alacak</th>
            <th className="num">Bakiye</th>
            <th>Vade</th>
            {onReverse ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.slice().reverse().map((r) => {
            const amt = Number(r.amount);
            const struck = r.isReversed || r.kind === 'iptal';
            return (
              <tr key={r.id} style={struck ? { opacity: 0.6 } : undefined}>
                <td className="small">{shortDate(r.entry_date)}</td>
                <td>
                  <span className={r.isReversed ? 'strong' : 'strong'} style={r.isReversed ? { textDecoration: 'line-through' } : undefined}>
                    {KIND_LABEL[r.kind] || r.kind}
                    {r.method ? ` · ${METHOD_LABEL[r.method] || r.method}` : ''}
                  </span>
                  {r.note ? <span className="muted small" style={{ display: 'block' }}>{r.note}</span> : null}
                  {r.isReversed ? <span className="badge info" style={{ marginTop: 2 }}>İptal edildi</span> : null}
                </td>
                <td className="num">{amt > 0 ? tl(amt) : ''}</td>
                <td className="num">{amt < 0 ? tl(-amt) : ''}</td>
                <td className="num strong">{tl(r.running)}</td>
                <td className={`small ${r.due_date && r.due_date < today && amt > 0 && !struck ? 'warn-text' : ''}`}>
                  {r.due_date ? shortDate(r.due_date) : ''}
                </td>
                {onReverse ? (
                  <td>
                    {!struck ? (
                      <button type="button" className="btn small" disabled={busyId === r.id} onClick={() => onReverse(r)}>
                        {busyId === r.id ? '…' : 'İptal et'}
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
