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

const kindergartenSubjects = {
  'Day 1': ['Art', 'English Language Arts', 'Math', 'Library', 'fizz ed'],
  'Day 2': ['Math', 'Shop', 'social studies', 'fizz ed', 'Reading Groups', 'Science', 'Music'],
  'Day 3': ['Math', 'social studies', 'Community Time', 'fizz ed', 'Art', 'English Language Arts'],
  'Day 4': ['English Language Arts', 'Tech', 'Science', 'social studies', 'Music', 'Math', 'Meeting for Sharing'],
  'Day 5': ['English Language Arts', 'Art', 'Math', 'social studies', 'Library', 'Spanish'],
  'Day 6': ['Tech', 'Math', 'Reading Groups', 'fizz ed', 'social studies', 'Music', 'Art', 'English Language Arts'],
  'Day 7': ['Math', 'Meeting for Business', 'fizz ed', 'Library', 'social studies', 'English Language Arts', 'Spanish']
};

const formatDateEastern = (d) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(d);

const formatTimeEastern = (d) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(d);

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

      let timeString = 'All Day';
      if (!isAllDay && typeof event.start.getHours === 'function') {
        if (endDate && endDate > startDate) {
          timeString = `${formatTimeEastern(startDate)} to${formatTimeEastern(endDate)}`;
        } else {
          timeString = formatTimeEastern(startDate);
        }
      }

      const title = (event.summary || '').trim();
      const rotatingDayMatch = title.match(/\bDay\s+([1-7])\b/i);

      return {
        title,
        rotatingDay: rotatingDayMatch ? `Day ${rotatingDayMatch[1]}` : '',
        date: startIso,
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

function formatAlexaSpeech(speechText, shouldEndSession = true) {
  let cleanSpeech = (speechText || '')
    .replace(/[*_#`\n]/g, ' ')
    .replace(/&/g, 'and')
    .replace(/[<>'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Keep phonetic expansion so pronunciation remains natural
  cleanSpeech = cleanSpeech
    .replace(/\bELA\b/gi, 'English Language Arts')
    .replace(/\bPE\b/gi, 'fizz ed')
    .replace(/\bSS\b/gi, 'social studies')
    .replace(/\bPhysical Education\b/gi, 'fizz ed');

  // No <voice> tag: inherits the Echo device's default user-configured voice
  const ssml = `<speak>${cleanSpeech || "I didn't receive a response."}</speak>`;

  return Response.json(
    {
      version: '1.0',
      response: {
        outputSpeech: {
          type: 'SSML',
          ssml: ssml
        },
        shouldEndSession: shouldEndSession
      }
    },
    { status: 200 }
  );
}

async function logToGoogleSheet(question, answer, status = 'OK') {
  const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  if (!webhookUrl) return;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 1500);

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'vercel',
        question: `[Alexa] ${question}`,
        answer: (answer || '').slice(0, 300),
        status
      }),
      signal: controller.signal
    });
  } catch (err) {
    console.error('Sheet logging timed out or failed:', err?.message);
  } finally {
    clearTimeout(id);
  }
}

