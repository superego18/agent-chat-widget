import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { chromium, webkit } from 'playwright-core';
import { createChatHandler } from '../scripts/chat-handler.mjs';

for (const [engine, width, theme] of [['chromium', 375, 'light'], ['chromium', 390, 'light'], ['chromium', 390, 'dark'], ['chromium', 768, 'light'], ['chromium', 1024, 'light'], ['chromium', 1440, 'light'], ['chromium', 1440, 'dark'], ['webkit', 390, 'light']]) {
  test(`persistent work review supports owner replies without claiming completion: ${engine} ${width} ${theme}`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-work-ui-'));
    fs.mkdirSync(path.join(root, 'sessions'));
    const actor = 'synthetic-work', at = new Date().toISOString();
    fs.writeFileSync(path.join(root, 'sessions', actor + '.json'), JSON.stringify({ sessionId: actor, tool: 'claude', name: '시험 세션' }));
    fs.writeFileSync(path.join(root, 'drafts.json'), JSON.stringify({ nextId: 5, trash: [], drafts: [
      { id: 1, to: actor, text: '일반 보관 글', at },
      { id: 2, to: actor, text: '확인 요청을 대화 밖에 모아 주세요. 대화에 섞인 확인 요청은 놓치기 쉽습니다. 요청 목록을 먼저 보고, 필요한 글을 펼치고 접을 수 있으면 좋겠습니다. 작성하던 의견은 요청을 바꾸거나 창을 닫아도 남아 있어야 합니다.', at, work: { actor, state: 'review', revision: 2, note: '목록에서 요청을 고른 뒤 필요한 내용만 펼쳐 볼 수 있도록 바꿨습니다.\n\n요청을 찾고 의견을 남기는 흐름이 편한지 확인해 주세요.', startedAt: at, updatedAt: at } },
      { id: 3, to: actor, text: '보관함의 저장 완료 전 전송을 막아 주세요', at, work: { actor, state: 'working', revision: 1, note: '긴 작업 설명도 접어서 목록으로 돌아갈 수 있어야 합니다. '.repeat(45), startedAt: at, updatedAt: at } },
      { id: 4, to: actor, text: '이미 마무리한 시험 항목', at, work: { actor, state: 'done', revision: 4, startedAt: at, updatedAt: at } }
    ] }));
    const handler = createChatHandler({ root });
    let before = false, beforeAsset;
    if (process.env.UIFB_WORK_BEFORE_REF) beforeAsset = execFileSync('git', ['show', process.env.UIFB_WORK_BEFORE_REF + ':assets/app-widget.js']);
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://fixture.invalid');
      if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!doctype html><meta name="viewport" content="width=device-width"><body><main style="height:1800px">Synthetic outer page</main><script src="/__uifb/widget.js"></script></body>'); return; }
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
        await page.locator('#panel').waitFor({ state: 'visible' });
      };
      await page.addInitScript(actor => { localStorage.setItem('__uifb_tab', actor); localStorage.setItem('__uifb_open:app', '1'); }, actor);
      await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
      const capture = async prefix => {
        if (!process.env.UIFB_WORK_CAPTURE_DIR) return;
        fs.mkdirSync(process.env.UIFB_WORK_CAPTURE_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.UIFB_WORK_CAPTURE_DIR, `${prefix}-${engine}-${width}-${theme}.png`) });
      };
      if (beforeAsset) { before = true; await page.goto(base); await openPanel(); await capture('before'); before = false; }
      await page.goto(base); await openPanel();
      await page.locator('#workBtn').filter({ hasText: '1' }).waitFor();
      const composer = page.getByRole('textbox', { name: '메시지', exact: true });
      const unsent = 'Synthetic unsent conversation draft';
      await composer.click();
      await page.keyboard.type(unsent);
      assert.equal(await composer.evaluate(el => el.textContent), unsent, 'real keyboard input establishes the unsent fixture before navigation');
      await page.evaluate(() => window.scrollTo(0, 120));
      await page.locator('#workBtn').click();
      assert.equal(await page.locator('#wsheet').isVisible(), true);
      assert.equal(await page.locator('#wlist [data-work-open]').count(), 3);
      assert.equal(await page.locator('#wlist [data-work-id]').count(), 0, 'opening starts with the whole compact list, not long bodies');
      assert.deepEqual(await page.locator('#wlist [data-work-open]').evaluateAll(rows => rows.map(row => row.dataset.workOpen)), ['2', '3', '4']);
      const list = page.locator('#wlist'), sheet = page.locator('#wsheet');
      const surrounding = async () => ({
        page: await page.evaluate(() => ({ x: scrollX, y: scrollY, scrollable: document.documentElement.scrollHeight > innerHeight })),
        header: await page.locator('#panel header').boundingBox(),
        compose: await page.locator('#composeRow').boundingBox(),
        input: await composer.evaluate(el => el.textContent),
      });
      const preserved = await surrounding();
      assert.equal(preserved.input, unsent);
      assert.equal(preserved.page.scrollable, true, 'the outer page can expose accidental scroll chaining');
      if (width >= 768) assert.equal(preserved.page.y, 120, 'desktop preservation uses a nonzero page position');
      const sheetBounds = await sheet.boundingBox();
      assert.ok(sheetBounds.y >= preserved.header.y + preserved.header.height - 1 && sheetBounds.y + sheetBounds.height <= preserved.compose.y + 1, 'the sheet preserves the header and composer boundary');
      const visibleRow = async id => {
        const row = page.locator(`[data-work-open="${id}"]`);
        const [r, l, s] = await Promise.all([row.boundingBox(), list.boundingBox(), sheet.boundingBox()]);
        assert.ok(r && r.x >= l.x && r.x + r.width <= l.x + l.width && r.y >= l.y && r.y + r.height <= l.y + l.height && r.x >= s.x && r.x + r.width <= s.x + s.width && r.y >= s.y && r.y + r.height <= s.y + s.height, JSON.stringify({ id, row: r, list: l, sheet: s }));
        await row.click({ trial: true });
        assert.deepEqual(await surrounding(), preserved, 'list navigation preserves page, composer and header');
      };
      await visibleRow('2');
      assert.ok((await page.locator('[data-work-open="2"]').boundingBox()).height < 120, 'long request titles are compact');
      await page.locator('#wclose').focus(); await page.keyboard.press('Tab');
      assert.equal(await page.locator('[data-work-open="2"]').evaluate(el => el.getRootNode().activeElement === el), true, 'the first compact request is keyboard reachable');
      const otherRow = await page.locator('[data-work-open="3"]').boundingBox(), listBounds = await list.boundingBox();
      if (otherRow.y + otherRow.height > listBounds.y + listBounds.height) {
        const scroll = await list.evaluate(el => ({ top: el.scrollTop, overflow: getComputedStyle(el).overflowY, extent: el.scrollHeight - el.clientHeight }));
        assert.ok(['auto', 'scroll'].includes(scroll.overflow) && scroll.extent > 0, 'overflow is constrained by the real internal list');
        await list.hover();
        await page.mouse.wheel(0, Math.ceil(otherRow.y + otherRow.height - listBounds.y - listBounds.height + 1));
        await page.waitForFunction(top => [...document.querySelectorAll('*')].some(el => el.shadowRoot?.getElementById('wlist')?.scrollTop > top), scroll.top);
        await visibleRow('3');
      }
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('[data-work-open="3"]').evaluate(el => el.getRootNode().activeElement === el), true, 'Tab reaches the next request');
      await visibleRow('3');
      await page.locator('[data-work-open="3"]').click();
      assert.equal(await page.locator('[data-work-id="3"]').isVisible(), true, 'the reached request actually opens');
      await page.getByRole('button', { name: '← 전체 요청', exact: true }).click();
      assert.equal(await page.locator('[data-work-open="3"]').evaluate(el => el.getRootNode().activeElement === el), true);
      await page.keyboard.press('Tab');
      const completed = page.locator('#wlist .workgroup > summary');
      assert.equal(await completed.evaluate(el => el.getRootNode().activeElement === el), true, 'keyboard navigation reaches the folded completed group');
      await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
      assert.equal(await page.locator('[data-work-open="4"]').evaluate(el => el.getRootNode().activeElement === el), true);
      await visibleRow('4');
      await page.locator('[data-work-open="4"]').click();
      assert.equal(await page.locator('[data-work-id="4"]').isVisible(), true, 'completed entries are reachable too');
      await page.keyboard.press('Escape');
      assert.equal(await sheet.isHidden(), true);
      await page.locator('#workBtn').click();
      assert.equal(await page.locator('#wlist [data-work-id]').count(), 0);
      assert.deepEqual(await surrounding(), preserved);
      await capture('list');
      await page.locator('[data-work-open="2"]').click();
      const review = page.locator('[data-work-id="2"]');
      assert.equal(await review.getByRole('button', { name: '확인했어요', exact: true }).isVisible(), true);
      assert.equal(await review.getByText('보관한 요청', {exact:true}).count(), 0, 'the original request is not repeated in another section');
      assert.equal(await review.locator('p').filter({hasText:'확인 요청을 대화 밖에 모아 주세요'}).count(), 1, 'one original text node in the detail');
      const shortHeight = await review.locator('.workrequest-text').evaluate(el => el.clientHeight);
      await review.getByRole('button', {name:'더 보기',exact:true}).click();
      assert.ok(await review.locator('.workrequest-text').evaluate(el => el.clientHeight) > shortHeight);
      await review.getByRole('button', {name:'접기',exact:true}).click();
      assert.equal(await review.locator('.workrequest-text').evaluate(el => el.clientHeight), shortHeight);
      assert.equal(await review.locator('.worksection').first().locator('p').count(), 2);
      await capture('detail-open');
      const beforeFoldHeight = (await page.locator('#wsheet').boundingBox()).height;
      await review.locator('summary').filter({hasText:'확인할 내용'}).click();
      assert.equal(await review.locator('.worksection').first().evaluate(el => el.open), false, 'long review notes can be folded');
      assert.equal((await page.locator('#wsheet').boundingBox()).height, beforeFoldHeight, 'folding text does not make the whole pane jump');
      await capture('detail-folded');
      const geometry = await page.locator('#wsheet').evaluate(el => ({ overflow: el.scrollWidth > el.clientWidth + 1, right: el.getBoundingClientRect().right, viewport: innerWidth }));
      assert.equal(geometry.overflow, false); assert.ok(geometry.right <= geometry.viewport + 1);
      await page.getByRole('textbox', { name: '요청 2 확인 의견' }).fill('놓치지 않도록 의견을 보관해 주세요');
      if (width < 520) {
        await page.setViewportSize({width, height:600});
        await page.waitForFunction(() => {
          const r = [...document.querySelectorAll('*')].find(el => el.shadowRoot?.getElementById('panel'))?.shadowRoot;
          if (!r) return false;
          const sheet = r.getElementById('wsheet').getBoundingClientRect();
          return sheet.top >= r.querySelector('header').getBoundingClientRect().bottom - 1 && sheet.bottom <= r.getElementById('composeRow').getBoundingClientRect().top + 1;
        });
        assert.equal(await page.getByRole('textbox', {name:'요청 2 확인 의견'}).inputValue(), '놓치지 않도록 의견을 보관해 주세요');
        await page.setViewportSize({width, height:900});
      }
      await page.getByRole('button', {name:'← 전체 요청',exact:true}).click();
      assert.equal(await page.locator('[data-work-open="2"]').evaluate(el => el.getRootNode().activeElement === el), true, 'back returns keyboard focus to the selected row');
      await page.locator('[data-work-open="3"]').click();
      assert.equal(await page.locator('[data-work-id="3"]').isVisible(), true);
      await page.locator('[data-work-id="3"] summary').click();
      assert.equal(await page.locator('[data-work-id="3"] details').evaluate(el => el.open), false, 'very long work notes remain foldable');
      await page.getByRole('button', {name:'← 전체 요청',exact:true}).click();
      await page.locator('[data-work-open="2"]').click();
      assert.equal(await page.getByRole('textbox', {name:'요청 2 확인 의견'}).inputValue(), '놓치지 않도록 의견을 보관해 주세요', 'switching requests preserves unsent comments');
      assert.equal(await review.locator('.worksection').first().evaluate(el => el.open), false, 'fold choice survives navigation');
      await page.reload(); await openPanel(); await page.locator('#workBtn').filter({ hasText: '1' }).waitFor(); await page.locator('#workBtn').click();
      assert.equal(await page.locator('#wlist [data-work-id]').count(), 0, 'reopening shows the list first');
      await page.locator('[data-work-open="2"]').click();
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
