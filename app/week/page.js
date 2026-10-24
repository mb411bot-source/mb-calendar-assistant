import { notFound } from 'next/navigation';
import { getWeek } from '../../lib/schoolWeek';
import AutoRefresh from './AutoRefresh';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'MB Kindergarten Week',
  description: 'This week at Moses Brown: rotation days, specials and school events.'
};

const SPECIAL_ICONS = {
  Art: '🎨',
  Library: '📚',
  PE: '👟',
  Music: '🎵',
  Shop: '🔨',
  Tech: '💻',
  Spanish: '💬',
  Science: '🔬',
  'Community Time': '🤝',
  'Meeting for Business': '🗂️'
};

// Events most likely to matter to a kindergarten family are listed first.
const PRIORITY = /kindergarten|\bK\b|lower school|\bLS\b|all[- ]school|no school|closed|early dismissal|break|recess/i;
const MAX_EVENTS = 4;

const css = `
:root {
  --bg: #f6f3ee; --card: #ffffff; --ink: #1f2328; --muted: #6b6f76; --line: #e6e1d8;
  --accent: #8a1c2b; --accent-soft: #f6e4e6; --today: #1f5f8b; --today-soft: #e3eef6;
  --closed: #9a6700; --closed-soft: #fff4d6; --share: #6a3fb5; --share-soft: #efe8fb;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14161a; --card: #1d2026; --ink: #eceef1; --muted: #9aa0a8; --line: #2c3038;
    --accent: #e0707f; --accent-soft: #3a1f25; --today: #7ab8e6; --today-soft: #1b2c3a;
    --closed: #e3b341; --closed-soft: #3a2f12; --share: #b99bf0; --share-soft: #2b2340;
  }
}
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--ink); }
.wrap { max-width: 1400px; margin: 0 auto; padding: 20px 16px 28px; }
header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
h1 { font-size: clamp(22px, 3vw, 34px); margin: 0; letter-spacing: -0.01em; }
h1 span { color: var(--muted); font-weight: 500; }
.tabs { display: flex; gap: 6px; }
.tabs a { text-decoration: none; color: var(--muted); border: 1px solid var(--line); padding: 7px 14px; border-radius: 999px; font-size: 15px; }
.tabs a.on { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
.day { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 16px; display: flex; flex-direction: column; gap: 12px; min-height: 260px; }
.day.today { border: 2px solid var(--today); box-shadow: 0 0 0 4px var(--today-soft); }
.day.past { opacity: 0.55; }
.day.closed { background: var(--closed-soft); }
.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.wd { font-size: 20px; font-weight: 700; }
.dt { color: var(--muted); font-size: 15px; }
.pill { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--today); background: var(--today-soft); padding: 4px 8px; border-radius: 999px; white-space: nowrap; }
.num { font-size: clamp(44px, 5vw, 64px); font-weight: 800; line-height: 1; color: var(--accent); }
.num small { font-size: 0.32em; font-weight: 700; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; margin-right: 6px; }
.badge { align-self: flex-start; font-weight: 700; font-size: 15px; padding: 6px 10px; border-radius: 10px; }
.badge.share { color: var(--share); background: var(--share-soft); }
.badge.closed { color: var(--closed); background: transparent; border: 1px solid var(--closed); }
.specials { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font-size: 15px; padding: 5px 9px; border-radius: 10px; background: var(--accent-soft); }
.none { color: var(--muted); font-size: 15px; }
.events { list-style: none; margin: 0; padding: 12px 0 0; border-top: 1px dashed var(--line); display: flex; flex-direction: column; gap: 8px; margin-top: auto; }
.events li { font-size: 14px; line-height: 1.3; }
.events .t { color: var(--muted); font-size: 13px; display: block; }
.events .closure { font-weight: 700; color: var(--closed); }
.more { color: var(--muted); font-size: 13px; }
footer { margin-top: 18px; color: var(--muted); font-size: 13px; display: flex; flex-wrap: wrap; gap: 6px 16px; }
.warn { color: var(--closed); }
`;

function rangeLabel(days) {
  const first = days[0];
  const last = days[days.length - 1];
  const month = (d) => d.dateLabel.split(' ')[0];
  return month(first) === month(last)
    ? `${first.dateLabel} – ${last.dateLabel.split(' ')[1]}`
    : `${first.dateLabel} – ${last.dateLabel}`;
}

function DayCard({ day }) {
  const events = [...day.events].sort((a, b) => Number(PRIORITY.test(b.title)) - Number(PRIORITY.test(a.title)));
  const shown = events.slice(0, MAX_EVENTS);
  const hidden = events.length - shown.length;
  const classes = ['day', day.isToday && 'today', day.isPast && 'past', day.closed && 'closed'].filter(Boolean).join(' ');

  return (
    <section className={classes}>
      <div className="top">
        <div>
          <div className="wd">{day.weekday}</div>
          <div className="dt">{day.dateLabel}</div>
        </div>
        {day.isToday && <span className="pill">Today</span>}
      </div>

      {day.closed ? (
        <span className="badge closed">No school</span>
      ) : day.rotatingDay ? (
        <>
          <div className="num">
            <small>Day</small>
            {day.rotatingDay.replace('Day ', '')}
          </div>
          {day.isShareDay && <span className="badge share">⭐ Share day</span>}
          {day.specials.length > 0 && (
            <div className="specials">
              {day.specials.map((s) => (
                <span className="chip" key={s}>
                  {SPECIAL_ICONS[s] ? `${SPECIAL_ICONS[s]} ` : ''}
                  {s}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <span className="none">No rotation day listed</span>
      )}

      {shown.length > 0 && (
        <ul className="events">
          {shown.map((e, i) => (
            <li key={i}>
              <span className="t">{e.time}</span>
              <span className={e.closure ? 'closure' : ''}>{e.title}</span>
            </li>
          ))}
          {hidden > 0 && <li className="more">+ {hidden} more</li>}
        </ul>
      )}
    </section>
  );
}

export default async function WeekPage({ searchParams }) {
  // Optional privacy: if WEEK_PAGE_KEY is set in Vercel, the page needs ?k=<that key>.
  const requiredKey = process.env.WEEK_PAGE_KEY;
  const key = searchParams?.k || '';
  if (requiredKey && key !== requiredKey) notFound();

  const isNext = searchParams?.w === 'next';
  const { days, errors } = await getWeek(isNext ? 1 : 0);
  const keyParam = key ? `k=${encodeURIComponent(key)}` : '';
  const thisHref = `/week${keyParam ? `?${keyParam}` : ''}`;
  const nextHref = `/week?w=next${keyParam ? `&${keyParam}` : ''}`;
  const updated = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date());

  return (
    <div className="wrap">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <AutoRefresh minutes={30} />
      <header>
        <h1>
          Kindergarten week <span>· {rangeLabel(days)}</span>
        </h1>
        <nav className="tabs">
          <a href={thisHref} className={isNext ? '' : 'on'}>
            This week
          </a>
          <a href={nextHref} className={isNext ? 'on' : ''}>
            Next week
          </a>
        </nav>
      </header>

      <main className="grid">
        {days.map((day) => (
          <DayCard key={day.iso} day={day} />
        ))}
      </main>

      <footer>
        <span>Updated {updated}</span>
        <span>Unofficial · from the Moses Brown school calendar</span>
        {errors.length > 0 && <span className="warn">Some calendar info couldn’t be loaded just now.</span>}
      </footer>
    </div>
  );
}
