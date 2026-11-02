import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getBrowser, closeBrowser } from './helpers.mjs';

after(closeBrowser);

const source = fs.readFileSync(process.env.UIFB_TEST_SOURCE || new URL('../assets/app-widget.js', import.meta.url), 'utf8');
const session = { id: 'test-thread', name: 'Test session', tool: 'codex', watch: { active: false, via: 'queue' }, status: { state: 'unknown' } };
const entry = (state) => ({ id: 1, from: 'user', to: session.id, text: 'Synthetic request', cid: 'test-message', context: 'app', at: new Date().toISOString(), queue: { state } });

test('send acknowledgement clears the composer and loading together with its bubble despite slow polling', async t => {
  const { page, store } = await open(t, 390);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/__uifb/api/chat', async route => {
    if (route.request().method() === 'POST') {
      const saved = { ...route.request().postDataJSON(), id: 1, at: new Date().toISOString(), queue: { state: 'accepted' } };
      store.messages.push(saved);
      return route.fulfill({ json: saved });
    }
    await gate;
    return route.fulfill({ json: { messages: store.messages, delivered: {} } });
  });
  try {
    await page.locator('#input').fill('Synchronized send');
    await page.locator('#form button[type="submit"]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('*')].some(e => e.shadowRoot?.getElementById('input')?.value === ''));
    assert.equal(await page.locator('.msg[data-id="1"]').count(), 1, 'the saved response must create the bubble without waiting for polling');
    assert.equal(await page.locator('#form button[type="submit"]').evaluate(el => el.classList.contains('busy')), false);
  } finally { release(); }
});

test('polling cannot show a submitted bubble before the send acknowledgement clears the composer', async t => {
  const { page, store } = await open(t, 390);
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const posted = new Promise(resolve => { started = resolve; });
  await page.route('**/__uifb/api/chat', async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { messages: store.messages, delivered: {} } });
    const saved = { ...route.request().postDataJSON(), id: 1, at: new Date().toISOString(), queue: { state: 'accepted' } };
    store.messages.push(saved); started();
    await gate;
    return route.fulfill({ json: saved });
  });
  try {
    await page.locator('#input').fill('Still awaiting acknowledgement');
    await page.locator('#form button[type="submit"]').click();
    await posted;
    await page.waitForTimeout(3500);
    assert.equal(await page.locator('.msg[data-id="1"]').count(), 0, 'the in-flight message must not also appear above the unchanged composer');
    assert.equal(await page.locator('#input').evaluate(el => el.value), 'Still awaiting acknowledgement');
    assert.equal(await page.locator('#form button[type="submit"]').evaluate(el => el.classList.contains('busy')), true);
  } finally { release(); }
});

test('a late send response cannot clear an identical draft in another session tab', async t => {
  const { page, store } = await open(t, 390);
  store.sessions.push({ ...session, id: 'second-thread', name: 'Second session' });
  await page.getByRole('tab', { name: 'Second session', exact: true }).waitFor({ timeout: 6000 });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/__uifb/api/chat', async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { messages: store.messages, delivered: {} } });
    const saved = { ...route.request().postDataJSON(), id: 1, at: new Date().toISOString(), queue: { state: 'accepted' } };
    await gate;
    store.messages.push(saved);
    return route.fulfill({ json: saved });
  });
  try {
    await page.locator('#input').fill('Same words in two tabs');
    await page.locator('#form button[type="submit"]').click();
    await page.getByRole('tab', { name: 'Second session', exact: true }).click();
    await page.locator('#input').fill('Same words in two tabs');
    release();
    await page.waitForFunction(() => [...document.querySelectorAll('*')].some(e => e.shadowRoot?.getElementById('form')?.querySelector('button[type="submit"]:not(.busy)')));
    assert.equal(await page.locator('#input').evaluate(el => el.value), 'Same words in two tabs');
  } finally { release(); }
});

test('holding acknowledged text clears input and shows the held note without waiting for a full poll', async t => {
  const { page } = await open(t, 390);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/__uifb/api/drafts', async route => {
    if (route.request().method() === 'POST') return route.fulfill({ json: { ...route.request().postDataJSON(), id: 7, at: new Date().toISOString() } });
    await gate;
    return route.fulfill({ json: { drafts: [], trash: [] } });
  });
  try {
    await page.locator('#input').fill('Synchronized hold');
    await page.locator('#later').click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#input').evaluate(el => el.value), '');
    assert.match(await page.locator('#msgs').textContent(), /Synchronized hold/);
    assert.equal(await page.locator('#later').evaluate(el => el.classList.contains('busy')), false);
  } finally { release(); }
});

