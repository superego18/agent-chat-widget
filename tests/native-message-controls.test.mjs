import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { webkit } from 'playwright-core';
import { B, makeDir, startServer, openWidget, getBrowser, closeBrowser } from './helpers.mjs';
after(closeBrowser);

async function fixture(engine, drafts = []) {
  const root = makeDir({ drafts }), native = path.join(root, 'native.jsonl');
  const record = (id, role, text, second) => JSON.stringify({ timestamp: `2026-10-30T00:00:0${second}Z`, type: 'response_item', payload: { id, type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
  fs.writeFileSync(native, [record('native-user', 'user', 'Native question', 1), record('native-answer', 'assistant', 'Native answer to quote', 2)].join('\n'));
  const file = path.join(root, 'sessions', B + '.json');
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file)), tool: 'codex', path: native }));
  const srv = await startServer(root), browser = engine === 'webkit' ? await webkit.launch({ headless: true }) : await getBrowser();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const opened = await openWidget(srv, { ctx, tab: B });
    return { ...opened, close: async () => { await ctx.close(); if (engine === 'webkit') await browser.close(); srv.stop(); } };
  } catch (error) { await ctx.close(); if (engine === 'webkit') await browser.close(); srv.stop(); throw error; }
}

for (const engine of ['chrome', 'webkit']) {
  const options = { skip: engine === 'webkit' && !fs.existsSync(webkit.executablePath()) };
  test(`native terminal user input shows confirmed pickup (${engine})`, options, async () => {
    const { w, close } = await fixture(engine);
    try {
      const marks = await w.eval(r => ({
        user: r.querySelector('.msg[data-id="xnative-user"] small').textContent,
        answer: r.querySelector('.msg[data-id="xnative-answer"] small').textContent,
        userButtons: [...r.querySelectorAll('.msg[data-id="xnative-user"] button')].map(b => b.textContent)
      }));
      assert.match(marks.user, / · 읽음/);
      assert.doesNotMatch(marks.answer, / · 읽음/);
      assert.ok(!marks.userButtons.some(b => ['보내기 취소', '다시 보내기', '전달 재시도'].includes(b)));
    } finally { await close(); }
  });
  test(`touch swipe opens a side question on a native answer (${engine})`, options, async () => {
    const { w, close } = await fixture(engine);
    try {
      await w.eval(r => {
        const el = r.querySelector('.msg[data-id="xnative-answer"] .mbody'), b = el.getBoundingClientRect();
        const fire = (type, x) => { const e = new Event(type, { bubbles: true, cancelable: true, composed: true }); Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: b.top + 5 }] }); el.dispatchEvent(e); };
        fire('touchstart', b.left + 5); for (const dx of [15, 40, 70, 90]) fire('touchmove', b.left + 5 + dx); fire('touchend', b.left + 95);
      });
      assert.equal(await w.eval(r => r.getElementById('sidebar').hidden), false);
      assert.deepEqual((await w.msgs()).map(m => m.id), ['xnative-answer']);
    } finally { await close(); }
  });
  test(`native user answer links start at the left message edge (${engine})`, options, async () => {
    const { w, close } = await fixture(engine);
    try {
      const actual = await w.eval(r => {
        const box = r.getElementById('msgs'), m = r.querySelector('.msg[data-id="xnative-user"]'), p = r.querySelector('svg.links path');
        return { startX: p ? Number(/^M ([\d.-]+)/.exec(p.getAttribute('d'))?.[1]) : null, expected: m.getBoundingClientRect().left - box.getBoundingClientRect().left + 10 };
      });
      assert.ok(actual.startX !== null && Math.abs(actual.startX - actual.expected) < 2, JSON.stringify(actual));
    } finally { await close(); }
  });
  test(`legacy held-note quote resolves its native original (${engine})`, options, async () => {
    const { w, close } = await fixture(engine, [{ id: 1, to: B, hold: true, text: 'Held question', replyTo: 'xnative-answer', replyQuote: 'answer to quote', at: '2026-10-30T00:00:03Z' }]);
    try {
      const quote = await w.eval(r => r.querySelector('.msg.hold .quote')?.textContent || '');
      assert.ok(quote.includes('answer to quote'), quote);
    } finally { await close(); }
  });
}
