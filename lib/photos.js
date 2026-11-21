// Kindergarten photos: reads Ella's PhotoShelter gallery so /photos can show it by
// upload day and hand out full-size downloads. Nothing is copied or stored here.
//
// The gallery password comes from the PHOTOSHELTER_PASSWORD environment variable
// (set in Vercel). The api_key below is PhotoShelter's public key for this site; it is
// in the gallery page's own HTML.

import { createHash } from 'crypto';

const HOST = 'https://o000006259.photoshelter.com';
const API_KEY = 'DOD4yYEYgGY';
export const GALLERY_ID = 'G0000jpgNGkfyGB8';
export const GALLERY_URL = `${HOST}/galleries/C0000R064Lz1pBB0/${GALLERY_ID}/2026-2027`;

const TZ = 'America/New_York';
const MAX_PAGES = 40;

export function photosPassword() {
  return process.env.PHOTOSHELTER_PASSWORD || '';
}

// The value stored in the visitor's cookie after they type the password. It changes
// if the password changes, which signs everyone out.
export function accessToken() {
  const pw = photosPassword();
  return pw ? createHash('sha256').update(`mb411-photos:${pw}`).digest('hex').slice(0, 32) : '';
}

export function hasAccess(cookieValue) {
  const token = accessToken();
  return Boolean(token) && cookieValue === token;
}

// PhotoShelter dates look like "2026-11-20 22:22:01 GMT".
function parseDate(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(' GMT', 'Z').replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

function easternDay(d) {
  return d.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
}

function thumbUrl(id, fileName) {
  const name = String(fileName || 'photo').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-');
  return `https://m.psecn.photoshelter.com/img-get2/${id}/fit=500x500/${name}.jpg`;
}

// Every photo in the gallery, newest upload first:
// [{ id, name, thumb, uploaded: Date, taken: Date|null, day: 'YYYY-MM-DD' }]
export async function listPhotos() {
  const pw = photosPassword();
  if (!pw) throw new Error('PHOTOSHELTER_PASSWORD is not set');
  const extend = encodeURIComponent(JSON.stringify({ Image: {}, Iptc: {} }));
  const seen = new Set();
  const photos = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${HOST}/psapi/v3/gallery/${GALLERY_ID}/images?api_key=${API_KEY}` +
      `&password=${encodeURIComponent(pw)}&per_page=250&page=${page}` +
      `&sort_by=uploaded_at&sort_dir=desc&extend=${extend}`;
    const res = await fetch(url, { next: { revalidate: 600 } });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.status !== 'ok') {
      throw new Error(`PhotoShelter returned ${res.status}: ${json?.error?.message || 'no data'}`);
    }
    const items = json.data?.GalleryImage || [];
    for (const item of items) {
      if (seen.has(item.image_id)) continue;
      seen.add(item.image_id);
      const iptc = item.Image?.Iptc || item.Iptc || {};
      const uploaded = parseDate(iptc.ctime) || new Date(0);
      photos.push({
        id: item.image_id,
        name: item.Image?.file_name || item.image_id,
        thumb: thumbUrl(item.image_id, item.Image?.file_name),
        uploaded,
        taken: parseDate(iptc.sdate),
        day: easternDay(uploaded)
      });
    }
    if (!items.length || !json.data?.Paging?.next) break;
  }
  photos.sort((a, b) => b.uploaded - a.uploaded);
  return photos;
}

// Photos grouped by the day they were uploaded (Eastern time), newest day first.
// Within a day, photos are in the order they were taken.
export function groupByDay(photos) {
  const days = new Map();
  for (const p of photos) {
    if (!days.has(p.day)) days.set(p.day, []);
    days.get(p.day).push(p);
  }
  return [...days.entries()].map(([day, list]) => ({
    day,
    photos: list.sort((a, b) => (a.taken || a.uploaded) - (b.taken || b.uploaded))
  }));
}

// Asks PhotoShelter for a download link. One photo comes back as a JPEG, several as a
// zip. `size` is the long edge in pixels (default 4096, about full size).
export async function downloadLink(ids, size = null) {
  const pw = photosPassword();
  if (!pw) throw new Error('PHOTOSHELTER_PASSWORD is not set');
  const form = new URLSearchParams();
  form.append('api_key', API_KEY);
  form.append('password', pw);
  form.append('gallery_id', GALLERY_ID);
  for (const id of ids) form.append('media_ids[]', id);
  form.append('download_image_filetype', 'jpeg');
  form.append('download_image_size', String(size || 4096));
  const res = await fetch(`${HOST}/psapi/v3/download_link`, {
    method: 'POST',
    body: form,
    cache: 'no-store'
  });
  const json = await res.json().catch(() => null);
  const link = json?.data?.DownloadLink?.[0]?.link;
  if (!res.ok || !link) {
    throw new Error(`PhotoShelter download failed (${res.status}): ${json?.error?.message || 'no link'}`);
  }
  return link;
}
