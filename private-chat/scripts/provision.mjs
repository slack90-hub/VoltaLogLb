import {refreshAccessFiles} from './access-files.mjs';
import {randomBytes, createHash} from 'node:crypto';
import {mkdir, writeFile, access} from 'node:fs/promises';
const directory = new URL('../.secrets/', import.meta.url);
await mkdir(directory, {recursive:true});
try { await access(new URL('access-kit.md', directory)); throw new Error('Access kit already exists. Refusing to replace encryption keys.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const digest = input => createHash('sha256').update(input).digest('base64url');
const key = randomBytes(32); const config = {fingerprint:digest(key)}; const passwords = {};
for (const user of ['nad','maria']) {
  passwords[user] = randomBytes(32).toString('base64url'); const salt = randomBytes(16).toString('base64url');
  config[user] = {salt, hash:digest(`${salt}:${passwords[user]}`)};
}
await writeFile(new URL('auth-config.json',directory), JSON.stringify(config), {flag:'wx'});
const code = `room1.${key.toString('base64url')}`;
await writeFile(new URL('access-kit.md',directory), `# Private room access kit\n\nRoom: https://mds-room.slack-90.workers.dev/\n\nNad account: nad\nPassword: ${passwords.nad}\n\nMaria account: maria\nPassword: ${passwords.maria}\n\nShared conversation recovery key:\n${code}\n\nGive Maria only her password and the shared recovery key through a trusted channel. Keep an offline copy. This key decrypts all history; never put it in email, Git, a URL, or the server. Each browser needs its account password and this recovery key. Losing all copies loses access to history.\n\nQuick exit: Escape, or the Quick exit button. The page auto-locks after 15 idle minutes or 5 minutes in the background.\n`, {flag:'wx'});
await writeFile(new URL('../.dev.vars',import.meta.url), `AUTH_CONFIG='${JSON.stringify(config)}'\n`);
await refreshAccessFiles();
console.log('Created ignored .secrets/access-kit.md and hashed auth-config.json. No credentials printed.');
