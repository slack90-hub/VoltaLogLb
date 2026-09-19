export const QUIET_MS = 24 * 60 * 60 * 1000;
export function shouldNotify(sender, previousMessageTime, now) {
  return sender === 'maria' && (previousMessageTime === null || now - previousMessageTime >= QUIET_MS);
}
export function validEnvelope(value) {
  return value && value.version === 1 && /^[a-f0-9-]{36}$/.test(value.id)
    && /^[A-Za-z0-9_-]{16}$/.test(value.iv)
    && typeof value.ciphertext === 'string' && value.ciphertext.length >= 24
    && value.ciphertext.length <= 30000 && /^[A-Za-z0-9_-]+$/.test(value.ciphertext);
}
