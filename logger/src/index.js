// Visitor logger for travels.birovince.com
// POST /log        — records one visit (called by a beacon on the page)
// GET  /logs?key=… — returns recent visits as JSON (key must match LOG_KEY secret)

const ALLOWED_ORIGINS = [
  'https://travels.birovince.com',
  'https://austria.birovince.com',
];

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function parseOS(ua) {
  if (/iPhone|iPad|iPod/.test(ua)) {
    const m = ua.match(/OS (\d+[._]\d+)/);
    return 'iOS' + (m ? ' ' + m[1].replace('_', '.') : '');
  }
  if (/Android/.test(ua)) {
    const m = ua.match(/Android (\d+(\.\d+)?)/);
    return 'Android' + (m ? ' ' + m[1] : '');
  }
  if (/Mac OS X/.test(ua)) {
    const m = ua.match(/Mac OS X (\d+[._]\d+)/);
    return 'macOS' + (m ? ' ' + m[1].replace(/_/g, '.') : '');
  }
  if (/Windows NT/.test(ua)) {
    const m = ua.match(/Windows NT (\d+\.\d+)/);
    const names = { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' };
    return 'Windows' + (m && names[m[1]] ? ' ' + names[m[1]] : '');
  }
  if (/Linux/.test(ua)) return 'Linux';
  return 'unknown';
}

function parseBrowser(ua) {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
  if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'Safari';
  if (/Firefox\//.test(ua)) return 'Firefox';
  return 'unknown';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (url.pathname === '/log' && request.method === 'POST') {
      const ua = request.headers.get('User-Agent') || '';
      const cf = request.cf || {};
      let client = {};
      try { client = await request.json(); } catch (_) { /* beacon may send no body */ }

      const now = new Date().toISOString();
      const entry = {
        time: now,
        ip: request.headers.get('CF-Connecting-IP') || '',
        os: parseOS(ua),
        browser: parseBrowser(ua),
        ua,
        country: cf.country || '',
        city: cf.city || '',
        region: cf.region || '',
        site: (request.headers.get('Origin') || '').replace('https://', ''),
        path: url.searchParams.get('p') || '',
        referrer: typeof client.ref === 'string' ? client.ref.slice(0, 200) : '',
        screen: typeof client.screen === 'string' ? client.screen.slice(0, 20) : '',
        language: (request.headers.get('Accept-Language') || '').split(',')[0],
      };

      // ISO-timestamp keys sort chronologically; keep entries for 90 days
      const key = `${now}_${crypto.randomUUID().slice(0, 8)}`;
      await env.VISITS.put(key, JSON.stringify(entry), { expirationTtl: 60 * 60 * 24 * 90 });

      return new Response('ok', { status: 200, headers: corsHeaders(request) });
    }

    if (url.pathname === '/logs' && request.method === 'GET') {
      if (url.searchParams.get('key') !== env.LOG_KEY) {
        return new Response('forbidden', { status: 403 });
      }
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
      // Collect all keys (newest last), then fetch the most recent `limit`
      const keys = [];
      let cursor;
      do {
        const page = await env.VISITS.list({ cursor });
        keys.push(...page.keys.map(k => k.name));
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      const recent = keys.sort().slice(-limit).reverse();
      const entries = await Promise.all(recent.map(async k => JSON.parse(await env.VISITS.get(k))));
      return new Response(JSON.stringify({ total: keys.length, entries }, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/clear' && request.method === 'GET') {
      if (url.searchParams.get('key') !== env.LOG_KEY) {
        return new Response('forbidden', { status: 403 });
      }
      let deleted = 0;
      let cursor;
      do {
        const page = await env.VISITS.list({ cursor });
        await Promise.all(page.keys.map(k => env.VISITS.delete(k.name)));
        deleted += page.keys.length;
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      return new Response(JSON.stringify({ deleted }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('not found', { status: 404 });
  },
};
