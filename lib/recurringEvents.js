// Standing school events that are not on the school's calendar feeds.
// They are added to the calendar data used by the Alexa skill, the web chat,
// the /week page and the reminders.
//
// weekday: 0 = Sunday, 1 = Monday, ... 6 = Saturday
// They are only added on school days (dates that have a Day 1-7 rotation entry),
// so they skip weekends, breaks and closures automatically.

export const RECURRING_EVENTS = [
  { title: 'Meeting for Worship', weekday: 3, time: '8:00 AM', location: '' }
];

const weekdayOf = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();

// schoolDayDates: YYYY-MM-DD strings for school days.
// existingEvents: events already on the calendar (anything with a `title` and `date`), so a
// date that already lists the same event is not given a second copy.
export function recurringEventsFor(schoolDayDates, existingEvents = []) {
  const out = [];
  const seen = new Set();
  for (const date of schoolDayDates) {
    for (const r of RECURRING_EVENTS) {
      if (weekdayOf(date) !== r.weekday) continue;
      const key = `${date}|${r.title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const needle = r.title.toLowerCase();
      const alreadyListed = existingEvents.some(
        (e) => e.date === date && String(e.title || '').toLowerCase().includes(needle)
      );
      if (!alreadyListed) out.push({ title: r.title, date, time: r.time, location: r.location });
    }
  }
  return out;
}