async function fetchWithTimeout(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

export async function GET() {
  return Response.json({ status: 'online', service: 'Moses Brown Alexa Endpoint' });
}

export async function POST(req) {
  let userQuestion = '';

  try {
    const body = await req.json();
    const reqType = body?.request?.type;

    if (reqType === 'LaunchRequest') {
      const welcomeText =
        'Welcome to the Moses Brown Assistant. You can ask what day is today, what day is tomorrow, or when is the next day off.';
      await logToGoogleSheet('LaunchRequest', welcomeText, 'SUCCESS');
      return formatAlexaSpeech(welcomeText, true);
    }

    const intent = body?.request?.intent;
    const intentName = intent?.name;

    if (intentName === 'AMAZON.StopIntent' || intentName === 'AMAZON.CancelIntent') {
      return formatAlexaSpeech('Goodbye!', true);
    }

    const slots = intent?.slots || {};
    for (const key of Object.keys(slots)) {
      if (slots[key]?.value) {
        userQuestion = slots[key].value.trim();
        break;
      }
    }

    // Auto-repair carrier clippings from Alexa
    if (
      userQuestion.startsWith('it for ') ||
      userQuestion.startsWith('it today') ||
      userQuestion.startsWith('it tomorrow') ||
      userQuestion.startsWith('is it today') ||
      userQuestion.startsWith('is it tomorrow') ||
      userQuestion.startsWith('day is it')
    ) {
      userQuestion = `What day ${userQuestion.replace(/^day /, '')}`;
    }

    if (!userQuestion) {
      if (intentName === 'AMAZON.FallbackIntent') {
        const fallbackText =
          'I did not catch that. You can ask what day is today in kindergarten, what day is tomorrow, or when is the next day off.';
        await logToGoogleSheet('FallbackIntent (Empty)', fallbackText, 'FALLBACK');
        return formatAlexaSpeech(fallbackText, true);
      }
      userQuestion = 'What day is it today in kindergarten?';
    }

    if (!process.env.GEMINI_API_KEY) {
      const errText = 'The assistant is missing its API configuration.';
      await logToGoogleSheet(userQuestion, errText, 'CONFIG_ERROR');
      return formatAlexaSpeech(errText, true);
    }

    const rawParsedFeeds = await Promise.all(
      FEEDS.map(async (feed) => {
        try {
          const res = await fetchWithTimeout(feed.url, 2800);
          if (!res.ok) return { name: feed.name, events: [] };
          const rawIcs = await res.text();
          const parsed = await ical.async.parseICS(rawIcs);
          const events = Object.values(parsed).filter((item) => item.type === 'VEVENT');
          return { name: feed.name, events };
        } catch {
          return { name: feed.name, events: [] };
        }
      })
    );

    const todayEastern = getEasternDate(0);
    const tomorrowEastern = getEasternDate(1);

    const cleanCalendar1 = cleanCalendarEvents(rawParsedFeeds[0].events);
    const cleanCalendar2 = cleanCalendarEvents(rawParsedFeeds[1].events);
    const cleanCalendar3 = cleanCalendarEvents(rawParsedFeeds[2].events);

    const schoolEvents = [...cleanCalendar1, ...cleanCalendar2]
      .filter((e) => e.date >= todayEastern.iso)
      .sort((a, b) => a.date.localeCompare(b.date));

    const schoolDaySchedule = cleanCalendar3
      .filter((event) => event.rotatingDay && event.date >= todayEastern.iso)
      .map((event) => ({
        date: event.date,
        day: event.rotatingDay,
        subjects: kindergartenSubjects[event.rotatingDay] || []
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const systemPrompt = `You are the Moses Brown Voice Assistant.
Your answer is spoken aloud by an Amazon Echo speaker:
1. Answer concisely in 1 or 2 natural spoken sentences.
2. DO NOT use markdown, asterisks, bullet points, or brackets.
3. Be direct, clear, and friendly.
4. When stating subjects, say "English Language Arts" instead of ELA, "social studies" instead of SS, and "fizz ed" instead of PE.
5. When asked what day it is today or tomorrow (e.g. "what day is it today in kindergarten"), ALWAYS state the rotating day (e.g. Day 6) and kindergarten subjects first. DO NOT mention future events on later dates.
6. "Sharing Day" or "Share Day" refers to "Meeting for Sharing" (Day 4).
7. For day off queries, check upcoming events for closures ("No School", "Closed", "Holiday", "Break", "In-Service").
8. State the date, time, and location when answering event queries like flu clinic, assemblies, or fairs.`;

    const userPrompt = `PARENT QUESTION:
${userQuestion}

TODAY'S DATE: ${todayEastern.formatted} (${todayEastern.iso})
TOMORROW'S DATE: ${tomorrowEastern.formatted} (${tomorrowEastern.iso})

UPCOMING ROTATING DAYS:
${JSON.stringify(schoolDaySchedule.slice(0, 30))}

UPCOMING SCHOOL EVENTS & CLOSURES:
${JSON.stringify(schoolEvents.slice(0, 40))}`;

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const modelsToTry = ['gemini-3.5-flash-lite', 'gemini-3.8-flash'];
    let spokenAnswer = null;

    for (const model of modelsToTry) {
      try {
        const res = await ai.models.generateContent({
          model: model,
          contents: `${systemPrompt}\n\n${userPrompt}`
        });
        if (res?.text) {
          spokenAnswer = res.text;
          break;
        }
      } catch (err) {
        console.warn(`Model ${model} failed:`, err?.message);
      }
    }

    if (!spokenAnswer) {
      spokenAnswer = "I'm sorry, I couldn't retrieve the school calendar right now.";
    }

    await logToGoogleSheet(userQuestion, spokenAnswer, 'SUCCESS');
    return formatAlexaSpeech(spokenAnswer, true);
  } catch (error) {
    console.error('Alexa endpoint error:', error);
    await logToGoogleSheet(userQuestion, error.message, 'ERROR');
    return formatAlexaSpeech('Sorry, I encountered an issue retrieving the school schedule.', true);
  }
}
