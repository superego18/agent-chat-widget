import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readCodexHistory } from '../scripts/transcript-store.mjs';
import { quoteLines } from '../scripts/chat-format.mjs';
import { getBrowser, closeBrowser } from './helpers.mjs';
after(closeBrowser);

const cid = '4c72f105-9c22-422e-80c0-e1b15f53d3c8';
const text = `[pipeline-continuation:${cid}]\nSynthetic continuation instruction`;
const native = (id = 'input', value = text, turn = 'observed-turn') => ({ timestamp: '2026-11-05T00:00:01Z', type: 'response_item', payload: {
  type: 'message', id, role: 'user', content: [{ type: 'input_text', text: value }], internal_chat_message_metadata_passthrough: { turn_id: turn },
} });
function fixture(t, rows = [native()]) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'continuation-origin-'));
  const root = path.join(project, '.ui-feedback'), dir = path.join(project, '.local', 'continuation');
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true }); fs.mkdirSync(dir, { recursive: true });
  const session = { sessionId: 'target', tool: 'codex', name: 'Target', agent: 'Codex', path: path.join(project, 'native.jsonl') };
  fs.writeFileSync(session.path, rows.map(JSON.stringify).join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'sessions', 'target.json'), JSON.stringify(session));
  fs.writeFileSync(path.join(root, 'automation-sources.json'), JSON.stringify({ sources: [{ type: 'pipeline-continuation', config: '.local/continuation/config.json' }] }));
  const config = { projectRoot: project, threadId: 'target', stateDirectory: dir };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
  const file = path.join(dir, 'state.sqlite'), db = new DatabaseSync(file);
  db.exec('CREATE TABLE continuation_intents(id TEXT PRIMARY KEY,state TEXT,body TEXT)');
  const intent = { id: cid, state: 'started', at: '2026-11-05T00:00:00Z', receipt: { status: 'started', turnId: 'observed-turn', cid } };
  const write = value => db.prepare('INSERT OR REPLACE INTO continuation_intents VALUES(?,?,?)').run(cid, value.state, JSON.stringify(value));
  write(intent);
  t.after(() => { db.close(); fs.rmSync(project, { recursive: true, force: true }); });
  return { root, session, config, dir, file, db, intent, write, read: () => readCodexHistory(root, session) };
}

test('an explicitly registered actual continuation receipt labels only its exact native target/turn input', t => {
  const f = fixture(t), before = fs.readFileSync(f.file), nativeBefore = fs.readFileSync(f.session.path);
  const item = f.read().items[0];
  assert.equal(item.from, 'automation');
  assert.equal(item.automationKind, 'pipeline-continuation');
  assert.equal(item.automationId, cid);
  assert.equal(item.text, text);
  assert.equal(item.id, 'xinput');
  assert.match(quoteLines({ replyTo: item.id }, [item])[0], /자동 안내/);
  assert.deepEqual(fs.readFileSync(f.file), before, 'the driver database is read only');
  assert.deepEqual(fs.readFileSync(f.session.path), nativeBefore);
  assert.equal(f.read().items.length, 1);
});
test('a late pickup receipt updates the existing bubble and confirmed provenance survives source loss without trusting rewritten text', t => {
  const f = fixture(t);
  f.write({ ...f.intent, state: 'unknown', receipt: { status: 'unknown' } });
  assert.equal(f.read().items[0].from, 'user');
  f.write(f.intent);
  assert.equal(f.read().items[0].from, 'automation');
  fs.unlinkSync(path.join(f.root, 'automation-sources.json'));
  assert.equal(f.read().items[0].from, 'automation');
  fs.writeFileSync(f.session.path, JSON.stringify(native('input', text + '\nChanged body')) + '\n');
  assert.equal(f.read().items[0].from, 'user');
});
for (const bad of ['wrong-turn', 'wrong-target', 'unconfirmed', 'wrong-cid', 'unregistered', 'quoted', 'duplicate']) test(`continuation-like input stays ordinary without unique native proof: ${bad}`, t => {
  const rows = bad === 'quoted' ? [native('input', 'Owner quotes: ' + text)] : bad === 'duplicate' ? [native(), native('other')] : [native()];
  const f = fixture(t, rows);
  if (bad === 'wrong-turn') f.write({ ...f.intent, receipt: { ...f.intent.receipt, turnId: 'different-turn' } });
  if (bad === 'wrong-cid') f.write({ ...f.intent, receipt: { ...f.intent.receipt, cid: 'different-id' } });
  if (bad === 'unconfirmed') f.write({ ...f.intent, state: 'unknown', receipt: { status: 'unknown' } });
  if (bad === 'unregistered') fs.unlinkSync(path.join(f.root, 'automation-sources.json'));
  if (bad === 'wrong-target') fs.writeFileSync(path.join(f.dir, 'config.json'), JSON.stringify({ ...f.config, threadId: 'other-target' }));
  assert.ok(f.read().items.every(item => item.from === 'user'));
});

for (const width of [390, 1440]) test(`proven continuation has an automation label and a distinct color at ${width}px`, async t => {
  const f = fixture(t), items = f.read().items;
  const ctx = await (await getBrowser()).newContext({ viewport: { width, height: 844 } });
  try {
    const page = await ctx.newPage();
    await page.route('**/*', route => {
      const p = new URL(route.request().url()).pathname;
      if (p === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body>Fixture</body>' });
      return route.fulfill({ json: p.endsWith('/sessions') ? { sessions: [{ ...f.session, id: f.session.sessionId }] } : p.endsWith('/transcript') ? { items } : p.endsWith('/chat') ? { messages: [], delivered: {} } : p.endsWith('/drafts') ? { drafts: [], trash: [] } : {} });
    });
    await page.goto('http://automation.test/');
    await page.addScriptTag({ content: fs.readFileSync(new URL('../assets/app-widget.js', import.meta.url), 'utf8') });
    await page.locator('#btn').click();
    const bubble = page.locator('.msg.automation');
    await bubble.waitFor({ timeout: 5000 });
    assert.match(await bubble.locator('.tag').textContent(), /자동 안내.*작업 이어가기.*Codex.*app-server/);
    assert.doesNotMatch(await bubble.locator('.tag').textContent(), /세션끼리|Orca/);
    assert.equal(await bubble.evaluate(el => getComputedStyle(el).borderTopStyle), 'dashed');
    assert.equal(await bubble.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
  } finally { await ctx.close(); }
});
