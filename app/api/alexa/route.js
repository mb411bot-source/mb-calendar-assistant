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
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// Alexa drops the reply ("The requested skill did not provide a valid response")
// if the endpoint takes longer than 8 seconds, so everything runs against a budget.
const AI_DEADLINE_MS = 6000; // stop waiting on the AI model after this long
const RESPONSE_BUDGET_MS = 7000; // never hold the reply past this for logging

const kindergartenSubjects = {
  'Day 1': ['Art', 'English Language Arts', 'Math', 'Library', 'fizz ed'],
  'Day 2': ['Math', 'Shop', 'social studies', 'fizz ed', 'Reading Groups', 'Science', 'Music'],
  'Day 3': ['Math', 'social studies', 'Community Time', 'fizz ed', 'Art', 'English Language Arts'],
  'Day 4': ['English Language Arts', 'Tech', 'Science', 'social studies', 'Music', 'Math', 'Meeting for Sharing'],
  'Day 5': ['English Language Arts', 'Art', 'Math', 'social studies', 'Library', 'Spanish'],
  'Day 6': ['Tech', 'Math', 'Reading Groups', 'fizz ed', 'social studies', 'Music', 'Art', 'English Language Arts'],
  'Day 7': ['Math', 'Meeting for Business', 'fizz ed', 'Library', 'social studies', 'English Language Arts', 'Spanish']
};

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
      const isAllDay = event.datetype === 'date';
      const startIso = extractIsoDate(event.start);
      const endIso = endDate ? extractIsoDate(endDate) : startIso;

      let timeString = 'All Day';
      if (!isAllDay) {
        if (endDate && endDate > startDate) {
          timeString = `${formatTimeEastern(startDate)} to ${formatTimeEastern(endDate)}`;
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

// Alexa only passes along the words captured by an intent's slot, not the words around
// it. Each of these intents has one fixed lead-in in the interaction model
// (alexa/interaction-model.json), so the full question is rebuilt from it here.
const INTENT_PREFIXES = {
  WhatDayIntent: 'What day is',
  WhenDoesIntent: 'When does',
  IsThereIntent: 'Is there',
  IsTodayIntent: 'Is today',
  DoWeHaveIntent: 'Do we have',
  WhatSpecialsIntent: 'What specials',
  TellMeAboutIntent: 'Tell me about'
};

function formatAlexaSpeech(speechText, shouldEndSession = true, repromptText = null) {
  let cleanSpeech = (speechText || 'I do not have that information right now.')
    .replace(/[*_#`\n\r]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[<>{}[\]\\]/g, '')
    .replace(/["']/g, '')
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  cleanSpeech = cleanSpeech
    .replace(/\bELA\b/gi, 'English Language Arts')
    .replace(/\bPE\b/gi, 'fizz ed')
    .replace(/\bSS\b/gi, 'social studies')
    .replace(/\bPhysical Education\b/gi, 'fizz ed');

  const responseBody = {
    version: '1.0',
    response: {
      outputSpeech: {
        type: 'SSML',
        ssml: `<speak>${cleanSpeech}</speak>`
      },
      shouldEndSession: shouldEndSession
    }
  };

  if (!shouldEndSession && repromptText) {
    const cleanReprompt = repromptText
      .replace(/[*_#`\n\r]/g, ' ')
      .replace(/&/g, ' and ')
      .replace(/[<>{}[\]\\]/g, '')
      .replace(/["']/g, '')
      .replace(/[—–]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();

    responseBody.response.reprompt = {
      outputSpeech: {
        type: 'SSML',
        ssml: `<speak>${cleanReprompt}</speak>`
      }
    };
  }

  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: {
      'Content-Type': 'application/json;charset=UTF-8'
    }
  });
}

async function logToGoogleSheet(question, answer, status = 'OK') {
  const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  if (!webhookUrl) return;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 4000);

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'vercel',
        question: question,
        answer: (answer || '').slice(0, 300),
        status: status || 'OK'
      }),
      redirect: 'follow',
      signal: controller.signal
    });
  } catch (err) {
    console.error('Sheet logging error:', err?.message);
  } finally {
    clearTimeout(id);
  }
}

// Log without delaying the spoken reply: hand the request to Vercel to finish in the
// background when possible, otherwise wait only as long as the Alexa budget allows.
function logSafely(startedAt, question, answer, status) {
  const pending = logToGoogleSheet(question, answer, status);
  const ctx = globalThis[Symbol.for('@vercel/request-context')]?.get?.();
  if (ctx?.waitUntil) {
    ctx.waitUntil(pending);
    return Promise.resolve();
  }
  const remaining = Math.max(200, RESPONSE_BUDGET_MS - (Date.now() - startedAt));
  return Promise.race([pending, new Promise((resolve) => setTimeout(resolve, remaining))]);
}

const speakDate = (iso) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  }).format(new Date(`${iso}T16:00:00Z`));

// "Share day" is Meeting for Sharing, which is always Day 4. Answered straight from the
// rotating schedule, with no AI call, so it is fast and cannot fail on a model outage.
function answerShareDay(question, schedule, todayIso) {
  if (!/\bshar(e|ing)\s+days?\b|meeting for sharing/i.test(question)) return null;
  const shareDays = schedule.filter((d) => d.day === 'Day 4' && d.date >= todayIso);
  if (shareDays.length === 0) return null;
  if (shareDays[0].date === todayIso) {
    const after = shareDays[1] ? ` The one after that is ${speakDate(shareDays[1].date)}.` : '';
    return `Today is Day 4, so today is a share day.${after}`;
  }
  return `The next share day is ${speakDate(shareDays[0].date)}, which is a Day 4.`;
}

const EVENT_SYNONYMS = [
  { ask: /christmas|winter|holiday (break|vacation|recess)/i, title: /winter (break|recess|vacation)|christmas|holiday (break|recess)/i },
  { ask: /spring (break|vacation|recess)|march break/i, title: /spring (break|recess|vacation)/i },
  { ask: /thanksgiving/i, title: /thanksgiving/i },
  { ask: /expo|homecoming/i, title: /expo|homecoming/i },
  { ask: /day off|no school|school closed/i, title: /no school|closed|holiday|break|recess|in-service/i }
];
const STOPWORDS = new Set(
  'when what where is are the a an next this of for on in at to do does we have school day time start starts begin begins'.split(' ')
);

// Used only when the AI model fails or runs out of time: a plain keyword lookup so
// common "when is ..." questions still get an answer.
function answerFromKeywords(question, events) {
  const q = question.toLowerCase();
  let match = null;
  const synonym = EVENT_SYNONYMS.find((s) => s.ask.test(q));
  if (synonym) {
    match = events.find((e) => synonym.title.test(e.title));
  } else {
    const words = q.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w))
      .map((w) => (w.length > 3 ? w.replace(/s$/, '') : w)); // so "shots" matches "Flu Shot Clinic"
    if (words.length > 0) {
      match = events.find((e) => words.every((w) => e.title.toLowerCase().includes(w)));
    }
  }
  if (!match) return null;
  if (match.endDate && match.endDate !== match.date) {
    return `${match.title} runs from ${speakDate(match.date)} to ${speakDate(match.endDate)}.`;
  }
  const time = match.time && match.time !== 'All Day' ? ` at ${match.time}` : '';
  return `${match.title} is on ${speakDate(match.date)}${time}.`;
}

