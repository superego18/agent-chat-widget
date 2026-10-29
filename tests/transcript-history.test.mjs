import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createChatHandler } from '../scripts/chat-handler.mjs';
import { carryTranscriptHistory } from '../scripts/transcript-store.mjs';

test('all native messages survive rollout deletion, server restart and session replacement', async t => {
  t.mock.method(fs, 'watch', () => ({}));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-history-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'sessions'));
  const rollout = path.join(root, 'rollout.jsonl');
  const session = { sessionId: 'old', tool: 'codex', agent: 'Codex', path: rollout, name: 'Product' };
  fs.writeFileSync(path.join(root, 'sessions/old.json'), JSON.stringify(session));
  const records = Array.from({ length: 350 }, (_, i) => ({ timestamp: new Date(1700000000000 + i * 1000).toISOString(), type: 'response_item', payload: { id: `msg-${i}`, type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `answer ${i}` }] } }));
  records.splice(1, 0, { type: 'response_item', payload: { type: 'function_call_output', output: 'x'.repeat(4 * 1024 * 1024 + 100) } });
  fs.writeFileSync(rollout, records.map(x => JSON.stringify(x)).join('\n'));
  const source = fs.readFileSync(rollout);
  async function serve() {
    const handler = createChatHandler({ root });
    const server = http.createServer((req, res) => handler.handle(req, res, new URL(req.url, 'http://localhost')));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { get: async id => (await fetch(`http://127.0.0.1:${server.address().port}/api/transcript?session=${id}`)).json(), close: () => new Promise(resolve => server.close(resolve)) };
  }
  let server = await serve();
  try {
    const first = await server.get('old');
    assert.equal(first.items.length, 350, 'neither the 4 MiB tail nor 300-message cap loses history');
    assert.deepEqual(fs.readFileSync(rollout), source, 'provider transcript stays untouched');
  } finally { await server.close(); }
  fs.unlinkSync(rollout); // Only this test's synthetic file is removed.
  server = await serve();
  try { assert.equal((await server.get('old')).items.length, 350); } finally { await server.close(); }
  carryTranscriptHistory(root, session, 'new');
  fs.unlinkSync(path.join(root, 'sessions/old.json'));
  fs.writeFileSync(path.join(root, 'sessions/new.json'), JSON.stringify({ ...session, sessionId: 'new', tool: 'claude' }));
  server = await serve();
  try {
    const migrated = await server.get('new');
    assert.equal(migrated.items.length, 350);
    assert.ok(migrated.items.every(x => x.session === 'new'));
    assert.equal(migrated.items[0].id, 'xmsg-0');
  } finally { await server.close(); }
});
