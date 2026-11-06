import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {getBrowser, closeBrowser} from './helpers.mjs';

after(closeBrowser);
const source = fs.readFileSync(new URL('../assets/app-widget.js', import.meta.url), 'utf8');
const evidence = new URL('../evidence/', import.meta.url);
fs.mkdirSync(evidence, {recursive: true});
for (const width of [390, 1440]) for (const colorScheme of ['light', 'dark']) test(`${width}px ${colorScheme} hides location URLs while retaining picked targets and literal message links`, async t => {
  const ctx = await (await getBrowser()).newContext({viewport: {width, height: 844}, colorScheme});
  t.after(() => ctx.close());
  const page = await ctx.newPage(), errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  const location = '/?filter=attention&item=fixture&tab=result';
  const msg = (id, text, extra = {}) => ({id, text, from: 'user', to: 'active', context: 'app', at: '2026-11-06T00:00:00Z', ...extra});
  const rows = [msg(1, '일반 메시지', {where: {url: location}}), msg(2, '직접 쓴 링크 https://example.test/?filter=attention'),
    msg(3, '위치를 찍은 메시지', {where: {url: location, selector: '#title', text: '제목 입력창'}}),
    msg(4, '보관함 메시지', {draft: {label: '미분류', items: [{id: 71, text: '보관한 일반 메모', where: {url: location}, device: 'mobile'},
      {id: 72, text: '보관한 선택 영역', where: {url: location, selector: '#photo', text: '사진 영역'}, device: 'desktop'},
      {id: 73, text: '이름 없는 선택 영역', where: {url: location, selector: '#fallback-target'}}]}})];
  const original = JSON.stringify(rows);
  await page.route('**/*', r => {
    const p = new URL(r.request().url()).pathname;
    if (p === '/') return r.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width"><body>Fixture'});
    if (r.request().method() !== 'GET') {writes.push(p); return r.fulfill({json: {}});}
    return r.fulfill({json: p.endsWith('/sessions') ? {sessions: [{id: 'active', name: 'Active', tool: 'codex', status: {state: 'idle'}}]} : p.endsWith('/chat') ? {messages: rows, delivered: {}} : p.endsWith('/drafts') ? {drafts: [], trash: []} : p.endsWith('/transcript') ? {items: []} : {}});
  });
  await page.goto('http://message-location.test/');
  await page.evaluate(() => {localStorage.setItem('__uifb_tab', 'active'); localStorage.setItem('__uifb_open:app', '1');});
  await page.addScriptTag({content: source});
  await page.locator('.msg[data-id="4"] .meta').first().waitFor();
  const metadata = await page.locator('.msg > small, .msg .meta').allTextContents();
  assert(!metadata.some(s => s.includes('filter=') || s.includes('tab=') || s.includes('item=')));
  assert((await page.locator('.msg[data-id="3"] > small').textContent()).includes('📍 제목 입력창'));
  const saved = await page.locator('.msg[data-id="4"] .meta').allTextContents();
  assert((await page.locator('.msg[data-id="4"] .tag').textContent()).includes('보관함 › 미분류'));
  assert(saved[0].includes('모바일')); assert(!saved[0].includes('📍'));
  assert(saved[1].includes('📍 사진 영역')); assert(saved[1].includes('데스크톱'));
  assert(saved[2].includes('📍 #fallback-target'));
  assert((await page.locator('.msg[data-id="2"] .mbody').textContent()).includes('https://example.test/?filter=attention'));
  assert.equal(JSON.stringify(rows), original);
  assert.equal(rows[0].where.url, location); assert.equal(rows[2].where.selector, '#title');
  await page.screenshot({path: fileURLToPath(new URL(`location-${width}-${colorScheme}.png`, evidence))});
  assert.equal(writes.some(p => p.endsWith('/chat') || p.endsWith('/drafts')), false);
  assert.deepEqual(errors, []);
});