test('a rejected unsaved send keeps its text and ends loading without adding a bubble', async t => {
  const { page } = await open(t, 390);
  await page.route('**/__uifb/api/chat', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, json: { error: 'Synthetic unavailable store' } })
    : route.fulfill({ json: { messages: [], delivered: {} } }));
  await page.locator('#input').fill('Retain unsaved text');
  await page.locator('#form button[type="submit"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('*')].some(e => e.shadowRoot?.getElementById('toast')?.textContent.includes('입력칸에 남겨')));
  assert.equal(await page.locator('#input').evaluate(el => el.value), 'Retain unsaved text');
  assert.equal(await page.locator('.msg.user').count(), 0);
  assert.equal(await page.locator('#form button[type="submit"]').evaluate(el => el.classList.contains('busy')), false);
});

test('a side question keeps loading beyond eight seconds until its request actually finishes', async t => {
  const { page } = await open(t, 390);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/__uifb/api/side', async route => {
    await gate;
    return route.fulfill({ json: { ...route.request().postDataJSON(), id: 8, sideGroup: 8, session: session.id, context: 'side', at: new Date().toISOString() } });
  });
  try {
    await page.locator('#input').fill('Slow side request');
    await page.locator('#side').click();
    await page.waitForTimeout(8300);
    assert.equal(await page.locator('#side').evaluate(el => el.classList.contains('busy')), true);
    assert.equal(await page.locator('#input').evaluate(el => el.value), 'Slow side request');
  } finally { release(); }
});

test('failed record deletion hides only that bubble and undo restores it without delivery', async t => {
  const m = entry('failed'), { page, store } = await open(t, 390, [m]);
  const calls = [];
  await page.route('**/__uifb/api/chat-hide-failed', route => { const body = route.request().postDataJSON(); calls.push(body); if (body.hidden) m.hiddenFailure = new Date().toISOString(); else delete m.hiddenFailure; return route.fulfill({ json: { ok: true } }); });
  await page.locator('.msg[data-id="1"]').getByRole('button', { name: '실패 기록 삭제', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('*')].some(e => e.shadowRoot?.getElementById('msgs') && !e.shadowRoot.querySelector('.msg[data-id="1"]')), null, { timeout: 6000 });
  await page.getByRole('button', { name: '되돌리기', exact: true }).click();
  await page.locator('.msg[data-id="1"]').waitFor();
  assert.deepEqual(calls, [{ id: 1, hidden: true }, { id: 1, hidden: false }]);
  assert.equal(store.posts.filter(p => /\/chat$|chat-retry|chat-interject/.test(p.path)).length, 0);
});

test('elapsed activity follows the last main assistant message rather than tool status or side answers', async t => {
  const messages = [{ id: 1, from: 'agent', session: session.id, text: 'Last main update', interim: true, at: new Date(Date.now() - 7 * 60_000).toISOString() }, { id: 2, from: 'agent', session: session.id, context: 'side', text: 'Recent side answer', at: new Date().toISOString() }];
  const { page, store } = await open(t, 390, messages, { ...session, status: { state: 'working', detail: '명령 실행 중', at: new Date().toISOString() } });
  assert.match(await page.locator('.typing').textContent(), /마지막 메시지 후 7분/);
  store.messages.push({ id: 3, from: 'agent', session: session.id, text: 'Fresh main update', interim: true, at: new Date().toISOString() });
  await page.waitForFunction(() => [...document.querySelectorAll('*')].some(e => e.shadowRoot?.querySelector('.msg[data-id="3"]')), null, { timeout: 6000 });
  assert.doesNotMatch(await page.locator('.typing').textContent(), /마지막 메시지 후/);
});

test('elapsed minutes keep advancing while the same tool continually refreshes status', async t => {
  const now = Date.now(), active = { ...session, status: { state: 'working', detail: '명령 실행 중', at: new Date(now).toISOString() } };
  const { page } = await open(t, 390, [{ id: 1, from: 'agent', session: session.id, text: 'Main update', at: new Date(now - 7 * 60_000).toISOString() }], active);
  assert.match(await page.locator('.typing').textContent(), /마지막 메시지 후 7분/);
  active.status.at = new Date(now + 2 * 60_000).toISOString();
  await page.evaluate(future => { Date.now = () => future; }, now + 2 * 60_000);
  await page.waitForFunction(() => [...document.querySelectorAll('*')].some(e => e.shadowRoot?.querySelector('.typing')?.textContent.includes('마지막 메시지 후 9분')), null, { timeout: 6000 });
});

