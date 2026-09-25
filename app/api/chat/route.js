export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import ical from 'node-ical';
import { GoogleGenAI } from '@google/genai';

const FEEDS = [
  {
    name: 'Feed 1 (School Events)',
    url: 'https://mosesbrown.myschoolapp.com/podium/feed/iCal.aspx?z=E1N%2bZECWAsAfUGqeWaJ4wnh22O7R2ayGHKshoyBZzraNcPRLE4U8KT9k2M0zhuH2P9%2bDbSna%2foN60549yOti3A%3d%3d'
  },
  {
    name: 'Feed 2 (School Events 2)',
    url: 'webcal://mosesbrown.myschoolapp.com/podium/feed/iCal.aspx?z=Rqm3n0%2fQWNXMEzr%2fwnqblb7%2fxmkVj0jo6VXZllLKMPMuGj%2bhS7ogeDgxFqXuX7EaViX6SpZXpUC2QbIvm8CY2w%3d%3d'
  },
  {
    name: 'Feed 3 (Rotating Schedule)',
    url: 'webcal://mosesbrown.myschoolapp.com/podium/feed/iCal.aspx?z=KlHNKuuxoXtfzbPFgqNMvxUHicqnjIZL7PNpZ1LKKngZk1Kv6n9LDT%2bnqwQ3TAVKwNBhWCaTgBrM%2b8TVGnztew%3d%3d'
  }
];

const kindergartenSubjects = {
  'Day 1': ['Art', 'ELA', 'Math', 'Library', 'PE'],
  'Day 2': ['Math', 'Shop', 'SS', 'PE', 'Reading Groups', 'Science', 'Music'],
  'Day 3': ['Math', 'SS', 'Community Time', 'PE', 'Art', 'ELA'],
  'Day 4': ['ELA', 'Tech', 'Science', 'SS', 'Music', 'Math', 'Meeting for Sharing'],
  'Day 5': ['ELA', 'Art', 'Math', 'SS', 'Library', 'Spanish'],
  'Day 6': ['Tech', 'Math', 'Reading Groups', 'PE', 'SS', 'Music', 'Art', 'ELA'],
  'Day 7': ['Math', 'Meeting for Business', 'PE', 'Library', 'SS', 'ELA', 'Spanish']
};

const formatDateEastern = (d) => {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(d);
};

