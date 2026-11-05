import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { chromium, webkit } from 'playwright-core';
const source = fs.readFileSync(new URL('../assets/app-widget.js', import.meta.url), 'utf8');
const at = i => new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
for (const engine of ['chrome', 'webkit']) for (const scenario of ['late image']) {
 test(`${engine}: ${scenario}`, { timeout: 45000 }, async t => {
  const browser = await (engine === 'chrome' ? chromium.launch({ channel: 'chrome', headless: true }) : webkit.launch({ headless: true }));
  t.after(() => browser.close());
  const ctx = await browser.newContext({ viewport: { width: 390, height: 699 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  const prefs = { pos: scenario === 'unread divider' ? { active: '80@-8' } : {} };
  let imageResponse, jpeg;
  const server = http.createServer((req,res) => {
   if (!req.url.startsWith('/__uifb/api/chat-images/') || !jpeg) { res.writeHead(404); res.end(); return; }
   imageResponse = res; // Hold even the header until the reading anchor is captured.
  });
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  t.after(async () => { if(imageResponse && !imageResponse.writableEnded) imageResponse.end(jpeg.subarray(2048)); await new Promise(r=>server.close(r)); });
  const messages = ['active', 'other'].flatMap((session, s) => Array.from({ length: 100 }, (_, i) => ({
   id: s * 1000 + i + 1, from: scenario === 'unread divider' && i >= 80 ? 'user' : 'agent', session,
   ...(scenario === 'unread divider' && i >= 80 ? { context: 'terminal' } : {}),
   text: `Synthetic ${session} message ${i + 1}\nReading line\nAnother line`, at: at(i),
   ...(scenario === 'late image' && s === 0 && i === 39 ? { attachments: [{ id: '00000000-0000-4000-8000-000000000001', url: '/__uifb/api/chat-images/00000000-0000-4000-8000-000000000001', name: 'Synthetic image' }] } : {}),
  })));
  await page.route('**/*', r => {
   const p = new URL(r.request().url()).pathname;
   if (p === '/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width"><body>Fixture' });
   if (p.includes('/chat-images/')) return r.continue();
   if (r.request().method() !== 'GET') {
    if (p.endsWith('/prefs')) { const b = r.request().postDataJSON(); if (b.tab) prefs.tab = b.tab; if (b.pos) prefs.pos[b.pos.session] = b.pos.id; return r.fulfill({ json: prefs }); }
    return r.fulfill({ json: {} });
   }
   return r.fulfill({ json: p.endsWith('/sessions') ? { sessions: ['active', 'other'].map(id => ({ id, name: id, tool: 'claude', status: { state: 'idle' } })) }
    : p.endsWith('/chat') ? { messages, delivered: {} } : p.endsWith('/transcript') ? { items: [] }
    : p.endsWith('/prefs') ? prefs : p.endsWith('/seen') ? { active: scenario === 'unread divider' ? at(78) : '2999-01-01T00:00:00Z', other: '2999-01-01T00:00:00Z' }
    : p.endsWith('/drafts') ? { drafts: [], trash: [] } : {} });
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  jpeg=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=640;c.height=480;const x=c.getContext('2d'),d=x.createImageData(640,480);let seed=42;for(let i=0;i<d.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;d.data[i]=seed>>>24;d.data[i+1]=100;d.data[i+2]=200;d.data[i+3]=255;}x.putImageData(d,0,0);return c.toDataURL('image/jpeg',.8).split(',')[1];}),'base64');
  assert(jpeg.length>2048,'header/tail fixture is genuinely split');
  await page.evaluate(() => { localStorage.setItem('__uifb_tab', 'active'); localStorage.setItem('__uifb_open:app', '1'); });
  await page.addScriptTag({ content: source }); await page.locator('.msg[data-id="80"]').waitFor({ state: 'attached' }); await page.waitForTimeout(200);
  const offset = id => page.locator('#msgs').evaluate((b, id) => { const m = b.querySelector(`.msg[data-id="${id}"]`); return m.getBoundingClientRect().top - b.getBoundingClientRect().top; }, id);
  const scroll = id => page.locator('#msgs').evaluate((b, id) => { const m = b.querySelector(`.msg[data-id="${id}"]`); b.scrollTop += m.getBoundingClientRect().top - b.getBoundingClientRect().top + 8; return m.getBoundingClientRect().top - b.getBoundingClientRect().top; }, id);
  if (scenario === 'late image') {
   const img = page.locator('.msg[data-id="40"] img'); await img.evaluate(e => { e.loading = 'eager'; });
   const before = await scroll(45);
   for(let i=0;i<40&&!imageResponse;i++) await page.waitForTimeout(50);
   assert(imageResponse,'real image request held before headers');
   imageResponse.writeHead(200, { 'Content-Type':'image/jpeg', 'Content-Length':jpeg.length, 'Cache-Control':'no-store' }); imageResponse.write(jpeg.subarray(0,2048));
   for(let i=0;i<40 && !await img.evaluate(e=>e.naturalWidth>0);i++) await page.waitForTimeout(50);
   assert(imageResponse,'real partial HTTP response started');assert(await img.evaluate(e=>e.naturalWidth>0&&!e.complete),'intrinsic size observed before load completion');
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const during=await offset(45);assert(Math.abs(during-before)<2,JSON.stringify({before,during,stage:'body still pending'}));
   imageResponse.end(jpeg.subarray(2048));
   await img.evaluate(e => e.complete && e.naturalWidth ? null : new Promise(r => e.addEventListener('load', r, { once: true })));
   await page.waitForTimeout(200); const after = await offset(45); assert(Math.abs(after - before) < 2, JSON.stringify({ before, after }));
  } else if (scenario === 'viewport after switch') {
   await page.locator('#tabs [role=tab]').filter({ hasText: 'other' }).click(); await page.locator('.msg[data-id="1080"]').waitFor({ state: 'attached' });
   const before = await scroll(1045); await page.waitForTimeout(200);
   await page.locator('#tabs [role=tab]').filter({ hasText: 'active' }).click(); await page.locator('#msgs').evaluate(b => { b.scrollTop = b.scrollHeight; });
   await page.waitForTimeout(200); await page.locator('#tabs [role=tab]').filter({ hasText: 'other' }).click();
   await page.setViewportSize({ width: 390, height: 389 }); await page.waitForTimeout(100); await page.setViewportSize({ width: 390, height: 699 }); await page.waitForTimeout(200);
   const after = await offset(1045); assert(Math.abs(after - before) < 2, JSON.stringify({ before, after }));
  } else {
   await page.waitForTimeout(400); const after = await offset(80); assert(Math.abs(after + 8) < 2, JSON.stringify({ expected: -8, after }));
  }
  assert.deepEqual(errors, []);
 });
}
