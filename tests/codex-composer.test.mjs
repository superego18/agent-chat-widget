import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { B, makeDir, startServer, openWidget, getBrowser, closeBrowser } from './helpers.mjs';

after(closeBrowser);
for (const width of [390, 1440]) {
  test(`Codex composer uses compact reply/reference chips without losing native IDs (${width}px)`, async () => {
    const root = makeDir({ messages: [{ id: 1, from: 'agent', session: B, text: 'Reply source', at: new Date().toISOString() }] }), native = path.join(root, 'rollout.jsonl');
    const ids = ['msg_' + 'a'.repeat(48), 'msg_' + 'b'.repeat(48)];
    fs.writeFileSync(native, ids.map((id, i) => JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'message', id, role: 'assistant', content: [{ type: 'output_text', text: i ? 'Reference source' : 'Reply source' }] } })).join('\n'));
    const sf = path.join(root, 'sessions', B + '.json');
    fs.writeFileSync(sf, JSON.stringify({ ...JSON.parse(fs.readFileSync(sf)), tool: 'codex', path: native }));
    const srv = await startServer(root);
    const ctx = await (await getBrowser()).newContext({ viewport: { width, height: 844 }, hasTouch: width === 390, isMobile: width === 390 });
    try {
      const { page, w } = await openWidget(srv, { ctx, tab: B });
      await w.clickText('답장', `.msg[data-id="x${ids[0]}"]`);
      await w.clickText('참고', `.msg[data-id="x${ids[1]}"]`);
      await w.type((await w.inputValue()) + 'Check this');
      const chips = await w.eval(r => [...r.querySelectorAll('#inback mark')].map(el => ({ text: el.textContent, width: el.getBoundingClientRect().width, max: r.getElementById('input').clientWidth, kind: el.classList.contains('f') ? 'f' : 'r' })));
      assert.deepEqual(chips.map(x => x.kind), ['r', 'f']);
      for (const chip of chips) {
        assert.ok(chip.width <= chip.max, 'each chip fits the composer');
        assert.ok(!chip.text.includes('msg_'), 'long native IDs are not shown');
      }
      const innerPadding = await w.eval(r => [...r.querySelectorAll('#inback mark')].map(mark => {
        const painted = mark.querySelector('span') || mark;
        const range = document.createRange();
        range.selectNodeContents(painted);
        return painted.getBoundingClientRect().width - range.getBoundingClientRect().width;
      }));
      for (const padding of innerPadding) assert.ok(Math.abs(padding) < 1, 'the chip background fits the rendered text');
      const outerGaps = await w.eval(r => [...r.querySelectorAll('#inback mark')].map(mark => mark.getBoundingClientRect().width - mark.querySelector('span').getBoundingClientRect().width));
      for (const gap of outerGaps) assert.ok(Math.abs(gap) < 1, 'no reserved blank space remains outside the chip');
      assert.equal(await w.eval(r => getComputedStyle(r.querySelector('#inback mark')).backgroundColor), 'rgba(0, 0, 0, 0)', 'no browser-default mark background remains outside the chip');
      const value = await w.inputValue();
      await w.clickText('답장', '.msg[data-id="1"]');
      const padding = await w.eval(r => {
        const marks = [...r.querySelectorAll('#inback mark')];
        const painted = mark => (mark.querySelector('span') || mark).getBoundingClientRect().width;
        return { native: painted(marks[0]), claude: painted(marks.at(-1)), nativeSlot: marks[0].getBoundingClientRect().width, claudeSlot: marks.at(-1).getBoundingClientRect().width };
      });
      assert.ok(Math.abs(padding.native - padding.claude) < 1, 'the same visible label has the same painted chip width as Claude');
      assert.ok(Math.abs(padding.nativeSlot - padding.claudeSlot) < 1, 'the chip occupies the same actual text width as Claude, with no hidden spacer');
      await w.click('#reply .rref:last-child button:last-child');
      await w.type(value);
      await w.idle(600);
      await page.addInitScript(id => {
        const st = JSON.parse(localStorage.getItem('__uifb_reply'));
        st.refs.find(ref => ref.id === id).quote = 'Reply';
        localStorage.setItem('__uifb_reply', JSON.stringify(st));
      }, 'x' + ids[0]);
      await page.reload();
      await w.idle(1200);
      assert.equal(await w.inputValue(), value, 'refresh preserves compact chips');
      assert.equal(await w.eval(r => r.querySelectorAll('#inback mark').length), 2);
      assert.equal(await w.eval(r => [...r.querySelectorAll('#reply .rref .go')].every(b => !b.hidden)), true, 'both native originals remain reachable');
      const fresh = await (await getBrowser()).newContext({ viewport: { width, height: 844 } });
      try {
        const other = await openWidget(srv, { ctx: fresh, tab: B });
        assert.equal(await other.w.inputValue(), value, 'another device restores the same compact references without local storage');
        assert.equal(await other.w.eval(r => [...r.querySelectorAll('#reply .rref .go')].every(b => !b.hidden)), true);
      } finally { await fresh.close(); }
      let posted;
      await page.route('**/__uifb/api/chat', route => {
        if (route.request().method() !== 'POST') return route.continue();
        posted = route.request().postDataJSON();
        return route.fulfill({ json: { id: 1, ...posted } });
      });
      await w.click('#form button[type="submit"]');
      for (let i = 0; i < 40 && !posted; i++) await new Promise(resolve => setTimeout(resolve, 50));
      assert.deepEqual(posted?.quotes, [{ id: 'x' + ids[0], quote: 'Reply' }, { id: 'x' + ids[1], refer: true }]);
      assert.ok(posted.text.includes(`[↩#x${ids[0]}]`));
      assert.ok(posted.text.includes(`[📎#x${ids[1]}]`));
    } finally { await ctx.close(); srv.stop(); }
  });
}
