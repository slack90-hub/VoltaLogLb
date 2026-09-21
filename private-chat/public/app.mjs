import {unlock, encrypt, decrypt, encode} from './crypto.mjs';
import {derivePassphrase,wrapHistoryKey,unwrapHistoryKey,validatePassphrase,ITERATIONS} from './passphrase.mjs';
const $ = id => document.getElementById(id);
let me, key, socket, reconnectTimer, typingTimer, busy = false, syncing = false, again = false, generation = 0;
let syncedThrough = 0; let latest = 0, earliest = Infinity, allLoaded = false, lastSeen = 0, lastDelivered = 0, lastTyping = 0;
let lastActivity = Date.now(), hiddenAt = 0;
const messages = new Map(), pending = new Map();
let receipts = [], searchText = '';
const neutralAppearance=()=>document.documentElement.dataset.appearance==='neutral';
const title = user => user === 'nad' ? (neutralAppearance()?'User A':'🦁') : (neutralAppearance()?'User B':'🦋');
window.addEventListener('room-appearance-change',()=>{if(me)$('identity').textContent=`Signed in as ${title(me.user)}`;$('typing').textContent='';if(key)render();});
const error = message => { $('gate-error').textContent = message; };
function notice(message) { $('notice').textContent = message; $('notice').hidden = !message; }
function connected(message) { $('connection').textContent = message; }
async function api(path, data) {
  const response = await fetch(`/api/${path}`, {method:data === undefined ? 'GET' : 'POST', credentials:'same-origin', cache:'no-store', headers:data === undefined ? {} : {'content-type':'application/json'}, body:data === undefined ? undefined : JSON.stringify(data), signal:AbortSignal.timeout(15000)});
  const value = await response.json();
  if (!response.ok) { const failure = new Error(value.error || 'Please try again.'); failure.status = response.status; throw failure; }
  return value;
}
let originalKitMode=false;
let formRevision=0;
function showUnlock() { $('login-form').hidden = true; $('unlock-form').hidden = false; $('recovery').focus(); }
async function refreshLoginLabel() {
  const revision=++formRevision;
  try {
    const info=await api(`signin-info?user=${$('user').value}`);
    if(revision!==formRevision)return;
    $('password-label').textContent=info.enrolled&&!originalKitMode?'Your passphrase':'Original account password';
    $('login-help').textContent=info.enrolled&&!originalKitMode?'One passphrase opens your conversation and history.':'First time? Use your existing access kit once to set up a passphrase.';
    $('use-kit').textContent=originalKitMode?'Back to passphrase sign-in':'Use original access kit';
    $('use-kit').hidden=!info.enrolled;
  } catch { $('login-help').textContent='Enter your passphrase or original account password.'; }
}
$('user').onchange=()=>{originalKitMode=false;error('');$('password').value='';void refreshLoginLabel();};
$('use-kit').onclick=()=>{originalKitMode=!originalKitMode;error('');$('password').value='';void refreshLoginLabel();};
async function enterRoom() {
  const epoch=generation;
  const info=await api('me');if(epoch!==generation||!key)return;me=info;
  generation++;$('gate').hidden=true;$('room').hidden=false;$('identity').textContent=`Signed in as ${title(me.user)}`;
  lastActivity=Date.now();hiddenAt=0;
  notice(!me.emailReady?'Email alerts are awaiting activation. Messages still work.':me.failedAlerts?'An earlier email alert could not be sent. Please check directly for messages.':'');
  try{for(const item of JSON.parse(sessionStorage.getItem(`room-pending-${me.user}`)||'[]'))pending.set(item.id,item);}catch{}
  await sync(true);if(!key)return;connect();await flush();if(!matchMedia('(max-width:800px)').matches)$('draft').focus();
  if(!me.passphraseReady)openPassphraseSetup();
}
$('login-form').addEventListener('submit',async event=>{
  event.preventDefault();error('');const button=$('login-submit');button.disabled=true;const epoch=generation;const user=$('user').value;const value=$('password').value;
  try {
    const info=await api(`signin-info?user=${user}`);if(epoch!==generation)return;
    if(info.enrolled&&!originalKitMode){
      const derived=await derivePassphrase(value,user,info.salt,info.iterations);if(epoch!==generation)return;
      const result=await api('login',{user,mode:'passphrase',id:info.id,authProof:derived.authProof});if(epoch!==generation)return;
      const unlocked=await unwrapHistoryKey(result.envelope,derived.wrappingKey,user,result.fingerprint);if(epoch!==generation)return;
      me=result;key=unlocked;$('password').value='';await enterRoom();
    } else {
      const result=await api('login',{user,password:value});if(epoch!==generation)return;
      me=result;$('password').value='';showUnlock();
    }
  } catch(failure){error(failure.message||'Unable to unlock history. Use your original access kit to recover access.');}
  finally{button.disabled=false;}
});
$('unlock-form').addEventListener('submit',async event=>{
  event.preventDefault();error('');const button=event.submitter;button.disabled=true;const epoch=generation;
  try{const info=await api('me');const unlocked=await unlock($('recovery').value,info.fingerprint);if(epoch!==generation)return;me=info;key=unlocked;$('recovery').value='';await enterRoom();}
  catch(failure){if(key)notice(failure.message);else error(failure.message);}
  finally{button.disabled=false;}
});
function openPassphraseSetup(){
  if(!key)return;$('new-passphrase').value='';$('confirm-passphrase').value='';$('setup-error').textContent='';$('setup-form').hidden=false;$('setup-success').hidden=true;
  $('setup-title').textContent=me.passphraseReady?'Change your passphrase':'Make sign-in easier';
  $('passphrase-dialog').showModal();$('new-passphrase').focus();
}
$('setup-open').onclick=openPassphraseSetup;
$('setup-skip').onclick=()=>$('passphrase-dialog').close();
$('setup-done').onclick=()=>$('passphrase-dialog').close();
$('passphrase-dialog').addEventListener('close',()=>{$('new-passphrase').value='';$('confirm-passphrase').value='';});
$('setup-form').addEventListener('submit',async event=>{
  event.preventDefault();$('setup-error').textContent='';const button=$('setup-save');const epoch=generation;
  button.disabled=true;$('setup-skip').disabled=true;button.textContent='Securing your passphrase…';
  try{
    const value=validatePassphrase($('new-passphrase').value);
    if(value!==$('confirm-passphrase').value.normalize('NFC'))throw new Error('The two passphrases do not match.');
    const salt=encode(crypto.getRandomValues(new Uint8Array(32)));const user=me.user;const fingerprint=me.fingerprint;
    const derived=await derivePassphrase(value,user,salt);if(epoch!==generation||!key)return;
    const wrapped=await wrapHistoryKey(key,derived.wrappingKey,user,fingerprint,salt);if(epoch!==generation||!key)return;
    const staged=await api('passphrase/stage',{salt,iterations:ITERATIONS,authProof:derived.authProof,...wrapped});if(epoch!==generation||!key)return;
    // Verify the server-returned envelope against the original fingerprint before
    // activating. Existing messages and the original room key never change.
    await unwrapHistoryKey(staged.envelope,derived.wrappingKey,user,fingerprint);if(epoch!==generation||!key)return;
    await api('passphrase/confirm',{id:staged.envelope.id,authProof:derived.authProof});if(epoch!==generation||!key)return;
    me.passphraseReady=true;$('new-passphrase').value='';$('confirm-passphrase').value='';$('setup-form').hidden=true;$('setup-success').hidden=false;$('setup-title').textContent='You are all set.';
  }catch(failure){if(epoch===generation)$('setup-error').textContent=failure.message||'Could not finish setup. Your original access kit still works.';}
  finally{button.disabled=false;$('setup-skip').disabled=false;button.textContent='Save passphrase';}
});
function clearLocal() {
  generation++; formRevision++; $('passphrase-dialog').close(); $('new-passphrase').value=''; $('confirm-passphrase').value=''; key = null; messages.clear(); pending.clear(); receipts = [];
  latest = 0; syncedThrough = 0; earliest = Infinity; allLoaded = false; lastSeen = 0; lastDelivered = 0; syncing = false; busy = false; again = false;
  if (me) { try { sessionStorage.removeItem(`room-pending-${me.user}`); } catch { /* storage unavailable */ } }
  clearTimeout(reconnectTimer); clearTimeout(typingTimer); if (socket) { socket.onclose = null; socket.close(); socket = null; }
  $('messages').replaceChildren(); $('draft').value = ''; $('recovery').value = ''; $('password').value = ''; $('search').value = ''; searchText = '';
  $('typing').textContent = ''; $('pending').hidden = true; $('room').hidden = true; $('gate').hidden = false; $('unlock-form').hidden = true; $('login-form').hidden = false;
  $('older').hidden = true; $('empty').hidden = false; $('send').disabled = false; document.title = 'MDS Workspace';
}
async function lock(exit = false) {
  clearLocal(); error('');
  const closing = api('logout', {}).catch(() => {});
  if (exit) { navigator.sendBeacon('/api/logout', '{}'); location.replace('https://mdslb.com/'); }
  else { await closing; me = null; originalKitMode=false; void refreshLoginLabel(); $('password').focus(); }
}
$('lock').onclick = () => lock(); $('exit').onclick = () => lock(true); $('switch-account').onclick = () => lock();
document.addEventListener('keydown', event => { if (event.key === 'Escape' && key && !document.querySelector('.chat.menu-open,.chat.search-open')) void lock(true); });
window.addEventListener('pagehide', () => { clearLocal(); navigator.sendBeacon('/api/logout', '{}'); });
window.addEventListener('pageshow', event => { if (event.persisted) { clearLocal(); location.reload(); } });
async function merge(rows, epoch) {
  for (const message of rows) {
    if (epoch !== generation || !key) return;
    if (!messages.has(message.id)) {
      let text;
      try { text = await decrypt(key, message); }
      catch { text = '[This message could not be decrypted or was altered.]'; }
      if (epoch !== generation || !key) return;
      messages.set(message.id, {...message, text});
    }
    latest = Math.max(latest, message.seq); earliest = Math.min(earliest, message.seq);
    pending.delete(message.id);
  }
  persistPending();
}
function render() {
  if (!key) return;
  const timeline = $('timeline'); const atBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 110;
  const fragment = document.createDocumentFragment(); let day = '';
  const peer = receipts.find(value => value.user !== me.user) || {};
  const list = [...messages.values()].sort((a,b) => a.seq-b.seq).filter(message => !searchText || message.text.toLocaleLowerCase().includes(searchText));
  for (const message of list) {
    const date = new Date(message.created); const dateLabel = date.toLocaleDateString(undefined, {day:'numeric', month:'short', year:'numeric'});
    if (day !== dateLabel) { day = dateLabel; const label = document.createElement('div'); label.className = 'day'; label.textContent = day; fragment.append(label); }
    const own = message.sender === me.user; const bubble = document.createElement('article'); bubble.className = `bubble${own ? '' : ' theirs'}`;
    const text = document.createElement('div'); text.className = 'text'; text.dir = 'auto'; text.textContent = message.text;
    const meta = document.createElement('div'); meta.className = 'meta';
    const time = document.createElement('span'); time.textContent = `${title(message.sender)} · ${date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`; meta.append(time);
    if (own) { const status = document.createElement('span'); status.textContent = peer.seen >= message.seq ? 'Read ✓✓' : peer.delivered >= message.seq ? 'Delivered ✓✓' : 'Sent ✓'; if (peer.seen >= message.seq) status.className = 'read'; meta.append(status); }
    bubble.append(text, meta); fragment.append(bubble);
  }
  $('messages').replaceChildren(fragment); $('empty').hidden = messages.size > 0;
  if (searchText && list.length === 0) { const noMatch = document.createElement('p'); noMatch.className = 'day'; noMatch.textContent = allLoaded ? 'No matching messages.' : 'No matches in loaded messages. Choose Search all history.'; $('messages').append(noMatch); }
  if (atBottom && !searchText) timeline.scrollTop = timeline.scrollHeight;
}
async function acknowledge() {
  if (!key || !latest) return;
  const atBottom = $('timeline').scrollHeight - $('timeline').scrollTop - $('timeline').clientHeight < 110;
  const seen = document.visibilityState === 'visible' && document.hasFocus() && atBottom && !searchText ? latest : lastSeen;
  if (lastDelivered >= latest && lastSeen >= seen) return;
  const epoch = generation;
  try { await api('receipt', {delivered:latest, seen}); if (epoch === generation) { lastDelivered = latest; lastSeen = seen; } } catch { /* retry on next sync */ }
}
async function sync(initial = false) {
  if (!key) return;
  if (syncing) { again = true; return; }
  syncing = true; const epoch = generation;
  try {
    let response;
    do {
      response = await api(initial ? 'messages' : `messages?after=${syncedThrough}`);
      if (epoch !== generation || !key) return;
      receipts = response.receipts; await merge(response.messages, epoch); if (response.messages.length) syncedThrough = response.messages.at(-1).seq;
      if (initial) { allLoaded = !response.more; $('older').hidden = allLoaded; break; }
    } while (response.more && key && epoch === generation);
    if (epoch !== generation || !key) return;
    render(); if (initial) $('timeline').scrollTop = $('timeline').scrollHeight;
    await acknowledge(); connected(socket?.readyState === WebSocket.OPEN ? 'Connected · End-to-end encrypted' : 'Connected · Checking for messages');
  } catch (failure) {
    if (failure.status === 401) { await lock(); error('Your session expired. Sign in to continue.'); }
    else connected('Connection interrupted · Retrying');
  } finally { if (epoch === generation) { syncing = false; if (again) { again = false; void sync(); } } }
}
function connect() {
  if (!key) return;
  if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return;
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/live`);
  socket.onopen = () => { connected('Connected · End-to-end encrypted'); void sync(); void flush(); };
  socket.onmessage = event => {
    if (!key) return;
    let data; try { data = JSON.parse(event.data); } catch { return; }
    if (data.type === 'refresh') void sync();
    if (data.type === 'receipts') { receipts = data.receipts; render(); }
    if (data.type === 'typing') { $('typing').textContent = `${title(data.user)} is typing…`; clearTimeout(typingTimer); typingTimer = setTimeout(() => { $('typing').textContent = ''; }, 3500); }
  };
  socket.onclose = event => { if (key) { connected('Reconnecting…'); if (event.code === 1008) { void lock(); error('Your session expired.'); } else reconnectTimer = setTimeout(connect, 4000); } };
  socket.onerror = () => connected('Live connection interrupted · Checking for messages');
}
function persistPending() {
  if (!me) return;
  try { sessionStorage.setItem(`room-pending-${me.user}`, JSON.stringify([...pending.values()])); } catch { /* tab still retries from memory */ }
  $('pending').hidden = pending.size === 0; $('pending-text').textContent = `${pending.size} encrypted message${pending.size === 1 ? '' : 's'} waiting to send. Keep this tab open.`;
}
async function flush() {
  if (busy || !key || !pending.size) return;
  busy = true; const epoch = generation;
  try {
    for (const [id, envelope] of pending) {
      const result = await api('messages', envelope);
      if (epoch !== generation || !key) return;
      await merge([result.message], epoch); pending.delete(id); persistPending(); render(); $('timeline').scrollTop = $('timeline').scrollHeight;
    }
  } catch (failure) {
    if (failure.status === 401) { await lock(); error('Your session expired. Sign in again.'); }
    else { $('pending-text').textContent = `Not sent yet: ${failure.message}`; $('pending').hidden = false; }
  } finally { if (epoch === generation) busy = false; }
}
$('composer').addEventListener('submit', async event => {
  event.preventDefault(); if (!key || !$('draft').value.trim()) return;
  if (pending.size >= 20) { notice('Twenty messages are waiting. Reconnect before adding more.'); return; }
  const epoch = generation; const text = $('draft').value.trim(); $('send').disabled = true;
  try {
    const envelope = await encrypt(key, me.user, text);
    if (epoch !== generation || !key) return;
    pending.set(envelope.id, envelope); persistPending(); $('draft').value = ''; $('draft').style.height = ''; await flush();
  } catch { notice('The message could not be encrypted. Please retry.'); }
  finally { $('send').disabled = false; $('draft').focus(); }
});
$('retry').onclick = () => flush();
$('draft').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('composer').requestSubmit(); } });
$('draft').addEventListener('input', () => {
  $('draft').style.height = 'auto'; $('draft').style.height = `${Math.min(130, $('draft').scrollHeight)}px`;
  if (socket?.readyState === WebSocket.OPEN && Date.now() - lastTyping > 2500) { socket.send('typing'); lastTyping = Date.now(); }
});
$('emoji').onclick = () => { $('draft').value += neutralAppearance()?' ☺':' ♥'; $('draft').focus(); };
$('search').oninput = () => { searchText = $('search').value.trim().toLocaleLowerCase(); render(); };
async function earlier() {
  if (!key || allLoaded) return;
  const epoch = generation; const response = await api(`messages?before=${earliest}`);
  if (epoch !== generation || !key) return;
  const previousHeight = $('timeline').scrollHeight;
  await merge(response.messages, epoch); allLoaded = !response.more; $('older').hidden = allLoaded; render();
  $('timeline').scrollTop = $('timeline').scrollHeight - previousHeight;
}
$('older').onclick = async () => { $('older').disabled = true; try { await earlier(); } catch (failure) { notice(failure.message); } finally { $('older').disabled = false; } };
async function loadAll() { while (!allLoaded && key) await earlier(); }
$('search-all').onclick = async () => {
  $('search-all').disabled = true; $('search-all').textContent = 'Loading history…';
  try { await loadAll(); render(); } catch (failure) { notice(failure.message); }
  finally { $('search-all').disabled = false; $('search-all').textContent = allLoaded ? 'All history loaded' : 'Search all history'; }
};
$('backup').onclick = async () => {
  $('backup').disabled = true;
  try {
    await loadAll(); if (!key) return;
    const encrypted = [...messages.values()].sort((a,b) => a.seq-b.seq).map(({text, ...message}) => message);
    const file = new Blob([JSON.stringify({format:'mds-room-backup-v1', exported:new Date().toISOString(), fingerprint:me.fingerprint, messages:encrypted}, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(file); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `private-room-encrypted-${new Date().toISOString().slice(0,10)}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (failure) { notice(failure.message); } finally { $('backup').disabled = false; }
};
$('timeline').addEventListener('scroll', () => { void acknowledge(); }, {passive:true});
for (const event of ['pointerdown','keydown','touchstart']) document.addEventListener(event, () => { lastActivity = Date.now(); }, {passive:true});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else { if (key && hiddenAt && Date.now() - hiddenAt > 5 * 60000) void lock(); else if (key) { void sync(); connect(); } hiddenAt = 0; }
});
window.addEventListener('online', () => { if (key) { connect(); void sync(); void flush(); } });
window.addEventListener('focus', () => { if (key) void acknowledge(); });
setInterval(() => {
  if (!key) return;
  if (Date.now() - lastActivity > 15 * 60000 || hiddenAt && Date.now() - hiddenAt > 5 * 60000) { void lock(); return; }
  if (socket?.readyState === WebSocket.OPEN) socket.send('ping');
  void sync(); void flush();
}, 10000);
// A fresh page always asks for the passphrase; a cookie alone cannot unlock history.
void refreshLoginLabel();