// Ask the models with staggered starts instead of strictly one after another: the next
// model is started as soon as the previous one errors, or after 1.2 seconds if it is
// still thinking. The first model to produce text wins. This keeps one slow or
// overloaded model from using up the whole Alexa time limit.
function askModels(ai, models, contents, deadlineAt, errors) {
  return new Promise((resolve) => {
    let done = false;
    let pending = 0;
    let next = 0;
    const controllers = [];
    const timers = [];
    const finish = (value) => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      controllers.forEach((c) => c.abort());
      resolve(value);
    };
    const launch = () => {
      if (done || next >= models.length) return;
      const model = models[next++];
      const controller = new AbortController();
      controllers.push(controller);
      pending++;
      Promise.resolve()
        .then(() =>
          ai.models.generateContent({
            model,
            contents,
            config: { abortSignal: controller.signal, temperature: 0.2 }
          })
        )
        .then((res) => {
          if (!res?.text) throw new Error('empty response');
          finish(res.text);
        })
        .catch((err) => {
          if (done) return;
          const raw = String(err?.message || 'error');
          const short = (raw.match(/"message":\s*"([^"]+)/)?.[1] || raw).slice(0, 70);
          console.error(`Model ${model} failed:`, raw);
          errors.push(`${model}: ${short}`);
          pending--;
          if (next < models.length) launch();
          else if (pending === 0) finish(null);
        });
    };
    launch();
    for (let i = 1; i < models.length; i++) timers.push(setTimeout(launch, i * 1200));
    timers.push(
      setTimeout(() => {
        errors.push('out of time');
        finish(null);
      }, Math.max(0, deadlineAt - Date.now()))
    );
  });
}

