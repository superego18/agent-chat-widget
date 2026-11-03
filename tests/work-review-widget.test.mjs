import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { chromium, webkit } from 'playwright-core';
import { createChatHandler } from '../scripts/chat-handler.mjs';

for (const [engine, width, theme] of [['chromium', 390, 'light'], ['chromium', 390, 'dark'], ['chromium', 1440, 'light'], ['chromium', 1440, 'dark'], ['webkit', 390, 'light']]) {
  test(`persistent work review supports owner replies without claiming completion: ${engine} ${width} ${theme}`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-work-ui-'));
    fs.mkdirSync(path.join(root, 'sessions'));
    const actor = 'synthetic-work', at = new Date().toISOString();
    fs.writeFileSync(path.join(root, 'sessions', actor + '.json'), JSON.stringify({ sessionId: actor, tool: 'claude', name: '시험 세션' }));
    fs.writeFileSync(path.join(root, 'drafts.json'), JSON.stringify({ nextId: 5, trash: [], drafts: [
      { id: 1, to: actor, text: '일반 보관 글', at },
      { id: 2, to: actor, text: '확인 요청을 대화 밖에 모아 주세요', at, work: { actor, state: 'review', revision: 2, note: '진행·확인에서 요청과 답을 확인해 주세요.', startedAt: at, updatedAt: at } },
      { id: 3, to: actor, text: '보관함의 저장 완료 전 전송을 막아 주세요', at, work: { actor, state: 'working', revision: 1, startedAt: at, updatedAt: at } },
      { id: 4, to: actor, text: '이미 마무리한 시험 항목', at, work: { actor, state: 'done', revision: 4, startedAt: at, updatedAt: at } }
    ] }));
    const handler = createChatHandler({ root });
    let before = false, beforeAsset;
    if (process.env.UIFB_WORK_BEFORE_REF) beforeAsset = execFileSync('git', ['show', process.env.UIFB_WORK_BEFORE_REF + ':assets/app-widget.js']);
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://fixture.invalid');
      if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!doctype html><meta name="viewport" content="width=device-width"><body><script src="/__uifb/widget.js"></script></body>'); return; }
      if (before && url.pathname === '/__uifb/widget.js') { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); res.end(beforeAsset); return; }
      if (url.pathname.startsWith('/__uifb/api/')) url.pathname = url.pathname.slice('/__uifb'.length);
      if (!handler.handle(req, res, url)) { res.writeHead(404); res.end(); }
    });
    let browser;
    try {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const base = 'http://127.0.0.1:' + server.address().port;
      browser = await (engine === 'webkit' ? webkit.launch({ headless: true }) : chromium.launch({ channel: 'chrome', headless: true }));
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' });
      const page = await ctx.newPage(); page.setDefaultTimeout(8000);
      const openPanel = async () => {
        await page.locator('#panel').waitFor({ state: 'attached' });
        if (await page.locator('#panel').isHidden()) await page.locator('#btn').click();
      };
      await page.addInitScript(actor => localStorage.setItem('__uifb_tab', actor), actor);
      await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
      const capture = async prefix => {
        if (!process.env.UIFB_WORK_CAPTURE_DIR) return;
        fs.mkdirSync(process.env.UIFB_WORK_CAPTURE_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.UIFB_WORK_CAPTURE_DIR, `${prefix}-${engine}-${width}-${theme}.png`) });
      };
      if (beforeAsset) { before = true; await page.goto(base); await openPanel(); await capture('before'); before = false; }
      await page.goto(base); await openPanel();
      await page.locator('#workBtn').filter({ hasText: '1' }).waitFor();
      await page.locator('#workBtn').click();
      assert.equal(await page.locator('#wsheet').isVisible(), true);
      assert.equal(await page.locator('#wlist [data-work-id]').count(), 3);
      assert.equal(await page.locator('#wlist [data-work-id="2"]').getByRole('button', { name: '확인했어요', exact: true }).isVisible(), true);
      await capture('after');
      const geometry = await page.locator('#wsheet').evaluate(el => ({ overflow: el.scrollWidth > el.clientWidth + 1, right: el.getBoundingClientRect().right, viewport: innerWidth }));
      assert.equal(geometry.overflow, false); assert.ok(geometry.right <= geometry.viewport + 1);
      await page.getByRole('textbox', { name: '요청 2 확인 의견' }).fill('놓치지 않도록 의견을 보관해 주세요');
      await page.reload(); await openPanel(); await page.locator('#workBtn').filter({ hasText: '1' }).waitFor(); await page.locator('#workBtn').click();
      assert.equal(await page.getByRole('textbox', { name: '요청 2 확인 의견' }).inputValue(), '놓치지 않도록 의견을 보관해 주세요');
      // The server stores the real reply, but its HTTP acknowledgement is lost.
      let dropped = false;
      await page.route('**/__uifb/api/drafts', async route => {
        let body; try { body = route.request().postDataJSON(); } catch {}
        if (!dropped && body?.action === 'work-answer') { dropped = true; await route.fetch(); await route.abort(); }
        else await route.continue();
      });
      await page.locator('[data-work-id="2"]').getByRole('button', { name: '확인했어요', exact: true }).click();
      await page.locator('[data-work-id="2"]').getByText('확인됨 · 담당 세션의 마무리 대기', { exact: false }).waitFor();
      const store = JSON.parse(fs.readFileSync(path.join(root, 'drafts.json')));
      assert.equal(store.drafts.find(d => d.id === 2).work.state, 'review');
      assert.equal(store.drafts.find(d => d.id === 2).work.answer.decision, 'approved');
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'chat.json'))).messages.length, 1);
      await page.locator('#wclose').focus(); await page.keyboard.press('Escape');
      assert.equal(await page.locator('#wsheet').isHidden(), true);
      assert.equal(await page.locator('#workBtn').evaluate(el => el.getRootNode().activeElement === el), true);
      await page.locator('#draftsBtn').click();
      assert.equal(await page.locator('#drafts .draft').count(), 1, 'work is not also pending for send');
    } finally {
      await browser?.close(); await handler.shutdown();
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
