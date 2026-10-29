// Calendar data for the /week page.
//
// This is a standalone copy of the feed-reading logic in app/api/*/route.js, kept
// separate on purpose so the week page can be changed without touching the Alexa skill
// or the chat bots. It never calls the AI.

import ical from 'node-ical';
import { recurringEventsFor } from './recurringEvents';

const FEEDS = [
  {
    name: 'School Events',
    url: 'https://mosesbrown.myschoolapp.com/podium/feed/iCal.aspx?z=E1N%2bZECWAsAfUGqeWaJ4wnh22O7R2ayGHKshoyBZzraNcPRLE4U8KT9k2M0zhuH2P9%2bDbSna%2foN60549yOti3A%3d%3d'
  },
  {
    name: 'School Events 2',
    url: 'https://mosesbrown.myschoolapp.com/podium/feed/iCal.aspx?z=Rqm3n0%2fQWNXMEzr%2fwnqblb7%2fxmkVj0jo6VXZllLKMPMuGj%2bhS7ogeDgxFqXuX7EaViX6SpZXpUC2QbIvm8CY2w%3d%3d'
  },
  {
    name: 'Rotating Schedule',
    url: 'https://mosesbrown.myschoolapp.com/podium/feed/iCal.aspx?z=KlHNKuuxoXtfzbPFgqNMvxUHicqnjIZL7PNpZ1LKKngZk1Kv6n9LDT%2bnqwQ3TAVKwNBhWCaTgBrM%2b8TVGnztew%3d%3d'
  }
];

// Re-read the school's feeds at most every 15 minutes.
const FEED_REVALIDATE_SECONDS = 15 * 60;

export const KINDERGARTEN_SUBJECTS = {
  'Day 1': ['Art', 'English Language Arts', 'Math', 'Library', 'PE'],
  'Day 2': ['Math', 'Shop', 'Social Studies', 'PE', 'Reading Groups', 'Science', 'Music'],
  'Day 3': ['Math', 'Social Studies', 'Community Time', 'PE', 'Art', 'English Language Arts'],
  'Day 4': ['English Language Arts', 'Tech', 'Science', 'Social Studies', 'Music', 'Math', 'Meeting for Sharing'],
  'Day 5': ['English Language Arts', 'Art', 'Math', 'Social Studies', 'Library', 'Spanish'],
  'Day 6': ['Tech', 'Math', 'Reading Groups', 'PE', 'Social Studies', 'Music', 'Art', 'English Language Arts'],
  'Day 7': ['Math', 'Meeting for Business', 'PE', 'Library', 'Social Studies', 'English Language Arts', 'Spanish']
};

// Everyday classes are left off the cards so the specials stand out.
const EVERYDAY_SUBJECTS = new Set(['Math', 'English Language Arts', 'Social Studies', 'Reading Groups']);

const CLOSURE_PATTERN =
  /no school|school (is )?closed|offices? closed|\b(winter|spring|thanksgiving|fall|mid-winter|holiday) (break|recess|weekend|vacation)\b|\bbreak\b|\brecess\b/i;
// School-day events that mention a break ("Last Day of Classes before Break") are not closures.
const NOT_CLOSURE = /last day of classes|before break|classes resume|first day/i;

const TZ = 'America/New_York';

const isoInEastern = (d) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

const formatTime = (d) =>
  new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);

// All-day events arrive as midnight UTC; timed events need converting to Eastern.
const eventIsoDate = (value, isAllDay) => {
  const d = new Date(value);
  return isAllDay ? d.toISOString().slice(0, 10) : isoInEastern(d);
};

// Adds whole days to a YYYY-MM-DD string.
export const addDays = (iso, days) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
};

const weekdayIndex = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = Sunday

function cleanEvents(rawEvents) {
  return rawEvents
    .filter((e) => e && e.type === 'VEVENT' && e.start)
    .map((e) => {
      const isAllDay = e.datetype === 'date';
      const start = new Date(e.start);
      const end = e.end ? new Date(e.end) : null;
      const date = eventIsoDate(e.start, isAllDay);
      let lastDate = date;
      if (end) {
        // An all-day event's end date is the day after it finishes.
        lastDate = isAllDay ? addDays(eventIsoDate(e.end, true), -1) : isoInEastern(end);
        if (lastDate < date) lastDate = date;
      }
      let time = 'All day';
      if (!isAllDay) {
        time = end && end > start ? `${formatTime(start)} – ${formatTime(end)}` : formatTime(start);
      }
      const title = (e.summary || '').trim();
      const dayNumber = title.match(/\bDay\s+([1-7])\b/i)?.[1];
      return {
        title,
        date,
        lastDate,
        time,
        isAllDay,
        location: (e.location || '').trim(),
        rotatingDay: dayNumber ? `Day ${dayNumber}` : ''
      };
    });
}

