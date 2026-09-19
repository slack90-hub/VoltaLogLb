import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createHash,randomBytes} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const digest=value=>createHash('sha256').update(value).digest('base64url');
const raw=randomBytes(32), code=`room1.${raw.toString('base64url')}`;
const passwords={nad:randomBytes(32).toString('base64url'),maria:randomBytes(32).toString('base64url')};
const config={fingerprint:digest(raw)};for(const user of ['nad','maria'])config[user]={salt:user,hash:digest(`${user}:${passwords[user]}`)};
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/worker.mjs',compatibilityDate:'2026-09-19',compatibilityFlags:['nodejs_compat'],durableObjects:{ROOM:{className:'PrivateRoom',useSQLite:true}},bindings:{AUTH_CONFIG:JSON.stringify(config)}}));
let browser;
try{
  const base=(await mf.ready).href;browser=await chromium.launch({channel:'msedge',headless:true});
  const desktop=await browser.newContext({viewport:{width:1365,height:900}}), mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const nad=await desktop.newPage(),maria=await mobile.newPage();const errors=[];
  for(const page of [nad,maria])page.on('pageerror',error=>errors.push(error.message));
  const login=async(page,user)=>{await page.goto(base);await page.locator('#user').selectOption(user);await page.locator('#password').fill(passwords[user]);await page.locator('#login-form button').click();await page.locator('#recovery').fill(code);await page.locator('#unlock-form .primary').click();await page.locator('#room').waitFor({state:'visible'});};
  await nad.goto(base);await mkdir('test-artifacts',{recursive:true});await nad.screenshot({path:'test-artifacts/login-desktop.png'});
  await login(nad,'nad');await login(maria,'maria');
  await nad.locator('#draft').fill('Hello Maria — from the desktop ♥');await nad.locator('#send').click();await maria.getByText('Hello Maria — from the desktop ♥',{exact:true}).waitFor();
  await maria.locator('#draft').fill('مرحبا نادر ♥ — from another browser');await maria.locator('#send').click();await nad.getByText('مرحبا نادر ♥ — from another browser',{exact:true}).waitFor();
  await nad.locator('#search').fill('another browser');assert.equal(await nad.locator('.bubble').count(),1);await nad.locator('#search').fill('');
  await nad.screenshot({path:'test-artifacts/chat-desktop.png'});await maria.screenshot({path:'test-artifacts/chat-mobile.png'});
  assert.equal(await maria.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  // Offline send retries once on reconnect and does not leak plaintext into storage.
  await desktop.setOffline(true);await nad.locator('#draft').fill('Offline retry');await nad.locator('#send').click();await nad.locator('#pending').waitFor({state:'visible'});
  const storage=await nad.evaluate(()=>JSON.stringify({...sessionStorage,...localStorage}));assert.equal(storage.includes('Offline retry'),false);assert.equal(storage.includes(code),false);
  await desktop.setOffline(false);await maria.getByText('Offline retry',{exact:true}).waitFor({timeout:30000});assert.equal(await maria.getByText('Offline retry',{exact:true}).count(),1);
  // A new browser unlocks persistent history using the recovery key.
  const third=await browser.newContext();const recovered=await third.newPage();await login(recovered,'nad');await recovered.getByText('Hello Maria — from the desktop ♥',{exact:true}).waitFor();
  await recovered.locator('#lock').click();await recovered.locator('#gate').waitFor({state:'visible'});assert.equal(await recovered.locator('#messages').textContent(),'');
  assert.equal(errors.length,0,errors.join('\n'));console.log('Browser checks passed: two accounts, desktop/mobile, real-time messages, Arabic, history recovery, search, offline retry, lock, no plaintext storage.');
}finally{await browser?.close();await mf.dispose();}
