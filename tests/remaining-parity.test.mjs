import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createChatHandler } from '../scripts/chat-handler.mjs';

function fixture(t, sessions) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-remaining-'));
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('widget-remaining-')); fs.rmSync(root, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, 'sessions'));
  for (const s of sessions) fs.writeFileSync(path.join(root, 'sessions', s.sessionId + '.json'), JSON.stringify(s));
  t.mock.method(fs, 'watch', () => ({ close() {} }));
  const handler = createChatHandler({ root });
  const write = (file, data) => fs.writeFileSync(path.join(root, file), JSON.stringify(data));
  const read = file => fs.existsSync(path.join(root, file)) ? JSON.parse(fs.readFileSync(path.join(root, file))) : {};
  const api = (url, body) => new Promise(resolve => {
    const req = new EventEmitter(); req.method = body ? 'POST' : 'GET';
    const res = { writeHead(status) { this.status = status; }, end(data) { resolve({ status: this.status, body: JSON.parse(data) }); } };
    assert.equal(handler.handle(req, res, new URL(url, 'http://test.invalid')), true);
    if (body) { req.emit('data', JSON.stringify(body)); req.emit('end'); }
  });
  return { root, write, read, api };
}

test('an explicit unresolved review target cannot borrow another session watcher', async t => {
  const f = fixture(t, [{ sessionId: 'other', tool: 'claude' }]);
  f.write('watch-other.json', { state: 'handling', session: 'other', until: '2999-01-01T00:00:00Z', handlesDone: true });
  assert.equal((await f.api('/api/watch?session=missing')).body.active, false);
  assert.equal((await f.api('/api/watch?session=other')).body.active, true);
  assert.equal((await f.api('/api/watch')).body.active, true, 'intentional discovery still works');
});

test('watch leases require finite future expiration dates', async t => {
  const f = fixture(t, [{ sessionId: 'other', tool: 'claude' }]);
  for (const until of [undefined, 'invalid-date', '2000-01-01T00:00:00Z']) {
    f.write('watch-other.json', { state: 'handling', session: 'other', until, handlesDone: true });
    assert.equal((await f.api('/api/watch?session=other')).body.active, false, String(until));
  }
  f.write('watch-other.json', { session: 'other', pid: process.pid, expiresAt: 'invalid-date', handlesDone: true });
  assert.equal((await f.api('/api/watch?session=other')).body.active, false);
});

test('Codex side failure does not pin a failed fork, and outgoing peer origins reach both side context and quotes', async t => {
  const calls = [];
  const mocked = t.mock.method(cp, 'spawn', (command, args, options) => {
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    let prompt = ''; child.stdin.on('data', data => { prompt += data; });
    child.stdin.on('finish', () => {
      const index = calls.length;
      calls.push({ args: options.env?.UIFB_SIDE_ARGS ? JSON.parse(options.env.UIFB_SIDE_ARGS) : args, prompt });
      child.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: index ? 'successful-side-fork' : 'failed-side-fork' }) + '\n');
      if (index) child.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Successful side answer' } }) + '\n');
      child.emit('close', index ? 0 : 1);
    });
    return child;
  });
  syncBuiltinESMExports(); t.after(() => { mocked.mock.restore(); syncBuiltinESMExports(); });
  const f = fixture(t, [{ sessionId: 'main', tool: 'codex' }, { sessionId: 'other', tool: 'claude' }]);
  fs.mkdirSync(path.join(f.root, 'transcript-history'));
  f.write('transcript-history/other.json', { items: [{ id: 'xoutgoing', from: 'peer', session: 'main', to: 'other', text: 'OUTGOING ORIGINAL FOR SIDE', at: new Date().toISOString() }] });
  const first = await f.api('/api/side', { session: 'main', cid: 'side-one', text: 'Side question', sideOn: 'xoutgoing', quotes: [{ id: 'xoutgoing', quote: 'ORIGINAL FOR' }] });
  for (let n = 0; n < 20 && f.read('chat.json').messages?.length < 2; n++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.read('side-groups.json')[first.body.sideGroup]?.fork, undefined);
  assert.ok(calls[0].prompt.includes('OUTGOING ORIGINAL FOR SIDE'));
  assert.ok(calls[0].prompt.includes('메시지 중 이 부분: "ORIGINAL FOR"'));
  await f.api('/api/side', { session: 'main', cid: 'side-two', text: 'Retry side question', sideGroup: first.body.sideGroup });
  for (let n = 0; n < 20 && calls.length < 2; n++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(calls[1].args.includes('fork'));
  assert.equal(f.read('side-groups.json')[first.body.sideGroup]?.fork, 'successful-side-fork');
});
