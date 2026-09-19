import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {createHash,randomBytes} from 'node:crypto';
import {encrypt,unlock} from '../public/crypto.mjs';
const digest=value=>createHash('sha256').update(value).digest('base64url');
const passwords={nad:randomBytes(32).toString('base64url'),maria:randomBytes(32).toString('base64url')};
const raw=randomBytes(32); const config={fingerprint:digest(raw)};
for(const user of ['nad','maria']) config[user]={salt:user,hash:digest(`${user}:${passwords[user]}`)};
await build({entryPoints:['test/bridge.mjs'],outfile:'dist/test-worker.mjs',bundle:true,format:'esm',platform:'neutral',external:['cloudflare:*','node:*'],loader:{'.html':'text','.css':'text','.txt':'text'}});
test('real Workers runtime: auth, persistence, concurrency, receipts, email outbox and logout',async t=>{
  const mail=[];let rejectMail=false;
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/test-worker.mjs',compatibilityDate:'2026-09-19',compatibilityFlags:['nodejs_compat'],durableObjects:{ROOM:{className:'TestRoom',useSQLite:true}},bindings:{AUTH_CONFIG:JSON.stringify(config),RESEND_API_KEY:'test-key',ALERT_FROM:'test@example.com',ALERT_TO:'recipient@example.com'},outboundService:async request=>{
    mail.push({body:await request.json(),key:request.headers.get('idempotency-key')});return new Response('{}',{status:rejectMail?503:200});
  }}));
  const request=async(path,{userCookie,data,origin='https://room.test',method}={})=>mf.dispatchFetch(`https://room.test${path}`,{method:method||(data===undefined?'GET':'POST'),headers:{origin,...(userCookie?{cookie:userCookie}:{}),'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  const sql=async(query,args=[])=> (await request('/__test',{data:{query,args}})).json();
  const wake=async()=>request('/__test',{data:{wake:true}});
  const reset=async()=>{await sql('DELETE FROM messages');await sql('DELETE FROM outbox');await sql('DELETE FROM receipts');mail.length=0;};
  const login=async user=>{const response=await request('/api/login',{data:{user,password:passwords[user]}});assert.equal(response.status,200,await response.clone().text());assert.match(response.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Strict/);return response.headers.get('set-cookie').split(';')[0];};
  try {
    const key=await unlock(raw.toString('base64url'),config.fingerprint);
    await t.test('anonymous, forged and cross-origin access are rejected',async()=>{
      assert.equal((await request('/api/messages')).status,401);
      assert.equal((await request('/api/messages',{userCookie:'__Host-room=forged'})).status,401);
      assert.equal((await request('/api/login',{data:{user:'nad',password:passwords.nad},origin:'https://evil.test'})).status,403);
      assert.equal((await request('/api/login',{data:{user:'maria',password:'wrong'}})).status,401);
      assert.equal((await request('/api/register',{data:{user:'third'}})).status,401);
      const page=await request('/');assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(page.headers.get('cache-control'),/no-store/);
    });
    const nad=await login('nad'),maria=await login('maria');
    await t.test('first Maria message creates one alert; concurrent duplicate creates one message',async()=>{
      await reset();const envelope=await encrypt(key,'maria','Private test');
      const results=await Promise.all([request('/api/messages',{userCookie:maria,data:envelope}),request('/api/messages',{userCookie:maria,data:envelope})]);
      for(const response of results) assert.ok(response.ok,await response.text());
      assert.equal((await sql('SELECT * FROM messages')).length,1);assert.equal((await sql('SELECT * FROM outbox')).length,1);
      const saved=(await (await request('/api/messages',{userCookie:nad})).json()).messages[0];assert.equal(saved.sender,'maria');assert.equal(JSON.stringify(saved).includes('Private test'),false);
      await wake();assert.equal((await sql('SELECT state FROM outbox'))[0].state,'sent');assert.equal(mail.length,1);assert.equal(mail[0].body.to[0],'recipient@example.com');assert.equal(JSON.stringify(mail).includes('Private test'),false);
      await request('/api/messages',{userCookie:maria,data:await encrypt(key,'maria','Another')});await wake();assert.equal(mail.length,1);
    });
    await t.test('Nad initiating after a quiet period suppresses Maria reply notification',async()=>{
      await reset();await request('/api/messages',{userCookie:maria,data:await encrypt(key,'maria','Old')});await sql('DELETE FROM outbox');
      await sql('UPDATE messages SET created=?',[Date.now()-25*3600000]);
      await request('/api/messages',{userCookie:nad,data:await encrypt(key,'nad','I am here')});
      await request('/api/messages',{userCookie:maria,data:await encrypt(key,'maria','Me too')});
      assert.equal((await sql('SELECT * FROM outbox')).length,0);
    });
    await t.test('Maria after quiet period re-arms; failed email retries keep same identifier',async()=>{
      await reset();await request('/api/messages',{userCookie:nad,data:await encrypt(key,'nad','Old')});await sql('UPDATE messages SET created=?',[Date.now()-25*3600000]);
      rejectMail=true;await request('/api/messages',{userCookie:maria,data:await encrypt(key,'maria','New')});await wake();
      assert.equal((await sql('SELECT state FROM outbox'))[0].state,'pending');assert.equal(mail.length,1);
      await sql('UPDATE outbox SET next_try=0');rejectMail=false;await wake();
      assert.equal(mail.length,2);assert.equal(mail[0].key,mail[1].key);assert.equal((await sql('SELECT state FROM outbox'))[0].state,'sent');
    });
    await t.test('authenticated sender cannot be spoofed; receipts are monotonic; ID conflicts fail',async()=>{
      const envelope=await encrypt(key,'nad','Sender check');const result=await request('/api/messages',{userCookie:nad,data:{...envelope,sender:'maria'}});assert.equal((await result.json()).message.sender,'nad');
      assert.equal((await request('/api/messages',{userCookie:maria,data:envelope})).status,409);
      assert.equal((await request('/api/messages',{userCookie:nad,data:{message:'plaintext'}})).status,400);
      await request('/api/receipt',{userCookie:maria,data:{delivered:999999,seen:999999}});const before=(await sql('SELECT * FROM receipts WHERE user=?',['maria']))[0];
      await request('/api/receipt',{userCookie:maria,data:{delivered:0,seen:0}});assert.deepEqual((await sql('SELECT * FROM receipts WHERE user=?',['maria']))[0],before);
    });
    await t.test('history pages do not lose or repeat messages',async()=>{
      await reset();for(let i=0;i<205;i++)await sql('INSERT INTO messages (id,sender,iv,ciphertext,created) VALUES (?,?,?,?,?)',[crypto.randomUUID(),'nad','abcdefghijklmnop','A'.repeat(24),Date.now()]);
      const page1=await (await request('/api/messages',{userCookie:nad})).json();assert.equal(page1.messages.length,100);
      const page2=await (await request(`/api/messages?before=${page1.messages[0].seq}`,{userCookie:nad})).json();
      const page3=await (await request(`/api/messages?before=${page2.messages[0].seq}`,{userCookie:nad})).json();
      assert.equal(new Set([...page1.messages,...page2.messages,...page3.messages].map(x=>x.id)).size,205);
    });
    await t.test('WebSocket is authenticated and logout revokes HTTP access',async()=>{
      const response=await mf.dispatchFetch('https://room.test/api/live',{headers:{origin:'https://room.test',cookie:nad,upgrade:'websocket'}});assert.equal(response.status,101);const socket=response.webSocket;socket.accept();
      const pong=new Promise(resolve=>socket.addEventListener('message',event=>resolve(JSON.parse(event.data)),{once:true}));socket.send('ping');assert.equal((await pong).type,'pong');
      await request('/api/logout',{userCookie:nad,data:{}});assert.equal((await request('/api/messages',{userCookie:nad})).status,401);socket.close();
    });
  }finally{await mf.dispose();}
});
