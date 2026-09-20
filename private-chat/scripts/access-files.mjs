import {readFile,writeFile} from 'node:fs/promises';
export async function refreshAccessFiles() {
  const directory=new URL('../.secrets/',import.meta.url);const kit=await readFile(new URL('access-kit.md',directory),'utf8');const code=kit.match(/room1\.[A-Za-z0-9_-]+/)[0];
  for(const user of ['nad','maria']) {
    const label=user==='nad'?'Nad':'Maria';const password=kit.match(new RegExp(`${label} account: ${user}\\nPassword: ([^\\n]+)`))[1].trim();
    await writeFile(new URL(`${user}-access.md`,directory),`# ${label}'s private room access\n\nOpen https://mds-room.slack-90.workers.dev/\n\nAccount: ${user}\nPassword: ${password}\n\nConversation recovery key:\n${code}\n\nFirst-time setup: sign in, paste the recovery key, then choose your own passphrase in the setup dialog. After that, use only your passphrase to sign in. These original credentials remain your recovery kit: choose Use original access kit if you forget your passphrase. Keep a safe offline copy. Share only through a trusted private channel.\n\nOn mdslb.com, tap "Murex is a sea shell" in the About MDS section five times to open the room. Quick exit: Escape or the Quick exit button.\n`);
  }
}
