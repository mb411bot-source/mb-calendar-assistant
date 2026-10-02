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
    url: 'https://mosesbrown.myschoolapp.com/podium/feed/iCal.aspx?z=Rqm3n0%2fQWNXMEzr%2fwnqblb7%2fxmkVj0jo6VXZllLKMPMuGj%2bhS7ogeDgxFqXuX7EaViX6SpZXpUC2QbIvm8CY2w%3d%3d'
  },
  {
    name: 'Feed 3 (Rotating Schedule)',
    url: 'https://mosesbrown.myschoolapp.com/podium/feed/iCal.aspx?z=KlHNKuuxoXtfzbPFgqNMvxUHicqnjIZL7PNpZ1LKKngZk1Kv6n9LDT%2bnqwQ3TAVKwNBhWCaTgBrM%2b8TVGnztew%3d%3d'
  }
];

let calendarCache = {
  timestamp: 0,
  schoolEvents: [],
  schoolDaySchedule: []
};
const CACHE_TTL_MS = 15 * 60 * 1000;

const kindergartenSubjects = {
  'Day 1': ['Art', 'English Language Arts', 'Math', 'Library', 'PE'],
  'Day 2': ['Math', 'Shop', 'Social Studies', 'PE', 'Reading Groups', 'Science', 'Music'],
  'Day 3': ['Math', 'Social Studies', 'Community Time', 'PE', 'Art', 'English Language Arts'],
  'Day 4': ['English Language Arts', 'Tech', 'Science', 'Social Studies', 'Music', 'Math', 'Meeting for Sharing'],
  'Day 5': ['English Language Arts', 'Art', 'Math', 'Social Studies', 'Library', 'Spanish'],
  'Day 6': ['Tech', 'Math', 'Reading Groups', 'PE', 'Social Studies', 'Music', 'Art', 'English Language Arts'],
  'Day 7': ['Math', 'Meeting for Business', 'PE', 'Library', 'Social Studies', 'English Language Arts', 'Spanish']
};

const extractIsoDate = (dateVal) => {
  if (!dateVal) return '';
  if (typeof dateVal === 'string') {
    const match = dateVal.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }
  const d = new Date(dateVal);
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return d.toISOString().slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
};

const cleanCalendarEvents = (events) => {
  if (!Array.isArray(events)) return [];
  return events
    .filter((e) => e && e.type === 'VEVENT' && e.start)
    .map((event) => {
      const startDate = new Date(event.start);
      const endDate = event.end ? new Date(event.end) : null;
      const isAllDay = !event.start.getHours && !event.start.getMinutes;
      const startIso = extractIsoDate(event.start);
      const endIso = endDate ? extractIsoDate(endDate) : startIso;

      let timeString = 'All Day';
      if (!isAllDay && typeof event.start.getHours === 'function') {
        const timeOptions = { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true };
        timeString = new Intl.DateTimeFormat('en-US', timeOptions).format(startDate);
      }

      const title = (event.summary || '').trim();
      const rotatingDayMatch = title.match(/\bDay\s+([1-7])\b/i);

      return {
        title,
        rotatingDay: rotatingDayMatch ? `Day ${rotatingDayMatch[1]}` : '',
        date: startIso,
        endDate: endIso,
        time: timeString,
        location: (event.location || '').trim()
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
  const targetDate = new Date(Date.UTC(year, month - 1, day + daysFromToday, 16));

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

// Fire and forget logging so it never blocks the browser response
function logToGoogleSheet(question, answer, status = 'OK') {
  const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  if (!webhookUrl) return;

  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'vercel',
      question: `[Web] ${question}`,
      answer: (answer || '').slice(0, 300),
      status: status || 'OK'
    }),
    redirect: 'follow'
  }).catch((err) => console.error('Sheet logging error:', err?.message));
}

