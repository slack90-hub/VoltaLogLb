const origins = new Set(['https://mdslb.com', 'https://www.mdslb.com']);
const maxBytes = 8192;

export async function handleRequest(request, env, send) {
  const origin = request.headers.get('Origin');
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin'
  };
  if (origins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
  if (new URL(request.url).pathname !== '/submit') return reply(404, { error: 'Not found.' });
  if (!origins.has(origin)) return reply(403, { error: 'This form is only available on the MIC website.' });
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      ...headers,
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '3600'
    } });
  }
  if (request.method !== 'POST') return reply(405, { error: 'Please submit the enquiry form.' });
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') {
    return reply(415, { error: 'Please submit the enquiry form.' });
  }
  if (!env.DELIVERY_ADDRESS || !env.SUBMISSIONS_PER_IP || !env.SUBMISSIONS_TOTAL) {
    return reply(503, { error: 'The form is temporarily unavailable. Please email mic@mdslb.com.' });
  }
  let data;
  try {
    if (Number(request.headers.get('Content-Length')) > maxBytes) throw new Error('size');
    const reader = request.body?.getReader();
    if (!reader) throw new Error('body');
    const chunks = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new Error('size');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('body');
  } catch {
    return reply(400, { error: 'Please check your enquiry and try again.' });
  }
  if (data.website) return reply(400, { error: 'Please leave the website field empty.' });
  const field = (name, max) => typeof data[name] === 'string' && data[name].trim().length <= max ? data[name].trim() : '';
  const name = field('name', 120);
  const phone = field('phone', 40);
  const email = field('email', 254);
  const interest = field('interest', 1000);
  const controlCharacters = /[\u0000-\u001f\u007f]/;
  if (!name || controlCharacters.test(name) || !phone || controlCharacters.test(phone)
      || !/^[+\d().\s-]+$/.test(phone) || (phone.match(/\d/g) || []).length < 6
      || !/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(email)
      || /[\s\r\n]/.test(email) || !interest || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(interest)) {
    return reply(400, { error: 'Please enter your name, a valid phone number, email address and interest.' });
  }
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const perIp = await env.SUBMISSIONS_PER_IP.limit({ key: ip });
    if (!perIp.success) return reply(429, { error: 'Please wait a minute before sending another enquiry.' });
    const total = await env.SUBMISSIONS_TOTAL.limit({ key: 'mic-survey' });
    if (!total.success) return reply(429, { error: 'The form is busy. Please try again in a minute.' });
    const body = [
      'New MIC website enquiry', '',
      `Name: ${name}`, `Phone: ${phone}`, `Email: ${email}`, '',
      'Interest:', interest, '',
      `Submitted: ${new Date().toISOString()}`,
      'Website: https://mdslb.com/mic/', '',
      'The visitor agreed to be contacted about this enquiry.'
    ].join('\r\n');
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(body)));
    const raw = [
      'From: MIC Website <mic@mdslb.com>',
      'To: Murex Insurance Consultancy <mic@mdslb.com>',
      `Reply-To: ${email}`,
      'Subject: New MIC website enquiry',
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@mdslb.com>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64', '',
      encoded.match(/.{1,76}/g).join('\r\n'), ''
    ].join('\r\n');
    // Send only to MIC's server-configured, verified forwarding destination.
    // No visitor input can change the recipient or authenticated sender.
    await send(raw);
    return reply(200, { ok: true });
  } catch {
    // Never log contact details or provider errors containing message contents.
    return reply(502, { error: 'Your enquiry could not be sent. Please try again or email mic@mdslb.com.' });
  }
}
