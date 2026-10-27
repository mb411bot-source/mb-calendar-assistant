export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { buildReminder } from '../../../lib/reminders';

// GET /api/reminders?type=share|tomorrow|week
// Returns { send, text } for Make to post to WhatsApp. ?date=YYYY-MM-DD pretends "today"
// is that date, for testing.
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || '';
  const date = searchParams.get('date');
  const today = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : undefined;

  try {
    const result = await buildReminder(type, today);
    return Response.json({ type, send: Boolean(result.send), text: result.text || '', reason: result.reason || '' });
  } catch (err) {
    return Response.json({ type, send: false, text: '', reason: `Error: ${err.message}` }, { status: 500 });
  }
}
