import { timingSafeEqual } from 'node:crypto';

const noCache = (res) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Vary', 'Authorization');
};

const secureEqual = (supplied, expected) => {
  if (typeof supplied !== 'string' || typeof expected !== 'string') return false;
  const x = Buffer.from(supplied);
  const y = Buffer.from(expected);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

export default async function handler(req, res) {
  noCache(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const expected = process.env.EDGE_LAB_VIEW_TOKEN;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!expected || expected.length < 24 || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url || '') || !key) {
    return res.status(503).json({ error: 'EDGE_LAB_HISTORY_NOT_CONFIGURED' });
  }

  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ') || !secureEqual(authorization.slice(7), expected)) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 9000);
  try {
    const response = await fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/edge_lab_slip_history_v1', {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{}',
      cache: 'no-store',
      redirect: 'error',
      signal: abort.signal
    });
    if (!response.ok) return res.status(503).json({ error: 'ARCHIVE_UNAVAILABLE' });
    const data = await response.json();
    if (!Array.isArray(data)) return res.status(503).json({ error: 'ARCHIVE_INVALID_RESPONSE' });
    return res.status(200).json({ slips: data.slice(0, 200) });
  } catch {
    return res.status(503).json({ error: 'ARCHIVE_UNAVAILABLE' });
  } finally {
    clearTimeout(timeout);
  }
}
