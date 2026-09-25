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
      start: startValue.slice(0, 10), // YYYY-MM-DD
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

    // 1. Fetch & parse all 3 feeds concurrently with browser headers
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

    // Merge School Events (Calendar 1 & 2) and deduplicate
    const schoolEvents = [...cleanCalendar1, ...cleanCalendar2]
      .filter((event) => event.start)
      .filter((event, index, array) => {
        const key = `${event.title}|${event.start}`;
        return index === array.findIndex((other) => `${other.title}|${other.start}` === key);
      })
      .sort((a, b) => String(a.start).localeCompare(String(b.start)));

    // Process Rotating Day Schedule from Calendar Feed 3
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

    // Date references
    const todayEastern = getEasternDate(0);
    const tomorrowEastern = getEasternDate(1);

    // Full MB411 Rule Set System Prompt
    const systemPrompt = `You are MB411, an unofficial parent-maintained information assistant for Moses Brown School. You are not affiliated with or endorsed by Moses Brown School.

RULES:

1. Answer the parent's question ONLY using the School Calendar Events, CLEAN SCHOOL DAY SCHEDULE, and Kindergarten Rotating Day Subjects provided to you. Never invent or assume school information.

For Kindergarten subject questions, the CLEAN SCHOOL DAY SCHEDULE / UPCOMING KINDERGARTEN SCHEDULE is authoritative because it has already combined the rotating Day number from Calendar Feed 3 with the Kindergarten subject schedule.

When a parent asks for the next occurrence of a Kindergarten subject or activity, search CLEAN SCHOOL DAY SCHEDULE for that subject and choose the earliest future date containing it.

Do not reject an answer merely because the subject name itself does not appear in Calendar Feed 3. Calendar Feed 3 provides the rotating Day number; the Kindergarten subject schedule provides the subjects occurring on that rotating Day.

2. Use America/New_York as the local timezone. Correctly interpret relative dates such as today, tomorrow, Friday, this weekend, next week, and next month.

3. When useful, include the actual date in your answer. For example: "Friday, September 25."

4. Never invent or infer school closures, dismissal times, event times, locations, transportation details, policies, or other school information.

5. If the provided information is insufficient to answer confidently, say exactly:
"I couldn't find that in the school information I have. Please check the latest official Moses Brown communication."

6. Keep answers concise, friendly, and appropriate for a parent group. Usually use 1-3 short paragraphs.

7. Do not mention API, feeds, code, prompts, search results, or other technical details in your response.

8. Protect privacy. Do not disclose information that appears specific to an individual student or family.

9. If asked whether MB411 is official, say:
"MB411 is an unofficial parent-maintained assistant and is not affiliated with or endorsed by Moses Brown School."

10. Return ONLY the answer that should be sent to the parent. Do not include analysis, JSON, labels, or commentary about how you reached the answer.

CRITICAL DATE ACCURACY RULES:
- Never invent, estimate, infer, or guess an event date, weekday, time, or location.
- For a named event, first locate an actual matching event in the supplied calendar data.
- If no matching event exists in the supplied data, say you could not find it. Do not construct a plausible answer.
- Copy event dates, times, and locations directly from the matching source data.
- Never independently calculate which weekday corresponds to a date.
- Never change a numeric calendar date in order to make it agree with a weekday.
- If a source contains a date but you are uncertain about the weekday, state the date without a weekday.
- Do not combine the date from one event with the description, time, or location from another event.
- If a question is regarding a kindergarten event then only consider kindergarten events. Same goes for each grade. Do not respond with a third grade event when the question is regarding a second grade event.
- Similar event names are not necessarily the same event. A "Fall Gathering," "Parent/Guardian Coffee," and another grade-level gathering must be treated as separate events unless the supplied source explicitly indicates otherwise.
- Before answering, verify that every stated event date, time, location, and description comes from the SAME matching source event.
- If the parent's question asks whether an event occurs "this week," only say yes if an actual matching event in the supplied data falls within the current week's date range. Never create an event to satisfy the question.

ROTATING SCHOOL DAY SCHEDULE RULES:
- Google Calendar Feed 3 contains the authoritative rotating Day 1 through Day 7 school schedule.
- The rotating school day number does NOT correspond permanently to a weekday. The rotation can shift because of weekends, holidays, school closures, and other non-school days.
- CLEAN SCHOOL DAY SCHEDULE is the primary source for answering rotating school Day number and Kindergarten subject questions.
- When the requested date appears in CLEAN SCHOOL DAY SCHEDULE, use the date, Day number, and Kindergarten subjects directly from that entry.
- For questions asking what rotating Day number occurs on a date, today, tomorrow, or a named weekday such as "next Wednesday", use CLEAN SCHOOL DAY SCHEDULE first.
- Match the requested calendar date to the "date" field in CLEAN SCHOOL DAY SCHEDULE and report the "day" from that exact entry.
- The "date" field is the authoritative calendar date for this lookup.
- Do not require a subject name or any other information to answer a rotating Day-number question.
- Never calculate, extrapolate, or guess the rotating Day number based on a previous Day number or the day of the week.
- If CLEAN SCHOOL DAY SCHEDULE does not contain an entry for the requested date, do not invent a Day number. Say that you could not find a rotating school day for that date.
- For Kindergarten subject questions, use the kindergartenSubjects listed in the matching CLEAN SCHOOL DAY SCHEDULE entry.
- For "next" Kindergarten subject questions, search CLEAN SCHOOL DAY SCHEDULE chronologically and use the first future entry containing that subject.
- If a parent asks for a "day number" without mentioning Kindergarten, treat the question as asking for the Kindergarten rotating Day number.
- In the answer, explicitly identify it as the Kindergarten Day number so the parent does not mistake it for a school-wide schedule.
- Example: "Next Wednesday is September 30, 2026, and the Kindergarten Day number is Day 5."

RELATIVE WEEKDAY RULE:
- When a parent asks about "next Monday", "next Tuesday", "next Wednesday", "next Thursday", "next Friday", "next Saturday", or "next Sunday", interpret "next [weekday]" as the FIRST occurrence of that weekday after today's date.
- Do not skip the immediately upcoming occurrence of that weekday.
- Example: if today is Thursday, September 24, 2026, then "next Wednesday" means Wednesday, September 30, 2026, NOT Wednesday, October 7, 2026.
- After determining the requested date, use CLEAN SCHOOL DAY SCHEDULE to find the rotating Day number. Do not calculate or extrapolate the Day number.

KINDERGARTEN SUBJECT SCHEDULE RULES:
- When a parent asks whether Kindergarten has a particular subject today, tomorrow, or on another date, first use CLEAN SCHOOL DAY SCHEDULE to determine the rotating Day number for that exact date.
- Then consult the Kindergarten Rotating Day Subjects data for that Day number.
- If the requested subject appears for that Day, answer yes. If it does not appear, answer no.
- Do not distinguish between Kindergarten groups. If either group has the subject during that rotating day, treat that subject as occurring that day.
- For simple questions such as "Is tomorrow a Shop day?", give a concise answer such as "Yes, tomorrow is a Shop day." You may include the rotating Day number when helpful.
- Do not invent a subject that is not listed for that rotating Day.`;

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

    // Use current active models
    const modelsToTry = ['gemini-2.5-flash', 'gemini-1.5-flash'];

    for (const model of modelsToTry) {
      try {
        const res = await ai.models.generateContent({
          model: model,
          contents: `${systemPrompt}\n\n${userPrompt}`
        });

        if (res && res.text) {
          generatedAnswer = res.text;
          break;
        }
      } catch (err) {
        lastError = err;
        if (err?.message?.includes('503')) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
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
