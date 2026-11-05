import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createChatHandler } from '../scripts/chat-handler.mjs';
import { getBrowser, closeBrowser } from './helpers.mjs';
after(closeBrowser);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');

for (const width of [390, 1440]) test(`${width}px real image upload, remove, refresh, failed send and retry preserve the exact attachment`, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-image-ui-'));
  const id = '11111111-1111-4111-8111-111111111111';
  fs.mkdirSync(path.join(dir, 'sessions'));
  fs.writeFileSync(path.join(dir, 'sessions', id + '.json'), JSON.stringify({ sessionId: id, tool: 'claude', name: 'Synthetic' }));
  fs.writeFileSync(path.join(dir, 'sessions', 'other.json'), JSON.stringify({ sessionId: 'other', tool: 'claude', name: 'Other' }));
  const handler = createChatHandler({ root: dir });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width"><body><script src="/__uifb/widget.js"></script></body>'); return; }
    if (url.pathname.startsWith('/__uifb/api/')) url.pathname = url.pathname.slice('/__uifb'.length);
    if (!handler.handle(req, res, url)) { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const context = await (await getBrowser()).newContext({ viewport: { width, height: 844 } });
  t.after(async () => { await context.close(); await handler.shutdown(); await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(id => { localStorage.setItem('__uifb_tab', id); localStorage.setItem('__uifb_open:app', '1'); }, id);
  await page.goto(base);
  await page.getByRole('button', { name: '사진 첨부', exact: true }).waitFor();
  const pick = async () => {
    await page.locator('#image-file').setInputFiles({ name: '스크린샷.png', mimeType: 'image/png', buffer: png });
    await page.getByRole('dialog', { name: '사진 화질 선택' }).waitFor();
    await page.getByRole('button', { name: '선택한 화질로 첨부', exact: true }).click();
  };
  await pick(); await page.locator('#image-preview img').waitFor();
  await page.getByRole('button', { name: '사진 첨부 취소: 스크린샷.png' }).click();
  assert.equal(await page.locator('#image-preview img').count(), 0);
  assert.equal(await page.locator('#attach').evaluate(e => e.getRootNode().activeElement === e), true);
  await pick(); await page.locator('#image-preview img').waitFor();
  await page.getByRole('tab', { name: 'Other', exact: true }).click();
  assert.equal(await page.locator('#image-preview img').count(), 0, 'another session never inherits staged images');
  await page.getByRole('tab', { name: 'Synthetic', exact: true }).click();
  assert.equal(await page.locator('#image-preview img').count(), 1);
  await page.reload(); await page.locator('#image-preview img').waitFor();
  if (process.env.UIFB_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.UIFB_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.UIFB_SCREENSHOT_DIR, width + '-preview.png') });
  }
  await page.locator('#input').fill('사진 확인');
  const deny = r => r.request().method() === 'POST' ? r.abort() : r.continue();
  await page.route('**/__uifb/api/chat', deny);
  await page.locator('#form button[type=submit]').click();
  await page.locator('.toast').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#image-preview img').count(), 1);
  assert.equal(await page.locator('#input').evaluate(e => e.value), '사진 확인');
  await page.unroute('**/__uifb/api/chat', deny);
  await page.locator('#form button[type=submit]').click();
  await page.locator('.msg.user .chat-image').waitFor();
  assert.equal(await page.locator('#image-preview img').count(), 0);
  assert.ok(await page.locator('.chat-image').evaluate(e => e.complete && e.naturalWidth === 1));
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'chat.json'))).messages;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].attachments.length, 1);
  assert.deepEqual(fs.readFileSync(stored[0].attachments[0].localPath), png);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
});
