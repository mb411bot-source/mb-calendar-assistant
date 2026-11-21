import { cookies } from 'next/headers';
import { GALLERY_URL, groupByDay, hasAccess, listPhotos, photosPassword } from '../../lib/photos';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'MB Kindergarten Photos',
  description: 'Class photos from the kindergarten, by week.',
  robots: { index: false, follow: false }
};

const css = `
:root {
  --bg: #f6f3ee; --card: #ffffff; --ink: #1f2328; --muted: #6b6f76; --line: #e6e1d8;
  --accent: #8a1c2b; --accent-soft: #f6e4e6;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14161a; --card: #1d2026; --ink: #eceef1; --muted: #9aa0a8; --line: #2c3038;
    --accent: #e0707f; --accent-soft: #3a1f25;
  }
}
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--ink); }
.wrap { max-width: 1200px; margin: 0 auto; padding: 20px 16px 40px; }
h1 { font-size: clamp(24px, 4vw, 34px); margin: 0 0 4px; letter-spacing: -0.01em; }
.sub { color: var(--muted); margin: 0 0 20px; font-size: 15px; line-height: 1.45; }
.sub a { color: inherit; }
.day { background: var(--card); border: 1px solid var(--line); border-radius: 16px; margin-bottom: 14px; }
.day > summary { list-style: none; cursor: pointer; padding: 14px 16px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
.day > summary::-webkit-details-marker { display: none; }
.day > summary::before { content: '▸'; color: var(--muted); transition: transform .15s; }
.day[open] > summary::before { transform: rotate(90deg); }
.when { font-size: 18px; font-weight: 700; }
.count { color: var(--muted); font-size: 15px; }
.new { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--accent); background: var(--accent-soft); padding: 3px 8px; border-radius: 999px; }
.zip { margin-left: auto; text-decoration: none; background: var(--ink); color: var(--bg); padding: 8px 14px; border-radius: 999px; font-size: 14px; font-weight: 600; white-space: nowrap; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; padding: 0 12px 14px; }
@media (max-width: 520px) { .grid { grid-template-columns: repeat(3, 1fr); gap: 4px; padding: 0 8px 10px; } .zip { margin-left: 0; } }
.grid a { display: block; aspect-ratio: 1; border-radius: 8px; overflow: hidden; background: var(--line); }
.grid img { width: 100%; height: 100%; object-fit: cover; display: block; }
form { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 20px; max-width: 420px; display: flex; flex-direction: column; gap: 12px; }
input { font-size: 17px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); }
button { font-size: 16px; font-weight: 600; padding: 10px 14px; border-radius: 999px; border: 0; background: var(--ink); color: var(--bg); cursor: pointer; }
.err { color: var(--accent); margin: 0; }
`;

function dayLabel(day) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric'
  });
}

function Shell({ children }) {
  return (
    <main className="wrap">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <h1>📸 Kindergarten photos</h1>
      {children}
    </main>
  );
}

function Login({ wrong }) {
  return (
    <Shell>
      <p className="sub">Class photos from Ella's gallery. Use the same password as the PhotoShelter gallery.</p>
      <form method="post" action="/api/photos/login">
        <input type="password" name="password" placeholder="Gallery password" autoComplete="current-password" required autoFocus />
        {wrong ? <p className="err">That password didn't work. Try again.</p> : null}
        <button type="submit">See photos</button>
      </form>
    </Shell>
  );
}

export default async function PhotosPage({ searchParams }) {
  if (!photosPassword()) {
    return <Shell><p className="sub">The photo page isn't set up yet (no gallery password configured).</p></Shell>;
  }
  if (!hasAccess(cookies().get('mb411_photos')?.value)) {
    return <Login wrong={searchParams?.wrong === '1'} />;
  }

  let days;
  try {
    days = groupByDay(await listPhotos());
  } catch (err) {
    return (
      <Shell>
        <p className="sub">
          Couldn't load the gallery right now ({err.message}). You can still open it on{' '}
          <a href={GALLERY_URL}>PhotoShelter</a>.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="sub">
        Newest first, grouped by the day the photos were posted. Tap a photo to download it full size,
        or use “Download all” for the whole day as a zip. Also on <a href={GALLERY_URL}>PhotoShelter</a>.
      </p>
      {days.map(({ day, photos }, i) => (
        <details className="day" key={day} open={i === 0}>
          <summary>
            <span className="when">{dayLabel(day)}</span>
            <span className="count">{photos.length} photo{photos.length === 1 ? '' : 's'}</span>
            {i === 0 ? <span className="new">Latest</span> : null}
            <a className="zip" href={`/api/photos/download?day=${day}`}>Download all</a>
          </summary>
          <div className="grid">
            {photos.map((p) => (
              <a key={p.id} href={`/api/photos/download?id=${p.id}`} title={p.name}>
                <img src={p.thumb} alt="" loading="lazy" decoding="async" />
              </a>
            ))}
          </div>
        </details>
      ))}
      {days.length === 0 ? <p className="sub">No photos yet.</p> : null}
    </Shell>
  );
}
