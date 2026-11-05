import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webkit } from 'playwright-core';
import { A, makeDir, startServer, openWidget, closeBrowser } from './helpers.mjs';
after(closeBrowser);
for (const engine of ['chrome', 'webkit']) for (const scenario of ['delete anchor', 'delivery moves anchor', 'send bottom', 'send reading']) {
 test(`${engine} mobile preserves scroll during ${scenario}`, { skip: engine === 'webkit' && !fs.existsSync(webkit.executablePath()) }, async () => {
  const messages = Array.from({ length: 80 }, (_, i) => ({ id: i + 1, from: 'user', to: A, text: `Synthetic message ${i + 1}\nReading line\nAnother line`, at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }));
  messages[39] = { id: 40, from: 'user', to: A, text: 'Synthetic failed message\n'.repeat(6), at: messages[39].at, queue: { state: 'failed', error: 'queue_failed' } };
  const root = makeDir({ messages }), srv = await startServer(root); let ctx, browser;
  try {
   if (engine === 'webkit') { browser = await webkit.launch({ headless: true }); ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); }
   const opened = await openWidget(srv, { ctx }); ctx = opened.ctx; const { w } = opened;
   if (scenario === 'delete anchor' || scenario === 'delivery moves anchor') {
    const before = await w.eval(r => { const b = r.getElementById('msgs'), m = b.querySelector('.msg[data-id="40"]'); b.scrollTop += m.getBoundingClientRect().top - b.getBoundingClientRect().top + 8; return b.querySelector('.msg[data-id="41"]').getBoundingClientRect().top - b.getBoundingClientRect().top; });
    if (scenario === 'delete anchor') { await w.clickText('실패 기록 삭제', '.msg[data-id="40"]'); await w.idle(800); }
    else { fs.writeFileSync(root + '/delivered.json', JSON.stringify({ _at: { 40: new Date().toISOString() } })); await w.click('#reload'); await w.idle(800); }
    const after = await w.eval(r => { const b = r.getElementById('msgs'); return { removed: !b.querySelector('.msg[data-id="40"]'), offset: b.querySelector('.msg[data-id="41"]').getBoundingClientRect().top - b.getBoundingClientRect().top }; });
    assert.equal(after.removed, scenario === 'delete anchor'); assert(Math.abs(after.offset - before) < 4, JSON.stringify({ before, after }));
   } else {
    await w.type('Synthetic send\n'.repeat(12));
    const before = await w.eval((r, scenario) => { const b = r.getElementById('msgs'); if (scenario === 'send bottom') b.scrollTop = b.scrollHeight; else { const m = b.querySelector('.msg[data-id="45"]'); b.scrollTop += m.getBoundingClientRect().top - b.getBoundingClientRect().top + 8; } return { offset: b.querySelector('.msg[data-id="45"]').getBoundingClientRect().top - b.getBoundingClientRect().top }; }, scenario);
    await w.click('#form button[type="submit"]'); await w.idle(900);
    const after = await w.eval(r => { const b = r.getElementById('msgs'); return { gap: b.scrollHeight - b.scrollTop - b.clientHeight, offset: b.querySelector('.msg[data-id="45"]').getBoundingClientRect().top - b.getBoundingClientRect().top }; });
    // Held rows visibly float by up to 3px; reject scroll drift beyond that motion.
    if (scenario === 'send bottom') assert(after.gap < 2, JSON.stringify(after)); else assert(Math.abs(after.offset - before.offset) < 4, JSON.stringify({ before, after }));
   }
  } finally { await ctx?.close(); await browser?.close(); srv.stop(); }
 });
}
