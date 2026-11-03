import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium, webkit } from 'playwright-core';
import { createChatHandler } from '../scripts/chat-handler.mjs';

const endKey = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';

for (const engine of ['chromium', 'webkit']) for (const width of [390, 768, 1440]) {
  test('editing a scrolled saved draft preserves visible native insertion: ' + engine + ' ' + width, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-draft-caret-'));
    const id = 'synthetic-caret';
    fs.mkdirSync(path.join(root, 'sessions'));
    fs.writeFileSync(path.join(root, 'sessions', id + '.json'), JSON.stringify({ sessionId: id, tool: 'claude', name: 'Synthetic caret' }));
    const text = Array.from({ length: 24 }, (_, i) => 'line ' + String(i + 1).padStart(2, '0') + ': abcdefghijklmnop').join('\n');
    fs.writeFileSync(path.join(root, 'drafts.json'), JSON.stringify({ nextId: 2, trash: [], drafts: [{ id: 1, to: id, text, at: new Date().toISOString() }] }));
    const chat = createChatHandler({ root });
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://fixture.invalid');
      if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!doctype html><meta name="viewport" content="width=device-width"><body><script src="/__uifb/widget.js"></script></body>'); return; }
      if (url.pathname.startsWith('/__uifb/api/')) url.pathname = url.pathname.slice('/__uifb'.length);
      if (!chat.handle(req, res, url)) { res.writeHead(404); res.end(); }
    });
    let browser;
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const base = 'http://127.0.0.1:' + server.address().port;
      browser = await (engine === 'chromium' ? chromium.launch({ channel: 'chrome', headless: true }) : webkit.launch({ headless: true }));
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: width < 768 });
      const page = await ctx.newPage(); page.setDefaultTimeout(5000);
      await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
      await page.addInitScript(id => localStorage.setItem('__uifb_tab', id), id);
      await page.goto(base); await page.locator('#btn').click(); await page.locator('#draftsBtn').click();
      const ta = page.locator('.draft textarea');
      await ta.tap({ position: { x: 50, y: 20 } }); await page.waitForTimeout(200);
      await ta.press(endKey); await page.waitForTimeout(80);
      const position = () => ta.evaluate(el => {
        const r = el.getBoundingClientRect(), style = getComputedStyle(el), box = el.closest('.drafts'), bounds = box.getBoundingClientRect();
        const line = el.value.slice(0, el.selectionStart).split('\n').length;
        // WebKit rounds fractional native textarea line boxes; use its full content height for this unwrapped fixture.
        const lineHeight = Math.min(parseFloat(style.lineHeight), (el.scrollHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / el.value.split('\n').length);
        const caretTop = r.top + parseFloat(style.paddingTop) + (line - 1) * lineHeight - el.scrollTop;
        return { line, caretTop, boxTop: bounds.top, boxBottom: bounds.bottom, height: r.height, top: r.top, innerScroll: el.scrollTop, lineHeight: style.lineHeight, scrollTop: box.scrollTop, visible: caretTop >= bounds.top && caretTop + lineHeight <= bounds.bottom + 1 };
      });
      const before = await position();
      assert.equal(before.line, 24); assert.equal(before.visible, true, JSON.stringify(before)); assert.ok(before.scrollTop > 0, 'fixture must exercise a scrolled draft');
      await page.keyboard.insertText('Z');
      assert.equal(await ta.inputValue(), text + 'Z', 'native input preserves exact prefix/suffix');
      const after = await position();
      assert.equal(after.visible, true, JSON.stringify({ before, after }));
      assert.equal(await ta.evaluate(el => el.getRootNode().activeElement === el), true);
      const insertedUnicode = '\uD55C\uAE00\uD83D\uDE42';
      await page.keyboard.insertText(insertedUnicode);
      let expected = text + 'Z' + insertedUnicode;
      assert.equal(await ta.inputValue(), expected, 'Unicode insertion preserves exact native text');
      assert.equal((await position()).visible, true, 'Unicode input preserves the visible editing line');
      await page.keyboard.press('Enter'); expected += '\n';
      await page.waitForTimeout(80);
      assert.equal(await ta.inputValue(), expected, 'native newline preserves exact text');
      assert.equal((await position()).visible, true, 'newline keeps the insertion line visible');
      await page.keyboard.insertText('next'); expected += 'next';
      assert.equal(await ta.inputValue(), expected);
      assert.equal((await position()).visible, true);
      // The public blur-save path persists the actual native edit.
      await page.locator('#dclose').click();
      for (let n = 0; n < 30 && JSON.parse(fs.readFileSync(path.join(root, 'drafts.json'))).drafts[0].text !== expected; n++) await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'drafts.json'))).drafts[0].text, expected);
      await page.locator('#draftsBtn').click();
      await ta.press(selectAllKey); await page.keyboard.insertText('short');
      assert.equal(await ta.inputValue(), 'short');
      assert.ok(await ta.evaluate(el => el.getBoundingClientRect().height <= 50), 'deleting text still shrinks the editor');
      assert.equal(await ta.evaluate(el => el.getRootNode().activeElement === el), true, 'measurement must not steal focus');
      assert.equal(await page.locator('.dmore').isHidden(), true);
      await page.locator('#dclose').click();
      for (let n = 0; n < 30 && JSON.parse(fs.readFileSync(path.join(root, 'drafts.json'))).drafts[0].text !== 'short'; n++) await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'drafts.json'))).drafts[0].text, 'short');
      await page.locator('#draftsBtn').click();
      const wrapped = 'native wrapping text '.repeat(100) + ' END';
      await ta.press(selectAllKey); await page.keyboard.insertText(wrapped);
      await ta.press(endKey);
      await page.locator('#drafts').evaluate(el => { el.scrollTop = el.scrollHeight; });
      const wrappedBefore = await ta.evaluate(el => el.closest('.drafts').scrollTop);
      assert.ok(wrappedBefore > 0, 'wrapped fixture must be scrolled');
      await page.keyboard.insertText('Z');
      assert.equal(await ta.inputValue(), wrapped + 'Z');
      assert.equal(await ta.evaluate(el => el.selectionStart), wrapped.length + 1);
      assert.ok(await ta.evaluate(el => el.closest('.drafts').scrollTop) >= wrappedBefore - 1, 'wrapped input must not reset the reading position');
      const fullHeight = await ta.evaluate(el => el.getBoundingClientRect().height);
      await page.locator('.dmore').click();
      const collapsedHeight = await ta.evaluate(el => el.getBoundingClientRect().height);
      assert.ok(collapsedHeight < fullHeight);
      await page.locator('.dmore').click();
      assert.equal(await ta.inputValue(), wrapped + 'Z');
      assert.ok(await ta.evaluate(el => el.getBoundingClientRect().height) > collapsedHeight);
      assert.equal(await page.locator('.draft textarea').count(), 1, 'hidden measurement fields must be removed');
      await page.locator('#dclose').click();
    } finally {
      await browser?.close();
      await Promise.all([chat.shutdown(), new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))]);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
