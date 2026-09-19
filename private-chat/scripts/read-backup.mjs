import {readFile,writeFile} from 'node:fs/promises';
import {unlock,decrypt} from '../public/crypto.mjs';
const [backupPath,keyPath,output]=process.argv.slice(2);
if(!backupPath||!keyPath||!output)throw new Error('Usage: node scripts/read-backup.mjs backup.json key.txt output.txt');
const backup=JSON.parse(await readFile(backupPath,'utf8'));
if(backup.format!=='mds-room-backup-v1')throw new Error('Unrecognized backup.');
const key=await unlock((await readFile(keyPath,'utf8')).trim(),backup.fingerprint);
const lines=[];for(const message of backup.messages)lines.push(`${new Date(message.created).toISOString()} ${message.sender}\n${await decrypt(key,message)}\n`);
await writeFile(output,lines.join('\n'),{flag:'wx'});console.log('Recovered backup to the requested local plaintext file.');
