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
  'Day 1': ['Art', 'ELA', 'Math', 'Library', 'PE'],
  'Day 2': ['Math', 'Shop', 'SS', 'PE', 'Reading Groups', 'Science', 'Music'],
  'Day 3': ['Math', 'SS', 'Community Time', 'PE', 'Art', 'ELA'],
  'Day 4': ['ELA', 'Tech', 'Science', 'SS', 'Music', 'Math', 'Meeting for Sharing'],
  'Day 5': ['ELA', 'Art', 'Math', 'SS', 'Library', 'Spanish'],
  'Day 6': ['Tech', 'Math', 'Reading Groups', 'PE', 'SS', 'Music', 'Art', 'ELA'],
  'Day 7': ['Math', 'Meeting for Business', 'PE', 'Library', 'SS', 'ELA', 'Spanish']
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

      const [year, month, day] = startIso.split('-').map(Number);
      const displayDate = new Date(Date.UTC(year, month - 1, day, 16));
      let formattedDateRange = formatDateEastern(displayDate);

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
        dateRange: formattedDateRange,
        startIso,
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

// Formats a clean Alexa JSON response
function formatAlexaSpeech(speechText, shouldEndSession = true) {
  // Strip out markdown asterisks or special characters for cleaner TTS
  const cleanSpeech = speechText.replace(/[*_#`]/g, '').trim();

  return Response.json({
    version: '1.0',
    response: {
      outputSpeech: {
        type: 'PlainText',
        text: cleanSpeech
      },
      shouldEndSession: shouldEndSession
    }
  });
}

// Log directly to the Google Sheet
async function logToGoogleSheet(question, answer, status = 'OK') {
  const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'vercel', // Logs directly to your sheet
        question: `[Alexa] ${question}`,
        answer: (answer || '').slice(0, 300),
        status
      })
    });
  } catch (err) {
    console.error('Error logging Alexa query to Google Sheet:', err);
  }
}

export async function POST(req) {
  let userQuestion = '';

  try {
    const body = await req.json();
    const reqType = body?.request?.type;

    // 1. Handle LaunchRequest (when someone says "Alexa, open Mo B")
    if (reqType === 'LaunchRequest') {
      return formatAlexaSpeech(
        'Welcome to the Mo B Assistant. You can ask what rotating day it is, check school closures, or ask about upcoming events.',
        false // Keep session open to listen for the user's question
      );
    }

    // 2. Handle Stop/Cancel intents
    const intentName = body?.request?.intent?.name;
    if (intentName === 'AMAZON.StopIntent' || intentName === 'AMAZON.CancelIntent') {
      return formatAlexaSpeech('Goodbye!');
    }

    // 3. Extract the question from the slot
    if (reqType === 'IntentRequest') {
      const slots = body?.request?.intent?.slots || {};
      userQuestion = slots.query?.value || slots.Question?.value || slots.AskQuery?.value || '';
    }

    if (!userQuestion) {
      return formatAlexaSpeech(
        'I did not catch your question. You can ask what day it is tomorrow, or check upcoming events.',
        false
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      return formatAlexaSpeech('The assistant is missing its API configuration.');
    }

    // 4. Fetch the calendar feeds
    const rawParsedFeeds = await Promise.all(
      FEEDS.map(async (feed) => {
        try {
          const res = await fetch(feed.url, { cache: 'no-store' });
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

    const cleanCalendar1 = cleanCalendarEvents(rawParsedFeeds[0].events);
    const cleanCalendar2 = cleanCalendarEvents(rawParsedFeeds[1].events);
    const cleanCalendar3 = cleanCalendarEvents(rawParsedFeeds[2].events);

    const schoolEvents = [...cleanCalendar1, ...cleanCalendar2].sort((a, b) =>
      a.startIso.localeCompare(b.startIso)
    );

    const schoolDaySchedule = cleanCalendar3
      .filter((event) => event.rotatingDay)
      .map((event) => ({
        date: event.startIso,
        formattedDate: event.dateRange,
        day: event.rotatingDay,
        kindergartenSubjects: kindergartenSubjects[event.rotatingDay] || []
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const todayEastern = getEasternDate(0);
    const tomorrowEastern = getEasternDate(1);
    const next7Days = Array.from({ length: 7 }, (_, i) => getEasternDate(i));

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

    // Voice-tuned system instructions (no markdown, spoken naturally)
    const systemPrompt = `You are Mo B Voice Assistant for Moses Brown School.
Your responses are read aloud by an Amazon Echo speaker:
1. Keep responses under 2 or 3 short sentences.
2. DO NOT use markdown, asterisks, bullet points, or special characters.
3. Be conversational and clear for voice playback.
4. Base all answers strictly on the provided calendar schedules.
5. If the information is not in the calendar data, say: "I couldn't find that in the school schedule."`;

    const userPrompt = `PARENT QUESTION:
${userQuestion}

TODAY: ${todayEastern.formatted} (${todayEastern.weekday})
TOMORROW: ${tomorrowEastern.formatted} (${tomorrowEastern.weekday})

TODAY STATUS:
${JSON.stringify(todayStatusInfo)}

CLEAN SCHEDULE:
${JSON.stringify(schoolDaySchedule)}

UPCOMING EVENTS:
${JSON.stringify(schoolEvents)}

Provide a concise spoken response for Alexa.`;

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const res = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: `${systemPrompt}\n\n${userPrompt}`
    });

    const spokenAnswer = res?.text || "I'm sorry, I couldn't find an answer for that.";

    await logToGoogleSheet(userQuestion, spokenAnswer, 'SUCCESS');

    return formatAlexaSpeech(spokenAnswer, true);
  } catch (error) {
    console.error('Alexa endpoint error:', error);
    await logToGoogleSheet(userQuestion, error.message, 'ERROR');
    return formatAlexaSpeech('Sorry, I encountered an issue retrieving the school schedule.');
  }
}
