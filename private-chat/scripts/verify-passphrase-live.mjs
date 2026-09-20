import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const base='https://mds-room.slack-90.workers.dev',mode=process.argv[2];const kit=await readFile('.secrets/access-kit.md','utf8');
const password=user=>kit.match(new RegExp(`${user==='nad'?'Nad':'Maria'} account: ${user}\\nPassword: ([^\\n]+)`))[1].trim();
const request=(path,cookie,data)=>fetch(base+'/api/'+path,{method:data===undefined?'GET':'POST',headers:{origin:base,...(cookie?{cookie}:{}),'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
const fingerprints={};
for(const user of ['nad','maria']){
  const login=await request('login',null,{user,password:password(user)});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  try{const account=await login.json();fingerprints[user]=account.fingerprint;
    if(user==='nad'){
      const hashes={};let after=0,page;do{page=await(await request('messages?after='+after,cookie)).json();for(const message of page.messages){hashes[message.id]=createHash('sha256').update(JSON.stringify(message)).digest('hex');after=message.seq;}}while(page.more);
      if(mode==='before'){await writeFile('.secrets/pre-passphrase-history.json',JSON.stringify({hashes,fingerprint:account.fingerprint}));console.log('Saved ciphertext-only history checksums before deployment.');}
      else{const baseline=JSON.parse(await readFile('.secrets/pre-passphrase-history.json','utf8'));assert.equal(account.fingerprint,baseline.fingerprint);for(const[id,hash]of Object.entries(baseline.hashes))assert.equal(hashes[id],hash);console.log('All pre-deployment messages and original key fingerprint are unchanged.');}
    }
    if(mode!=='before'){const info=await(await request('signin-info?user='+user)).json();assert.equal(typeof info.enrolled,'boolean');console.log(user+': original access works; passphrase setup available.');}
  }finally{await request('logout',cookie,{});}
}
assert.equal(fingerprints.nad,fingerprints.maria);assert.equal((await request('messages')).status,401);