const cleanCalendarEvents = (events) => {
  if (!Array.isArray(events)) return [];

  return events
    .filter((e) => e && e.type === 'VEVENT' && e.start)
    .map((event) => {
      const startDate = new Date(event.start);
      const endDate = event.end ? new Date(event.end) : null;

      let formattedDateRange = formatDateEastern(startDate);
      const startIso = startDate.toISOString().slice(0, 10);

      if (endDate && endDate > startDate) {
        const inclusiveEndDate = new Date(endDate.getTime() - 1000);
        if (formatDateEastern(startDate) !== formatDateEastern(inclusiveEndDate)) {
          formattedDateRange = `${formatDateEastern(startDate)} through ${formatDateEastern(inclusiveEndDate)}`;
        }
      }

      const title = (event.summary || '').trim();
      const rotatingDayMatch = title.match(/\bDay\s+([1-7])\b/i);

      return {
        title: title,
        rotatingDay: rotatingDayMatch ? `Day ${rotatingDayMatch[1]}` : '',
        dateRange: formattedDateRange,
        startIso: startIso,
        location: (event.location || '').trim(),
        description: (event.description || '').replace(/\s+/g, ' ').slice(0, 250)
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

    // 1. Concurrently fetch all 3 feeds
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
      .map((event) => ({
        date: event.dateRange,
        isoDate: event.startIso,
        rotatingDay: event.rotatingDay,
        subjects: kindergartenSubjects[event.rotatingDay] || []
      }))
      .sort((a, b) => a.isoDate.localeCompare(b.isoDate));

    const schoolDaySchedule = kindergartenUpcomingSchedule.map((event) => ({
      date: event.isoDate,
      formattedDate: event.date,
      day: event.rotatingDay,
      kindergartenSubjects: event.subjects
    }));

    const qLower = question.trim().toLowerCase();

    // 1. Diagnostics command
    if (qLower === 'debug') {
      const f1Count = cleanCalendar1.length;
      const f2Count = cleanCalendar2.length;
      const f3Count = cleanCalendar3.length;
      const minDate = schoolEvents[0]?.startIso || 'N/A';
      const maxDate = schoolEvents[schoolEvents.length - 1]?.startIso || 'N/A';

      return Response.json({
        answer: `**Debug Diagnostics:**\n` +
          `• Feed 1 Status: ${rawParsedFeeds[0].status} (${f1Count} events)\n` +
          `• Feed 2 Status: ${rawParsedFeeds[1].status} (${f2Count} events)\n` +
          `• Feed 3 Status: ${rawParsedFeeds[2].status} (${f3Count} events)\n` +
          `• Total School Events: ${schoolEvents.length}\n` +
          `• Date Range Loaded: ${minDate} to ${maxDate}`
      });
    }

    // 2. Direct November Inspection (bypasses LLM fallback to verify data)
    if (qLower === 'debug nov' || qLower === 'debug november') {
      const novEvents = schoolEvents.filter(e => e.startIso && e.startIso.startsWith('2026-11'));
      if (novEvents.length === 0) {
        return Response.json({ answer: 'There are ZERO events in the calendar data with start dates in 2026-11.' });
      }
      const list = novEvents.map(e => `• **${e.startIso}** (${e.dateRange}): ${e.title} ${e.location ? `[@ ${e.location}]` : ''}`).join('\n');
      return Response.json({ answer: `**Found ${novEvents.length} events in November 2026:**\n\n${list}` });
    }

    // 3. Direct Ruby / Walk Search (bypasses LLM fallback to verify data)
    if (qLower === 'debug walk' || qLower === 'debug ruby') {
      const matches = schoolEvents.filter(e => 
        (e.title + ' ' + e.description).toLowerCase().includes('ruby') || 
        (e.title + ' ' + e.description).toLowerCase().includes('walk')
      );
      if (matches.length === 0) {
        return Response.json({ answer: 'Zero events containing "ruby" or "walk" were found across all 446 calendar events.' });
      }
      const list = matches.map(e => `• **${e.startIso}**: ${e.title}`).join('\n');
      return Response.json({ answer: `**Matches found in raw feed:**\n\n${list}` });
    }

    const todayEastern = getEasternDate(0);
    const tomorrowEastern = getEasternDate(1);
    const next7Days = Array.from({ length: 7 }, (_, i) => getEasternDate(i));

    const systemPrompt = `You are MB411, an unofficial parent-maintained information assistant for Moses Brown School. You are not affiliated with or endorsed by Moses Brown School.

RULES:
1. Answer the parent's question ONLY using the School Calendar Events, CLEAN SCHOOL DAY SCHEDULE, and Kindergarten Rotating Day Subjects provided to you.
2. Timezone: Use America/New_York as the local timezone. Correctly interpret relative dates (today, tomorrow, this week, next week, upcoming months).
3. If the parent asks to list events for a month (e.g. November), search SCHOOL CALENDAR EVENTS for all events in that month and list them clearly with dates.
4. ROTATING DAY SCHEDULE RULES:
   - When asked "what day is it on Monday", "what day is tomorrow", or for a specific date, look up the date in CLEAN SCHOOL DAY SCHEDULE.
   - Report the rotating Day number (Day 1-7) and Kindergarten subjects.
5. NAMED EVENT LOOKUPS:
   - Search titles and descriptions in SCHOOL CALENDAR EVENTS.
   - If an event is found, report its exact date, time, and location.
   - ONLY if the event does not exist anywhere in the provided calendar data, say:
"I couldn't find that in the school information I have. Please check the latest official Moses Brown communication."
6. Keep answers concise, clear, and parent-friendly. Return ONLY the answer to send to the parent.`;

    const userPrompt = `CURRENT PARENT QUESTION:
${question}

CURRENT DATE REFERENCE:
• Today: ${todayEastern.formatted} (${todayEastern.iso})
• Tomorrow: ${tomorrowEastern.formatted} (${tomorrowEastern.iso})

UPCOMING WEEK DATES:
${next7Days.map((d) => `• ${d.weekday}: ${d.formatted} (${d.iso})`).join('\n')}

CLEAN SCHOOL DAY SCHEDULE (ROTATING DAY 1-7):
${JSON.stringify(schoolDaySchedule, null, 2)}

SCHOOL CALENDAR EVENTS:
${JSON.stringify(schoolEvents, null, 2)}

KINDERGARTEN ROTATING DAY SUBJECTS:
${JSON.stringify(kindergartenSubjects, null, 2)}

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
