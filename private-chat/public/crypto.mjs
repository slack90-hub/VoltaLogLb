// Standard Web Crypto AES-256-GCM with a random, out-of-band room key.
// The client never sends this key to the server or persists it.
const encoder = new TextEncoder();
export const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
export const decode = text => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
export async function unlock(code, expectedFingerprint) {
  const raw = decode(code.trim().replace(/^room1\./, ''));
  if (raw.length !== 32) throw new Error('The recovery key is not valid.');
  const fingerprint = encode(await crypto.subtle.digest('SHA-256', raw));
  if (fingerprint !== expectedFingerprint) throw new Error('This recovery key belongs to a different conversation.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);
}
function aad(sender, id) { return encoder.encode(`mds-private-room:v1:${sender}:${id}`); }
export async function encrypt(key, sender, text, id = crypto.randomUUID()) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: aad(sender, id)}, key, encoder.encode(text));
  return {version: 1, id, iv: encode(iv), ciphertext: encode(ciphertext)};
}
export async function decrypt(key, message) {
  const plaintext = await crypto.subtle.decrypt({name: 'AES-GCM', iv: decode(message.iv), additionalData: aad(message.sender, message.id)}, key, decode(message.ciphertext));
  return new TextDecoder().decode(plaintext);
}
