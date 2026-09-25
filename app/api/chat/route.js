import ical from 'node-ical';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// The 3 Moses Brown School Feeds
const FEEDS = [
  {
    name: 'Moses Brown Feed 1',
    url: 'https://mosesbrown.myschoolapp.com/podium/feed/iCal.aspx?z=E1N%2bZECWAsAfUGqeWaJ4wnh22O7R2ayGHKshoyBZzraNcPRLE4U8KT9k2M0zhuH2P9%2bDbSna%2foN60549yOti3A%3d%3d'
  },
  {
    name: 'Moses Brown Feed 2',
    url: 'https://mosesbrown.myschoolapp.com/podium/feed/iCal.aspx?z=KlHNKuuxoXtfzbPFgqNMvxUHicqnjIZL7PNpZ1LKKngZk1Kv6n9LDT%2bnqwQ3TAVKwNBhWCaTgBrM%2b8TVGnztew%3d%3d'
  },
  {
    name: 'Moses Brown Feed 3',
    url: 'https://mosesbrown.myschoolapp.com/podium/feed/iCal.aspx?z=Rqm3n0%2fQWNXMEzr%2fwnqblb7%2fxmkVj0jo6VXZllLKMPMuGj%2bhS7ogeDgxFqXuX7EaViX6SpZXpUC2QbIvm8CY2w%3d%3d'
  }
];

export async function POST(req) {
  try {
    const { question } = await req.json();

    // 1. Fetch & parse feeds concurrently
    const parsedFeeds = await Promise.all(
      FEEDS.map(async (feed) => {
        try {
          const events = await ical.async.fromURL(feed.url);
          return Object.values(events)
            .filter((item) => item.type === 'VEVENT')
            .map((e) => ({
              feed: feed.name,
              summary: e.summary || 'Untitled Event',
              start: e.start ? new Date(e.start).toISOString() : null,
              end: e.end ? new Date(e.end).toISOString() : null,
              location: e.location || 'Campus / Unspecified',
              description: e.description ? e.description.slice(0, 150) : ''
            }));
        } catch (err) {
          console.error(`Fetch failed for ${feed.name}:`, err);
          return [];
        }
      })
    );

    // 2. Flatten and sort chronologically
    const allEvents = parsedFeeds
      .flat()
      .filter((e) => e.start)
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    // 3. Compact text digest for context window
    const now = new Date().toISOString();
    const digest = allEvents.map((e) =>
      `• [${e.feed}] ${e.summary} | Start: ${e.start} | End: ${e.end} | Loc: ${e.location}${e.description ? ` | Note: ${e.description}` : ''}`
    ).join('\n');

    // 4. Send to Gemini 2.5 Flash
    const prompt = `You are a helpful school calendar assistant for Moses Brown School.
Current reference timestamp: ${now}

Calendar Data Across 3 Feeds:
${digest}

User Question: ${question}

Instructions:
- Provide clear, direct answers about dates, schedules, school events, days off, and potential conflicts.
- If an event belongs to a specific feed, note which feed or division it comes from.
- Keep responses conversational, concise, and easy to read.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt
    });

    return Response.json({ answer: response.text });
  } catch (error) {
    console.error('Error generating calendar response:', error);
    return Response.json({ error: 'Failed to query calendar schedule.' }, { status: 500 });
  }
}