async function getCalendarData() {
  const now = Date.now();
  if (calendarCache.timestamp && now - calendarCache.timestamp < CACHE_TTL_MS) {
    return {
      schoolEvents: calendarCache.schoolEvents,
      schoolDaySchedule: calendarCache.schoolDaySchedule
    };
  }

  const rawParsedFeeds = await Promise.all(
    FEEDS.map(async (feed) => {
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(feed.url, { signal: controller.signal, cache: 'no-store' });
        clearTimeout(tid);
        if (!res.ok) return { name: feed.name, events: [] };
        const rawIcs = await res.text();
        const parsed = await ical.async.parseICS(rawIcs);
        return { name: feed.name, events: Object.values(parsed).filter((i) => i.type === 'VEVENT') };
      } catch {
        return { name: feed.name, events: [] };
      }
    })
  );

  const cleanCalendar1 = cleanCalendarEvents(rawParsedFeeds[0].events);
  const cleanCalendar2 = cleanCalendarEvents(rawParsedFeeds[1].events);
  const cleanCalendar3 = cleanCalendarEvents(rawParsedFeeds[2].events);

  const schoolEvents = [...cleanCalendar1, ...cleanCalendar2].sort((a, b) => a.date.localeCompare(b.date));
  const schoolDaySchedule = cleanCalendar3
    .filter((event) => event.rotatingDay)
    .map((event) => ({
      date: event.date,
      day: event.rotatingDay,
      subjects: kindergartenSubjects[event.rotatingDay] || []
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (schoolEvents.length > 0 || schoolDaySchedule.length > 0) {
    calendarCache = { timestamp: now, schoolEvents, schoolDaySchedule };
  }

  return { schoolEvents: calendarCache.schoolEvents, schoolDaySchedule: calendarCache.schoolDaySchedule };
}

export async function GET() {
  return Response.json({ status: 'online', service: 'Moses Brown Web Chat Endpoint' });
}

export async function POST(req) {
  let userQuestion = '';

  try {
    const body = await req.json();
    userQuestion = (body?.question || body?.message || body?.prompt || body?.text || '').trim();

    if (!userQuestion) {
      return Response.json({
        answer: 'Please enter a question.',
        reply: 'Please enter a question.',
        message: 'Please enter a question.'
      }, { status: 400 });
    }

    if (!process.env.GEMINI_API_KEY) {
      logToGoogleSheet(userQuestion, 'Missing GEMINI_API_KEY', 'CONFIG_ERROR');
      return Response.json({
        answer: 'Assistant configuration missing.',
        reply: 'Assistant configuration missing.',
        message: 'Assistant configuration missing.'
      }, { status: 500 });
    }

    const todayEastern = getEasternDate(0);
    const tomorrowEastern = getEasternDate(1);
    const { schoolEvents: allEvents, schoolDaySchedule: allSchedules } = await getCalendarData();

    const upcomingEvents = allEvents.filter((e) => (e.endDate || e.date) >= todayEastern.iso);
    const upcomingSchedule = allSchedules.filter((e) => e.date >= todayEastern.iso);

    const systemPrompt = `You are the helpful assistant for Moses Brown School.
1. Answer clearly, accurately, and concisely.
2. For rotating day queries (today/tomorrow), state the day (Day 1 - Day 7) and kindergarten subjects first.
3. For breaks/holidays (Winter Break, Spring Break, next day off), state the exact dates and class resumption dates.
4. "Sharing Day" or "Share Day" refers to "Meeting for Sharing" (Day 4).
5. For events like Expo Weekend or Homecoming, list dates, times, and locations clearly.`;

    const userPrompt = `PARENT QUESTION:
${userQuestion}

TODAY'S DATE: ${todayEastern.formatted} (${todayEastern.iso})
TOMORROW'S DATE: ${tomorrowEastern.formatted} (${tomorrowEastern.iso})

UPCOMING ROTATING DAYS:
${JSON.stringify(upcomingSchedule.slice(0, 60))}

UPCOMING SCHOOL EVENTS & CLOSURES:
${JSON.stringify(upcomingEvents.slice(0, 150))}`;

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const modelsToTry = ['gemini-2.5-flash', 'gemini-1.5-flash'];
    let reply = null;

    for (const model of modelsToTry) {
      try {
        const res = await ai.models.generateContent({
          model: model,
          contents: `${systemPrompt}\n\n${userPrompt}`
        });
        if (res?.text) {
          reply = res.text;
          break;
        }
      } catch (err) {
        console.warn(`Model ${model} failed:`, err?.message);
      }
    }

    if (!reply) {
      reply = "I'm sorry, I couldn't find that information on the calendar.";
    }

    // Log without blocking the response
    logToGoogleSheet(userQuestion, reply, 'SUCCESS');

    // Return all standard keys so page.js always finds the text
    return Response.json({
      answer: reply,
      reply: reply,
      message: reply,
      response: reply,
      text: reply
    }, { status: 200 });
  } catch (error) {
    console.error('Chat endpoint error:', error);
    logToGoogleSheet(userQuestion || 'Unhandled Chat Exception', error.message, 'ERROR');
    return Response.json({
      error: 'Internal Server Error',
      answer: 'Sorry, I encountered an issue retrieving the calendar.'
    }, { status: 500 });
  }
}
