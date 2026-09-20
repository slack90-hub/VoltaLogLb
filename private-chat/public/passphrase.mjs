// Browser-only passphrase derivation. Neither the passphrase nor wrapping key
// is transmitted. The auth proof is password-equivalent and must use HTTPS.
import {encode,decode} from './crypto.mjs';
const encoder=new TextEncoder();
export const ITERATIONS=600000;
export function validatePassphrase(value) {
  const text=value.normalize('NFC');
  if(text!==text.trim())throw new Error('Remove spaces at the beginning or end.');
  const words=text.split(/\s+/u);
  if(text.length<16||text.length>200||new Set(words.map(word=>word.toLocaleLowerCase())).size<4)throw new Error('Use at least four different words and 16 characters.');
  return text;
}
export async function derivePassphrase(value,user,salt,iterations=ITERATIONS) {
  if(!['nad','maria'].includes(user)||iterations!==ITERATIONS||!/^[A-Za-z0-9_-]{43}$/.test(salt))throw new Error('Unsupported sign-in settings. Refresh and try again.');
  const password=await crypto.subtle.importKey('raw',encoder.encode(value.normalize('NFC')),'PBKDF2',false,['deriveBits']);
  const master=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations,salt:decode(salt)},password,256));
  const material=await crypto.subtle.importKey('raw',master,'HKDF',false,['deriveBits','deriveKey']);master.fill(0);
  const parameters=purpose=>({name:'HKDF',hash:'SHA-256',salt:decode(salt),info:encoder.encode(`mds-room:passphrase:v1:${user}:${purpose}`)});
  const authProof=encode(await crypto.subtle.deriveBits(parameters('authentication'),material,256));
  const wrappingKey=await crypto.subtle.deriveKey(parameters('history-wrapping'),material,{name:'AES-GCM',length:256},false,['wrapKey','unwrapKey']);
  return {authProof,wrappingKey};
}
const aad=(user,fingerprint,salt)=>encoder.encode(`mds-room:keywrap:v1:${user}:${fingerprint}:${salt}`);
export async function wrapHistoryKey(key,wrappingKey,user,fingerprint,salt) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const wrappedKey=encode(await crypto.subtle.wrapKey('raw',key,wrappingKey,{name:'AES-GCM',iv,additionalData:aad(user,fingerprint,salt)}));
  return {iv:encode(iv),wrappedKey};
}
export async function unwrapHistoryKey(record,wrappingKey,user,fingerprint) {
  if(record.iterations!==ITERATIONS||!/^[A-Za-z0-9_-]{16}$/.test(record.iv)||!/^[A-Za-z0-9_-]{64}$/.test(record.wrappedKey))throw new Error('Invalid encrypted history key. Use your original access kit.');
  const key=await crypto.subtle.unwrapKey('raw',decode(record.wrappedKey),wrappingKey,{name:'AES-GCM',iv:decode(record.iv),additionalData:aad(user,fingerprint,record.salt)},'AES-GCM',true,['encrypt','decrypt']);
  const raw=new Uint8Array(await crypto.subtle.exportKey('raw',key));
  const actual=encode(await crypto.subtle.digest('SHA-256',raw));raw.fill(0);
  if(actual!==fingerprint)throw new Error('The saved key does not match your history. Use your original access kit.');
  return key;
}
