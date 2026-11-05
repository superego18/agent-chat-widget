import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getBrowser, closeBrowser } from './helpers.mjs';

after(closeBrowser);
const source = fs.readFileSync(new URL('../assets/app-widget.js', import.meta.url), 'utf8');
const session = { id: 'startup-test', name: 'Startup session', tool: 'codex', watch: { via: 'queue' }, status: { state: 'unknown' } };
async function open(t, width = 390, configure = () => {}) {
  const ctx = await (await getBrowser()).newContext({ viewport: { width, height: 844 } });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  const state = { sessions: [session], status: 200, malformed: false, networkError: false, pending: false, slow: '', calls: 0 };
  configure(state);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width"><body>Fixture</body>' });
    if (url.pathname.endsWith('/sessions')) {
      state.calls++;
      if (state.pending) return;
      if (state.networkError) return route.abort('failed');
      return route.fulfill({ status: state.status, json: state.malformed ? {} : { sessions: state.sessions } });
    }
    if (url.pathname.endsWith(state.slow) && state.slow) return;
    const body = url.pathname.endsWith('/chat') ? { messages: [], delivered: {} }
      : url.pathname.endsWith('/drafts') ? { drafts: [], trash: [] }
      : url.pathname.endsWith('/transcript') ? { items: [] } : {};
    return route.fulfill({ json: body });
  });
  await page.goto('http://startup.test/');
  await page.clock.install();
  await page.evaluate(selected => {
    localStorage.setItem('__uifb_open:app', '1');
    if (selected) localStorage.setItem('__uifb_tab', selected);
  }, state.selected);
  await page.addScriptTag({ content: source });
  return { page, state };
}

for (const width of [390, 1440]) test(`reopening immediately shows loading, then sessions despite blocked history (${width}px)`, async t => {
  const { page, state } = await open(t, width, s => { s.pending = true; s.slow = '/chat'; });
  await page.locator('#panel').waitFor({ state: 'visible', timeout: 2000 });
  assert.match(await page.locator('#mode').textContent(), /불러오는 중/);
  assert.doesNotMatch(await page.locator('#msgs').textContent(), /등록된 세션이 없습니다/);
  await page.clock.runFor(8200);
  assert.match(await page.locator('#mode').textContent(), /불러오지 못/);
  assert.doesNotMatch(await page.locator('#msgs').textContent(), /등록된 세션이 없습니다/);
  state.pending = false;
  await page.clock.runFor(4000);
  await page.getByRole('tab', { name: session.name, exact: true }).waitFor({ timeout: 2000 });
  assert.equal(await page.locator('#input').isEnabled(), true);
});

for (const problem of ['http', 'malformed', 'network']) test(`session ${problem} is an error, recovery and subsequent failure preserve known sessions`, async t => {
  const { page, state } = await open(t, 390, s => { s.status = problem === 'http' ? 503 : 200; s.malformed = problem === 'malformed'; s.networkError = problem === 'network'; });
  await page.locator('#panel').waitFor({ state: 'visible', timeout: 2000 });
  await page.getByText('세션 목록을 불러오지 못했습니다.', { exact: false }).first().waitFor({ timeout: 2000 });
  assert.doesNotMatch(await page.locator('#msgs').textContent(), /등록된 세션이 없습니다/);
  state.status = 200; state.malformed = false; state.networkError = false;
  await page.getByRole('tab', { name: session.name, exact: true }).waitFor({ timeout: 6000 });
  await page.locator('#input').fill('Keep my unsent words');
  state.status = 503;
  await page.waitForFunction(() => [...document.querySelectorAll('*')].some(e => e.shadowRoot?.getElementById('mode')?.textContent.includes('갱신하지 못')));
  assert.equal(await page.locator('#input').evaluate(el => el.value), 'Keep my unsent words');
  assert.equal(await page.getByRole('tab', { name: session.name, exact: true }).count(), 1);
  assert.equal(await page.locator('#input').isEnabled(), true);
});

test('only a successful validated empty list shows unregistered', async t => {
  const { page } = await open(t, 390, s => { s.sessions = []; });
  await page.locator('#panel').waitFor({ state: 'visible', timeout: 2000 });
  await page.waitForFunction(() => [...document.querySelectorAll('*')].some(e => e.shadowRoot?.getElementById('mode')?.textContent === '등록된 세션이 없습니다.'));
  assert.equal(await page.locator('#input').isDisabled(), true);
});

test('loading does not discard the previously selected session', async t => {
  const { page, state } = await open(t, 390, s => {
    s.pending = true;
    s.selected = 'second-session';
    s.sessions.push({ ...session, id: s.selected, name: 'Second session' });
  });
  await page.locator('#panel').waitFor({ state: 'visible', timeout: 2000 });
  await page.clock.runFor(8200);
  state.pending = false;
  await page.clock.runFor(4000);
  await page.getByRole('tab', { name: 'Second session', exact: true }).waitFor({ timeout: 2000 });
  assert.equal(await page.getByRole('tab', { name: 'Second session', exact: true }).getAttribute('aria-pressed'), 'true');
});

for (const slow of ['/drafts', '/transcript']) test(`valid sessions appear without waiting for ${slow}`, async t => {
  const { page } = await open(t, 390, s => { s.slow = slow; });
  await page.getByRole('tab', { name: session.name, exact: true }).waitFor({ timeout: 2000 });
  await page.locator('#panel').waitFor({ state: 'visible', timeout: 2000 });
  assert.equal(await page.locator('#input').isEnabled(), true);
});
