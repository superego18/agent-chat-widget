import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {getBrowser, closeBrowser} from './helpers.mjs';

after(closeBrowser);
const source = fs.readFileSync(new URL('../assets/app-widget.js', import.meta.url), 'utf8');
for (const width of [390, 1440]) test(`${width}px repeated automatic notices share compact label disclosure without hiding conversations`, async t => {
  const ctx = await (await getBrowser()).newContext({viewport: {width, height: 844}});
  t.after(() => ctx.close());
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const make = (id, extra = {}) => ({id, from: 'user', session: 'active', context: 'terminal', text: 'Synthetic repeated notice\nFull unchanged content', at: '2026-11-06T00:00:00Z', ...extra});
  const kinds = ['goal-context', 'project-instructions', 'environment-context', 'orca-dispatch', 'pipeline-continuation'];
  const notices = kinds.map((kind, i) => make(`xnotice${i}`, {nativeDisplay: {provider: 'codex', kind}}));
  notices.push(make('xmail', {text: 'You have 1 orchestration message. Run `orca orchestration check --run run_fixture`.'}),
    make('xautomation', {from: 'automation', automationKind: 'pipeline-continuation'}));
  const controls = [make('xowner'), make('xquoted', {text: '[pipeline-continuation:owner-quotation] literal owner text'}),
    make('xagent', {from: 'agent', text: 'Synthetic error or permission answer'}), make('xpeer', {from: 'peer', peerMethod: 'message-tool'}),
    make('xunknown', {nativeDisplay: {provider: 'codex', kind: 'unknown'}}),
    make(1, {context: 'app', nativeDisplay: {provider: 'codex', kind: 'goal-context'}}),
    make('xquestion', {nativeDisplay: {provider: 'codex', kind: 'pipeline-continuation'}, nativeQuestion: {tool: 'request_user_input_async'}}),
    make('xattachment', {nativeDisplay: {provider: 'codex', kind: 'goal-context'}, attachments: [{url: '/__uifb/api/chat-images/aaaaaaaa-0000-4000-8000-000000000001', name: 'Synthetic attachment'}]}),
    make('xunqualified', {from: 'automation', automationKind: 'unknown'})];
  const rows = [...notices, ...controls];
  await page.route('**/*', r => {
    const p = new URL(r.request().url()).pathname;
    if (p === '/') return r.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width"><body>Fixture'});
    if (p.startsWith('/__uifb/api/chat-images/')) return r.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="blue"/></svg>'});
    if (r.request().method() !== 'GET') return r.fulfill({json: {}});
    return r.fulfill({json: p.endsWith('/sessions') ? {sessions: [{id: 'active', name: 'Active', tool: 'codex', status: {state: 'idle'}}]} : p.endsWith('/chat') ? {messages: rows, delivered: {}} : p.endsWith('/drafts') ? {drafts: [], trash: []} : p.endsWith('/transcript') ? {items: []} : {}});
  });
  await page.goto('http://automatic-notice.test/');
  await page.evaluate(() => {localStorage.setItem('__uifb_tab', 'active'); localStorage.setItem('__uifb_open:app', '1');});
  await page.addScriptTag({content: source});
  await page.locator('.msg[data-id="xunqualified"]').waitFor();
  fs.mkdirSync(new URL('../.local/', import.meta.url), {recursive: true});
  for (const m of notices) {
    const row = page.locator(`.msg[data-id="${m.id}"]`), body = row.locator('.mbody'), toggle = row.locator('.subt');
    await toggle.waitFor({state: 'visible'});
    assert.equal(await body.isVisible(), false);
    await toggle.scrollIntoViewIfNeeded();
    const label = await row.locator('.tag').boundingBox(), button = await toggle.boundingBox(), box = await row.boundingBox();
    assert(label && button && box);
    assert(label.x + label.width <= button.x + 1);
    assert(button.x + button.width <= box.x + box.width + 1);
    assert(Math.min(label.y + label.height, button.y + button.height) > Math.max(label.y, button.y));
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await row.screenshot({path: new URL(`../.local/automatic-${width}-${m.id}.png`, import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, '$1:')});
    await toggle.focus(); await page.keyboard.press('Enter');
    assert.equal(await row.locator('.subt').getAttribute('aria-expanded'), 'true');
    assert.equal(await body.isVisible(), true);
    assert.equal(await body.textContent(), m.text.replace(/`/g, ''));
    await row.locator('.subt').click();
    assert.equal(await body.isVisible(), false);
  }
  for (const m of controls) {
    const row = page.locator(`.msg[data-id="${m.id}"]`);
    assert.equal(await row.locator('.subt').count(), 0, `unexpected disclosure for ${m.id}`);
    assert.equal(await row.locator('.mbody').isVisible(), true);
    assert.equal(await row.locator('.mbody').textContent(), m.text);
  }
  assert.equal(await page.locator('.msg[data-id="xattachment"] img').isVisible(), true);
  assert.deepEqual(errors, []);
});
