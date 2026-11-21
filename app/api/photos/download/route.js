export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { cookies } from 'next/headers';
import { downloadLink, hasAccess, listPhotos } from '../../../../lib/photos';

const ID = /^I0000[A-Za-z0-9._]{11}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ZIP_SIZE = 2048; // long edge for a whole day's zip, so it stays a sensible size

// GET /api/photos/download?id=I0000...   one photo as a full-size JPEG
// GET /api/photos/download?day=YYYY-MM-DD  every photo uploaded that day, as a zip
// Sends the browser on to PhotoShelter's own download link.
export async function GET(req) {
  if (!hasAccess(cookies().get('mb411_photos')?.value)) {
    return Response.redirect(new URL('/photos', req.url), 303);
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id') || '';
  const day = searchParams.get('day') || '';

  try {
    if (ID.test(id)) {
      return Response.redirect(await downloadLink([id]), 302);
    }
    if (DAY.test(day)) {
      const ids = (await listPhotos()).filter((p) => p.day === day).map((p) => p.id);
      if (!ids.length) return new Response('No photos were uploaded that day.', { status: 404 });
      return Response.redirect(await downloadLink(ids, ZIP_SIZE), 302);
    }
    return new Response('Missing photo or day.', { status: 400 });
  } catch (err) {
    return new Response(`Sorry, the download didn't work: ${err.message}`, { status: 502 });
  }
}