// "What day is it today / tomorrow in kindergarten" is answered straight from the
// rotating schedule, with no AI call.
function answerRotatingDay(question, schedule, today, tomorrow) {
  const q = question.toLowerCase();
  const which = /\btomorrow\b/.test(q) ? 'tomorrow' : /\btoday\b/.test(q) ? 'today' : null;
  if (!which || schedule.length === 0) return null;
  if (!/what day|which day|day number|rotating|subjects|specials|in kindergarten|kindergarten (today|tomorrow)/.test(q)) {
    return null;
  }
  const target = which === 'today' ? today : tomorrow;
  const entry = schedule.find((d) => d.date === target.iso);
  if (!entry) return null;
  const subjects = entry.subjects || [];
  const list =
    subjects.length > 1
      ? `${subjects.slice(0, -1).join(', ')}, and ${subjects[subjects.length - 1]}`
      : subjects.join('');
  const lead = which === 'today' ? `Today is ${entry.day}.` : `Tomorrow, ${target.weekday}, is ${entry.day}.`;
  return list ? `${lead} Kindergarten has ${list}.` : lead;
}

const eventLine = (e) =>
  [e.date === e.endDate || !e.endDate ? e.date : `${e.date} to ${e.endDate}`, e.time, e.title, e.location]
    .filter(Boolean)
    .join(' | ');

