import {readFile} from 'node:fs/promises';
import {encrypt,decrypt,unlock} from '../public/crypto.mjs';
import assert from 'node:assert/strict';
const base='https://mds-room.slack-90.workers.dev';
const kit=await readFile('.secrets/access-kit.md','utf8');
const password=user=>kit.match(new RegExp(`${user} account: [a-z]+\\nPassword: ([^\\n]+)`))[1].trim();
const code=kit.match(/room1\.[A-Za-z0-9_-]+/)[0];
async function api(path,cookie,data){const response=await fetch(base+'/api/'+path,{method:data===undefined?'GET':'POST',headers:{origin:base,...(cookie?{cookie}:{}),'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return response;}
const anonymous=await api('messages');assert.equal(anonymous.status,401);
const accounts={};for(const user of ['nad','maria']){const response=await api('login',null,{user,password:password(user==='nad'?'Nad':'Maria')});assert.equal(response.status,200);accounts[user]={cookie:response.headers.get('set-cookie').split(';')[0],...await response.json()};}
const key=await unlock(code,accounts.nad.fingerprint);
const history=await(await api('messages',accounts.nad.cookie)).json();
if(history.messages.length===0){const envelope=await encrypt(key,'maria','Setup check: this private conversation is ready. ♥');const response=await api('messages',accounts.maria.cookie,envelope);assert.equal(response.status,201);console.log('Created one encrypted setup message as Maria to verify the first-message email alert.');}
const result=await(await api('messages',accounts.nad.cookie)).json();assert.ok(result.messages.length>0);await decrypt(key,result.messages[0]);
const me=await(await api('me',accounts.nad.cookie)).json();console.log(JSON.stringify({live:true,anonymousStatus:anonymous.status,twoAccounts:true,historyDecrypts:true,messageCount:result.messages.length,emailEnabled:me.emailReady,alerts:me.alerts}));
for(const user of ['nad','maria'])await api('logout',accounts[user].cookie,{});
