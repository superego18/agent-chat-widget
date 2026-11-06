import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {getBrowser, closeBrowser} from './helpers.mjs';

after(closeBrowser);
const source = fs.readFileSync(new URL('../assets/app-widget.js', import.meta.url), 'utf8');
const evidence = new URL('../evidence/', import.meta.url);
fs.mkdirSync(evidence, {recursive: true});
for (const mode of ['cached', 'pending', 'wheel', 'touch-boundary']) test(`${mode}: delayed initial restoration respects subsequent reading intent`, {timeout: 25000}, async t => {
  const ctx = await (await getBrowser()).newContext({viewport: {width: 390, height: 744}, isMobile: true, hasTouch: true});
  t.after(() => ctx.close());
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const messages = ['active', 'other'].flatMap((session, s) => Array.from({length: 40}, (_, i) => ({id: s * 100 + i + 1, from: 'agent', session,
    text: `Synthetic ${session} ${i + 1}\nSecond reading line\nThird reading line`, at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()})));
  const items = Array.from({length: 150}, (_, i) => ({id: 'xlate' + i, from: 'agent', session: 'active', context: 'terminal',
    text: `Synthetic native ${i}\nSecond history line`, at: new Date(Date.UTC(2026, 0, 2, 0, i)).toISOString()}));
  const savedId = mode === 'cached' ? '8' : 'xlate80', prefs = {pos: {active: savedId + '@-8', other: '108@-8'}};
  let release;
  await page.route('**/*', r => {
    const url = new URL(r.request().url()), p = url.pathname;
    if (p === '/') return r.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width"><body>Fixture'});
    if (r.request().method() !== 'GET') return r.fulfill({json: {}});
    if (p.endsWith('/transcript') && url.searchParams.get('session') === 'active') {release = () => r.fulfill({json: {items}}); return;}
    return r.fulfill({json: p.endsWith('/sessions') ? {sessions: ['active', 'other'].map(id => ({id, name: id, tool: 'codex', status: {state: 'idle'}}))} : p.endsWith('/chat') ? {messages, delivered: {}} : p.endsWith('/prefs') ? prefs : p.endsWith('/seen') ? {active: '2027-01-01T00:00:00Z', other: '2027-01-01T00:00:00Z'} : p.endsWith('/drafts') ? {drafts: [], trash: []} : p.endsWith('/transcript') ? {items: []} : {}});
  });
  await page.goto('http://pending-intent.test/');
  await page.evaluate(prefs => {localStorage.setItem('__uifb_tab', 'other'); localStorage.setItem('__uifb_open:app', '1'); sessionStorage.setItem('__uifb_positions', JSON.stringify(prefs.pos));}, prefs);
  await page.addScriptTag({content: source});
  await page.locator('.msg[data-id="108"]').waitFor();
  const start = await page.evaluate(() => performance.now());
  await page.getByRole('tab', {name: /^active/}).click();
  await page.locator('.msg[data-id="8"]').waitFor();
  const firstRowsMs = await page.evaluate(start => performance.now() - start, start);
  const topRow = () => page.locator('#msgs').evaluate(b => {const m = [...b.querySelectorAll('.msg[data-id]')].find(e => e.getBoundingClientRect().bottom > b.getBoundingClientRect().top + 1); return {id: m?.dataset.id, offset: m ? m.getBoundingClientRect().top - b.getBoundingClientRect().top : null, scrollTop: b.scrollTop};});
  let cachedRestoreMs = null;
  if (mode === 'cached') {
    await page.waitForFunction(() => {const r = [...document.body.children].map(e => e.shadowRoot).find(r => r?.getElementById('msgs')), b = r?.getElementById('msgs'), m = b?.querySelector('.msg[data-id="8"]'); return m && Math.abs(m.getBoundingClientRect().top - b.getBoundingClientRect().top + 8) < 2;});
    cachedRestoreMs = await page.evaluate(start => performance.now() - start, start);
  }
  if (mode === 'wheel' || mode === 'touch-boundary') {
    const beforeScroll = await page.locator('#msgs').evaluate(b => b.scrollTop), box = await page.locator('#msgs').boundingBox();
    if (mode === 'wheel') {await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, 220);}
    else await page.locator('#msgs').evaluate(b => {b.dispatchEvent(new Event('touchmove', {bubbles: true})); b.scrollTop += 220;});
    await page.waitForFunction(before => {const r = [...document.body.children].map(e => e.shadowRoot).find(r => r?.getElementById('msgs')); return r && r.getElementById('msgs').scrollTop > before + 50;}, beforeScroll);
  }
  await page.waitForTimeout(1200);
  const before = await topRow();
  assert(release, 'Native history must remain held until after the user action');
  const responseReleasedMs = await page.evaluate(start => performance.now() - start, start);
  await release();
  await page.locator('.msg[data-id="xlate149"]').waitFor();
  await page.waitForTimeout(150);
  const after = await topRow(), settledMs = await page.evaluate(start => performance.now() - start, start);
  fs.writeFileSync(new URL(`pending-${mode}.json`, evidence), JSON.stringify({mode, firstRowsMs, cachedRestoreMs, responseReleasedMs, settledMs, before, after, errors, physicalTouchCertified: false}, null, 2));
  await page.screenshot({path: fileURLToPath(new URL(`pending-${mode}.png`, evidence))});
  if (mode === 'wheel' || mode === 'touch-boundary') assert(after.id === before.id && Math.abs(after.offset - before.offset) < 2, JSON.stringify({before, after}));
  else assert(after.id === savedId && Math.abs(after.offset + 8) < 2, JSON.stringify({savedId, after}));
  assert.deepEqual(errors, []);
});