// Mobile chrome reuses the existing account and appearance controls.
const chatPanel=document.querySelector('.chat');
function closeMobileMenu(){chatPanel.classList.remove('menu-open');$('mobile-menu').setAttribute('aria-expanded','false');}
$('mobile-menu').onclick=()=>{const open=chatPanel.classList.toggle('menu-open');$('mobile-menu').setAttribute('aria-expanded',String(open));};
$('mobile-neutral').onclick=()=>{$('neutral-mode').click();};
function syncMobileNeutral(){$('mobile-neutral').setAttribute('aria-pressed',String(neutralAppearance()));}
syncMobileNeutral();window.addEventListener('room-appearance-change',syncMobileNeutral);
function closeMobileSearch(){chatPanel.classList.remove('search-open');$('mobile-search').setAttribute('aria-expanded','false');$('search').value='';$('search').dispatchEvent(new Event('input'));}
$('mobile-search').onclick=()=>{closeMobileMenu();if(chatPanel.classList.contains('search-open')){closeMobileSearch();}else{chatPanel.classList.add('search-open');$('mobile-search').setAttribute('aria-expanded','true');$('search').focus();}};
document.addEventListener('click',event=>{if(!event.target.closest('#mobile-menu,.header-actions,.appearance-row'))closeMobileMenu();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeMobileMenu();closeMobileSearch();}});
document.querySelector('.header-actions').addEventListener('click',()=>{closeMobileMenu();closeMobileSearch();});