async function fetchWithTimeout(url, timeoutMs = 3500) {
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

async function getCalendarData() {
  const now = Date.now();
  if (calendarCache.timestamp && now - calendarCache.timestamp < CACHE_TTL_MS) {
    return {
      schoolEvents: calendarCache.schoolEvents,
      schoolDaySchedule: calendarCache.schoolDaySchedule,
      cached: true,
      errors: []
    };
  }

  let feedErrors = [];
  const rawParsedFeeds = await Promise.all(
    FEEDS.map(async (feed) => {
      try {
        const res = await fetchWithTimeout(feed.url, 3000);
        if (!res.ok) {
          feedErrors.push(`${feed.name} HTTP ${res.status}`);
          return { name: feed.name, events: [] };
        }
        const rawIcs = await res.text();
        const parsed = await ical.async.parseICS(rawIcs);
        const events = Object.values(parsed).filter((item) => item.type === 'VEVENT');
        return { name: feed.name, events };
      } catch (err) {
        feedErrors.push(`${feed.name}: ${err.message}`);
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
    calendarCache = {
      timestamp: now,
      schoolEvents,
      schoolDaySchedule
    };
  }

  return {
    schoolEvents: calendarCache.schoolEvents,
    schoolDaySchedule: calendarCache.schoolDaySchedule,
    cached: false,
    errors: feedErrors
  };
}

export async function GET() {
  return new Response(JSON.stringify({ status: 'online', service: 'Moses Brown Alexa Endpoint' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json;charset=UTF-8' }
  });
}

export async function POST(req) {
  const startedAt = Date.now();
  let userQuestion = '';

  try {
    const body = await req.json();
    const reqType = body?.request?.type;

    // Handle initial launch ("open moses brown assistant")
    if (reqType === 'LaunchRequest') {
      const welcomeText = "Sure, what's your question?";
      const repromptText = "What's your question?";

      await logSafely(startedAt, '[Alexa] LaunchRequest', welcomeText, 'SUCCESS');
      return formatAlexaSpeech(welcomeText, false, repromptText);
    }

    const intent = body?.request?.intent;
    const intentName = intent?.name;

    if (intentName === 'AMAZON.StopIntent' || intentName === 'AMAZON.CancelIntent') {
      return formatAlexaSpeech('Goodbye!', true);
    }

    // Extract captured slot value across any configured slot names
    const slots = intent?.slots || {};
    let capturedPhrase = '';
    for (const key of Object.keys(slots)) {
      const slotValue = slots[key]?.value || slots[key]?.slotValue?.value;
      if (slotValue) {
        capturedPhrase = String(slotValue).trim();
        break;
      }
    }

    // When Alexa sends no captured phrase, record what it did send so the skill's
    // interaction model can be diagnosed from the sheet's Status column.
    const requestNote = capturedPhrase
      ? ''
      : ` [no phrase captured: type=${reqType} intent=${intentName || 'none'} slots=${JSON.stringify(slots).slice(0, 150)}]`;

    // Reconstruct full semantic question based on intent name
    const carrierPrefix = INTENT_PREFIXES[intentName];
    if (carrierPrefix && capturedPhrase) {
      userQuestion = `${carrierPrefix} ${capturedPhrase}?`;
    } else if (intentName === 'WhenIsIntent') {
      userQuestion = capturedPhrase ? `When is ${capturedPhrase}?` : 'When is the next school event?';
    } else if (intentName === 'WhatIsIntent') {
      const lower = capturedPhrase.toLowerCase();
      if (lower.startsWith('day ') || lower === 'today' || lower === 'tomorrow') {
        userQuestion = `What day is it ${capturedPhrase} in kindergarten?`;
      } else {
        userQuestion = capturedPhrase ? `What is ${capturedPhrase}?` : 'What day is it today in kindergarten?';
      }
    } else {
      // Legacy AskSchoolIntent or FallbackIntent
      if (!capturedPhrase) {
        if (intentName === 'AMAZON.FallbackIntent') {
          const fallbackText =
            'I did not catch that. You can ask what day is today in kindergarten, what day is tomorrow, or when is Expo Weekend.';
          await logSafely(startedAt, '[Alexa] Fallback', fallbackText, 'FALLBACK');
          return formatAlexaSpeech(fallbackText, true);
        }
        userQuestion = 'What day is it today in kindergarten?';
      } else {
        userQuestion = capturedPhrase;
      }
    }

    if (!process.env.GEMINI_API_KEY) {
      const errText = 'The assistant is missing its API configuration.';
      await logSafely(startedAt, `[Alexa] ${userQuestion || 'Missing Config'}`, errText, 'CONFIG_ERROR');
      return formatAlexaSpeech(errText, true);
    }

    const todayEastern = getEasternDate(0);
    const tomorrowEastern = getEasternDate(1);

    const { schoolEvents: allEvents, schoolDaySchedule: allSchedules, errors: feedErrors } = await getCalendarData();

    const upcomingEvents = allEvents.filter((e) => (e.endDate || e.date) >= todayEastern.iso);
    const upcomingSchedule = allSchedules.filter((e) => e.date >= todayEastern.iso);

    const directAnswer =
      answerShareDay(userQuestion, upcomingSchedule, todayEastern.iso) ||
      answerRotatingDay(userQuestion, upcomingSchedule, todayEastern, tomorrowEastern);
    if (directAnswer) {
      await logSafely(startedAt, `[Alexa] ${userQuestion}`, directAnswer, `SUCCESS_NO_AI${requestNote}`);
      return formatAlexaSpeech(directAnswer, true);
    }

    const systemPrompt = `You are the Moses Brown School Voice Assistant.
Your answer will be spoken aloud to parents by an Amazon Echo device:
1. Answer concisely in 1 or 2 natural spoken sentences.
2. DO NOT use markdown, asterisks, bullet points, brackets, quotation marks, or special characters.
3. Be direct, clear, and friendly.
4. When stating subjects, say "English Language Arts" instead of ELA, "social studies" instead of SS, and "fizz ed" instead of PE.
5. If the parent asks about today, state today's rotating day (e.g. Day 6) and kindergarten subjects.
6. If the parent asks about tomorrow, state tomorrow's rotating day (e.g. Day 7) and kindergarten subjects.
7. "Sharing Day" or "Share Day" refers to "Meeting for Sharing" (Day 4).
8. Handle school events with flexible keyword matching:
   - "Expo", "Expo Weekend", "Homecoming", "Fall Expo": Match any event containing "Expo" or "Homecoming".
   - "Spring Break": Match any multi-day break/closures in March or April.
   - "Winter Break" / "Christmas Break" / "Christmas Vacation" / "Holiday Break": Match multi-day closures in late December / early January.
   - "Next day off": Find the nearest upcoming date with "No School", "Closed", "Holiday", "Break", or "In-Service".
9. When answering an event query, clearly state the date (e.g., Friday, October 16th), time if applicable, and title.`;

    const userPrompt = `PARENT QUESTION:
${userQuestion}

TODAY'S DATE: ${todayEastern.formatted} (${todayEastern.iso})
TOMORROW'S DATE: ${tomorrowEastern.formatted} (${tomorrowEastern.iso})

UPCOMING ROTATING DAYS (NEXT 60 DAYS):
${JSON.stringify(upcomingSchedule.slice(0, 60))}

UPCOMING SCHOOL EVENTS & CLOSURES (one per line: date or date range | time | title | location):
${upcomingEvents.slice(0, 300).map(eventLine).join('\n')}`;

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const modelsToTry = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-flash'];
    const modelErrors = [];
    let spokenAnswer = await askModels(
      ai,
      modelsToTry,
      `${systemPrompt}\n\n${userPrompt}`,
      startedAt + AI_DEADLINE_MS,
      modelErrors
    );

    let finalStatus = 'SUCCESS';
    if (!spokenAnswer) {
      // The reason goes in the sheet's Status column so failures can be diagnosed.
      const feedNote =
        feedErrors && feedErrors.length > 0
          ? `; FEEDS: ${feedErrors.join(', ')}`
          : upcomingSchedule.length === 0
            ? '; FEEDS: rotating schedule is empty'
            : '';
      const reason = `${modelErrors.join('; ')}${feedNote}`.slice(0, 400);
      spokenAnswer = answerFromKeywords(userQuestion, upcomingEvents);
      if (spokenAnswer) {
        finalStatus = `AI_FAILURE_KEYWORD_FALLBACK (${reason})`;
      } else {
        finalStatus = `AI_FAILURE (${reason})`;
        spokenAnswer = 'Sorry, I could not find that on the school calendar right now.';
      }
    } else if (feedErrors && feedErrors.length > 0) {
      finalStatus = 'DEGRADED_FEEDS';
    }

    await logSafely(startedAt, `[Alexa] ${userQuestion}`, spokenAnswer, `${finalStatus}${requestNote}`);
    return formatAlexaSpeech(spokenAnswer, true);
  } catch (error) {
    console.error('Alexa endpoint error:', error);
    await logSafely(startedAt, `[Alexa] ${userQuestion || 'Unhandled Exception'}`, error.message, 'ERROR');
    return formatAlexaSpeech('Sorry, I encountered an issue retrieving the school schedule.', true);
  }
}