async function loadFeed(feed) {
  const res = await fetch(feed.url, {
    next: { revalidate: FEED_REVALIDATE_SECONDS },
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`${feed.name}: HTTP ${res.status}`);
  const parsed = await ical.async.parseICS(await res.text());
  return cleanEvents(Object.values(parsed));
}

// For ordering a day's events: all-day first, then by start time ("8:15 AM – 9:00 AM" → 495).
function startMinutes(time) {
  const m = String(time).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return -1;
  return ((Number(m[1]) % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0)) * 60 + Number(m[2]);
}

// The Monday of the week to show. On weekends that is the coming week.
export function weekStartFor(todayIso, offsetWeeks = 0) {
  const dow = weekdayIndex(todayIso);
  const monday = dow === 0 ? addDays(todayIso, 1) : dow === 6 ? addDays(todayIso, 2) : addDays(todayIso, 1 - dow);
  return addDays(monday, offsetWeeks * 7);
}

// Turns cleaned feed events into five day cards. Exported separately so it can be
// tested without the network.
export function buildWeek({ schoolEvents, rotation, mondayIso, todayIso }) {
  const days = [];
  for (let i = 0; i < 5; i++) {
    const iso = addDays(mondayIso, i);
    const rotatingDay = rotation.find((r) => r.date === iso)?.rotatingDay || '';
    const subjects = KINDERGARTEN_SUBJECTS[rotatingDay] || [];
    const events = schoolEvents
      .filter((e) => e.date <= iso && iso <= e.lastDate)
      .map((e) => ({
        title: e.title,
        time: e.isAllDay ? 'All day' : e.date === iso ? e.time : 'Continues',
        location: e.location,
        multiDay: e.lastDate > e.date,
        closure: CLOSURE_PATTERN.test(e.title) && !NOT_CLOSURE.test(e.title)
      }))
      .sort((a, b) => startMinutes(a.time) - startMinutes(b.time));
    days.push({
      iso,
      weekday: new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(new Date(`${iso}T12:00:00Z`)),
      dateLabel: new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${iso}T12:00:00Z`)),
      isToday: iso === todayIso,
      isPast: iso < todayIso,
      rotatingDay,
      specials: subjects.filter((s) => !EVERYDAY_SUBJECTS.has(s) && s !== 'Meeting for Sharing'),
      isShareDay: subjects.includes('Meeting for Sharing'),
      closed: events.some((e) => e.closure),
      events
    });
  }
  return days;
}

export const todayInEastern = () => isoInEastern(new Date());

export async function getWeek(offsetWeeks = 0) {
  const todayIso = isoInEastern(new Date());
  const mondayIso = weekStartFor(todayIso, offsetWeeks);
  const { schoolEvents, rotation, errors } = await loadSchoolCalendar();
  return {
    todayIso,
    mondayIso,
    days: buildWeek({ schoolEvents, rotation, mondayIso, todayIso }),
    errors
  };
}

// Reads all three school feeds. schoolEvents: the two event feeds, de-duplicated.
// rotation: the Day 1-7 entries from the rotating schedule feed.
export async function loadSchoolCalendar() {
  const results = await Promise.allSettled(FEEDS.map(loadFeed));
  const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message || 'feed error');
  const [events1, events2, rotationEvents] = results.map((r) => (r.status === 'fulfilled' ? r.value : []));

  // The two event feeds overlap, so drop exact repeats.
  const seen = new Set();
  const schoolEvents = [...events1, ...events2].filter((e) => {
    const key = `${e.title.toLowerCase()}|${e.date}|${e.time}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const rotation = rotationEvents.filter((e) => e.rotatingDay);

  // Standing events that aren't on the school's feeds (lib/recurringEvents.js), added on school days.
  const weeklyEvents = recurringEventsFor(rotation.map((r) => r.date), schoolEvents).map((e) => ({
    ...e,
    lastDate: e.date,
    isAllDay: false,
    rotatingDay: ''
  }));

  return { schoolEvents: [...schoolEvents, ...weeklyEvents], rotation, errors };
}
