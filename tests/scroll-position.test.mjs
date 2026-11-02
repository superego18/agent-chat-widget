import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webkit } from 'playwright-core';
import { A, makeDir, startServer, openWidget, closeBrowser } from './helpers.mjs';
after(closeBrowser);

for (const engine of ['chrome', 'webkit']) for (const scenario of ['quick close', 'older history', 'reload', 'reload older history', 'new reply while closed']) {
  test(`mobile reading position survives ${scenario} (${engine})`, { skip: engine === 'webkit' && !fs.existsSync(webkit.executablePath()) }, async () => {
    const messages = Array.from({ length: 260 }, (_, i) => ({ id: i + 1, from: 'user', to: A, text: `Message ${i + 1}\nReading position fixture`, at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }));
    const srv = await startServer(makeDir({ messages, delivered: { _at: Object.fromEntries(messages.map(m => [m.id, m.at])) } }));
    let ctx, browser;
    try {
      if (engine === 'webkit') { browser = await webkit.launch({ headless: true }); ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true }); }
      const opened = await openWidget(srv, { ctx }); ctx = opened.ctx;
      const { w, page } = opened;
      if (scenario.includes('older history')) await w.click('#more');
      await w.idle(400);
      const before = await w.eval(r => {
        const b = r.getElementById('msgs'), m = b.querySelectorAll('.msg[data-id]')[8];
        b.scrollTop += m.getBoundingClientRect().top - b.getBoundingClientRect().top + 17;
        b.dispatchEvent(new Event('scroll'));
        return { id: m.dataset.id, offset: m.getBoundingClientRect().top - b.getBoundingClientRect().top };
      });
      if (scenario.startsWith('reload')) { await page.reload(); await w.idle(1500); }
      else {
        await w.click('#close');
        if (scenario === 'new reply while closed') {
          await srv.api('/api/chat', { from: 'agent', session: A, text: 'New reply while away' });
          await w.idle(3500);
        }
        await w.click('#btn'); await w.idle(1000);
      }
      const after = await w.eval((r, id) => {
        const b = r.getElementById('msgs'), m = b.querySelector(`.msg[data-id="${id}"]`);
        return { exists: !!m, offset: m ? m.getBoundingClientRect().top - b.getBoundingClientRect().top : null, bottomGap: b.scrollHeight - b.scrollTop - b.clientHeight };
      }, before.id);
      assert.ok(after.exists && Math.abs(after.offset - before.offset) < 2, JSON.stringify({ before, after }));
    } finally { await ctx?.close(); await browser?.close(); srv.stop(); }
  });
}
