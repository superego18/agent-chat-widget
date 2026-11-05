import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeDir, startServer, openWidget, getBrowser, closeBrowser } from './helpers.mjs';
after(closeBrowser);
const manifest = { checkedAt: '2026-11-04T16:00:00Z', items: [{ title: 'App and conversation', description: 'The application with its conversation panel', links: [
  { label: '로컬', href: 'http://127.0.0.1:12345/', scope: 'local' },
  { label: '원격 · Tailscale', href: 'https://a-very-long-but-valid-host-name-for-mobile-layout.example.ts.net:8447/', scope: 'remote' },
] }, { title: '비교 페이지 서버', description: 'Review server address', links: [{ label: '로컬 · 비교 서버', href: 'http://127.0.0.1:12346/', scope: 'local' }] }] };

test('registered project links are read-only, missing/corrupt configuration is empty and unsafe URLs are excluded', async () => {
  const root = makeDir(), file = path.join(root, 'project-links.json'), srv = await startServer(root);
  try {
    assert.deepEqual((await srv.api('/api/project-links')).items, []);
    fs.writeFileSync(file, '{invalid');
    assert.deepEqual((await srv.api('/api/project-links')).items, []);
    const data = structuredClone(manifest);
    data.items[0].links.push({ label: 'Unsafe', href: 'javascript:alert(1)', scope: 'remote' }, { label: 'Credential', href: 'https://user:secret@example.test/', scope: 'remote' });
    fs.writeFileSync(file, JSON.stringify(data));
    const before = fs.readFileSync(file);
    const response = await srv.api('/api/project-links');
    assert.equal(response.items[0].links.length, 2);
    assert.equal(response.checkedAt, manifest.checkedAt);
    assert.equal((await fetch(srv.base + '/api/project-links', { method: 'POST', body: '{}' })).status, 405);
    assert.deepEqual(fs.readFileSync(file), before);
  } finally { srv.stop(); }
});

for (const width of [390, 1440]) for (const reviews of ['available', 'unavailable']) test(`project links show local/remote addresses and honest review state at ${width}px (${reviews})`, async () => {
  const root = makeDir();
  fs.writeFileSync(path.join(root, 'project-links.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(root, 'pages-fixture.json'), JSON.stringify({ title: '비교 페이지', items: [{ title: 'Existing review', href: '/review-old.html', meta: ['Existing review preserved'] }] }));
  const srv = await startServer(root), ctx = await (await getBrowser()).newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
  try {
    const { page, w } = await openWidget(srv, { ctx });
    if (reviews === 'unavailable') await page.route('**/__uifb/api/pages', r => r.fulfill({ status: 404, json: { error: 'Review service is separate' } }));
    await page.getByRole('button', { name: '프로젝트 링크', exact: true }).click();
    await page.getByRole('link', { name: /원격 · Tailscale/ }).waitFor();
    assert.equal(await page.locator('.project-link a').count(), 3);
    const anchors = await page.locator('.project-link a').evaluateAll(links => links.map(a => ({ href: a.href, height: a.getBoundingClientRect().height, overflow: a.scrollWidth > a.clientWidth + 1 })));
    assert.deepEqual(anchors.map(a => a.href), manifest.items.flatMap(i => i.links.map(l => l.href)));
    assert.equal(await page.locator('#plist strong, #plist h3').filter({ hasText: /^비교 페이지(?: 서버)?$/ }).count(), 1, 'review server and pages share one heading');
    assert.ok(anchors.every(a => a.height >= 44 && !a.overflow));
    if (reviews === 'available') await page.getByRole('link', { name: 'Existing review', exact: true }).waitFor();
    else assert.match(await page.locator('#plist').textContent(), /비교 페이지 목록에 연결되지/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const dir = process.env.UIFB_LINK_EVIDENCE_DIR;
    if (dir) { fs.mkdirSync(dir, { recursive: true }); await page.locator('#psheet').screenshot({ path: path.join(dir, `${width}-${reviews}.png`) }); }
    await w.click('#pclose');
    assert.equal(await page.locator('#psheet').isHidden(), true);
  } finally { await ctx.close(); srv.stop(); }
});
