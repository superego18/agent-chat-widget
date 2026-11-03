import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createChatHandler } from '../scripts/chat-handler.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-poll-cache-'));
  fs.mkdirSync(path.join(root, 'sessions'));
  const chatFile = path.join(root, 'chat.json'), deliveredFile = path.join(root, 'delivered.json');
  fs.writeFileSync(chatFile, JSON.stringify({ messages: [{ id: 1, from: 'user', to: 'synthetic', text: 'Synthetic message' }] }));
  fs.writeFileSync(deliveredFile, '{}');
  const handler = createChatHandler({ root });
  t.after(async () => { await handler.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  const get = (gzip = true) => {
    let body, headers;
    handler.handle({ method: 'GET', headers: gzip ? { 'accept-encoding': 'gzip' } : {} }, {
      writeHead(status, h) { assert.equal(status, 200); headers = h; }, end(value) { body = value; }
    }, new URL('http://fixture.invalid/api/chat'));
    return { data: JSON.parse(headers['Content-Encoding'] === 'gzip' ? zlib.gunzipSync(body).toString() : body), headers };
  };
  return { root, chatFile, deliveredFile, handler, get };
}

test('unchanged chat polling reads history once and reuses gzip without losing plain JSON', t => {
  const f = fixture(t), read = fs.readFileSync, gzip = zlib.gzipSync;
  let reads = 0, compressions = 0;
  t.mock.method(fs, 'readFileSync', function(file, ...args) { if (file === f.chatFile) reads++; return read.call(this, file, ...args); });
  t.mock.method(zlib, 'gzipSync', function(...args) { compressions++; return gzip.apply(this, args); });
  const first = f.get();
  for (let i = 0; i < 5; i++) assert.deepEqual(f.get().data, first.data);
  assert.deepEqual(f.get(false).data, first.data);
  assert.equal(first.headers['Cache-Control'], 'no-store', 'browser freshness is unchanged');
  assert.equal(reads, 1, 'unchanged polling must not repeatedly read the full chat file');
  assert.equal(compressions, 1, 'unchanged polling must not repeatedly compress the full conversation');
});

test('new chat and delivered-only updates immediately invalidate the cached response', t => {
  const f = fixture(t);
  f.get();
  f.handler.addChat({ from: 'agent', session: 'synthetic', text: 'New synthetic answer' });
  assert.equal(f.get().data.messages.at(-1).text, 'New synthetic answer');
  fs.writeFileSync(f.deliveredFile, JSON.stringify({ _at: { 1: '2026-11-03T00:00:00Z' } }));
  assert.equal(f.get().data.delivered._at[1], '2026-11-03T00:00:00Z', 'reading is not inferred from chat changes');
  fs.writeFileSync(f.deliveredFile, JSON.stringify({ _at: { 1: '2026-11-03T00:01:00Z' } }));
  assert.equal(f.get(false).data.delivered._at[1], '2026-11-03T00:01:00Z');
});

test('atomic replacement with the same size and mtime refreshes cached chat; deletion and recovery stay fresh', t => {
  const f = fixture(t);
  const original = f.get().data, stat = fs.statSync(f.chatFile);
  const next = path.join(f.root, 'replacement.json');
  fs.writeFileSync(next, JSON.stringify({ messages: [{ ...original.messages[0], text: 'Synthetic changed' }] }));
  assert.equal(fs.statSync(next).size, stat.size);
  fs.utimesSync(next, stat.atime, stat.mtime);
  fs.renameSync(next, f.chatFile);
  assert.equal(f.get().data.messages[0].text, 'Synthetic changed');
  fs.unlinkSync(f.chatFile);
  assert.deepEqual(f.get().data.messages, []);
  fs.writeFileSync(f.chatFile, JSON.stringify({ messages: original.messages }));
  assert.equal(f.get().data.messages[0].text, 'Synthetic message');
});

test('a native Codex pickup refreshes a cached response even when chat and delivered files were unchanged', t => {
  const f = fixture(t), native = path.join(f.root, 'native.jsonl');
  const receipt = '11111111-2222-4333-8444-555555555555';
  fs.writeFileSync(native, '');
  fs.writeFileSync(path.join(f.root, 'sessions', 'synthetic.json'), JSON.stringify({ sessionId: 'synthetic', tool: 'codex', path: native }));
  fs.writeFileSync(f.chatFile, JSON.stringify({ messages: [{ id: 1, from: 'user', to: 'synthetic', text: 'Synthetic message', at: '2026-11-03T00:00:00Z', queue: { state: 'accepted', receipt } }] }));
  assert.equal(f.get().data.delivered._at?.[1], undefined, 'acceptance is not pickup');
  fs.appendFileSync(native, JSON.stringify({ timestamp: '2026-11-03T00:00:01Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `[대화/피드백 · 앱 화면] [uifb-receipt:${receipt}] Synthetic message` }] } }) + '\n');
  assert.equal(f.get().data.delivered._at[1], '2026-11-03T00:00:01.000Z');
  assert.equal(JSON.parse(fs.readFileSync(f.deliveredFile))._at[1], '2026-11-03T00:00:01.000Z');
});

test('oversized chat is returned complete without retaining a compressed response cache', t => {
  const f = fixture(t), gzip = zlib.gzipSync;
  const text = 'x'.repeat(8 * 1024 * 1024 + 1);
  fs.writeFileSync(f.chatFile, JSON.stringify({ messages: [{ id: 1, text }] }));
  let compressions = 0;
  t.mock.method(zlib, 'gzipSync', function(...args) { compressions++; return gzip.apply(this, args); });
  assert.equal(f.get().data.messages[0].text.length, text.length);
  assert.equal(f.get().data.messages[0].text.length, text.length);
  assert.equal(compressions, 2, 'cache budget does not truncate or retain oversized responses');
});
