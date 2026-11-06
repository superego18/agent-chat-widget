import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {chromium, webkit} from 'playwright-core';

const source = fs.readFileSync(new URL('../assets/app-widget.js', import.meta.url), 'utf8');
const evidence = new URL('../evidence/', import.meta.url);
fs.mkdirSync(evidence, {recursive: true});
for (const engine of ['chrome', 'webkit']) for (const entry of ['open', 'switch', 'read further']) test(`${engine} ${entry}: a correct restored anchor survives delayed longer native history`, {timeout: 40000}, async t => {
  const browser = await (engine === 'chrome' ? chromium.launch({channel: 'chrome', headless: true}) : webkit.launch({headless: true}));
  t.after(() => browser.close());
  const ctx = await browser.newContext({viewport: {width: 390, height: 744}, isMobile: true, hasTouch: true});
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const messages = ['active', 'other'].flatMap((session, s) => Array.from({length: 30}, (_, i) => ({id: s * 100 + i + 1, from: 'agent', session,
    text: `Synthetic shared ${session} ${i + 1}\nReading anchor line\nThird line`, at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()})));
  const items = Array.from({length: 150}, (_, i) => ({id: 'xlate' + i, from: 'agent', session: 'active', context: 'terminal',
    text: `Synthetic native ${i}\nOlder recorded turn`, at: new Date(Date.UTC(2026, 0, 2, 0, i)).toISOString()}));
  const prefs = {pos: {active: '8@-8', other: '108@-8'}};
  let release;
  await page.route('**/*', r => {
    const url = new URL(r.request().url()), p = url.pathname;
    if (p === '/') return r.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width"><body>Fixture'});
    if (r.request().method() !== 'GET') return r.fulfill({json: {}});
    if (p.endsWith('/transcript') && url.searchParams.get('session') === 'active') {release = () => r.fulfill({json: {items}}); return;}
    return r.fulfill({json: p.endsWith('/sessions') ? {sessions: ['active', 'other'].map(id => ({id, name: id, tool: 'codex', status: {state: 'idle'}}))} : p.endsWith('/chat') ? {messages, delivered: {}} : p.endsWith('/prefs') ? prefs : p.endsWith('/seen') ? {active: '2027-01-01T00:00:00Z', other: '2027-01-01T00:00:00Z'} : p.endsWith('/drafts') ? {drafts: [], trash: []} : p.endsWith('/transcript') ? {items: []} : {}});
  });
  await page.goto('http://late-history.test/');
  await page.evaluate(({entry, prefs}) => {localStorage.setItem('__uifb_tab', entry === 'switch' ? 'other' : 'active'); localStorage.setItem('__uifb_open:app', '1'); sessionStorage.setItem('__uifb_positions', JSON.stringify(prefs.pos));}, {entry, prefs});
  await page.addScriptTag({content: source});
  if (entry === 'switch') {await page.locator('.msg[data-id="108"]').waitFor(); await page.getByRole('tab', {name: /^active/}).click();}
  await page.waitForFunction(() => {const root = [...document.body.children].map(e => e.shadowRoot).find(r => r?.getElementById('msgs')); const b = root?.getElementById('msgs'), m = b?.querySelector('.msg[data-id="8"]'); return m && Math.abs(m.getBoundingClientRect().top - b.getBoundingClientRect().top + 8) < 2;});
  let anchorId = '8';
  if (entry === 'read further') {
    const box = await page.locator('#msgs').boundingBox();
    const start = await page.locator('#msgs').evaluate(b => b.scrollTop);
    if (engine === 'chrome') {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 230);
    } else {
      // Playwright rejects wheel input in mobile WebKit. Change the real scroll
      // position before releasing history; no post-response position forcing.
      await page.locator('#msgs').evaluate(b => {b.scrollTop += 230;});
    }
    await page.waitForFunction(start => {const root = [...document.body.children].map(e => e.shadowRoot).find(r => r?.getElementById('msgs')); return root?.getElementById('msgs').scrollTop > start + 50;}, start);
    await page.waitForTimeout(150);
    anchorId = await page.locator('#msgs').evaluate(b => [...b.querySelectorAll('.msg[data-id]')].find(m => m.getBoundingClientRect().bottom > b.getBoundingClientRect().top + 1).dataset.id);
    assert.notEqual(anchorId, '8', 'Scrolling must change the reading anchor before the delayed response');
  }
  const measure = () => page.locator('#msgs').evaluate((b, id) => {const m = b.querySelector(`.msg[data-id="${id}"]`); return {exists: !!m, offset: m ? m.getBoundingClientRect().top - b.getBoundingClientRect().top : null, rendered: b.querySelectorAll('.msg').length, scrollTop: b.scrollTop};}, anchorId);
  const before = await measure();
  assert(release, 'The native response must actually remain pending until after restoration');
  await release();
  await page.locator('.msg[data-id="xlate149"]').waitFor();
  await page.waitForTimeout(150);
  const after = await measure();
  fs.writeFileSync(new URL(`late-${engine}-${entry}.json`, evidence), JSON.stringify({engine, entry, before, after, errors}, null, 2));
  await page.screenshot({path: fileURLToPath(new URL(`late-${engine}-${entry}.png`, evidence))});
  assert(after.exists && Math.abs(after.offset - before.offset) < 2, JSON.stringify({engine, entry, before, after}));
  assert.deepEqual(errors, []);
});
