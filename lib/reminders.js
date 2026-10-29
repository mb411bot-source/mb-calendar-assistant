// WhatsApp reminder messages for MB411. Make calls /api/reminders on a schedule and
// sends whatever text comes back. Nothing here sends messages itself or calls the AI.
//
// To change which events count as worth a reminder, edit the word lists below.

import { addDays, loadSchoolCalendar, todayInEastern } from './schoolWeek';

// Always worth knowing about: school closures and unusual school days.
const CLOSURE = /no school|school (and offices )?closed|school closed|in-service/i;
const SPECIAL_DAY = /early dismissal|half[- ]day|noon dismissal|last day of classes|classes resume|first day of (school|classes)|last day of school/i;

// Kindergarten events are always included (unless they are about another grade too).
const KINDERGARTEN = /kindergarten|\bK\b|early childhood/i;

// Fun, whole-school or Lower School events a kindergarten family would go to or prepare for.
const FUN = new RegExp(
  [
    'picture', 'photo', 'retake', 'pumpkin', 'halloween', 'parade', 'costume', 'polar bear',
    'shuffle', 'walk to school', 'art show', 'holiday sing', '\\bsing\\b', 'concert', 'ensembles?',
    'play party', 'field day', 'book fair', 'spirit day', 'pajama', 'dress[- ]?down', 'grandparent',
    'special friends', 'expo', 'homecoming', '\\bfair\\b', 'festival', '\\bfest\\b', 'carnival',
    'potluck', 'celebration', 'assembly', 'performance', 'picnic', 'harvest'
  ].join('|'),
  'i'
);

// Events for other grades or divisions, unless they also mention Lower School / kindergarten.
const OTHER_GRADE =
  /\b(1st|2nd|3rd|4th|5th|6th|7th|8th|first|second|third|fourth|fifth|sixth|seventh|eighth)\s+grade\b|\bgrade\s*\d|pre-?primary|\bPP\b|pre-?k\b|nursery|\bupper school\b|varsity|\bJV\b/i;
const LOWER_SCHOOL = /lower school|\bLS\b|all[- ]school|kindergarten|early childhood/i;

// Adult meetings and admin items: skip even if a fun word appears.
const NOT_FOR_US = /meeting|webinar|book club|committee|reception|audition|camp\b|tour\b|stewarding|\brep\b|info session|admission/i;

export function isNotable(title) {
  if (CLOSURE.test(title) || SPECIAL_DAY.test(title)) return true;
  const otherGradeOnly = OTHER_GRADE.test(title) && !LOWER_SCHOOL.test(title);
  if (otherGradeOnly) return false;
  if (KINDERGARTEN.test(title)) return true;
  if (NOT_FOR_US.test(title)) return false;
  return FUN.test(title);
}

const TZ_DATE = (iso, opts) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(`${iso}T12:00:00Z`));
const longDate = (iso) => TZ_DATE(iso, { weekday: 'long', month: 'long', day: 'numeric' });
const shortDate = (iso) => TZ_DATE(iso, { weekday: 'short', month: 'short', day: 'numeric' });

