import { DurableObject } from 'cloudflare:workers';
import { timingSafeEqual } from 'node:crypto';
import { EmailMessage } from 'cloudflare:email';
import html from '../public/index.html';
import css from '../public/style.css';
import app from '../public/app.txt';
import cryptography from '../public/crypto.txt';
import passphraseClient from '../public/passphrase.txt';
import {credential, publicCredential, proofHash, equalProof, stagePassphrase, confirmPassphrase} from './passphrases.mjs';
import { shouldNotify, validEnvelope } from './rules.mjs';
const TTL = 8 * 60 * 60 * 1000;
const COOKIE = '__Host-room';
const headers = {
  'cache-control': 'no-store, max-age=0', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'strict-transport-security': 'max-age=31536000',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
};
const json = (data, status = 200, extra = {}) => Response.json(data, {status, headers: {...headers, ...extra}});
const enc = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const hash = async value => b64(await crypto.subtle.digest('SHA-256', enc.encode(value)));
const eq = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(enc.encode(a), enc.encode(b));
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
async function body(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Request body required.');
  let size = 0; const chunks = [];
  while (true) {
    const {done, value} = await reader.read(); if (done) break;
    size += value.length;
    if (size > 34000) { await reader.cancel(); throw new HttpError(413, 'Message is too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(400, 'Invalid request.'); }
}
function cookie(token, age = TTL / 1000) { return `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`; }
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) {
        if (request.method !== 'GET' || url.pathname === '/api/live') {
          if (request.headers.get('origin') !== url.origin) return json({error: 'Request origin rejected.'}, 403);
        }
        return await env.ROOM.getByName('nad-maria-v1').fetch(request);
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return json({error: 'Method not allowed.'}, 405);
      const assets = {'/': [html, 'text/html'], '/style.css': [css, 'text/css'], '/app.mjs': [app, 'text/javascript'], '/crypto.mjs': [cryptography, 'text/javascript'], '/passphrase.mjs': [passphraseClient, 'text/javascript'], '/robots.txt': ['User-agent: *\nDisallow: /\n', 'text/plain']};
      const asset = assets[url.pathname];
      if (!asset) return new Response('Not found', {status: 404, headers});
      return new Response(request.method === 'HEAD' ? null : asset[0], {headers: {...headers, 'content-type': `${asset[1]}; charset=utf-8`}});
    } catch (error) {
      // Never log request bodies, credentials or conversation metadata.
      return json({error: error.status ? error.message : 'The room is temporarily unavailable. Please retry.'}, error.status || 503);
    }
  },
  async scheduled(event, env) { await env.ROOM.getByName('nad-maria-v1').wake(); }
};
export class PrivateRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user TEXT NOT NULL, expires INTEGER NOT NULL, auth_version TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, sender TEXT NOT NULL, iv TEXT NOT NULL, ciphertext TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts (user TEXT PRIMARY KEY, delivered INTEGER NOT NULL DEFAULT 0, seen INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, created INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_try INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending');
      CREATE TABLE IF NOT EXISTS passphrases (user TEXT PRIMARY KEY, id TEXT NOT NULL, salt TEXT NOT NULL, iterations INTEGER NOT NULL, iv TEXT NOT NULL, wrapped_key TEXT NOT NULL, verifier TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS passphrase_pending (user TEXT PRIMARY KEY, id TEXT NOT NULL, salt TEXT NOT NULL, iterations INTEGER NOT NULL, iv TEXT NOT NULL, wrapped_key TEXT NOT NULL, verifier TEXT NOT NULL, created INTEGER NOT NULL, session_token TEXT NOT NULL, base_id TEXT NOT NULL);`);
  }
  rows(query, ...args) { return this.sql.exec(query, ...args).toArray(); }
  config() {
    try { const config = JSON.parse(this.env.AUTH_CONFIG); if (!config.nad || !config.maria || !config.fingerprint) throw new Error(); return config; }
    catch { throw new HttpError(503, 'This room has not been activated yet.'); }
  }
  limit(key, max, windowMs) {
    const now = Date.now(); this.sql.exec('DELETE FROM attempts WHERE until < ?', now);
    const old = this.rows('SELECT * FROM attempts WHERE key = ?', key)[0];
    if (old && old.count >= max) throw new HttpError(429, 'Please wait a few minutes before trying again.');
    this.sql.exec('INSERT INTO attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count = count + 1', key, now + windowMs);
  }
  async session(request) {
    const token = request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(401, 'Please sign in again.');
    const digest = await hash(token);
    const session = this.rows('SELECT * FROM sessions WHERE token = ? AND expires > ?', digest, Date.now())[0];
    if (!session || session.auth_version !== await hash(this.env.AUTH_CONFIG || '')) throw new HttpError(401, 'Please sign in again.');
    return session;
  }
  message(row) { return {...row, version: 1}; }
  async fetch(request) {
    // Catch here as well: RPC boundaries do not preserve custom Error fields.
    try { return await this.route(request); }
    catch (error) { return json({error:error.status ? error.message : 'The room is temporarily unavailable. Please retry.'}, error.status || 503); }
  }
  async route(request) {
    const url = new URL(request.url); const path = url.pathname; const config = this.config();
    if (path === '/api/signin-info' && request.method === 'GET') {
      this.limit(`info:${await hash(request.headers.get('cf-connecting-ip') || 'local')}`, 120, 15 * 60000);
      const user=url.searchParams.get('user');
      if(!['nad','maria'].includes(user)) throw new HttpError(400,'Choose your account.');
      const record=credential(this,user);
      return json(record?{enrolled:true,id:record.id,salt:record.salt,iterations:record.iterations}:{enrolled:false});
    }
    if (path === '/api/login' && request.method === 'POST') {
      this.limit(`login:${await hash(request.headers.get('cf-connecting-ip') || 'local')}`, 12, 15 * 60000);
      const data = await body(request); const user = data.user;
      if (!['nad', 'maria'].includes(user)) throw new HttpError(401, 'Account or password is incorrect.');
      let passphraseRecord;
      if(data.mode==='passphrase') {
        if(!/^[A-Za-z0-9_-]{43}$/.test(data.authProof)) throw new HttpError(401,'Passphrase is incorrect.');
        passphraseRecord=credential(this,user);
        const verifier=await proofHash(data.authProof);
        if(!passphraseRecord||passphraseRecord.id!==data.id||!equalProof(verifier,passphraseRecord.verifier)) throw new HttpError(401,'Passphrase is incorrect.');
      } else {
        if(typeof data.password!=='string'||data.password.length>200) throw new HttpError(401,'Account or password is incorrect.');
        const record=config[user];
        if(!eq(await hash(`${record.salt}:${data.password}`),record.hash)) throw new HttpError(401,'Account or password is incorrect.');
      }
      const token=b64(crypto.getRandomValues(new Uint8Array(32)));const version=await hash(this.env.AUTH_CONFIG);const tokenHash=await hash(token);
      // Do not mint an old-credential session if setup completed during hashing.
      if(passphraseRecord&&credential(this,user)?.id!==passphraseRecord.id) throw new HttpError(401,'Passphrase changed. Please try again.');
      this.sql.exec('DELETE FROM sessions WHERE expires < ?',Date.now());
      this.sql.exec('INSERT INTO sessions VALUES (?,?,?,?)',tokenHash,user,Date.now()+TTL,version);
      return json({user,fingerprint:config.fingerprint,passphraseReady:!!credential(this,user),envelope:passphraseRecord?publicCredential(passphraseRecord):undefined},200,{'set-cookie':cookie(token)});
    }
    const session = await this.session(request);
    if (path === '/api/passphrase/stage' && request.method === 'POST') return json({envelope:await stagePassphrase(this,session,await body(request))});
    if (path === '/api/passphrase/confirm' && request.method === 'POST') return json({envelope:await confirmPassphrase(this,session,await body(request)),passphraseReady:true});
    if (path === '/api/me' && request.method === 'GET') return json({user: session.user, fingerprint: config.fingerprint, passphraseReady: !!credential(this,session.user), emailReady: this.env.EMAIL_ENABLED === 'true' || !!(this.env.RESEND_API_KEY && this.env.ALERT_FROM && this.env.ALERT_TO), failedAlerts: this.rows("SELECT count(*) AS n FROM outbox WHERE state = 'failed'")[0].n, alerts: session.user === 'nad' ? this.rows('SELECT state,count(*) AS count FROM outbox GROUP BY state') : undefined});
    if (path === '/api/logout' && request.method === 'POST') {
      this.sql.exec('DELETE FROM sessions WHERE token = ?', session.token);
      for (const socket of this.ctx.getWebSockets()) if (socket.deserializeAttachment()?.token === session.token) socket.close(1000, 'Locked');
      return json({ok: true}, 200, {'set-cookie': cookie('', 0)});
    }
    if (path === '/api/messages' && request.method === 'GET') {
      const before = Math.max(1, Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER);
      const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
      const order = url.searchParams.has('after') ? 'ASC' : 'DESC';
      const messages = this.rows(`SELECT * FROM messages WHERE seq < ? AND seq > ? ORDER BY seq ${order} LIMIT 100`, before, after).map(row => this.message(row));
      return json({messages: messages.sort((a,b) => a.seq-b.seq), receipts: this.rows('SELECT * FROM receipts'), more: messages.length === 100});
    }
    if (path === '/api/messages' && request.method === 'POST') {
      const data = await body(request); if (!validEnvelope(data)) throw new HttpError(400, 'Invalid encrypted message.');
      const checkDuplicate = existing => {
        if (existing.sender !== session.user || existing.iv !== data.iv || existing.ciphertext !== data.ciphertext) throw new HttpError(409, 'Message identifier already used.');
        return existing;
      };
      const existing = this.rows('SELECT * FROM messages WHERE id = ?', data.id)[0];
      if (existing) return json({message:this.message(checkDuplicate(existing))});
      this.limit(`send:${session.user}`, 60, 60000);
      // Arm before the synchronous transaction, with a cron fallback.
      if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(Date.now() + 1000);
      let inserted;
      this.ctx.storage.transactionSync(() => {
        const duplicate = this.rows('SELECT * FROM messages WHERE id = ?', data.id)[0];
        if (duplicate) { inserted = checkDuplicate(duplicate); return; }
        const previous = this.rows('SELECT created FROM messages ORDER BY seq DESC LIMIT 1')[0]; const now = Date.now();
        inserted = this.rows('INSERT INTO messages (id,sender,iv,ciphertext,created) VALUES (?,?,?,?,?) RETURNING *', data.id, session.user, data.iv, data.ciphertext, now)[0];
        if (shouldNotify(session.user, previous?.created ?? null, now)) this.sql.exec('INSERT INTO outbox (id,created,next_try) VALUES (?,?,?)', data.id, now, now);
      });
      await this.broadcast({type: 'refresh'});
      return json({message: this.message(inserted)}, 201);
    }
    if (path === '/api/receipt' && request.method === 'POST') {
      const data = await body(request); const maximum = this.rows('SELECT coalesce(max(seq),0) AS n FROM messages')[0].n;
      const delivered = Math.min(maximum, Math.max(0, Math.floor(Number(data.delivered) || 0)));
      const seen = Math.min(delivered, Math.max(0, Math.floor(Number(data.seen) || 0)));
      this.sql.exec('INSERT INTO receipts VALUES (?,?,?) ON CONFLICT(user) DO UPDATE SET delivered=max(delivered,excluded.delivered),seen=max(seen,excluded.seen)', session.user, delivered, seen);
      await this.broadcast({type: 'receipts', receipts: this.rows('SELECT * FROM receipts')});
      return json({ok: true});
    }
    if (path === '/api/live' && request.method === 'GET' && request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      if (this.ctx.getWebSockets().length >= 12) throw new HttpError(429, 'Too many open tabs. Close an unused chat tab.');
      const pair = new WebSocketPair(); this.ctx.acceptWebSocket(pair[1]); pair[1].serializeAttachment(session);
      return new Response(null, {status: 101, webSocket: pair[0]});
    }
    throw new HttpError(404, 'Not found.');
  }
  async active(socket) {
    const session = socket.deserializeAttachment();
    if (!session || session.expires <= Date.now() || session.auth_version !== await hash(this.env.AUTH_CONFIG || '') || !this.rows('SELECT token FROM sessions WHERE token = ?', session.token).length) { socket.close(1008, 'Please sign in again'); return null; }
    return session;
  }
  async broadcast(data, excludeUser) {
    for (const socket of this.ctx.getWebSockets()) {
      try { const session = await this.active(socket); if (session && session.user !== excludeUser) socket.send(JSON.stringify(data)); } catch { /* closed connection */ }
    }
  }
  async webSocketMessage(socket, message) {
    const session = await this.active(socket); if (!session) return;
    if (typeof message !== 'string' || message.length > 100) { socket.close(1009); return; }
    if (message === 'ping') { socket.send(JSON.stringify({type:'pong'})); return; }
    if (message === 'typing') {
      try { this.limit(`typing:${session.user}`, 30, 60000); await this.broadcast({type:'typing', user:session.user}, session.user); } catch { /* drop excess typing updates */ }
    }
  }
  async wake() { await this.alarm(); }
  async alarm() {
    const now = Date.now(); this.sql.exec('DELETE FROM sessions WHERE expires < ?', now); this.sql.exec('DELETE FROM attempts WHERE until < ?', now);
    this.sql.exec("UPDATE outbox SET state = 'failed' WHERE state = 'pending' AND created < ?", now - 23 * 60 * 60 * 1000);
    const ready = this.env.EMAIL_ENABLED === 'true' || !!(this.env.RESEND_API_KEY && this.env.ALERT_FROM && this.env.ALERT_TO);
    const jobs = this.rows("SELECT * FROM outbox WHERE state='pending' AND next_try <= ? ORDER BY created LIMIT 10", now);
    for (const job of jobs) {
      this.sql.exec('UPDATE outbox SET next_try=?, attempts=attempts+1 WHERE id=?', now + 120000, job.id);
      if (!ready) continue;
      try {
        if (this.env.EMAIL_ENABLED === 'true' && this.env.EMAIL) {
          // Stable Message-ID helps mail systems deduplicate, but email is at-least-once.
          const raw = [`From: Private Room <${this.env.ALERT_FROM}>`, `To: ${this.env.ALERT_TO}`, 'Subject: You have a new private message', `Message-ID: <room-${job.id}@mdslb.com>`, `Date: ${new Date(job.created).toUTCString()}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', 'A new private message is waiting for you. Open your saved private room link to read it.'].join('\r\n');
          await this.env.EMAIL.send(new EmailMessage(this.env.ALERT_FROM, this.env.ALERT_TO, raw));
          this.sql.exec("UPDATE outbox SET state='sent' WHERE id=?", job.id);
        } else {
          const response = await fetch('https://api.resend.com/emails', {
            method:'POST', signal:AbortSignal.timeout(15000),
            headers:{authorization:`Bearer ${this.env.RESEND_API_KEY}`, 'content-type':'application/json', 'idempotency-key':`room-v1-${job.id}`},
            body:JSON.stringify({from:this.env.ALERT_FROM, to:[this.env.ALERT_TO], subject:'You have a new private message', text:'A new private message is waiting for you. Open your saved private room link to read it.'})
          });
          await response.body?.cancel();
          if (response.ok) this.sql.exec("UPDATE outbox SET state='sent' WHERE id=?", job.id);
          else this.sql.exec('UPDATE outbox SET next_try=? WHERE id=?', now + Math.min(3600000, 60000 * 2 ** Math.min(job.attempts, 6)), job.id);
        }
      } catch { /* Durable outbox retries; never log recipient or message. */ }
    }
    const next = this.rows("SELECT min(next_try) AS time FROM outbox WHERE state='pending'")[0].time;
    if (next !== null) await this.ctx.storage.setAlarm(Math.max(Date.now() + 60000, next));
  }
}
