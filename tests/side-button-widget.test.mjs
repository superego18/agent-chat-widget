import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {getBrowser, closeBrowser} from './helpers.mjs';

after(closeBrowser);
const source = fs.readFileSync(new URL('../assets/app-widget.js', import.meta.url), 'utf8');
const evidence = new URL('../evidence/', import.meta.url);
fs.mkdirSync(evidence, {recursive: true});
for (const width of [390, 1440]) for (const colorScheme of ['light', 'dark']) test(`${width}px ${colorScheme} side-question button matches its interface and keeps empty-input list action`, async t => {
  const ctx = await (await getBrowser()).newContext({viewport: {width, height: 844}, colorScheme});
  t.after(() => ctx.close());
  const page = await ctx.newPage(), errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', r => {
    const p = new URL(r.request().url()).pathname;
    if (p === '/') return r.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width"><body>Fixture'});
    if (r.request().method() !== 'GET') {writes.push(p); return r.fulfill({json: {}});}
    return r.fulfill({json: p.endsWith('/sessions') ? {sessions: [{id: 'active', name: 'Active', tool: 'codex', status: {state: 'idle'}}]} : p.endsWith('/chat') ? {messages: [], delivered: {}} : p.endsWith('/drafts') ? {drafts: [], trash: []} : p.endsWith('/transcript') ? {items: []} : {}});
  });
  await page.goto('http://side-button.test/');
  await page.evaluate(() => {localStorage.setItem('__uifb_tab', 'active'); localStorage.setItem('__uifb_open:app', '1');});
  await page.addScriptTag({content: source});
  const button = page.locator('#side');
  await button.waitFor({state: 'visible'});
  const style = await button.evaluate(e => {const s = getComputedStyle(e), r = e.getBoundingClientRect(); return {bg: s.backgroundColor, text: s.color, border: s.borderTopColor, borderStyle: s.borderTopStyle, radius: s.borderRadius, width: r.width, height: r.height, x: r.x, right: r.right};});
  assert.equal(style.bg, 'rgb(236, 254, 255)');
  assert.equal(style.text, 'rgb(21, 94, 117)');
  assert.equal(style.border, 'rgb(34, 211, 238)');
  assert.equal(style.borderStyle, 'dashed');
  assert.equal(style.radius, '7px');
  assert(style.width > 0 && style.height === 25 && style.x >= 0 && style.right <= width);
  const interfaceBg = await page.locator('#sidebar').evaluate(e => getComputedStyle(e).backgroundColor);
  assert.equal(style.bg, interfaceBg);
  const neighbour = await page.locator('#later').evaluate(e => ({bg: getComputedStyle(e).backgroundColor, border: getComputedStyle(e).borderTopColor}));
  assert.equal(neighbour.bg, 'rgb(255, 255, 255)');
  assert.equal(neighbour.border, 'rgb(129, 140, 248)');
  await button.click();
  await page.locator('#sidepop').waitFor({state: 'visible'});
  assert.equal(await page.locator('#sidepop').textContent(), '곁질문이 없습니다.');
  assert.equal(await page.locator('#input').textContent(), '');
  await page.screenshot({path: new URL(`side-${width}-${colorScheme}.png`, evidence).pathname.replace(/^\/(\w:)/, '$1')});
  await button.click();
  assert.equal(await page.locator('#sidepop').isVisible(), false);
  assert.equal(writes.some(p => p.endsWith('/chat') || p.endsWith('/side')), false);
  assert.deepEqual(errors, []);
});
