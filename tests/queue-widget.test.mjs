import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getBrowser, closeBrowser } from './helpers.mjs';

after(closeBrowser);

const source = fs.readFileSync(new URL('../assets/app-widget.js', import.meta.url), 'utf8');
const session = { id: 'test-thread', name: 'Test session', tool: 'codex', watch: { active: false, via: 'queue' }, status: { state: 'unknown' } };
const entry = (state) => ({ id: 1, from: 'user', to: session.id, text: 'Synthetic request', cid: 'test-message', context: 'app', at: new Date().toISOString(), queue: { state } });

// Every request is fulfilled locally. No listening server or session receives a message.
async function open(t, width, messages = []) {
  const browser = await getBrowser();
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const store = { messages, posts: [], sendFailure: false };
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
          const saved = { ...post, id: store.messages.length + 1, at: new Date().toISOString(), queue: { state: store.sendFailure ? 'failed' : 'accepted' } };
          store.messages.push(saved);
          body = saved;
          if (store.sendFailure) status = 502;
        } else body = { messages: store.messages, delivered: {} };
        break;
      case '/__uifb/api/chat-retry':
        body = store.messages.find((m) => m.id === post.id);
        body.queue = { state: 'accepted' };
        break;
      case '/__uifb/api/sessions': body = { sessions: [session] }; break;
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
      return root.querySelector('.msg[data-id="1"]')?.textContent.includes('큐 접수됨');
    });
    assert.deepEqual(store.posts.filter(p => p.path.endsWith('/chat-retry')).map(p => p.body), [{ id: 1, confirmUnknown: true }]);
    assert.equal(store.messages.length, 1);
  });
  test(`queue state changes render without new messages; retry keeps the same id (${width}px)`, async (t) => {
    const { page, store, errors } = await open(t, width, [entry('pending')]);
    const bubble = page.locator('.msg[data-id="1"]');
    await page.waitForFunction(() => {
      const root = [...document.querySelectorAll('*')].find((e) => e.shadowRoot?.getElementById('panel')).shadowRoot;
      return root.querySelector('.msg[data-id="1"]')?.textContent.includes('큐 접수 확인 중');
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
      return root.querySelector('.msg[data-id="1"]')?.textContent.includes('큐 접수됨');
    });
    assert.match(await bubble.textContent(), /읽음 확인 전/);
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
  assert.equal(await page.locator('#input').inputValue(), '');
  assert.match(await page.locator('#toast').textContent(), /저장됐지만 전달하지 못했습니다/);
  assert.equal(store.messages.length, 1);
  await bubble.getByRole('button', { name: '전달 재시도', exact: true }).click();
  await bubble.getByRole('button', { name: '다시 보내기', exact: true }).click();
  await bubble.locator('textarea').fill('Synthetic edited resend');
  store.sendFailure = true;
  await page.locator('.editbar').getByRole('button', { name: '다시 보내기', exact: true }).click();
  await page.locator('.msg[data-id="2"]').getByRole('button', { name: '전달 재시도', exact: true }).waitFor({ state: 'visible' });
  assert.equal(store.messages.length, 2);
  assert.equal(store.messages[1].resendOf, 1);
  assert.notEqual(store.messages[1].cid, store.messages[0].cid);
  assert.equal(await page.locator('.msg[data-id="2"] textarea').count(), 0);
  assert.deepEqual(errors, []);
});
