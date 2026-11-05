import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { A, makeDir, startServer, openWidget, getBrowser, closeBrowser } from './helpers.mjs';
after(closeBrowser);

for (const width of [390, 1440]) for (const mode of ['single', 'selected']) test(`${mode} stash send places its toast above the conversation composer at ${width}px`, async () => {
  const srv = await startServer(makeDir({ drafts: [1, 2].map(id => ({ id, to: A, text: 'Synthetic saved request ' + id, label: null, at: new Date().toISOString() })) }));
  const ctx = await (await getBrowser()).newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
  try {
    const { page, w } = await openWidget(srv, { ctx });
    page.setDefaultTimeout(5000);
    await w.click('#draftsBtn');
    await page.locator('.draft[data-id="1"] .send1').waitFor();
    if (mode === 'single') await page.locator('.draft[data-id="1"] .send1').click();
    else { await page.locator('#dall').check(); await page.locator('#dsend').click(); }
    await page.locator('#toast').waitFor();
    await page.locator('#dsheet').waitFor({ state: 'hidden' });
    const geometry = await page.locator('#toast').evaluate(t => {
      const r = t.getRootNode(), c = r.getElementById('composeRow').getBoundingClientRect(), p = r.getElementById('panel').getBoundingClientRect(), b = t.getBoundingClientRect();
      return { toast: { left: b.left, right: b.right, top: b.top, bottom: b.bottom }, composerTop: c.top, panelTop: p.top, width: innerWidth };
    });
    const dir = process.env.UIFB_TOAST_EVIDENCE_DIR;
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
      await page.locator('#panel').screenshot({ path: path.join(dir, `${mode}-${width}.png`) });
      fs.writeFileSync(path.join(dir, `${mode}-${width}.json`), JSON.stringify(geometry, null, 2));
    }
    assert.match(await page.locator('#toast').textContent(), /보냄/);
    assert.ok(geometry.toast.bottom <= geometry.composerTop, 'must not cover the composer controls');
    assert.ok(geometry.composerTop - geometry.toast.bottom <= 30, 'must stay next to the composer, not the dismissed sheet header');
    assert.ok(geometry.toast.left >= 8 && geometry.toast.right <= width - 8, 'must fit the viewport');
    assert.ok(geometry.toast.top > geometry.panelTop, 'must stay within the conversation');
  } finally { await ctx.close(); srv.stop(); }
});
