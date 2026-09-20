import {timingSafeEqual} from 'node:crypto';
const encoder=new TextEncoder();
export class AccessError extends Error {constructor(status,message){super(message);this.status=status;}}
export async function proofHash(value){return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(`mds-room:proof:v1:${value}`))))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
export function equalProof(a,b){return typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(encoder.encode(a),encoder.encode(b));}
export function publicCredential(row){return row?{id:row.id,salt:row.salt,iterations:row.iterations,iv:row.iv,wrappedKey:row.wrapped_key}:null;}
export function credential(room,user){return room.rows('SELECT * FROM passphrases WHERE user=?',user)[0];}
function recent(session){if(Date.now()-(session.expires-8*3600000)>10*60000)throw new AccessError(403,'Sign out and sign in again before changing your passphrase.');}
export async function stagePassphrase(room,session,data){
  recent(session);room.limit(`setup:${session.user}`,12,3600000);
  if(data.iterations!==600000||!/^[A-Za-z0-9_-]{43}$/.test(data.salt)||!/^[A-Za-z0-9_-]{43}$/.test(data.authProof)||!/^[A-Za-z0-9_-]{16}$/.test(data.iv)||!/^[A-Za-z0-9_-]{64}$/.test(data.wrappedKey))throw new AccessError(400,'Invalid passphrase setup.');
  const verifier=await proofHash(data.authProof);
  const id=crypto.randomUUID();const active=credential(room,session.user);
  room.sql.exec('DELETE FROM passphrase_pending WHERE created < ?',Date.now()-10*60000);
  room.sql.exec('INSERT OR REPLACE INTO passphrase_pending (user,id,salt,iterations,iv,wrapped_key,verifier,created,session_token,base_id) VALUES (?,?,?,?,?,?,?,?,?,?)',session.user,id,data.salt,data.iterations,data.iv,data.wrappedKey,verifier,Date.now(),session.token,active?.id||'');
  return publicCredential(room.rows('SELECT * FROM passphrase_pending WHERE user=?',session.user)[0]);
}
export async function confirmPassphrase(room,session,data){
  recent(session);
  if(typeof data.id!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(data.authProof))throw new AccessError(400,'Invalid confirmation.');
  const verifier=await proofHash(data.authProof);let activated;
  room.ctx.storage.transactionSync(()=>{
    if(!room.rows('SELECT token FROM sessions WHERE token=? AND expires>?',session.token,Date.now()).length)throw new AccessError(401,'Please sign in again.');
    const active=credential(room,session.user);
    // Idempotent confirmation handles a lost successful response.
    if(active?.id===data.id&&equalProof(active.verifier,verifier)){activated=active;return;}
    const pending=room.rows('SELECT * FROM passphrase_pending WHERE user=?',session.user)[0];
    if(!pending||pending.id!==data.id||pending.session_token!==session.token||pending.created<Date.now()-10*60000||!equalProof(pending.verifier,verifier)||pending.base_id!==(active?.id||''))throw new AccessError(409,'Setup expired or changed in another tab. Try again.');
    room.sql.exec('INSERT OR REPLACE INTO passphrases (user,id,salt,iterations,iv,wrapped_key,verifier,created) VALUES (?,?,?,?,?,?,?,?)',pending.user,pending.id,pending.salt,pending.iterations,pending.iv,pending.wrapped_key,pending.verifier,Date.now());
    room.sql.exec('DELETE FROM passphrase_pending WHERE user=?',session.user);
    room.sql.exec('DELETE FROM sessions WHERE user=? AND token<>?',session.user,session.token);
    activated=credential(room,session.user);
  });
  for(const socket of room.ctx.getWebSockets()){const attached=socket.deserializeAttachment();if(attached?.user===session.user&&attached.token!==session.token)socket.close(1008,'Passphrase updated');}
  return publicCredential(activated);
}
