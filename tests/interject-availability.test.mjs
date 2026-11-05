import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getBrowser, closeBrowser } from './helpers.mjs';
after(closeBrowser);
const source = fs.readFileSync(new URL('../assets/app-widget.js', import.meta.url), 'utf8');
for (const width of [390, 1440]) test(`${width}px control refresh preserves button position without enabling stale delivery`, async t => {
  const ctx = await (await getBrowser()).newContext({ viewport: { width, height: 844 } }); t.after(() => ctx.close());
  const page = await ctx.newPage(); let state = 'working', control = 'connected', steer = true, posts = 0;
  await page.route('**/*', r => {
    const p = new URL(r.request().url()).pathname;
    if (p === '/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><body>Fixture' });
    if (r.request().method() !== 'GET') { if (/\/(chat|chat-interject|chat-retry)$/.test(p)) posts++; return r.fulfill({ json: {} }); }
    return r.fulfill({ json: p.endsWith('/sessions') ? { sessions: [{ id: 'active', name: 'Active', tool: 'codex', status: { state }, watch: { configured: true, active: true, via: 'queue', control, steer } }] } : p.endsWith('/chat') ? { messages: [], delivered: {} } : p.endsWith('/transcript') ? { items: [] } : p.endsWith('/drafts') ? { drafts: [], trash: [] } : {} });
  });
  await page.goto('http://interject-state.test/'); await page.clock.install();
  await page.evaluate(() => { localStorage.setItem('__uifb_tab', 'active'); localStorage.setItem('__uifb_open:app', '1'); });
  await page.addScriptTag({ content: source }); const button = page.locator('#now'); await button.waitFor();
  assert.equal(await button.isEnabled(), true); const original = await button.boundingBox();
  const advance = async () => { await page.clock.runFor(3500); await page.waitForTimeout(100); };
  control = 'checking'; steer = false; await advance();
  assert.equal(await button.isVisible(), true); assert.equal(await button.isDisabled(), true); assert.match(await button.getAttribute('title'), /확인/);
  const checking = await button.boundingBox(); assert.equal(checking.width, original.width); assert.equal(checking.height, original.height);
  control = 'connected'; steer = true; await advance(); assert.equal(await button.isEnabled(), true);
  control = 'disconnected'; steer = false; await advance(); assert.equal(await button.isVisible(), true); assert.equal(await button.isDisabled(), true);
  state = 'idle'; await advance(); assert.equal(await button.isVisible(), false);
  state = 'unknown'; await advance(); assert.equal(await button.isVisible(), false);
  assert.equal(posts, 0, 'observing control never sends or resends messages');
});
