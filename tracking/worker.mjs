const allowedOrigins = new Set(['https://mdslb.com', 'https://www.mdslb.com']);
const headers = {
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
};
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { ...headers, 'content-type': 'application/json', ...extra },
});
async function authenticated(request, secret) {
  if (!secret) return false;
  let credentials;
  try { credentials = atob((request.headers.get('authorization') || '').replace(/^Basic /, '')); }
  catch { return false; }
  const digest = value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [a, b] = await Promise.all([digest(credentials), digest(`admin:${secret}`)]);
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < aa.length; i++) difference |= aa[i] ^ bb[i];
  return difference === 0;
}
const escapeHtml = value => String(value ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/events') {
      const origin = request.headers.get('origin');
      if (!allowedOrigins.has(origin)) return json({error:'Origin not allowed'}, 403);
      const cors = {'access-control-allow-origin':origin, 'vary':'Origin'};
      if (request.method === 'OPTIONS') return new Response(null, {status:204, headers:{...headers,...cors,'access-control-allow-methods':'POST','access-control-allow-headers':'content-type'}});
      if (request.method !== 'POST') return json({error:'Method not allowed'}, 405, cors);
      if (!env.DB) return json({error:'Storage unavailable'}, 503, cors);
      try {
        if (Number(request.headers.get('content-length')) > 512) return json({error:'Too large'},413,cors);
        const reader = request.body?.getReader();
        if (!reader) return json({error:'Missing body'},400,cors);
        let text = '', bytes = 0;
        const decoder = new TextDecoder();
        while (true) {
          const part = await reader.read(); if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 512) { await reader.cancel(); return json({error:'Too large'},413,cors); }
          text += decoder.decode(part.value,{stream:true});
        }
        text += decoder.decode();
        let event;
        try { event = JSON.parse(text); } catch { return json({error:'Invalid JSON'},400,cors); }
        if (!event || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.id) || !['key_success','gallery_open'].includes(event.type)) return json({error:'Invalid event'},400,cors);
        // One row per unlock: retries cannot inflate totals; either event can arrive first.
        const column = event.type === 'key_success' ? 'key_at' : 'opened_at';
        await env.DB.prepare(`INSERT INTO gallery_sessions (id, ${column}) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(id) DO UPDATE SET ${column} = COALESCE(gallery_sessions.${column}, excluded.${column})`).bind(event.id).run();
        return json({ok:true},200,cors);
      } catch { return json({error:'Could not record event'},503,cors); }
    }
    if (url.pathname !== '/' && url.pathname !== '/stats') return json({error:'Not found'},404);
    if (!await authenticated(request, env.ADMIN_PASSWORD)) return new Response('Sign in to view gallery statistics.', {status:401,headers:{...headers,'www-authenticate':'Basic realm="Murex statistics", charset="UTF-8"'}});
    if (request.method !== 'GET') return json({error:'Method not allowed'},405);
    try {
      const [totals, start, daily] = await Promise.all([
        env.DB.prepare('SELECT COUNT(key_at) AS key_successes, COUNT(opened_at) AS gallery_opens, MAX(key_at) AS last_key, MAX(opened_at) AS last_open FROM gallery_sessions').first(),
        env.DB.prepare('SELECT started_at FROM tracking_metadata WHERE id=1').first(),
        env.DB.prepare(`SELECT day, SUM(keys) AS key_successes, SUM(opens) AS gallery_opens FROM (SELECT substr(key_at,1,10) AS day, COUNT(*) AS keys, 0 AS opens FROM gallery_sessions WHERE key_at IS NOT NULL GROUP BY day UNION ALL SELECT substr(opened_at,1,10) AS day, 0 AS keys, COUNT(*) AS opens FROM gallery_sessions WHERE opened_at IS NOT NULL GROUP BY day) GROUP BY day ORDER BY day DESC LIMIT 30`).all(),
      ]);
      const data = {...totals, started_at:start?.started_at, days:daily.results};
      if (url.pathname === '/stats') return json(data);
      const rows = data.days.map(d => `<tr><td>${escapeHtml(d.day)}</td><td>${d.key_successes}</td><td>${d.gallery_opens}</td></tr>`).join('');
      return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Murex statistics</title><style>body{margin:0;background:#080c1b;color:#f9f1e0;font:17px/1.6 system-ui}main{max-width:800px;margin:auto;padding:40px 24px}.cards{display:flex;gap:20px;flex-wrap:wrap}.card{padding:24px;background:#171d32;border:1px solid #45435a;border-radius:18px;flex:1}strong{display:block;font-size:48px}p{color:#c1c6d6}table{width:100%;border-collapse:collapse}th,td{padding:12px;text-align:left;border-bottom:1px solid #45435a}a{color:#ffe1a1}</style><main><h1>Murex statistics</h1><p>Tracking started: ${escapeHtml(data.started_at)} (UTC)</p><div class="cards"><div class="card">Successful key entries<strong>${data.key_successes}</strong></div><div class="card">Gallery opens with a loaded photo<strong>${data.gallery_opens}</strong></div></div><p>Last successful key: ${escapeHtml(data.last_key)}<br>Last gallery open: ${escapeHtml(data.last_open)}</p><p><a href="/">Refresh counts</a></p><h2>Daily activity (UTC)</h2><table><thead><tr><th>Date</th><th>Successful keys</th><th>Gallery opens</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No events recorded yet.</td></tr>'}</tbody></table><p>Each new unlock counts again. Browsing between photos does not. Counts are browser-reported events, not unique people. Blocked requests or offline visits may be missed; older activity cannot be recovered.</p></main></html>`,{headers:{...headers,'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"}});
    } catch { return json({error:'Statistics storage unavailable'},503); }
  }
};