// Calendar titles sometimes have stray spaces or words in capitals ("VETERANS DAY").
// Capitalised words of 3+ letters become Title Case; short ones like LS or PP stay.
const tidyTitle = (t) =>
  t
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b([A-Z])([A-Z’']{2,})\b/g, (m, first, rest) => first + rest.toLowerCase());

// Same-title all-day events on back-to-back days (e.g. a break entered day by day)
// become one event with a date range.
function mergeRuns(events) {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const out = [];
  for (const e of sorted) {
    const prev = out.find((p) => p.isAllDay && e.isAllDay && p.title.toLowerCase() === e.title.toLowerCase() && e.date <= addDays(p.lastDate, 1) && e.date >= p.date);
    if (prev) {
      if (e.lastDate > prev.lastDate) prev.lastDate = e.lastDate;
      continue;
    }
    out.push({ ...e });
  }
  return out;
}

function describe(e, { withDate = false } = {}) {
  const parts = [];
  if (withDate) {
    parts.push(e.lastDate > e.date ? `${shortDate(e.date)} – ${shortDate(e.lastDate)}` : shortDate(e.date));
  }
  let line = tidyTitle(e.title);
  if (!e.isAllDay && e.time) line += ` (${e.time}${e.location ? `, ${e.location}` : ''})`;
  else if (e.lastDate > e.date && !withDate) line += ` (through ${longDate(e.lastDate)})`;
  parts.push(line);
  return parts.join(': ');
}

const emoji = (title) => (CLOSURE.test(title) ? '🚫' : /picture|photo|retake/i.test(title) ? '📸' : SPECIAL_DAY.test(title) ? '⏰' : '🎉');

function notableEvents(schoolEvents) {
  const events = mergeRuns(schoolEvents.filter((e) => isNotable(e.title)));
  // A closure that falls entirely inside a longer closure (an in-service day during
  // Thanksgiving break, New Year's Day during winter break) adds nothing, so drop it.
  return events.filter(
    (e) =>
      !CLOSURE.test(e.title) ||
      !events.some(
        (o) => o !== e && CLOSURE.test(o.title) && o.date <= e.date && o.lastDate >= e.lastDate &&
          (o.lastDate > e.lastDate || o.date < e.date)
      )
  );
}

const dayOff = (events, iso) => events.some((e) => CLOSURE.test(e.title) && e.date <= iso && iso <= e.lastDate);

// 7 AM: only on a share day (Day 4) that is a school day.
export function shareDayMessage({ schoolEvents, rotation }, todayIso) {
  const today = rotation.find((r) => r.date === todayIso);
  if (!today || today.rotatingDay !== 'Day 4' || dayOff(schoolEvents, todayIso)) {
    return { send: false, reason: `Today (${todayIso}) is ${today?.rotatingDay || 'not a rotation day'}` };
  }
  return {
    send: true,
    text: `⭐ *Share day today!*\n\nToday, ${longDate(todayIso)}, is Day 4 (Meeting for Sharing). Don't forget the share item.`
  };
}

// 5 PM: notable events starting tomorrow (multi-day events only on their first day).
export function tomorrowMessage({ schoolEvents }, todayIso) {
  const tomorrow = addDays(todayIso, 1);
  const events = notableEvents(schoolEvents).filter((e) => e.date === tomorrow);
  if (events.length === 0) return { send: false, reason: `Nothing notable on ${tomorrow}` };
  const lines = events.map((e) => `${emoji(e.title)} ${describe(e)}`);
  return {
    send: true,
    text: `📅 *Tomorrow at MB* (${longDate(tomorrow)})\n\n${lines.join('\n\n')}`
  };
}

// Messages put a blank line under the heading and between events, for easier reading on a phone.

// Sunday: notable events in the coming Monday-Sunday, plus that week's share days.
export function weekMessage({ schoolEvents, rotation }, todayIso) {
  const dow = new Date(`${todayIso}T12:00:00Z`).getUTCDay();
  const monday = dow === 1 ? todayIso : addDays(todayIso, (8 - dow) % 7 || 7);
  const sunday = addDays(monday, 6);
  const events = notableEvents(schoolEvents).filter((e) => e.date <= sunday && e.lastDate >= monday);
  const shareDays = rotation
    .filter((r) => r.rotatingDay === 'Day 4' && r.date >= monday && r.date <= sunday && !dayOff(schoolEvents, r.date))
    .map((r) => shortDate(r.date));

  const lines = events.map((e) => `${emoji(e.title)} ${describe({ ...e, date: e.date < monday ? monday : e.date }, { withDate: true })}`);
  if (shareDays.length) lines.push(`⭐ Share day: ${shareDays.join(', ')}`);
  if (lines.length === 0) lines.push('Nothing special on the school calendar this week.');

  return {
    send: true,
    text: `🗓️ *MB this week* (${TZ_DATE(monday, { month: 'short', day: 'numeric' })} – ${TZ_DATE(sunday, { month: 'short', day: 'numeric' })})\n\n${lines.join('\n\n')}`
  };
}

export async function buildReminder(type, todayIso = todayInEastern()) {
  const calendar = await loadSchoolCalendar();
  if (calendar.errors.length && calendar.schoolEvents.length === 0 && calendar.rotation.length === 0) {
    return { send: false, reason: `Calendar unavailable: ${calendar.errors.join('; ')}` };
  }
  if (type === 'share') return shareDayMessage(calendar, todayIso);
  if (type === 'tomorrow') return tomorrowMessage(calendar, todayIso);
  if (type === 'week') return weekMessage(calendar, todayIso);
  if (type === 'preview') {
    // For checking the filter: every notable event in the next 120 days.
    const end = addDays(todayIso, 120);
    const kept = notableEvents(calendar.schoolEvents).filter((e) => e.lastDate >= todayIso && e.date <= end);
    return { send: false, text: kept.map((e) => describe(e, { withDate: true })).join('\n') };
  }
  return { send: false, reason: `Unknown type "${type}"` };
}
