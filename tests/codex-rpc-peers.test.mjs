import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCodexHistory } from '../scripts/transcript-store.mjs';
import { createEvidenceContext } from '../scripts/codex-orchestration.mjs';
import { createPeerSourceIndex } from '../scripts/codex-peer-index.mjs';
import { getBrowser, closeBrowser } from './helpers.mjs';
after(closeBrowser);
const cid = '11111111-2222-4333-8444-555555555555', text = '[Synthetic coordination] Update existing evidence only.';

function fixture(t, bad) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rpc-peer-'));
  const root = path.join(project, '.ui-feedback'), dir = path.join(project, '.local', 'sender');
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true }); fs.mkdirSync(dir, { recursive: true });
  const source = { sessionId: 'sender', tool: 'codex', name: 'Synthetic sender', path: path.join(project, 'sender.jsonl') };
  const target = { sessionId: 'target', tool: 'codex', name: 'Synthetic target', path: path.join(project, 'target.jsonl') };
  const script = path.join(dir, 'send.mjs');
  const content = `import fs from 'node:fs';import {randomUUID} from 'node:crypto';\nconst cid=randomUUID();\nconst receipt=await withCodexRpc(config.command,async call=>{return call('turn/steer',{threadId:config.threadId,expectedTurnId:turn.id,clientUserMessageId:cid,input:[{type:'text',text:'${text}'}]});});\nfs.writeFileSync(path.join(dir,'receipt.json'),JSON.stringify({at:new Date().toISOString(),cid,sameTurnOnly:true,receipt}));`;
  const created = { timestamp: '2026-11-05T00:00:00Z', type: 'event_msg', payload: { type: 'item_completed', item: { type: 'FileChange', status: bad === 'failed-creation' ? 'failed' : 'completed', changes: { [script]: { type: 'add', content } } } } };
  const executed = { timestamp: '2026-11-05T00:00:03Z', type: 'event_msg', payload: { type: 'item_completed', started_at_ms: Date.parse('2026-11-05T00:00:01Z'), item: { type: 'CommandExecution', status: 'completed', cwd: pathToFileURL(project).href, command: ['powershell', '-Command', 'node ' + path.relative(project, script).split(path.sep).join('/')], exit_code: bad === 'failed-execution' ? 1 : 0, aggregated_output: JSON.stringify({ turnId: 'target-turn' }) } } };
  fs.writeFileSync(path.join(dir, 'receipt.json'), JSON.stringify({ at: '2026-11-05T00:00:02Z', cid, sameTurnOnly: true, receipt: { turnId: 'target-turn' } }));
  const input = { timestamp: '2026-11-05T00:00:04Z', type: 'response_item', payload: { type: 'message', role: 'user', id: 'native-input', content: [{ type: 'input_text', text: bad === 'changed-text' ? text + ' Owner addition' : text }], internal_chat_message_metadata_passthrough: { turn_id: 'target-turn' } } };
  const accepted = { timestamp: '2026-11-05T00:00:04.006Z', type: 'event_msg', payload: { type: 'item_completed', thread_id: bad === 'wrong-target' ? 'foreign' : 'target', turn_id: bad === 'wrong-turn' ? 'foreign-turn' : 'target-turn', item: { type: 'UserMessage', id: 'different-event-id', client_id: bad === 'wrong-cid' ? 'foreign' : cid, content: [{ type: 'text', text }] } } };
  fs.writeFileSync(source.path, [created, executed].map(JSON.stringify).join('\n') + '\n');
  const rows = bad === 'missing-native-receipt' ? [input] : [input, accepted];
  if (bad === 'duplicate') rows.push({ ...input, payload: { ...input.payload, id: 'duplicate-input' } });
  fs.writeFileSync(target.path, rows.map(JSON.stringify).join('\n') + '\n');
  for (const s of [source, target]) fs.writeFileSync(path.join(root, 'sessions', s.sessionId + '.json'), JSON.stringify(s));
  const index = createPeerSourceIndex();
  t.after(async () => { await index.shutdown(); fs.rmSync(project, { recursive: true, force: true }); });
  return { root, source, target, index, read: () => readCodexHistory(root, target, Object.assign(createEvidenceContext(), { peerSources: index })) };
}
async function ready(f) {
  let data;
  for (let i = 0; i < 40; i++) {
    data = f.read();
    if (f.index.read(f.source).complete && f.index.read(f.target).complete) return f.read();
    await new Promise(r => setTimeout(r, 10));
  }
  throw Error('Fixture peer index did not settle');
}
test('a successful native inline RPC script plus exact client receipt classifies its canonical input as a peer message', async t => {
  const f = fixture(t), data = await ready(f), item = data.items.find(m => m.id === 'xnative-input');
  assert.equal(item.from, 'peer'); assert.equal(item.session, 'sender'); assert.equal(item.to, 'target');
  assert.equal(item.peerMethod, 'app-server-steer'); assert.equal(item.peerSourceTool, 'codex');
  assert.equal(item.peerTargetTool, 'codex'); assert.equal(item.text, text); assert.equal(data.items.length, 1);
  assert.deepEqual(f.read().items, data.items, 'polling does not duplicate or reclassify the native input');
  const rewritten = fs.readFileSync(f.target.path, 'utf8').replace(text, text + ' Owner addition');
  fs.writeFileSync(f.target.path, rewritten);
  assert.equal((await ready(f)).items.find(m => m.id === 'xnative-input').from, 'user', 'rewritten text cannot reuse earlier RPC provenance');
});
for (const bad of ['failed-creation', 'failed-execution', 'wrong-cid', 'wrong-turn', 'wrong-target', 'missing-native-receipt', 'changed-text', 'duplicate']) test(`RPC-like text has no peer provenance without complete proof: ${bad}`, async t => {
  const f = fixture(t, bad), data = await ready(f);
  assert(data.items.every(m => m.from === 'user'));
});
for (const width of [390, 1440]) test(`RPC peer label and incoming color fit at ${width}px`, async t => {
  const f = fixture(t), items = (await ready(f)).items;
  const ctx = await (await getBrowser()).newContext({ viewport: { width, height: 844 } });
  try {
    const page = await ctx.newPage();
    await page.route('**/*', route => {
      const p = new URL(route.request().url()).pathname;
      if (p === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body>Fixture</body>' });
      return route.fulfill({ json: p.endsWith('/sessions') ? { sessions: [{ ...f.target, id: f.target.sessionId }, { ...f.source, id: f.source.sessionId }] } : p.endsWith('/transcript') ? { items: new URL(route.request().url()).searchParams.get('session') === f.target.sessionId ? items : [] } : p.endsWith('/chat') ? { messages: [], delivered: {} } : p.endsWith('/drafts') ? { drafts: [], trash: [] } : {} });
    });
    await page.goto('http://peer.test/');
    await page.addScriptTag({ content: fs.readFileSync(new URL('../assets/app-widget.js', import.meta.url), 'utf8') });
    await page.locator('#btn').click();
    const bubble = page.locator('.msg.peer.in'); await bubble.waitFor({ timeout: 5000 });
    assert.match(await bubble.locator('.tag').textContent(), /Codex.*app-server.*끼워넣기/);
    assert.match(await bubble.locator('.route').textContent(), /Synthetic sender.*Synthetic target/);
    assert.equal(await bubble.evaluate(e => e.scrollWidth <= e.clientWidth + 1), true);
  } finally { await ctx.close(); }
});
