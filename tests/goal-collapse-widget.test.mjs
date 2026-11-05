import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {getBrowser, closeBrowser} from './helpers.mjs';

after(closeBrowser);
const source = fs.readFileSync(new URL('../assets/app-widget.js', import.meta.url), 'utf8');
for (const width of [390, 1440]) test(`${width}px Goal context folds to three lines and preserves source and other messages`, async t => {
  const ctx = await (await getBrowser()).newContext({viewport: {width, height: 844}});
  t.after(() => ctx.close());
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const long = Array.from({length: 12}, (_, i) => `Synthetic Goal line ${i + 1}`).join('\n');
  const message = (id, text, extra = {}) => ({id, text, from: 'user', session: 'active', context: 'terminal', at: '2026-11-06T00:00:00Z', ...extra});
  const display = {nativeDisplay: {provider: 'codex', kind: 'goal-context'}};
  const rows = [message('xlong', long, display), message('xshort', 'Short Goal', display), message('xowner', long), message(1, long, {...display, context: 'app'}), message('xsub', long, {from: 'sub'})];
  await page.route('**/*', r => {
    const p = new URL(r.request().url()).pathname;
    if (p === '/') return r.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width"><body>Fixture'});
    if (r.request().method() !== 'GET') return r.fulfill({json: {}});
    return r.fulfill({json: p.endsWith('/sessions') ? {sessions: [{id: 'active', name: 'Active', tool: 'codex', status: {state: 'idle'}}]} : p.endsWith('/chat') ? {messages: rows, delivered: {}} : p.endsWith('/drafts') ? {drafts: [], trash: []} : p.endsWith('/transcript') ? {items: []} : {}});
  });
  await page.goto('http://goal-collapse.test/');
  await page.evaluate(() => {localStorage.setItem('__uifb_tab', 'active'); localStorage.setItem('__uifb_open:app', '1');});
  await page.addScriptTag({content: source});
  const row = page.locator('.msg[data-id="xlong"]'), body = row.locator('.mbody'), toggle = row.locator('.subt');
  await toggle.waitFor({state: 'visible'});
  const folded = await body.evaluate(e => ({height: e.clientHeight, line: parseFloat(getComputedStyle(e).lineHeight), scroll: e.scrollHeight, clamp: getComputedStyle(e).webkitLineClamp}));
  assert.equal(folded.clamp, '3'); assert(folded.height <= folded.line * 3 + 1); assert(folded.scroll > folded.height);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await toggle.click();
  await row.locator('.subt[aria-expanded="true"]').waitFor();
  assert.equal(await body.textContent(), long);
  assert(await body.evaluate(e => e.clientHeight >= e.scrollHeight - 1));
  assert.equal(await row.locator('.tag').textContent(), '자동 문맥 · Codex · 목표 진행');
  await row.locator('.subt').click();
  await row.locator('.subt[aria-expanded="false"]').waitFor();
  assert.equal(await body.evaluate(e => getComputedStyle(e).webkitLineClamp), '3');
  assert.equal(await page.locator('.msg[data-id="xshort"] .subt').isVisible(), false);
  for (const id of ['xowner', '1']) {
    assert.equal(await page.locator(`.msg[data-id="${id}"] .subt`).count(), 0);
    assert.equal(await page.locator(`.msg[data-id="${id}"] .mbody`).textContent(), long);
  }
  assert.equal(await page.locator('.msg[data-id="xsub"] .mbody').evaluate(e => getComputedStyle(e).webkitLineClamp), '3');
  assert.equal(rows[0].text, long);
  assert.deepEqual(errors, []);
});
