import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { A, B, makeDir, startServer, openWidget, getBrowser, closeBrowser } from './helpers.mjs';
import { replaceSessionState } from '../scripts/session-state.mjs';

after(closeBrowser);
for (const width of [390, 1440]) {
  test(`history and held drafts remain in the same role after replacement (${width}px)`, async () => {
    const root = makeDir({ messages: [{ id: 1, from: 'user', to: A, text: 'Before migration', at: '2026-01-01T00:00:00Z' }, { id: 2, from: 'agent', session: A, text: 'Previous answer', at: '2026-01-01T00:00:01Z', re: [1] }], delivered: { _at: { 1: '2026-01-01T00:00:00Z' } }, drafts: [{ id: 1, to: A, text: 'Held draft', hold: true }] });
    replaceSessionState(root, [{ from: A, to: B }]);
    const native = path.join(root, 'deleted-rollout.jsonl');
    const sessionFile = path.join(root, 'sessions', `${B}.json`);
    const session = JSON.parse(fs.readFileSync(sessionFile));
    fs.writeFileSync(sessionFile, JSON.stringify({ ...session, tool: 'claude', path: native }));
    fs.mkdirSync(path.join(root, 'transcript-history'));
    fs.writeFileSync(path.join(root, 'transcript-history', `${B}.json`), JSON.stringify({ items: [{ id: 'xnative-1', session: B, from: 'agent', text: 'After migration', at: '2026-01-01T00:00:02Z' }] }));
    const srv = await startServer(root);
    const ctx = await (await getBrowser()).newContext({ viewport: { width, height: 900 } });
    try {
      const { w, page } = await openWidget(srv, { ctx, tab: B });
      const texts = (await w.msgs()).map(x => x.text);
      for (const text of ['Before migration', 'Previous answer', 'After migration']) assert.ok(texts.includes(text), text);
      assert.ok((await w.holds()).some(x => x.text === 'Held draft'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    } finally { await ctx.close(); srv.stop(); }
  });
}
