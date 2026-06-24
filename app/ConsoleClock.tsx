'use client';

import { useEffect, useState } from 'react';
import { APP_TIMEZONE } from '@/lib/timezone';

const MONTHS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

/** Returns the wall-clock parts in the app timezone (GMT-3), independent of the runtime TZ. */
function partsInAppTz(d: Date) {
  // en-US + 24h gives stable, parseable fields we can re-label in pt-BR.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  // Intl can emit "24" for midnight hour in some engines; normalise.
  const hour = p.hour === '24' ? '00' : p.hour;
  return {
    day: p.day,
    month: MONTHS[Number(p.month) - 1],
    year: p.year,
    hour,
    minute: p.minute,
    second: p.second,
  };
}

export default function ConsoleClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Reserve the line during SSR/first paint so the header doesn't jump.
  if (!now) {
    return <span className="tabular-nums opacity-0">00 JAN 0000 · 00:00:00</span>;
  }

  const t = partsInAppTz(now);
  return (
    <span className="tabular-nums">
      {t.day} {t.month} {t.year}
      <span className="mx-1.5 text-current/40">·</span>
      {t.hour}:{t.minute}
      <span className="text-current/45">:{t.second}</span>
      <span className="ml-1.5 text-current/40">GMT-3</span>
    </span>
  );
}
