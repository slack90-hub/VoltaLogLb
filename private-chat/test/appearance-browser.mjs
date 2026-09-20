import {Miniflare,convertV4MiniflareOptions} from 'miniflare';import {randomBytes,createHash} from 'node:crypto';import {mkdir} from 'node:fs/promises';import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');const digest=value=>createHash('sha256').update(value).digest('base64url');const raw=randomBytes(32),code=`room1.${raw.toString('base64url')}`,password=randomBytes(32).toString('base64url');const config={fingerprint:digest(raw),nad:{salt:'test',hash:digest('test:'+password)},maria:{salt:'test',hash:digest('test:'+password)}};
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/worker.mjs',compatibilityDate:'2026-09-19',compatibilityFlags:['nodejs_compat'],durableObjects:{ROOM:{className:'PrivateRoom',useSQLite:true}},bindings:{AUTH_CONFIG:JSON.stringify(config)}}));let browser;
try{
  const base=(await mf.ready).href;browser=await chromium.launch({channel:'msedge',headless:true});await mkdir('test-artifacts',{recursive:true});
  for(const mobile of [false,true]){
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1365,height:900},isMobile:mobile,hasTouch:mobile});const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const login=async()=>{await page.locator('#password').fill(password);await page.locator('#login-submit').click();await page.locator('#recovery').fill(code);await page.locator('#unlock-form .primary').click();await page.locator('#setup-skip').click();};
    await page.goto(base);await login();await page.locator('#draft').fill('A message stays unchanged.');await page.locator('#send').click();await page.getByText('A message stays unchanged.',{exact:true}).first().waitFor();
    await page.screenshot({path:`test-artifacts/personal-${mobile?'mobile':'desktop'}.png`});assert.equal(await page.getByRole('switch').isChecked(),false);assert.equal(await page.locator('.chat-title h1').innerText(),'Lion & Butterfly');
    await page.locator('.mode-toggle').click();assert.equal(await page.getByRole('switch').isChecked(),true);assert.equal(await page.locator('.chat-title h1').innerText(),'Conversation');
    const chrome=await page.evaluate(()=>{const room=document.querySelector('#room').cloneNode(true);room.querySelector('#messages').remove();room.querySelector('#draft').remove();const copy=document.createElement('div');copy.append(room);document.body.append(copy);room.hidden=false;const text=room.innerText;copy.remove();return text;});
    assert.equal(/[♥♡🦁🦋]|love|lion|butterfly|hearts|always us|\bNad\b|\bMaria\b/i.test(chrome),false,chrome);
    assert.equal(await page.locator('#identity').textContent(),'Signed in as User A');
    assert.ok((await page.locator('.bubble .meta').first().innerText()).includes('User A'));
    assert.equal(await page.locator('#emoji').getAttribute('aria-label'),'Add a smile');await page.screenshot({path:`test-artifacts/neutral-${mobile?'mobile':'desktop'}.png`});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.locator('#messages').innerText().then(text=>text.includes('A message stays unchanged.')),true);
    await page.locator('#lock').click();assert.equal(await page.locator('.welcome h1').innerText(),'Your private\nconversation.');assert.equal(await page.locator('#user option[value=nad]').textContent(),'User A');
    await page.reload();assert.equal(await page.evaluate(()=>document.documentElement.dataset.appearance),'neutral');await login();assert.equal(await page.getByRole('switch').isChecked(),true);
    await page.locator('.mode-toggle').click();assert.equal(await page.locator('.chat-title h1').innerText(),'Lion & Butterfly');assert.equal(await page.locator('#emoji').getAttribute('aria-label'),'Add a heart');assert.deepEqual(errors,[]);await context.close();
  }
  console.log('PASS: neutral/personal switch, desktop/mobile layouts, remembered setting through lock and refresh, neutral login, decorations restored, and unchanged messages.');
}finally{await browser?.close();await mf.dispose();}