test('before the first answer elapsed time uses the stable native turn start, never file updates', async t => {
  const { page } = await open(t, 390, [], { ...session, status: { state: 'working', detail: '명령 실행 중', startedAt: new Date(Date.now() - 7 * 60_000).toISOString(), at: new Date().toISOString() } });
  assert.match(await page.locator('.typing').textContent(), /작업 시작 후 7분/);
});

// Every request is fulfilled locally. No listening server or session receives a message.
async function open(t, width, messages = [], currentSession = session) {
  const browser = await getBrowser();
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const store = { messages, posts: [], sendFailure: false, sessions: [currentSession] };
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width"><title>Widget fixture</title><body><h1>Test page</h1></body>' });
    const post = req.method() === 'POST' ? req.postDataJSON() : null;
    if (post) store.posts.push({ path: url.pathname, body: post });
    let body = {};
    let status = 200;
    switch (url.pathname) {
      case '/__uifb/api/chat':
        if (post) {
          const saved = { ...post, id: store.messages.length + 1, at: new Date().toISOString(), queue: { state: store.sendFailure ? 'failed' : 'accepted', ...(post.interject ? { mode: 'steer' } : {}) } };
          store.messages.push(saved);
          body = saved;
          if (store.sendFailure) status = 502;
        } else body = { messages: store.messages, delivered: {} };
        break;
      case '/__uifb/api/chat-retry':
        body = store.messages.find((m) => m.id === post.id);
        body.queue = { state: 'accepted' };
        break;
      case '/__uifb/api/sessions': body = { sessions: store.sessions }; break;
      case '/__uifb/api/transcript': body = { items: [] }; break;
      case '/__uifb/api/drafts': body = { drafts: [], trash: [] }; break;
      case '/__uifb/api/pages': body = { pages: [] }; break;
    }
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('http://widget.test.invalid/');
  await page.addScriptTag({ content: source });
  await page.locator('#btn').click();
  await page.locator('#input').waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const root = [...document.querySelectorAll('*')].find((e) => e.shadowRoot?.getElementById('panel'))?.shadowRoot;
    return root && !root.getElementById('input').disabled;
  });
  return { page, store, errors };
}

