import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
await mkdir('dist', {recursive:true});
for (const name of ['app', 'crypto']) await writeFile(`public/${name}.txt`, await readFile(`public/${name}.mjs`));
await build({entryPoints:['src/worker.mjs'], outfile:'dist/worker.mjs', bundle:true, format:'esm', platform:'neutral', target:'es2022', external:['cloudflare:*','node:*'], loader:{'.html':'text','.css':'text','.txt':'text'}});
console.log('Built private room Worker and bundled browser assets.');
