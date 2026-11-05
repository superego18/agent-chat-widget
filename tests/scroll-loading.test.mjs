import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getBrowser, closeBrowser } from './helpers.mjs';
after(closeBrowser);
const source = fs.readFileSync(new URL('../assets/app-widget.js', import.meta.url), 'utf8');
for (const delay of ['chat', 'prefs', 'failed prefs']) test(`saved reading position waits for delayed ${delay}, not only native history`, async t => {
 const ctx = await (await getBrowser()).newContext({ viewport: { width: 390, height: 844 } }); t.after(() => ctx.close());
 const page = await ctx.newPage(); let release, prefsReads = 0;
 const messages = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, from: 'agent', session: 'active', text: `Shared answer ${i + 1}\nSynthetic shared history`, at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }));
 const items = Array.from({ length: 150 }, (_, i) => ({ id: 'xnative' + i, from: 'agent', session: 'active', context: 'terminal', text: `Native answer ${i}\nSynthetic native history`, at: new Date(Date.UTC(2026, 0, 2, 0, i)).toISOString() }));
 await page.route('**/*', r => {
  const p = new URL(r.request().url()).pathname;
  if (p === '/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><body>Fixture' });
  if (r.request().method() !== 'GET') return r.fulfill({ json: {} });
  const data = p.endsWith('/sessions') ? { sessions: [{ id: 'active', name: 'Active', tool: 'codex', status: { state: 'idle' } }] } : p.endsWith('/chat') ? { messages, delivered: {} } : p.endsWith('/transcript') ? { items } : p.endsWith('/prefs') ? { pos: { active: '8@-8' } } : p.endsWith('/drafts') ? { drafts: [], trash: [] } : {};
  if (delay === 'failed prefs' && p.endsWith('/prefs') && prefsReads++ === 0) return r.fulfill({ status: 503, json: {} });
  if (p.endsWith('/' + delay)) { release = () => r.fulfill({ json: data }); return; }
  return r.fulfill({ json: data });
 });
 await page.goto('http://scroll-loading.test/'); await page.evaluate(delay => { localStorage.setItem('__uifb_tab', 'active'); localStorage.setItem('__uifb_open:app', '1'); if (delay === 'chat') sessionStorage.setItem('__uifb_positions', JSON.stringify({ active: '8@-8' })); }, delay);
 await page.addScriptTag({ content: source }); await page.getByText('Native answer 149',{ exact: false }).waitFor();
 if (delay === 'failed prefs') { await page.waitForTimeout(200); await page.locator('#reload').click(); } else { assert(release); await release(); } await page.waitForTimeout(500);
 const actual = await page.locator('#msgs').evaluate(b => { const m = b.querySelector('.msg[data-id="8"]'); return { exists: !!m, offset: m ? m.getBoundingClientRect().top - b.getBoundingClientRect().top : null }; });
 assert(actual.exists && Math.abs(actual.offset + 8) < 2, JSON.stringify({ delay, actual }));
});