for (const width of [390, 1440]) {
  test(`failed steering explains its cause and retries as ordinary delivery (${width}px)`, async t => {
    const m = { ...entry('failed'), interject: true, queue: { state: 'failed', mode: 'steer', diagnostic: 'no_active_turn' } };
    const { page } = await open(t, width, [m]);
    const bubble = page.locator('.msg[data-id="1"]');
    const button = bubble.getByRole('button', { name: '일반 전송으로 재시도', exact: true });
    await button.waitFor({ timeout: 3000 });
    assert.match(await bubble.textContent(), /실행 중인 턴이 없음/);
    let body;
    await page.route('**/__uifb/api/chat-interject', route => { body = route.request().postDataJSON(); delete m.interject; m.queue = { state: 'accepted' }; return route.fulfill({ json: { ok: true } }); });
    await button.click(); assert.deepEqual(body, { id: 1, on: false });
    await page.waitForFunction(() => [...document.querySelectorAll('*')].some(e => e.shadowRoot?.querySelector('.msg[data-id="1"]')?.textContent.includes('전달 요청됨')), null, { timeout: 6000 });
  });
  test(`ordinary pending Codex input offers conversion and delivered steering explains recall (${width}px)`, async t => {
    const m = { ...entry('accepted'), queue: { state: 'accepted', receipt: '11111111-1111-4111-8111-111111111111' } };
    const { page } = await open(t, width, [m], { ...session, watch: { ...session.watch, cancel: true, steer: true }, status: { state: 'working' } });
    const bubble = page.locator('.msg[data-id="1"]');
    await bubble.getByRole('button', { name: '끼워넣기', exact: true }).waitFor({ timeout: 3000 });
    m.interject = true; m.queue.mode = 'steer';
    await page.waitForFunction(() => [...document.querySelectorAll('*')].some(e => e.shadowRoot?.querySelector('.msg[data-id="1"] .tag.now')), null, { timeout: 6000 });
    assert.equal(await bubble.getByRole('button', { name: '보내기 취소', exact: true }).isDisabled(), true);
    assert.match(await bubble.textContent(), /실행 중인 턴에 전달됨/);
    m.queue.state = 'failed';
    await page.waitForFunction(() => [...document.querySelectorAll('*')].some(e => [...(e.shadowRoot?.querySelectorAll('.msg[data-id="1"] button') || [])].some(b => b.textContent === '보내기 취소' && !b.disabled)), null, { timeout: 6000 });
    await bubble.getByRole('button', { name: '끼워넣기 취소', exact: true }).waitFor();
    m.queue.state = 'unknown';
    await page.waitForFunction(() => [...document.querySelectorAll('*')].some(e => [...(e.shadowRoot?.querySelectorAll('.msg[data-id="1"] button') || [])].some(b => b.textContent === '보내기 취소' && b.disabled)), null, { timeout: 6000 });
    assert.match(await bubble.getByRole('button', { name: '보내기 취소', exact: true }).getAttribute('title'), /미확인/);
  });
  test(`Codex exposes cancellation and holds only after confirmed deletion (${width}px)`, async t => {
    const m = { ...entry('accepted'), queue: { state: 'accepted', receipt: '11111111-1111-4111-8111-111111111111' } };
    const { page, store } = await open(t, width, [m], { ...session, watch: { ...session.watch, cancel: true } });
    const bubble = page.locator('.msg[data-id="1"]');
    await bubble.getByRole('button', { name: '보류로', exact: true }).waitFor();
    await page.route('**/__uifb/api/chat-cancel', route => route.fulfill({ status: 409, json: { error: 'Already running' } }));
    page.once('dialog', d => d.accept());
    await bubble.getByRole('button', { name: '보류로', exact: true }).click();
    assert.equal(store.posts.filter(p => p.path.endsWith('/drafts')).length, 0);
    assert.equal(store.messages[0].cancelled, undefined);
    await page.route('**/__uifb/api/chat-cancel', route => { store.messages[0].cancelled = new Date().toISOString(); return route.fulfill({ json: { ok: true } }); });
    const held = page.waitForResponse(r => r.url().endsWith('/drafts') && r.request().method() === 'POST');
    await bubble.getByRole('button', { name: '보류로', exact: true }).click();
    await held;
    assert.equal(store.posts.filter(p => p.path.endsWith('/drafts')).length, 1);
  });
  test(`editing an accepted unread send requires duplicate-risk confirmation (${width}px)`, async t => {
    const { page, store } = await open(t, width, [entry('accepted')]);
    const bubble = page.locator('.msg[data-id="1"]');
    await bubble.getByRole('button', { name: '다시 보내기', exact: true }).click();
    await bubble.locator('textarea.edit').fill('Revised request');
    const go = bubble.locator('.editbar').getByRole('button', { name: '다시 보내기', exact: true });
    const dialogs = [];
    page.once('dialog', d => { dialogs.push(d.message()); return d.dismiss(); });
    await go.click();
    assert.equal(dialogs.length, 1, 'warn before creating another message');
    assert.equal(store.posts.filter(p => p.path.endsWith('/chat')).length, 0);
    assert.equal(await bubble.locator('textarea.edit').inputValue(), 'Revised request');
    page.once('dialog', d => d.accept()); await go.click();
    await page.locator('.msg[data-id="2"]').waitFor();
    assert.equal(store.messages.length, 2); assert.equal(store.messages[1].resendOf, 1);
    assert.equal(store.posts.filter(p => p.path.endsWith('/chat')).length, 1);
  });
  test(`Codex shows explicit interjection only while working with steering capability (${width}px)`, async t => {
    const active = { ...session, watch: { ...session.watch, steer: true }, status: { state: 'working' } };
    const { page, store } = await open(t, width, [], active);
    await page.locator('#now').waitFor({ state: 'visible', timeout: 2000 });
    await page.locator('#input').fill('Change direction while working');
    await page.locator('#now').click();
    await page.waitForFunction(() => [...document.querySelectorAll('*')].some(e => e.shadowRoot?.querySelector('.msg[data-id="1"]')));
    assert.equal(store.posts.filter(p => p.path.endsWith('/chat'))[0].body.interject, true);
    assert.match(await page.locator('.msg[data-id="1"]').textContent(), /실행 중인 턴에 전달됨 · 읽음 확인 전/);
    active.status.state = 'idle';
    await page.locator('#now').waitFor({ state: 'hidden', timeout: 6000 });
    await page.locator('#input').fill('Ordinary next task'); await page.locator('#form button[type="submit"]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('*')].some(e => e.shadowRoot?.querySelector('.msg[data-id="2"]')));
    assert.equal(store.posts.filter(p => p.path.endsWith('/chat'))[1].body.interject, undefined);
  });
  test(`uncertain delivery requires explicit duplicate-risk confirmation (${width}px)`, async (t) => {
    const { page, store } = await open(t, width, [entry('unknown')]);
    const retry = page.locator('.msg[data-id="1"]').getByRole('button', { name: '중복 가능성 확인 후 재시도', exact: true });
    await retry.waitFor({ state: 'visible' });
    page.once('dialog', dialog => dialog.dismiss());
    await retry.click();
    assert.equal(store.posts.filter(p => p.path.endsWith('/chat-retry')).length, 0);
    page.once('dialog', dialog => dialog.accept());
    await retry.click();
    await page.waitForFunction(() => {
      const root = [...document.querySelectorAll('*')].find(e => e.shadowRoot?.getElementById('panel')).shadowRoot;
      return root.querySelector('.msg[data-id="1"]')?.textContent.includes('전달 요청됨');
    });
    assert.deepEqual(store.posts.filter(p => p.path.endsWith('/chat-retry')).map(p => p.body), [{ id: 1, confirmUnknown: true }]);
    assert.equal(store.messages.length, 1);
  });
  test(`queue state changes render without new messages; retry keeps the same id (${width}px)`, async (t) => {
    const { page, store, errors } = await open(t, width, [entry('pending')]);
    const bubble = page.locator('.msg[data-id="1"]');
    await page.waitForFunction(() => {
      const root = [...document.querySelectorAll('*')].find((e) => e.shadowRoot?.getElementById('panel')).shadowRoot;
      return root.querySelector('.msg[data-id="1"]')?.textContent.includes('전달 요청 중');
    });
    assert.equal(await bubble.getByRole('button', { name: '다시 보내기', exact: true }).count(), 0);
    store.messages[0].queue.state = 'failed';
    const retry = bubble.getByRole('button', { name: '전달 재시도', exact: true });
    await retry.waitFor({ state: 'visible', timeout: 6000 });
    assert.match(await bubble.textContent(), /전달 실패/);
    assert.equal(await bubble.getByRole('button', { name: '다시 보내기', exact: true }).count(), 0);
    await retry.click();
    await page.waitForFunction(() => {
      const root = [...document.querySelectorAll('*')].find((e) => e.shadowRoot?.getElementById('panel')).shadowRoot;
      return root.querySelector('.msg[data-id="1"]')?.textContent.includes('전달 요청됨');
    });
    assert.match(await bubble.textContent(), /읽음 확인 전/);
    assert.doesNotMatch(await bubble.textContent(), /큐|queue/i);
    assert.doesNotMatch(await bubble.textContent(), / · 읽음(?:$| ·)/);
    assert.equal(store.messages.length, 1);
    assert.deepEqual(store.posts.filter((p) => p.path.endsWith('chat-retry')).map((p) => p.body), [{ id: 1 }]);
    assert.equal(store.posts.filter((p) => p.path.endsWith('/chat')).length, 0);
    assert.equal(await bubble.getByRole('button', { name: '다시 보내기', exact: true }).count(), 1);
    assert.doesNotMatch(await page.locator('#mode').textContent(), /바로 전달됩니다/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const bounds = await bubble.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    assert.deepEqual(errors, []);
  });
}

test('stored queue failure clears the composer and exposes retry; explicit resend remains available after acceptance', async (t) => {
  const { page, store, errors } = await open(t, 390);
  store.sendFailure = true;
  await page.locator('#input').fill('Synthetic failed request');
  await page.locator('#form button[type="submit"]').click();
  const bubble = page.locator('.msg[data-id="1"]');
  await bubble.getByRole('button', { name: '전달 재시도', exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.locator('#input').evaluate(el => el.value), '');
  assert.match(await page.locator('#toast').textContent(), /저장됐지만 전달하지 못했습니다/);
  assert.equal(store.messages.length, 1);
  await bubble.getByRole('button', { name: '전달 재시도', exact: true }).click();
  await bubble.getByRole('button', { name: '다시 보내기', exact: true }).click();
  await bubble.locator('textarea').fill('Synthetic edited resend');
  store.sendFailure = true;
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.editbar').getByRole('button', { name: '다시 보내기', exact: true }).click();
  await page.locator('.msg[data-id="2"]').getByRole('button', { name: '전달 재시도', exact: true }).waitFor({ state: 'visible' });
  assert.equal(store.messages.length, 2);
  assert.equal(store.messages[1].resendOf, 1);
  assert.notEqual(store.messages[1].cid, store.messages[0].cid);
  assert.equal(await page.locator('.msg[data-id="2"] textarea').count(), 0);
  assert.deepEqual(errors, []);
});
