export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import ical from 'node-ical';
import { GoogleGenAI } from '@google/genai';

// 1. Moses Brown iCal Feeds
const FEEDS = [
  {
    name: 'Feed 1 (School Events)',
    url: 'https://mosesbrown.myschoolapp.com/podium/feed/iCal.aspx?z=E1N%2bZECWAsAfUGqeWaJ4wnh22O7R2ayGHKshoyBZzraNcPRLE4U8KT9k2M0zhuH2P9%2bDbSna%2foN60549yOti3A%3d%3d'
  },
  {
    name: 'Feed 2 (School Events 2)',
    url: 'https://mosesbrown.myschoolapp.com/podium/feed/iCal.aspx?z=Rqm3n0%2fQWNXMEzr%2fwnqblb7%2fxmkVj0jo6VXZllLKMPMuGj%2bhS7ogeDgxFqXuX7EaViX6SpZXpUC2QbIvm8CY2w%3d%3d'
  },
  {
    name: 'Feed 3 (Rotating Schedule)',
    url: 'https://mosesbrown.myschoolapp.com/podium/feed/iCal.aspx?z=KlHNKuuxoXtfzbPFgqNMvxUHicqnjIZL7PNpZ1LKKngZk1Kv6n9LDT%2bnqwQ3TAVKwNBhWCaTgBrM%2b8TVGnztew%3d%3d'
  }
];

// 2. Kindergarten Rotating Day Schedule Matrix
const kindergartenSubjects = {
  'Day 1': ['Art', 'ELA', 'Math', 'Library', 'PE'],
  'Day 2': ['Math', 'Shop', 'SS', 'PE', 'Reading Groups', 'Science', 'Music'],
  'Day 3': ['Math', 'SS', 'Community Time', 'PE', 'Art', 'ELA'],
  'Day 4': ['ELA', 'Tech', 'Science', 'SS', 'Music', 'Math', 'Meeting for Sharing'],
  'Day 5': ['ELA', 'Art', 'Math', 'SS', 'Library', 'Spanish'],
  'Day 6': ['Tech', 'Math', 'Reading Groups', 'PE', 'SS', 'Music', 'Art', 'ELA'],
  'Day 7': ['Math', 'Meeting for Business', 'PE', 'Library', 'SS', 'ELA', 'Spanish']
};

// Formatter Helpers
const formatDateEastern = (d) => {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(d);
};

const formatTimeEastern = (d) => {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(d);
};

// Accurate Eastern Date String: YYYY-MM-DD
const getEasternIsoDate = (d) => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(d));
};

const cleanCalendarEvents = (events) => {
  if (!Array.isArray(events)) return [];

  return events
    .filter((e) => e && e.type === 'VEVENT' && e.start)
    .map((event) => {
      const startDate = new Date(event.start);
      const endDate = event.end ? new Date(event.end) : null;

      const startIso = getEasternIsoDate(startDate);
      let formattedDateRange = formatDateEastern(startDate);

      const isAllDay = !event.start.getHours && !event.start.getMinutes;
      let timeString = 'All Day';

      if (!isAllDay && typeof event.start.getHours === 'function') {
        if (endDate && endDate > startDate) {
          timeString = `${formatTimeEastern(startDate)} – ${formatTimeEastern(endDate)}`;
        } else {
          timeString = formatTimeEastern(startDate);
        }
      }

      if (endDate && endDate > startDate) {
        // Only treat as multi-day if start date and inclusive end date differ in Eastern time
        const inclusiveEndDate = new Date(endDate.getTime() - 60000);
        const endIso = getEasternIsoDate(inclusiveEndDate);

        if (startIso !== endIso) {
          formattedDateRange = `${formatDateEastern(startDate)} through ${formatDateEastern(inclusiveEndDate)}`;
        } else {
          formattedDateRange = formatDateEastern(startDate);
        }
      }

      const title = (event.summary || '').trim();
      const rotatingDayMatch = title.match(/\bDay\s+([1-7])\b/i);

      return {
        title: title,
        rotatingDay: rotatingDayMatch ? `Day ${rotatingDayMatch[1]}` : '',
        dateRange: formattedDateRange,
        startIso: startIso,
        time: timeString,
        location: (event.location || '').trim(),
        description: (event.description || '').replace(/\s+/g, ' ').slice(0, 300)
      };
    });
};

const getEasternDate = (daysFromToday = 0) => {
  const now = new Date();
  const easternDateString = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);

  const [year, month, day] = easternDateString.split('-').map(Number);
  const targetDate = new Date(Date.UTC(year, month - 1, day + daysFromToday, 12));

  return {
    iso: targetDate.toISOString().slice(0, 10),
    weekday: new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long' }).format(targetDate),
    formatted: new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    }).format(targetDate)
  };
};

