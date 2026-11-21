export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { accessToken, photosPassword } from '../../../../lib/photos';

// POST /api/photos/login (form field "password"). The password is the same one as the
// PhotoShelter gallery. A right password sets a cookie for 180 days.
export async function POST(req) {
  const form = await req.formData().catch(() => null);
  const typed = String(form?.get('password') || '').trim();
  const ok = Boolean(photosPassword()) && typed.toLowerCase() === photosPassword().toLowerCase();
  const res = Response.redirect(new URL(ok ? '/photos' : '/photos?wrong=1', req.url), 303);
  if (!ok) return res;
  const headers = new Headers(res.headers);
  headers.append(
    'Set-Cookie',
    `mb411_photos=${accessToken()}; Path=/; Max-Age=${180 * 24 * 3600}; HttpOnly; Secure; SameSite=Lax`
  );
  return new Response(null, { status: 303, headers });
}
