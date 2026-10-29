'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const WEEKDAYS = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'];
const KIND_LABEL = { resmi: 'Resmi tatil', dini: 'Dini gün', ozel: 'Özel gün', alisveris: 'Alışveriş dönemi' };

function ymd(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function parse(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function whenLabel(diff) {
  if (diff < 0) return 'şu an devam ediyor';
  if (diff === 0) return 'bugün';
  if (diff === 1) return 'yarın';
  return `${diff} gün sonra`;
}

/**
 * Küçük aylık takvim + yaklaşan önemli günler.
 * Önemli bir gün 3 gün kala (ya da başladıysa bitene kadar) vurgulu uyarı olarak gösterilir.
 * compact=true: yalnızca yaklaşan (3 gün) uyarıları ve bir sonraki gün; ay ızgarası yok.
 */
export default function MiniCalendar({ compact = false, warnDays = 3 }) {
  const [days, setDays] = useState(null);
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [picked, setPicked] = useState(null);

  const today = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);

  useEffect(() => {
    let cancelled = false;
    const from = new Date(today);
    from.setDate(from.getDate() - 7);
    supabase
      .from('special_days')
      .select('id, day, end_day, name, kind, note')
      .gte('day', ymd(from))
      .order('day', { ascending: true })
      .limit(60)
      .then(({ data }) => {
        if (!cancelled) setDays(data || []);
      });
    return () => {
      cancelled = true;
    };
  }, [today]);

  const events = useMemo(
    () =>
      (days || []).map((d) => ({
        ...d,
        start: parse(d.day),
        end: parse(d.end_day || d.day),
      })),
    [days]
  );

  // Devam eden ya da warnDays içinde başlayacak günler
  const soon = events
    .filter((e) => e.end >= today && daysBetween(today, e.start) <= warnDays)
    .sort((a, b) => a.start - b.start);
  const next = events.filter((e) => daysBetween(today, e.start) > warnDays).slice(0, compact ? 1 : 3);

  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // pazartesi başlangıç
  const count = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= count; d++) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));

  function eventsOn(date) {
    return events.filter((e) => date >= e.start && date <= e.end);
  }

  const pickedEvents = picked ? eventsOn(picked) : [];

  return (
    <section className="card cal" aria-label="Önemli günler takvimi">
      <h2>Önemli günler</h2>

      {days === null ? <p className="muted small">Yükleniyor…</p> : null}

      {days !== null && soon.length ? (
        <div className="cal-soon">
          {soon.map((e) => {
            const diff = daysBetween(today, e.start);
            return (
              <div key={e.id} className="cal-alert">
                <span className="strong">{e.name}</span>
                <span className="small">{whenLabel(diff)}{e.end > e.start ? ` · ${e.start.getDate()}–${e.end.getDate()} ${MONTHS[e.end.getMonth()]}` : ''}</span>
                {e.note ? <span className="small">{e.note}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {days !== null && !soon.length ? (
        <p className="muted small">Önümüzdeki {warnDays} gün içinde önemli bir gün yok.</p>
      ) : null}

      {!compact ? (
        <>
          <div className="cal-head">
            <button className="cal-nav" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} aria-label="Önceki ay">‹</button>
            <span className="strong">{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</span>
            <button className="cal-nav" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} aria-label="Sonraki ay">›</button>
          </div>
          <div className="cal-grid" role="grid">
            {WEEKDAYS.map((w) => (
              <span key={w} className="cal-wd" role="columnheader">{w}</span>
            ))}
            {cells.map((date, i) => {
              if (!date) return <span key={`e${i}`} />;
              const ev = eventsOn(date);
              const isToday = date.getTime() === today.getTime();
              const isPicked = picked && date.getTime() === picked.getTime();
              const urgent = ev.length && daysBetween(today, date) >= 0 && daysBetween(today, date) <= warnDays;
              return (
                <button
                  key={date.getTime()}
                  type="button"
                  className={`cal-day ${isToday ? 'today' : ''} ${ev.length ? 'has' : ''} ${urgent ? 'urgent' : ''} ${isPicked ? 'picked' : ''}`}
                  onClick={() => setPicked(ev.length ? date : null)}
                  aria-label={`${date.getDate()} ${MONTHS[date.getMonth()]}${ev.length ? ': ' + ev.map((e) => e.name).join(', ') : ''}`}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          {pickedEvents.length ? (
            <div className="cal-pick">
              {pickedEvents.map((e) => (
                <div key={e.id}>
                  <span className="strong">{e.name}</span> <span className="muted small">· {KIND_LABEL[e.kind]}</span>
                  {e.note ? <div className="small muted">{e.note}</div> : null}
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {next.length ? (
        <div className="cal-next">
          <span className="muted small">Sıradaki</span>
          {next.map((e) => (
            <div key={e.id} className="cal-next-row">
              <span>{e.name}</span>
              <span className="muted small">{e.start.getDate()} {MONTHS[e.start.getMonth()]} · {daysBetween(today, e.start)} gün</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
