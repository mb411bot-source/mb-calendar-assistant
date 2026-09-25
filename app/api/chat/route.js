export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import ical from 'node-ical';
import { GoogleGenAI } from '@google/genai';

// 1. Moses Brown iCal Feeds
const FEEDS = [
  {
    name: 'Feed 1',
    url: 'https://mosesbrown.myschoolapp.com/podium/feed/iCal.aspx?z=E1N%2bZECWAsAfUGqeWaJ4wnh22O7R2ayGHKshoyBZzraNcPRLE4U8KT9k2M0zhuH2P9%2bDbSna%2foN60549yOti3A%3d%3d'
  },
  {
    name: 'Feed 2',
    url: 'https://mosesbrown.myschoolapp.com/podium/feed/iCal.aspx?z=KlHNKuuxoXtfzbPFgqNMvxUHicqnjIZL7PNpZ1LKKngZk1Kv6n9LDT%2bnqwQ3TAVKwNBhWCaTgBrM%2b8TVGnztew%3d%3d'
  },
  {
    name: 'Feed 3 (Rotating Schedule)',
    url: 'https://mosesbrown.myschoolapp.com/podium/feed/iCal.aspx?z=Rqm3n0%2fQWNXMEzr%2fwnqblb7%2fxmkVj0jo6VXZllLKMPMuGj%2bhS7ogeDgxFqXuX7EaViX6SpZXpUC2QbIvm8CY2w%3d%3d'
  }
];

// 2. Kindergarten Rotating Day Schedule Matrix
const KINDERGARTEN_SUBJECTS = {
  'Day 1': ['Art', 'ELA', 'Math', 'Library', 'PE'],
  'Day 2': ['Math', 'Shop', 'SS', 'PE', 'Reading Groups', 'Science', 'Music'],
  'Day 3': ['Math', 'SS', 'Community Time', 'PE', 'Art', 'ELA'],
  'Day 4': ['ELA', 'Tech', 'Science', 'SS', 'Music', 'Math', 'Meeting for Sharing'],
  'Day 5': ['ELA', 'Art', 'Math', 'SS', 'Library', 'Spanish'],
  'Day 6': ['Tech', 'Math', 'Reading Groups', 'PE', 'SS', 'Music', 'Art', 'ELA'],
  'Day 7': ['Math', 'Meeting for Business', 'PE', 'Library', 'SS', 'ELA', 'Spanish']
};

const cleanCalendarEvents = (events) => {
  if (!Array.isArray(events)) return [];

  return events.map((event) => {
    const startValue = event.start ? new Date(event.start).toISOString() : '';
    const endValue = event.end ? new Date(event.end).toISOString() : '';

    let formattedDate = '';
    if (startValue) {
      const dateForFormatting = new Date(startValue);
      formattedDate = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      }).format(dateForFormatting);
    }

    const title = event.summary || '';
    const rotatingDayMatch = title.match(/\bDay\s+([1-7])\b/i);

    return {
      title: title,
      rotatingDay: rotatingDayMatch ? `Day ${rotatingDayMatch[1]}` : '',
      date: formattedDate,
      start: startValue.slice(0, 10),
      end: endValue,
      location: event.location || '',
      description: event.description || ''
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

    // Fetch and parse all 3 feeds concurrently
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
            console.error(`Feed ${feed.name} returned status ${res.status}`);
            return [];
          }

          const rawIcs = await res.text();
          const events = await ical.async.parseICS(rawIcs);
          return Object.values(events).filter((item) => item.type === 'VEVENT');
        } catch (err) {
          console.error(`Fetch failed for ${feed.name}:`, err);
          return [];
        }
      })
    );

    const cleanCalendar1 = cleanCalendarEvents(rawParsedFeeds[0]);
    const cleanCalendar2 = cleanCalendarEvents(rawParsedFeeds[1]);
    const cleanCalendar3 = cleanCalendarEvents(rawParsedFeeds[2]);

    const schoolEvents = [...cleanCalendar1, ...cleanCalendar2]
      .filter((event) => event.start)
      .filter((event, index, array) => {
        const key = `${event.title}|${event.start}`;
        return index === array.findIndex((other) => `${other.title}|${other.start}` === key);
      })
      .sort((a, b) => String(a.start).localeCompare(String(b.start)));

    const kindergartenUpcomingSchedule = cleanCalendar3
      .filter((event) => event.rotatingDay)
      .map((event) => ({
        date: event.date,
        start: event.start,
        rotatingDay: event.rotatingDay,
        subjects: KINDERGARTEN_SUBJECTS[event.rotatingDay] || []
      }))
      .sort((a, b) => a.start.localeCompare(b.start));

    const schoolDaySchedule = kindergartenUpcomingSchedule.map((event) => ({
      date: event.start,
      formattedDate: event.date,
      day: event.rotatingDay,
      kindergartenSubjects: event.subjects
    }));

    const todayEastern = getEasternDate(0);
    const tomorrowEastern = getEasternDate(1);

    const systemPrompt = `You are MB411, an unofficial parent-maintained information assistant for Moses Brown School. You are not affiliated with or endorsed by Moses Brown School.

RULES:
1. Answer the parent's question ONLY using the School Calendar Events, CLEAN SCHOOL DAY SCHEDULE, and Kindergarten Rotating Day Subjects provided to you. Never invent or assume school information.
2. Use America/New_York as the local timezone. Correctly interpret relative dates such as today, tomorrow, Friday, this weekend, next week, and next month.
3. When useful, include the actual date in your answer. For example: "Friday, September 25."
4. If the provided information is insufficient to answer confidently, say exactly:
"I couldn't find that in the school information I have. Please check the latest official Moses Brown communication."
5. Keep answers concise, friendly, and appropriate for a parent group.
6. Protect privacy. Do not disclose information that appears specific to an individual student or family.
7. Return ONLY the answer that should be sent to the parent. Do not include analysis, JSON, labels, or commentary.`;

    const userPrompt = `CURRENT PARENT QUESTION:
${question}

CURRENT EASTERN DATE:
${todayEastern.formatted}
ISO DATE: ${todayEastern.iso}

TOMORROW'S EASTERN DATE:
${tomorrowEastern.formatted}
ISO DATE: ${tomorrowEastern.iso}

CLEAN SCHOOL DAY SCHEDULE (ROTATING DAY 1-7 & KINDERGARTEN SUBJECTS):
${JSON.stringify(schoolDaySchedule, null, 2)}

SCHOOL CALENDAR EVENTS:
${JSON.stringify(schoolEvents, null, 2)}

Before answering, examine ALL of the information above.
Return only the answer to send to the parent.`;

    let generatedAnswer = null;
    let lastError = null;

    // Active production models with automatic backoff retry
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

          // Wait on 503 high demand or 429 rate limit
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
