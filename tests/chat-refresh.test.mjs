import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getBrowser, closeBrowser } from './helpers.mjs';
after(closeBrowser);
const source = fs.readFileSync(new URL('../assets/app-widget.js', import.meta.url), 'utf8');
const target = { id: 'refresh-test', name: 'Refresh target', tool: 'codex', watch: { active: true, via: 'queue' }, status: { state: 'idle' } };

async function open(t, width, panelOpen = true) {
  const context = await (await getBrowser()).newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
  t.after(() => context.close());
  const page = await context.newPage();
  const state = { documents: 0, messages: [], transcriptItems: [], composed: {}, chatReads: 0, sessionReads: 0, stalled: false, holdChat: false, heldChat: [] };
  if (!panelOpen) state.composed[target.id] = { text: 'Unsent conversation' };
  await page.route('**/*', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') {
      state.documents++;
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width"><body><input id="app-draft" aria-label="App draft"></body>' });
    }
    if (route.request().method() !== 'GET') {
      if (path.endsWith('/compose')) {
        const { session, text } = route.request().postDataJSON();
        state.composed[session] = { text };
      }
      return route.fulfill({ json: {} });
    }
    if (path.endsWith('/compose')) return route.fulfill({ json: state.composed });
    if (path.endsWith('/sessions')) {
      state.sessionReads++;
      if (state.stalled) return;
      return route.fulfill({ json: { sessions: [target] } });
    }
    if (path.endsWith('/chat')) {
      state.chatReads++;
      if (state.holdChat) { state.heldChat.push(route); return; }
      return route.fulfill({ json: { messages: state.messages, delivered: {} } });
    }
    return route.fulfill({ json: path.endsWith('/drafts') ? { drafts: [], trash: [] } : path.endsWith('/transcript') ? { items: state.transcriptItems } : {} });
  });
  await page.goto('http://refresh.test/');
  await page.locator('#app-draft').fill('Unsubmitted app form');
  await page.clock.install();
  await page.addScriptTag({ content: source });
  if (panelOpen) await page.locator('#btn').click();
  await page.getByRole('tab', { name: target.name, exact: true, includeHidden: true }).waitFor({ state: 'attached' });
  await page.waitForTimeout(150);
  if (panelOpen) await page.locator('#input').fill('Unsent conversation');
  else await page.waitForFunction(() => [...document.querySelectorAll('*')].some(e => e.shadowRoot?.getElementById('input')?.value === 'Unsent conversation'));
  await page.evaluate(() => { window.appSentinel = document.getElementById('app-draft'); });
  return { page, state };
}

for (const width of [390, 1440]) for (const button of ['reload', 'rbtn']) test(`${width}px ${button} refreshes conversation without reloading the app or losing drafts`, async t => {
  const { page, state } = await open(t, width, button !== 'rbtn');
  const previousReads = state.chatReads, previousSessions = state.sessionReads;
  state.messages.push({ id: 1, from: 'user', to: target.id, text: 'New stored conversation', at: new Date().toISOString(), context: 'app' });
  await page.locator('#' + button).click();
  await page.waitForTimeout(550);
  assert.equal(state.documents, 1, 'the app document must never be requested again');
  assert.equal(await page.evaluate(() => window.appSentinel === document.getElementById('app-draft')), true);
  assert.equal(await page.locator('#app-draft').inputValue(), 'Unsubmitted app form');
  assert.ok(state.chatReads > previousReads, 'the button must actually refresh chat data');
  assert.ok(state.sessionReads > previousSessions, 'the button must refresh session data');
  if (button === 'rbtn') await page.locator('#btn').click();
  await page.locator('.msg[data-id="1"]').waitFor();
  assert.equal(await page.locator('#input').evaluate(el => el.value), 'Unsent conversation');
  assert.equal(await page.locator('#reloadCover').isHidden(), true);
  assert.equal(await page.locator('#' + button).evaluate(el => el.classList.contains('reloading')), false);
});

test('a stalled manual refresh ends, keeps known sessions and preserves both drafts', async t => {
  const { page, state } = await open(t, 390);
  state.stalled = true;
  await page.locator('#reload').click();
  await page.clock.runFor(8500);
  assert.equal(state.documents, 1);
  assert.match(await page.locator('#mode').textContent(), /갱신하지 못/);
  assert.equal(await page.locator('#reload').evaluate(el => el.classList.contains('reloading')), false);
  assert.equal(await page.locator('#reloadCover').isHidden(), true);
  assert.equal(await page.locator('#app-draft').inputValue(), 'Unsubmitted app form');
  assert.equal(await page.locator('#input').evaluate(el => el.value), 'Unsent conversation');
});

test('refresh during an older poll waits for it and requests fresh data once it closes', async t => {
  const { page, state } = await open(t, 390);
  state.holdChat = true;
  await page.clock.runFor(3100);
  assert.equal(state.heldChat.length, 1);
  const before = state.chatReads;
  await page.locator('#reload').click();
  assert.equal(await page.locator('#reload').getAttribute('aria-busy'), 'true');
  state.holdChat = false;
  state.messages.push({ id: 2, from: 'user', to: target.id, text: 'Stored after older read', at: new Date().toISOString(), context: 'app' });
  await state.heldChat[0].fulfill({ json: { messages: [], delivered: {} } });
  await page.locator('.msg[data-id="2"]').waitFor({ timeout: 2000 });
  assert.ok(state.chatReads > before);
  assert.equal(state.documents, 1);
  assert.equal(await page.locator('#input').evaluate(el => el.value), 'Unsent conversation');
});

for (const width of [390, 1440]) test(`manual refresh updates the color of the same native message after provenance arrives at ${width}px`, async t => {
  const { page, state } = await open(t, width);
  const item = { id: 'x-native-existing', from: 'user', session: target.id, context: 'terminal', text: '[pipeline-continuation:11111111-1111-4111-8111-111111111111]\nSynthetic instruction', at: '2026-11-05T00:00:00Z' };
  state.transcriptItems.push(item);
  await page.locator('#reload').click();
  const bubble = page.locator('.msg[data-id="x-native-existing"]');
  await bubble.waitFor(); assert.equal(await bubble.evaluate(e => e.classList.contains('user')), true);
  Object.assign(item, { from: 'automation', automationKind: 'pipeline-continuation', automationId: '11111111-1111-4111-8111-111111111111', automationProvider: 'codex', automationTransport: 'app-server' });
  await page.locator('#reload').click();
  await page.waitForFunction(() => [...document.querySelectorAll('*')].some(e => e.shadowRoot?.querySelector('.msg.automation[data-id="x-native-existing"]')));
  assert.match(await bubble.locator('.tag').textContent(), /자동 안내.*작업 이어가기.*Codex.*app-server/);
  assert.equal(await bubble.evaluate(e => getComputedStyle(e).borderTopStyle), 'dashed');
  assert.equal(await bubble.count(), 1); assert.equal(state.documents, 1);
  assert.equal(await page.locator('#input').evaluate(e => e.value), 'Unsent conversation');
});
