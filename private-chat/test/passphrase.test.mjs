import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes,createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';import {build} from 'esbuild';
import {unlock,encrypt,decrypt,encode} from '../public/crypto.mjs';
import {derivePassphrase,wrapHistoryKey,unwrapHistoryKey,validatePassphrase,ITERATIONS} from '../public/passphrase.mjs';
const digest=value=>createHash('sha256').update(value).digest('base64url');
const raw=randomBytes(32),fingerprint=digest(raw);const config={fingerprint};const passwords={nad:encode(randomBytes(32)),maria:encode(randomBytes(32))};
for(const user of ['nad','maria'])config[user]={salt:user,hash:digest(`${user}:${passwords[user]}`)};
const phrases={nad:'orchid harbor velvet mountain',maria:'copper meadow lantern river',changed:'silver forest window planet'};
test('browser derivation uses separate account/auth/encryption keys and rejects tampering',async()=>{
  assert.throws(()=>validatePassphrase('1234'));assert.throws(()=>validatePassphrase('same same same same'));
  const salt=encode(randomBytes(32));const roomKey=await unlock(encode(raw),fingerprint);
  const nad=await derivePassphrase(phrases.nad,'nad',salt),maria=await derivePassphrase(phrases.nad,'maria',salt);
  assert.notEqual(nad.authProof,maria.authProof);
  const wrapped=await wrapHistoryKey(roomKey,nad.wrappingKey,'nad',fingerprint,salt);
  const envelope={...wrapped,salt,iterations:ITERATIONS};const restored=await unwrapHistoryKey(envelope,nad.wrappingKey,'nad',fingerprint);
  const message={...await encrypt(roomKey,'maria','Existing history stays readable'),sender:'maria'};assert.equal(await decrypt(restored,message),'Existing history stays readable');
  await assert.rejects(unwrapHistoryKey(envelope,maria.wrappingKey,'maria',fingerprint));
  await assert.rejects(derivePassphrase(phrases.nad,'nad',salt,1000));
  assert.equal(JSON.stringify(envelope).includes(encode(raw)),false);
});
test('passphrase migration is isolated, recoverable, and does not alter history',async t=>{
  await build({entryPoints:['test/bridge.mjs'],outfile:'dist/passphrase-test-worker.mjs',bundle:true,format:'esm',platform:'neutral',external:['cloudflare:*','node:*'],loader:{'.html':'text','.css':'text','.txt':'text'}});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/passphrase-test-worker.mjs',compatibilityDate:'2026-09-19',compatibilityFlags:['nodejs_compat'],durableObjects:{ROOM:{className:'TestRoom',useSQLite:true}},bindings:{AUTH_CONFIG:JSON.stringify(config)}}));
  const request=async(path,cookie,data)=>mf.dispatchFetch('https://room.test'+path,{method:data===undefined?'GET':'POST',headers:{origin:'https://room.test',...(cookie?{cookie}:{}),'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  const json=async(path,cookie,data)=>{const response=await request(path,cookie,data);assert.ok(response.ok,await response.clone().text());return response.json();};
  const sql=async(query,args=[])=>json('/__test',null,{query,args});
  const login=async(user,data={password:passwords[user]})=>{const response=await request('/api/login',null,{user,...data});assert.ok(response.ok,await response.clone().text());return {cookie:response.headers.get('set-cookie').split(';')[0],value:await response.json()};};
  const prepare=async(user,phrase)=>{const salt=encode(randomBytes(32));const derived=await derivePassphrase(phrase,user,salt);const key=await unlock(encode(raw),fingerprint);const wrapped=await wrapHistoryKey(key,derived.wrappingKey,user,fingerprint,salt);return {derived,data:{salt,iterations:ITERATIONS,...wrapped,authProof:derived.authProof}};};
  try{
    let nad=await login('nad'),maria=await login('maria');const oldNad=await login('nad');
    const key=await unlock(encode(raw),fingerprint);await json('/api/messages',nad.cookie,await encrypt(key,'nad','History before migration'));
    const before=await json('/api/messages',nad.cookie);const setup=await prepare('nad',phrases.nad);let stage;
    await t.test('setup requires authentication and only stages encrypted material',async()=>{
      assert.equal((await request('/api/passphrase/stage',null,setup.data)).status,401);
      stage=await json('/api/passphrase/stage',nad.cookie,{...setup.data,user:'maria'});
      assert.equal((await json('/api/signin-info?user=nad')).enrolled,false);
      assert.equal((await json('/api/signin-info?user=maria')).enrolled,false);
      const stored=JSON.stringify(await sql('SELECT * FROM passphrase_pending'));assert.equal(stored.includes(phrases.nad),false);assert.equal(stored.includes(encode(raw)),false);assert.equal(stored.includes(setup.derived.authProof),false);
      await unwrapHistoryKey(stage.envelope,setup.derived.wrappingKey,'nad',fingerprint);
      assert.equal((await request('/api/passphrase/confirm',maria.cookie,{id:stage.envelope.id,authProof:setup.derived.authProof})).status,409);
    });
    await t.test('confirm activates only Nad and revokes other Nad sessions; confirmation can retry',async()=>{
      await json('/api/passphrase/confirm',nad.cookie,{id:stage.envelope.id,authProof:setup.derived.authProof});
      await json('/api/passphrase/confirm',nad.cookie,{id:stage.envelope.id,authProof:setup.derived.authProof});
      assert.equal((await request('/api/me',oldNad.cookie)).status,401);assert.equal((await request('/api/me',maria.cookie)).status,200);
      assert.equal((await json('/api/signin-info?user=nad')).enrolled,true);assert.equal((await json('/api/signin-info?user=maria')).enrolled,false);
      assert.deepEqual(await json('/api/messages',nad.cookie),before);
    });
    await t.test('new-browser proof unlocks the same history; wrong proof and cross-account proof fail',async()=>{
      const info=await json('/api/signin-info?user=nad');assert.equal(info.wrappedKey,undefined);
      const derived=await derivePassphrase(phrases.nad,'nad',info.salt);const fresh=await login('nad',{mode:'passphrase',id:info.id,authProof:derived.authProof});
      const recovered=await unwrapHistoryKey(fresh.value.envelope,derived.wrappingKey,'nad',fingerprint);assert.equal(await decrypt(recovered,before.messages[0]),'History before migration');
      assert.equal((await request('/api/login',null,{user:'maria',mode:'passphrase',id:info.id,authProof:derived.authProof})).status,401);
      assert.equal((await request('/api/login',null,{user:'nad',mode:'passphrase',id:info.id,authProof:encode(randomBytes(32))})).status,401);
      nad=fresh;
    });
    await t.test('interrupted replacement leaves old passphrase working; expired setup cannot activate',async()=>{
      const newer=await prepare('nad',phrases.changed);const pending=await json('/api/passphrase/stage',nad.cookie,newer.data);
      const info=await json('/api/signin-info?user=nad');assert.equal(info.id,stage.envelope.id);
      await sql('UPDATE passphrase_pending SET created=0');assert.equal((await request('/api/passphrase/confirm',nad.cookie,{id:pending.envelope.id,authProof:newer.derived.authProof})).status,409);
      const still=await login('nad',{mode:'passphrase',id:info.id,authProof:setup.derived.authProof});assert.equal(still.value.passphraseReady,true);
    });
    await t.test('Maria enrolls independently, and original access kits remain usable',async()=>{
      const setupMaria=await prepare('maria',phrases.maria);const pending=await json('/api/passphrase/stage',maria.cookie,setupMaria.data);
      await json('/api/passphrase/confirm',maria.cookie,{id:pending.envelope.id,authProof:setupMaria.derived.authProof});
      const info=await json('/api/signin-info?user=maria');const fresh=await login('maria',{mode:'passphrase',id:info.id,authProof:setupMaria.derived.authProof});
      const restored=await unwrapHistoryKey(fresh.value.envelope,setupMaria.derived.wrappingKey,'maria',fingerprint);assert.equal(await decrypt(restored,before.messages[0]),'History before migration');
      assert.equal((await login('nad')).value.passphraseReady,true);assert.equal((await login('maria')).value.passphraseReady,true);
      assert.deepEqual(await json('/api/messages',fresh.cookie),before);
      const stored=JSON.stringify(await sql('SELECT * FROM passphrases'));for(const phrase of Object.values(phrases))assert.equal(stored.includes(phrase),false);assert.equal(stored.includes(encode(raw)),false);
    });
  }finally{await mf.dispose();}
});