export async function POST(req) {
  try {
    const { question } = await req.json();

    if (!process.env.GEMINI_API_KEY) {
      return Response.json({
        answer: 'Configuration Error: GEMINI_API_KEY is missing in Vercel Environment Variables.'
      });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // Fetch and parse all 3 feeds
    const rawParsedFeeds = await Promise.all(
      FEEDS.map(async (feed) => {
        try {
          const res = await fetch(feed.url, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              Accept: 'text/calendar, text/plain, */*'
            },
            cache: 'no-store'
          });

          if (!res.ok) {
            console.error(`Feed fetch error: ${feed.name} returned status ${res.status}`);
            return { name: feed.name, status: res.status, events: [] };
          }

          const rawIcs = await res.text();
          const parsed = await ical.async.parseICS(rawIcs);
          const events = Object.values(parsed).filter((item) => item.type === 'VEVENT');
          return { name: feed.name, status: 200, events };
        } catch (err) {
          console.error(`Fetch failed for ${feed.name}:`, err);
          return { name: feed.name, status: 'error', error: err.message, events: [] };
        }
      })
    );

    const cleanCalendar1 = cleanCalendarEvents(rawParsedFeeds[0].events);
    const cleanCalendar2 = cleanCalendarEvents(rawParsedFeeds[1].events);
    const cleanCalendar3 = cleanCalendarEvents(rawParsedFeeds[2].events);

    // Merge School Events (Cal 1 & 2)
    const schoolEventsMap = new Map();
    [...cleanCalendar1, ...cleanCalendar2].forEach((ev) => {
      const key = `${ev.title}|${ev.startIso}`;
      if (!schoolEventsMap.has(key)) {
        schoolEventsMap.set(key, ev);
      }
    });
    const schoolEvents = Array.from(schoolEventsMap.values()).sort((a, b) =>
      a.startIso.localeCompare(b.startIso)
    );

    // Rotating Day Schedule (Cal 3)
    const kindergartenUpcomingSchedule = cleanCalendar3
      .filter((event) => event.rotatingDay)
      .map((event) => {
        const [year, month, day] = event.startIso.split('-').map(Number);
        const localNoon = new Date(Date.UTC(year, month - 1, day, 16));
        return {
          date: formatDateEastern(localNoon),
          isoDate: event.startIso,
          rotatingDay: event.rotatingDay,
          subjects: kindergartenSubjects[event.rotatingDay] || []
        };
      })
      .sort((a, b) => a.isoDate.localeCompare(b.isoDate));

    const schoolDaySchedule = kindergartenUpcomingSchedule.map((event) => ({
      date: event.isoDate,
      formattedDate: event.date,
      day: event.rotatingDay,
      kindergartenSubjects: event.subjects
    }));

    const todayEastern = getEasternDate(0);
    const tomorrowEastern = getEasternDate(1);
    const next7Days = Array.from({ length: 7 }, (_, i) => getEasternDate(i));

    // Ground truth check for Today:
    const isWeekendToday = todayEastern.weekday === 'Saturday' || todayEastern.weekday === 'Sunday';
    const closuresToday = schoolEvents.filter(
      (e) =>
        e.startIso === todayEastern.iso &&
        /\b(no school|closed|holiday|break|in-service|vacation)\b/i.test(e.title)
    );
    const rotatingScheduleToday = schoolDaySchedule.find((s) => s.date === todayEastern.iso);

    const todayStatusInfo = {
      date: todayEastern.formatted,
      weekday: todayEastern.weekday,
      isWeekend: isWeekendToday,
      isSchoolInSession: !isWeekendToday && closuresToday.length === 0,
      closures: closuresToday.map((c) => c.title),
      rotatingDay: rotatingScheduleToday?.day || 'No rotating day scheduled',
      kindergartenSubjects: rotatingScheduleToday?.kindergartenSubjects || []
    };

const systemPrompt = `You are MB411, an unofficial parent-maintained information assistant for Moses Brown School. You are not affiliated with or endorsed by Moses Brown School.

CRITICAL INSTRUCTIONS & STRICT PARENT ASSISTANT RULES:

1. SOURCE OF TRUTH:
- Answer the parent's question ONLY using the School Calendar Events, CLEAN SCHOOL DAY SCHEDULE, TODAY GROUND TRUTH STATUS, and Kindergarten Rotating Day Subjects provided to you.
- Never invent, extrapolate, or assume school information.
- If the requested information genuinely does not exist anywhere in the provided calendar or schedule data, say exactly:
"I couldn't find that in the school information I have. Please check the latest official Moses Brown communication."

2. TIMEZONE & RELATIVE DATES:
- Local timezone is America/New_York.
- Correctly interpret relative dates (today, tomorrow, this week, next week, upcoming months).
- Friday is a standard weekday, never a weekend day.

3. SCHOOL OPEN / CLOSURE DETERMINATION RULES:
- When a parent asks "is there school today", "is school open tomorrow", or asks about a specific date:
  a. Consult TODAY GROUND TRUTH STATUS for today's status.
  b. For other dates: Weekends (Saturday and Sunday) have no regular school.
  c. For weekdays (Monday through Friday): Check SCHOOL CALENDAR EVENTS for explicit closure terms ("No School", "Closed", "In-Service", "Holiday", "Break", "Vacation"). If present, report school is closed and name the reason.
  d. If it is a weekday, no closure events exist on the calendar, and/or a rotating Day (Day 1–7) is scheduled, state clearly that school is in session. Never claim school is closed simply because there isn't a calendar event explicitly titled "School Open".

4. ROTATING DAY SCHEDULE & KINDERGARTEN SUBJECTS:
- Google Calendar Feed 3 contains the authoritative rotating Day 1 through Day 7 school schedule.
- When asked "what day is it on Monday", "what day is tomorrow", or for a specific date, look up the date in CLEAN SCHOOL DAY SCHEDULE.
- Report the rotating Day number (Day 1-7) and explicitly identify it as the Kindergarten / Lower School Day number.
- For Kindergarten subject questions, use the kindergartenSubjects listed for that rotating Day.
- Rotating days are single school days. Report them as the single calendar date (e.g., "Tuesday, September 29, 2026"), never as a date range.
- For questions asking about "Sharing Day" or "Meeting for Sharing", search CLEAN SCHOOL DAY SCHEDULE for the next date where the rotating day subjects include "Meeting for Sharing" (which occurs on Day 4).
- For questions asking about "Meeting for Business", search for the next date that includes "Meeting for Business" (which occurs on Day 7).

5. NAMED EVENT LOOKUPS:
- Search both titles and descriptions in SCHOOL CALENDAR EVENTS.
- Whenever an event is found, ALWAYS include the exact date, start/end time (unless marked "All Day"), and location in your response.
- Example: "The Ruby Bridges Walk to School Day is scheduled for Friday, November 13, 2026, from 7:45 AM – 8:15 AM at Campanella."
- When a parent asks to list events for a specific month (e.g., "November"), list ALL events from the SCHOOL CALENDAR EVENTS list whose date falls within that month in the upcoming school year.

6. OUTPUT FORMAT:
- Keep answers concise, clear, and parent-friendly.
- Return ONLY the final message text to send directly to the parent. No meta-commentary, conversational filler, or internal reasoning.`;

    const userPrompt = `CURRENT PARENT QUESTION:
${question}

TODAY GROUND TRUTH STATUS:
${JSON.stringify(todayStatusInfo, null, 2)}

CURRENT DATE REFERENCE:
• Today: ${todayEastern.formatted} (${todayEastern.iso}) - ${todayEastern.weekday}
• Tomorrow: ${tomorrowEastern.formatted} (${tomorrowEastern.iso}) - ${tomorrowEastern.weekday}

UPCOMING WEEK DATES:
${next7Days.map((d) => `• ${d.weekday}: ${d.formatted} (${d.iso})`).join('\n')}

CLEAN SCHOOL DAY SCHEDULE (ROTATING DAY 1-7 & KINDERGARTEN SUBJECTS):
${JSON.stringify(schoolDaySchedule, null, 2)}

SCHOOL CALENDAR EVENTS:
${JSON.stringify(schoolEvents, null, 2)}

Return only the final answer for the parent.`;

    let generatedAnswer = null;
    let lastError = null;

    const modelsToTry = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];

    for (const model of modelsToTry) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await ai.models.generateContent({
            model: model,
            contents: `${systemPrompt}\n\n${userPrompt}`
          });

          if (res?.text) {
            generatedAnswer = res.text;
            break;
          }
        } catch (err) {
          lastError = err;
          const msg = err?.message || '';
          if (msg.includes('503') || msg.includes('429') || err?.status === 'UNAVAILABLE') {
            await new Promise((r) => setTimeout(r, attempt * 1200));
            continue;
          }
          break;
        }
      }
      if (generatedAnswer) break;
    }

    if (!generatedAnswer) {
      throw lastError || new Error('No models succeeded.');
    }

    return Response.json({ answer: generatedAnswer });
  } catch (error) {
    console.error('Error in MB411 Calendar Assistant:', error);
    return Response.json({ answer: `Error: ${error.message || 'An unknown error occurred'}` });
  }
}
}
