import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { createChatHandler } from '../scripts/chat-handler.mjs';
import { formatMessage, pendingFor, wasDelivered } from '../scripts/chat-format.mjs';

const session = { sessionId: 'test-thread', tool: 'codex', name: 'Test session' };
const message = { from: 'user', to: session.sessionId, context: 'app', text: 'Check the heading', cid: 'test-message' };

test('plain stored sends do not scan native histories to construct empty quote context', async t => {
  const f = fixture(t);
  const native = path.join(f.root, 'synthetic-native.jsonl');
  fs.writeFileSync(native, JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Synthetic previous answer' }] } }) + '\n');
  fs.writeFileSync(path.join(f.root, 'sessions', session.sessionId + '.json'), JSON.stringify({ ...session, path: native }));
  const read = fs.readFileSync;
  let historyReads = 0;
  t.mock.method(fs, 'readFileSync', (file, ...args) => {
    if (String(file) === native) historyReads++;
    return read(file, ...args);
  });
  const result = await f.api('/api/chat', { ...message, ack: 'stored' });
  assert.equal(result.status, 200);
  assert.equal(historyReads, 0, 'a plain send must not synchronously rebuild transcript history before its stored acknowledgement');
  assert.equal(f.calls.length, 1);
  f.calls[0].child.emit('close', 0);
});

test('stored acknowledgement returns the durable message before provider delivery finishes', async t => {
  const f = fixture(t);
  try {
    const request = f.api('/api/chat', { ...message, ack: 'stored' });
    const result = await Promise.race([request, new Promise(resolve => setTimeout(() => resolve(null), 100))]);
    assert.ok(result, 'saving must acknowledge without waiting for the provider helper');
    assert.equal(result.status, 200);
    assert.equal(result.body.queue.state, 'pending');
    assert.equal(f.read('chat.json').messages[0].id, result.body.id);
    assert.equal(f.read('chat.json').messages[0].ack, undefined, 'transport option is not persisted as message content');
    f.calls[0].child.emit('close', 1);
    await new Promise(resolve => setImmediate(resolve));
    const refreshed = await f.api('/api/chat');
    assert.equal(refreshed.body.messages[0].queue.state, 'failed');
    assert.equal(f.calls.length, 1, 'refreshing never resubmits the request');
  } finally { for (const call of f.calls) call.child.emit('close', 1); }
});

test('failed record deletion is reversible and never resends the input', async t => {
  const f = fixture(t, child => { queueMicrotask(() => child.emit('close', 1)); return child; });
  const sent = await f.api('/api/chat', message);
  assert.equal((await f.api('/api/chat-hide-failed', { id: sent.body.id, hidden: true })).status, 200);
  assert.ok(f.read('chat.json').messages[0].hiddenFailure);
  assert.equal((await f.api('/api/chat-retry', { id: sent.body.id })).status, 400, 'hidden records cannot silently retry');
  assert.equal((await f.api('/api/chat-hide-failed', { id: sent.body.id, hidden: false })).status, 200);
  assert.equal(f.read('chat.json').messages[0].hiddenFailure, undefined);
  assert.equal(f.calls.length, 1);
  const chat = f.read('chat.json'); chat.messages[0].queue.state = 'unknown'; fs.writeFileSync(path.join(f.root, 'chat.json'), JSON.stringify(chat));
  assert.equal((await f.api('/api/chat-hide-failed', { id: sent.body.id, hidden: true })).status, 409);
});

for (const state of ['accepted', 'failed', 'unknown']) test(`pending ordinary input converts to steering without a duplicate message: ${state}`, async t => {
  const steps = [];
  const f = fixture(t, child => { queueMicrotask(() => child.emit('close', 0)); return child; }, {
    cancelSend: async () => { steps.push('withdraw'); return { ok: true }; },
    steerSend: async () => { steps.push('steer'); return { ok: state === 'accepted', state, mode: 'steer' }; }
  });
  const sent = await f.api('/api/chat', message);
  const changed = await f.api('/api/chat-interject', { id: sent.body.id, on: true });
  assert.equal(changed.status, state === 'accepted' ? 200 : 502);
  assert.deepEqual(steps, ['withdraw', 'steer']);
  const saved = f.read('chat.json').messages;
  assert.equal(saved.length, 1); assert.equal(saved[0].id, sent.body.id);
  assert.equal(saved[0].queue.receipt, sent.body.queue.receipt);
  assert.equal(saved[0].queue.state, state); assert.equal(saved[0].interject, true);
  assert.equal(f.calls.length, 1, 'conversion never queues a second ordinary input');
  if (state === 'accepted') { await f.api('/api/chat-interject', { id: sent.body.id, on: true }); assert.deepEqual(steps, ['withdraw', 'steer'], 'repeat conversion does not steer twice'); }
  if (state === 'failed') assert.equal((await f.api('/api/chat-cancel', { id: sent.body.id })).status, 200, 'definitely failed steering can move to hold');
  else if (state === 'unknown') assert.equal((await f.api('/api/chat-cancel', { id: sent.body.id })).status, 409, 'uncertain steering cannot pretend to be recalled');
});

for (const state of ['not_pending', 'unknown', 'failed']) test(`failed withdrawal never steers the queued original: ${state}`, async t => {
  let steers = 0;
  const f = fixture(t, child => { queueMicrotask(() => child.emit('close', 0)); return child; }, { cancelSend: async () => ({ ok: false, state }), steerSend: async () => { steers++; return { ok: true, state: 'accepted' }; } });
  const sent = await f.api('/api/chat', message);
  const result = await f.api('/api/chat-interject', { id: sent.body.id, on: true });
  assert.equal(result.status, state === 'not_pending' ? 409 : 502);
  if (state === 'failed') assert.match(result.body.error, /Codex 제어 연결.*기존 메시지는 유지했고 중복 전송하지/);
  assert.equal(f.read('chat.json').messages.length, 1);
  assert.equal(steers, 0); assert.equal(f.read('chat.json').messages[0].interject, undefined);
});

test('definitely failed steering can revert to ordinary queue delivery', async t => {
  const f = fixture(t, child => { queueMicrotask(() => child.emit('close', 0)); return child; }, { steerSend: async () => ({ ok: false, state: 'failed', mode: 'steer' }) });
  const sent = await f.api('/api/chat', { ...message, interject: true });
  assert.equal((await f.api('/api/chat-interject', { id: sent.body.id, on: false })).status, 200);
  const saved = f.read('chat.json').messages[0];
  assert.equal(saved.interject, undefined); assert.equal(saved.queue.state, 'accepted'); assert.equal(saved.queue.mode, undefined);
  assert.equal(f.calls.length, 1);
});

test('conversion serializes cancel/retry and preserves concurrent history', async t => {
  let enter, finish;
  const entered = new Promise(r => { enter = r; }), gate = new Promise(r => { finish = r; });
  const f = fixture(t, child => { queueMicrotask(() => child.emit('close', 0)); return child; }, { cancelSend: async () => { enter(); await gate; return { ok: true }; }, steerSend: async () => ({ ok: true, state: 'accepted', mode: 'steer' }) });
  const sent = await f.api('/api/chat', message), changing = f.api('/api/chat-interject', { id: sent.body.id, on: true });
  await entered;
  assert.equal((await f.api('/api/chat-cancel', { id: sent.body.id })).status, 409);
  assert.equal((await f.api('/api/chat-retry', { id: sent.body.id, confirmUnknown: true })).status, 409);
  assert.equal((await f.api('/api/chat-interject', { id: sent.body.id, on: true })).status, 409);
  const chat = f.read('chat.json'); chat.messages.push({ id: 2, from: 'agent', text: 'Concurrent reply' }); fs.writeFileSync(path.join(f.root, 'chat.json'), JSON.stringify(chat));
  finish(); assert.equal((await changing).status, 200);
  assert.equal(f.read('chat.json').messages.length, 2);
});

for (const [label, outcome, status] of [['deleted', { ok: true }, 200], ['already consumed', { ok: false, state: 'not_pending' }, 409], ['unknown deletion', { ok: false, state: 'unknown' }, 502]]) test(`Codex cancellation persists only confirmed deletion: ${label}`, async t => {
  const cancelled = [];
  const f = fixture(t, child => { queueMicrotask(() => child.emit('close', 0)); return child; }, { cancelSend: async (...args) => { cancelled.push(args); return outcome; } });
  const sent = await f.api('/api/chat', message);
  const r = await f.api('/api/chat-cancel', { id: sent.body.id });
  assert.equal(r.status, status);
  assert.equal(!!f.read('chat.json').messages[0].cancelled, outcome.ok);
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0][1], session.sessionId);
  assert.equal(cancelled[0][2], sent.body.queue.receipt);
  assert.equal(f.calls.length, 1, 'cancellation never resends or interrupts');
});

test('Codex cancellation refuses received and interjected inputs before native deletion', async t => {
  let calls = 0;
  const f = fixture(t, child => { queueMicrotask(() => child.emit('close', 0)); return child; }, { cancelSend: async () => { calls++; return { ok: true }; } });
  const sent = await f.api('/api/chat', message);
  fs.writeFileSync(path.join(f.root, 'delivered.json'), JSON.stringify({ _at: { [sent.body.id]: new Date().toISOString() } }));
  assert.equal((await f.api('/api/chat-cancel', { id: sent.body.id })).status, 409);
  fs.writeFileSync(path.join(f.root, 'delivered.json'), '{}');
  const chat = f.read('chat.json'); chat.messages[0].queue.mode = 'steer'; fs.writeFileSync(path.join(f.root, 'chat.json'), JSON.stringify(chat));
  assert.equal((await f.api('/api/chat-cancel', { id: sent.body.id })).status, 409);
  assert.equal(calls, 0);
});

test('cancellation blocks concurrent retry and preserves messages written while deletion waits', async t => {
  let enter, finish;
  const entered = new Promise(r => { enter = r; }), gate = new Promise(r => { finish = r; });
  const f = fixture(t, child => { queueMicrotask(() => child.emit('close', 0)); return child; }, { cancelSend: async () => { enter(); await gate; return { ok: true }; } });
  const sent = await f.api('/api/chat', message), chat = f.read('chat.json');
  chat.messages[0].queue.state = 'unknown'; fs.writeFileSync(path.join(f.root, 'chat.json'), JSON.stringify(chat));
  const cancelling = f.api('/api/chat-cancel', { id: sent.body.id }); await entered;
  assert.equal((await f.api('/api/chat-retry', { id: sent.body.id, confirmUnknown: true })).status, 409);
  assert.equal((await f.api('/api/chat-cancel', { id: sent.body.id })).status, 409);
  const current = f.read('chat.json'); current.messages.push({ id: 2, from: 'agent', text: 'Concurrent answer' }); fs.writeFileSync(path.join(f.root, 'chat.json'), JSON.stringify(current));
  finish(); assert.equal((await cancelling).status, 200);
  assert.equal(f.read('chat.json').messages.length, 2);
  assert.ok(f.read('chat.json').messages[0].cancelled);
  assert.equal((await f.api('/api/chat-cancel', { id: sent.body.id })).status, 200, 'completed cancellation is idempotent');
});

test('a missing recipient registration never turns an uncertain native queue into a local cancellation', async t => {
  const f = fixture(t, child => { queueMicrotask(() => child.emit('close', 0)); return child; });
  const sent = await f.api('/api/chat', message);
  fs.unlinkSync(path.join(f.root, 'sessions', session.sessionId + '.json'));
  assert.equal((await f.api('/api/chat-cancel', { id: sent.body.id })).status, 409);
  assert.equal(f.read('chat.json').messages[0].cancelled, undefined);
});

test('explicit Codex interjection uses steering while ordinary sends still use queue', async t => {
  const steered = [];
  const f = fixture(t, child => { queueMicrotask(() => child.emit('close', 0, null)); return child; }, {
    steerSend: async (...args) => { steered.push(args); return { ok: true, state: 'accepted', mode: 'steer', turnId: 'turn_live' }; }
  });
  const response = await f.api('/api/chat', { ...message, interject: true });
  assert.equal(response.body.queue.mode, 'steer'); assert.equal(response.body.queue.turnId, 'turn_live');
  assert.equal(steered.length, 1); assert.equal(f.calls.length, 0);
  assert.equal(steered[0][1], session.sessionId);
  assert.ok(steered[0][2].includes(message.text)); assert.ok(steered[0][2].includes('[uifb-receipt:' + response.body.queue.receipt + ']'));
  await f.api('/api/chat', { ...message, interject: true });
  assert.equal(steered.length, 1, 'repeated clicks do not steer twice');
  const normal = await f.api('/api/chat', { ...message, cid: 'ordinary-send', text: 'Next task' });
  assert.equal(normal.body.queue.state, 'accepted');
  assert.equal(f.calls.length, 1); assert.equal(steered.length, 1);
});

for (const state of ['failed', 'unknown']) test(`steering ${state} is stored without falling back to queue`, async t => {
  const f = fixture(t, child => { queueMicrotask(() => child.emit('close', 0, null)); return child; }, { steerSend: async () => ({ ok: false, state, mode: 'steer', error: 'steer_failed' }) });
  const r = await f.api('/api/chat', { ...message, interject: true });
  assert.equal(r.status, 502); assert.equal(r.body.queue.state, state); assert.equal(f.calls.length, 0);
  if (state === 'unknown') {
    assert.equal((await f.api('/api/chat-retry', { id: r.body.id })).status, 409);
    assert.equal((await f.api('/api/chat-retry', { id: r.body.id, confirmUnknown: true })).status, 502);
    assert.equal(f.calls.length, 0, 'an explicitly confirmed retry still uses steering');
  }
});

// Exercise the HTTP handler without sockets, CLI processes, hooks or real sessions.
function fixture(t, spawnImpl, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-queue-test-'));
  const handlers = [];
  t.after(async () => {
    for (const call of calls) call.child.emit('close', 1);
    await Promise.all(handlers.map(h => h.shutdown()));
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('widget-queue-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, 'sessions'));
  fs.writeFileSync(path.join(root, 'sessions', `${session.sessionId}.json`), JSON.stringify(session));
  const bin = path.join(root, 'fake bin');
  const cli = path.join(bin, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, 'process.exitCode = 0;');
  fs.writeFileSync(path.join(bin, 'codex.cmd'), '@echo off\r\nexit /b 99\r\n');
  fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
  const originalPath = process.env.PATH;
  process.env.PATH = bin;
  t.after(() => { process.env.PATH = originalPath; });
  const calls = [];
  const queueSpawn = (...args) => {
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    calls.push({ args, child });
    return spawnImpl ? spawnImpl(child, args) : child;
  };
  t.mock.method(fs, 'watch', () => {
    const watcher = new EventEmitter(); watcher.close = () => watcher.emit('close'); return watcher;
  });
  const makeHandler = () => { const h = createChatHandler({ root, queueSpawn, ...extra }); handlers.push(h); return h; };
  const handler = makeHandler();
  const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  const api = (url, body, chat = handler) => new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = body === undefined ? 'GET' : 'POST';
    const res = { writeHead(status) { this.status = status; }, end(data) { resolve({ status: this.status, body: JSON.parse(data) }); } };
    assert.equal(chat.handle(req, res, new URL(url, 'http://test.invalid')), true);
    if (body !== undefined) { req.emit('data', JSON.stringify(body)); req.emit('end'); }
  });
  return { root, bin, cli, handler, makeHandler, calls, read, api };
}

test('handler shutdown fences ingress, keeps pending cleanup and returns one join promise', async t => {
  const f = fixture(t);
  const stored = await f.api('/api/chat', { ...message, ack: 'stored' });
  assert.equal(stored.status, 200);
  const shutdown = f.handler.shutdown(); assert.strictEqual(f.handler.shutdown(), shutdown);
  assert.equal((await f.api('/api/chat')).status, 503);
  assert.ok(f.handler.cleanupSnapshot().some(x => x.resources.some(r => r.kind === 'child' && !r.closed)));
  let joined = false; shutdown.then(() => { joined = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(joined, false);
  f.calls[0].child.emit('close', 1);
  await shutdown;
  assert.deepEqual(f.handler.cleanupSnapshot(), []);
  assert.equal(f.calls.length, 1, 'shutdown does not launch or retry a provider');
  assert.equal(f.read('chat.json').messages[0].text, message.text);
});

test('Codex receives native replies, references, partial quotes and mixed quote context', async t => {
  const f = fixture(t, child => { queueMicrotask(() => child.emit('close', 0)); return child; });
  const native = path.join(f.root, 'native.jsonl');
  const records = ['First native answer', 'Second native answer'].map((text, i) => ({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'message', id: `answer-${i}`, role: 'assistant', content: [{ type: 'output_text', text }] } }));
  fs.writeFileSync(native, records.map(JSON.stringify).join('\n'));
  fs.writeFileSync(path.join(f.root, 'sessions', session.sessionId + '.json'), JSON.stringify({ ...session, path: native }));
  const cases = [
    { replyTo: 'xanswer-0' },
    { replyTo: 'xanswer-0', refer: true, replyQuote: 'native answer' },
    { quotes: [{ id: 'xanswer-0', quote: 'First native' }, { id: 'xanswer-1', refer: true }] },
  ];
  for (const [i, extra] of cases.entries()) {
    const r = await f.api('/api/chat', { ...message, cid: `quote-${i}`, ...extra });
    assert.equal(r.status, 200);
    const input = f.calls.at(-1).args[1].at(-1);
    if (i === 0) assert.match(input, /답장 대상 \[xanswer-0\] 에이전트: First native answer/);
    if (i === 1) {
      assert.match(input, /참고로 붙인 메시지\(답장 아님\) \[xanswer-0\].*"native answer"/);
      assert.doesNotMatch(input, /답장 대상/);
      assert.equal(r.body.replyQuote, extra.replyQuote);
      assert.equal(r.body.refer, true);
    }
    if (i === 2) {
      assert.match(input, /답장 대상 \[xanswer-0\].*"First native"/);
      assert.match(input, /참고로 붙인 메시지\(답장 아님\) \[xanswer-1\] 에이전트: Second native answer/);
      assert.deepEqual(r.body.quotes, extra.quotes);
    }
  }
});

test('Codex reply and reference resolve peer messages displayed from another registered transcript', async t => {
  const f = fixture(t, child => { queueMicrotask(() => child.emit('close', 0)); return child; });
  fs.mkdirSync(path.join(f.root, 'transcript-history'));
  fs.writeFileSync(path.join(f.root, 'sessions/receiver.json'), JSON.stringify({ sessionId: 'receiver', tool: 'codex', path: path.join(f.root, 'missing-native.jsonl') }));
  fs.writeFileSync(path.join(f.root, 'transcript-history/receiver.json'), JSON.stringify({ items: [{ id: 'xpeer', from: 'peer', session: session.sessionId, to: 'receiver', text: 'Peer original', at: new Date().toISOString() }] }));
  for (const refer of [false, true]) {
    await f.api('/api/chat', { ...message, cid: `peer-quote-${refer}`, replyTo: 'xpeer', refer });
    assert.match(f.calls.at(-1).args[1].at(-1), /\[xpeer\] 세션끼리: Peer original/);
  }
});

test('queue acceptance waits for successful CLI completion and never marks read or live', async (t) => {
  const f = fixture(t);
  const posted = f.api('/api/chat', message);
  assert.equal(f.read('chat.json').messages[0].queue.state, 'pending');
  assert.equal(fs.existsSync(path.join(f.root, 'delivered.json')), false);
  f.calls[0].child.emit('exit', 0);
  assert.equal(f.read('chat.json').messages[0].queue.state, 'pending');
  f.calls[0].child.emit('close', 0);
  const response = await posted;
  assert.equal(response.status, 200);
  assert.equal(response.body.queue.state, 'accepted');
  assert.equal(response.body.queue.ok, true);
  const chat = (await f.api('/api/chat')).body;
  assert.deepEqual(chat.delivered, {});
  assert.equal(wasDelivered(chat.messages[0], chat.delivered), false);
  assert.equal((await f.api('/api/sessions')).body.sessions[0].watch.active, true);
  const watch = (await f.api('/api/watch?session=test-thread')).body;
  assert.equal(watch.active, true);
  assert.equal(watch.via, 'queue');
  assert.equal((await f.api('/api/chat', message)).body.id, response.body.id);
  assert.equal(f.calls.length, 1);
});

test('duplicate cid while pending waits for the same queue attempt', async (t) => {
  const f = fixture(t);
  const first = f.api('/api/chat', message);
  const duplicate = f.api('/api/chat', { ...message, text: 'Changed duplicate' });
  assert.equal(f.calls.length, 1);
  f.calls[0].child.emit('close', 0);
  assert.deepEqual(await duplicate, await first);
  assert.equal(f.read('chat.json').messages.length, 1);
});

test('a queue timeout is uncertain, bounded and retry requires duplicate-risk confirmation', async (t) => {
  const f = fixture(t, undefined, { queueTimeoutMs: 30 });
  let killed = false;
  const first = f.api('/api/chat', message);
  f.calls[0].child.kill = () => { killed = true; };
  const timedOut = await first;
  assert.equal(killed, true);
  assert.equal(timedOut.status, 502);
  assert.equal(timedOut.body.queue.state, 'unknown');
  assert.equal(timedOut.body.queue.error, 'queue_timeout');
  assert.equal((await f.api('/api/chat-retry', { id: 1 })).status, 409);
  assert.equal(f.calls.length, 1);
  const retry = f.api('/api/chat-retry', { id: 1, confirmUnknown: true });
  f.calls[0].child.emit('close', 0);
  assert.equal(f.read('chat.json').messages[0].queue.state, 'pending');
  f.calls[1].child.emit('close', 0);
  assert.equal((await retry).body.queue.state, 'accepted');
  assert.equal(f.read('chat.json').messages.length, 1);
});

test('restart preserves an interrupted request as unknown without automatic redelivery', async (t) => {
  const f = fixture(t, undefined, { queueTimeoutMs: 50 });
  const first = f.api('/api/chat', message);
  const originalReceipt = f.read('chat.json').messages[0].queue.receipt;
  const restarted = f.makeHandler();
  assert.equal((await f.api('/api/chat', undefined, restarted)).body.messages[0].queue.state, 'unknown');
  assert.equal((await f.api('/api/chat', message, restarted)).status, 502);
  assert.equal((await f.api('/api/chat-retry', { id: 1 }, restarted)).status, 409);
  const retry = f.api('/api/chat-retry', { id: 1, confirmUnknown: true }, restarted);
  assert.equal(f.calls.length, 2);
  f.calls[1].child.emit('close', 0);
  assert.equal((await retry).body.queue.receipt, originalReceipt);
  f.calls[0].child.emit('close', 4);
  await first;
  assert.equal(f.read('chat.json').messages[0].queue.state, 'accepted');
});

for (const failure of ['throw', 'error', 'nonzero', 'signal']) {
  test(`queue ${failure} failure is durable, deduplicated and explicitly retryable`, async (t) => {
    let attempt = 0;
    const f = fixture(t, (child) => {
      if (++attempt === 1 && failure === 'throw') throw new Error('Synthetic spawn failure');
      return child;
    });
    const first = f.api('/api/chat', message);
    if (failure === 'error') {
      f.calls[0].child.emit('error', new Error('Synthetic spawn failure'));
      f.calls[0].child.emit('close', 0);
    } else if (failure === 'nonzero') f.calls[0].child.emit('close', 7);
    else if (failure === 'signal') f.calls[0].child.emit('close', null, 'SIGTERM');
    const response = await first;
    assert.equal(response.status, 502);
    assert.equal(response.body.queue.ok, false);
    const state = failure === 'signal' ? 'unknown' : 'failed';
    assert.equal(response.body.queue.state, state);
    assert.equal(response.body.queue.error, ['throw', 'error'].includes(failure) ? 'spawn_failed' : failure === 'signal' ? 'queue_interrupted' : 'queue_failed');
    assert.equal(f.read('chat.json').messages[0].queue.state, state);
    // A new handler represents restart; neither GET nor the original cid retries.
    const restarted = f.makeHandler();
    assert.equal((await f.api('/api/chat', undefined, restarted)).body.messages[0].queue.state, state);
    assert.equal((await f.api('/api/chat', message, restarted)).status, 502);
    assert.equal(f.calls.length, 1);
    if (failure === 'signal') assert.equal((await f.api('/api/chat-retry', { id: response.body.id }, restarted)).status, 409);
    const retry = f.api('/api/chat-retry', { id: response.body.id, ...(failure === 'signal' ? { confirmUnknown: true } : {}) }, restarted);
    assert.equal(f.calls.length, 2);
    assert.equal((await f.api('/api/chat-retry', { id: response.body.id }, restarted)).status, 409);
    f.calls[1].child.emit('close', 0);
    const retried = await retry;
    assert.equal(retried.status, 200);
    assert.equal(retried.body.queue.state, 'accepted');
    assert.equal(retried.body.id, response.body.id);
    assert.equal(retried.body.cid, message.cid);
    assert.equal(f.read('chat.json').messages.length, 1);
    assert.equal((await f.api('/api/chat-retry', { id: response.body.id }, restarted)).status, 409);
    assert.equal(fs.existsSync(path.join(f.root, 'delivered.json')), false);
  });
}

test('retry failure returns failure; explicit new-message resend still creates a new message', async (t) => {
  const f = fixture(t);
  const first = f.api('/api/chat', message);
  f.calls[0].child.emit('close', 1);
  await first;
  const retry = f.api('/api/chat-retry', { id: 1 });
  f.calls[1].child.emit('close', 2);
  assert.equal((await retry).status, 502);
  assert.equal(f.read('chat.json').messages[0].queue.code, 2);
  const resend = f.api('/api/chat', { ...message, cid: 'explicit-resend', resendOf: 1, text: 'Check the revised heading' });
  f.calls[2].child.emit('close', 0);
  assert.equal((await resend).body.resendOf, 1);
  assert.equal(f.read('chat.json').messages.length, 2);
  assert.equal(f.read('chat.json').messages[0].queue.state, 'failed');
});

test('queueText exposes completion outcomes to a host onDone wrapper', async (t) => {
  const f = fixture(t);
  const success = f.handler.queueText(session, 'Synthetic completion wakeup');
  assert.equal(typeof success.then, 'function');
  f.calls[0].child.emit('close', 0);
  assert.deepEqual(await success, { ok: true, state: 'accepted', code: 0 });
  const failed = f.handler.queueText(session, 'Synthetic completion wakeup');
  f.calls[1].child.emit('close', 3);
  assert.deepEqual(await failed, { ok: false, state: 'failed', error: 'queue_failed', code: 3, signal: null });
  const [command, args, options] = f.calls[0].args;
  if (process.platform === 'win32') {
    assert.equal(command, process.execPath);
    assert.equal(args[0], f.cli);
    assert.deepEqual(args.slice(1), ['queue', '--thread', session.sessionId, '--message', 'Synthetic completion wakeup']);
    assert.equal(options.windowsHide, true);
  } else assert.equal(command, 'codex');
  assert.notEqual(options.shell, true);
});

test('Windows queue launches the Node CLI directly and preserves actual argv bytes', { skip: process.platform !== 'win32', timeout: 10_000 }, async (t) => {
  const f = fixture(t, (_child, [command, args, options]) => {
    assert.equal(command, process.execPath, 'Only the synthetic Node CLI may execute');
    assert.equal(args[0], f.cli);
    return spawn(command, args, options);
  });
  fs.writeFileSync(f.cli, "require('node:fs').writeFileSync(require('node:path').join(__dirname, 'argv.json'), JSON.stringify(process.argv.slice(2)));\n");
  const text = 'Synthetic "quoted words"\r\n한글 \\path\\ending\\\nLiteral $env:PATH `text` & | < > %PATH%';
  const outcome = await f.handler.queueText(session, text);
  assert.deepEqual(outcome, { ok: true, state: 'accepted', code: 0 });
  const argvFile = path.join(path.dirname(f.cli), 'argv.json');
  const argv = JSON.parse(fs.readFileSync(argvFile, 'utf8'));
  assert.deepEqual(argv.slice(0, -1), ['queue', '--thread', session.sessionId, '--message']);
  assert.deepEqual(Buffer.from(argv.at(-1), 'utf8'), Buffer.from(text, 'utf8'));
  const where = { url: '/synthetic', selector: '#heading', text: 'A "quoted heading"', adjust: { text: { from: text, to: 'Replacement "words"\n한글 \\tail\\' } } };
  const response = await f.api('/api/chat', { ...message, text, where });
  assert.equal(response.status, 200);
  const formatted = JSON.parse(fs.readFileSync(argvFile, 'utf8')).at(-1);
  const expected = `${f.handler.QUEUE_PREFIX}앱 화면] [uifb-receipt:${response.body.queue.receipt}] ${text}\n위치: /synthetic · #heading · "${where.text}"\n바꿔 본 값: 내용 ${where.adjust.text.from} → ${where.adjust.text.to}`;
  assert.deepEqual(Buffer.from(formatted, 'utf8'), Buffer.from(expected, 'utf8'));
});

test('Windows queue respects PATH order and resolves a native executable without a shell', { skip: process.platform !== 'win32' }, async (t) => {
  const f = fixture(t);
  const native = path.join(f.bin, 'codex.exe');
  fs.writeFileSync(native, 'Synthetic executable; never executed');
  const result = f.handler.queueText(session, 'Synthetic request');
  assert.equal(f.calls[0].args[0], native);
  assert.deepEqual(f.calls[0].args[1], ['queue', '--thread', session.sessionId, '--message', 'Synthetic request']);
  f.calls[0].child.emit('close', 0);
  assert.equal((await result).ok, true);
});

test('queue diagnostics classify bounded stderr without exposing prompt or CLI output', async (t) => {
  const f = fixture(t);
  const result = f.handler.queueText(session, 'Synthetic private prompt');
  f.calls[0].child.stderr.write('error: unexpected argument "Synthetic private prompt" token=synthetic-secret');
  f.calls[0].child.emit('close', 2);
  const failed = await result;
  assert.equal(failed.diagnostic, 'invalid_arguments');
  assert.equal(failed.code, 2);
  assert.doesNotMatch(JSON.stringify(failed), /private prompt|synthetic-secret|token=/);
  const unknown = f.handler.queueText(session, 'Synthetic private prompt');
  f.calls[1].child.stderr.write('x'.repeat(8192) + 'synthetic-secret');
  f.calls[1].child.emit('close', 1);
  assert.equal((await unknown).diagnostic, 'cli_error');
});

test('retry uses individual pickup evidence rather than a later session cursor', async (t) => {
  const f = fixture(t);
  const first = f.api('/api/chat', message);
  f.calls[0].child.emit('close', 1);
  await first;
  fs.writeFileSync(path.join(f.root, 'delivered.json'), JSON.stringify({ [session.sessionId]: 10 }));
  const retry = f.api('/api/chat-retry', { id: 1 });
  assert.equal(f.calls.length, 2);
  f.calls[1].child.emit('close', 1);
  assert.equal((await retry).status, 502);
  fs.writeFileSync(path.join(f.root, 'delivered.json'), JSON.stringify({ _at: { 1: new Date().toISOString() } }));
  assert.equal((await f.api('/api/chat-retry', { id: 1 })).status, 409);
  assert.equal(f.calls.length, 2);
});

test('queue completions preserve messages and outcomes written by other requests', async (t) => {
  const f = fixture(t);
  const first = f.api('/api/chat', message);
  const second = f.api('/api/chat', { ...message, text: 'Synthetic second request', cid: 'second-message' });
  const reply = f.handler.addChat({ from: 'agent', text: 'Synthetic reply' });
  assert.equal(reply.id, 3);
  f.calls[1].child.emit('close', 0);
  await second;
  f.calls[0].child.emit('close', 1);
  await first;
  const saved = f.read('chat.json').messages;
  assert.equal(saved.length, 3);
  assert.equal(saved[0].queue.state, 'failed');
  assert.equal(saved[1].queue.state, 'accepted');
  assert.equal(saved[2].text, 'Synthetic reply');
});

test('native per-message receipt persists pickup without acknowledging unrelated messages', async (t) => {
  const f = fixture(t);
  const first = f.api('/api/chat', message);
  f.calls[0].child.emit('close', 0);
  const saved = (await first).body;
  const second = f.api('/api/chat', { ...message, cid: 'second-receipt', text: 'Another synthetic message' });
  f.calls[1].child.emit('close', 0);
  await second;
  const transcript = path.join(f.root, 'native.jsonl');
  const nativeText = `${f.handler.QUEUE_PREFIX}앱 화면] [uifb-receipt:${saved.queue.receipt}] ${message.text}`;
  const at = new Date(Date.now() + 1).toISOString();
  const record = role => JSON.stringify({ timestamp: at, type: 'response_item', payload: { type: 'message', role, content: [{ type: 'input_text', text: nativeText }] } }) + '\n';
  fs.writeFileSync(path.join(f.root, 'sessions', `${session.sessionId}.json`), JSON.stringify({ ...session, path: transcript }));
  fs.writeFileSync(transcript, record('assistant'));
  assert.deepEqual((await f.api('/api/chat')).body.delivered, {});
  fs.appendFileSync(transcript, record('user'));
  const received = (await f.api('/api/chat')).body.delivered;
  assert.equal(received._at[1], at);
  assert.equal(received._at[2], undefined);
  assert.equal(f.read('delivered.json')._at[1], at);
  assert.equal((await f.api('/api/chat-retry', { id: 1, confirmUnknown: true })).status, 409);
});

test('queue ownership prevents legacy read inference and automatic watcher redelivery', () => {
  const old = { ...message, id: 1, at: '2000-01-01T00:00:00Z' };
  const d = { [session.sessionId]: 1 };
  assert.equal(wasDelivered(old, d), true);
  for (const state of ['pending', 'accepted', 'failed']) {
    const queued = { ...old, queue: { state } };
    assert.equal(wasDelivered(queued, d), false);
    assert.deepEqual(pendingFor([queued], session.sessionId, 0, {}), []);
    assert.equal(wasDelivered(queued, { _at: { 1: '2000-01-02T00:00:00Z' } }), true);
  }
  assert.deepEqual(pendingFor([old], session.sessionId, 0, {}), [old]);
});

test('full text adjustments survive chat, draft storage and queue formatting; styles stay bounded', async (t) => {
  const f = fixture(t);
  const from = 'Original paragraph. '.repeat(1000);
  const to = 'Revised paragraph. '.repeat(1000);
  const where = { selector: '#heading', adjust: { text: { from, to }, fontFamily: { from: 'a'.repeat(150), to: 'b'.repeat(150) } } };
  const sent = f.api('/api/chat', { ...message, where });
  const queuedText = f.calls[0].args[1].at(-1);
  assert.ok(queuedText.includes(from) && queuedText.includes(to));
  f.calls[0].child.emit('close', 0);
  const entry = (await sent).body;
  assert.deepEqual(entry.where.adjust.text, { from, to });
  assert.equal(entry.where.adjust.fontFamily.to.length, 120);
  assert.ok(formatMessage(entry, [entry]).join('\n').includes(to));
  await f.api('/api/drafts', { action: 'add', to: session.sessionId, text: 'Synthetic draft', where });
  const draft = (await f.api('/api/drafts')).body.drafts[0];
  assert.deepEqual(draft.where.adjust.text, { from, to });
  const batch = f.api('/api/chat', { ...message, cid: 'draft-message', draft: { label: 'Test', items: [draft] } });
  f.calls[1].child.emit('close', 0);
  assert.deepEqual((await batch).body.draft.items[0].where.adjust.text, { from, to });
});

test('Claude and noQueue callers keep synchronous addChat behavior without spawning', async (t) => {
  const f = fixture(t);
  const entry = f.handler.addChat({ ...message, noQueue: true });
  assert.equal(entry.id, 1);
  assert.equal(entry.queue, undefined);
  fs.writeFileSync(path.join(f.root, 'sessions', `${session.sessionId}.json`), JSON.stringify({ ...session, tool: 'claude' }));
  const claude = (await f.api('/api/chat', { ...message, cid: 'claude-message' })).body;
  assert.equal(claude.queue, undefined);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(pendingFor([claude], session.sessionId, 0, {}), [claude]);
});

test('standalone adapter injected shutdown joins real HTTP and child close, not Windows console delivery', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-chat-adapter-'));
  const entry = new URL('../scripts/chat-server.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import http from 'node:http';
    const entry=process.argv[1], root=process.argv[2], create=http.createServer;
    http.createServer=(...args)=>{const server=create(...args);
      server.once('listening',()=>process.send({event:'listening',port:server.address().port}));
      server.once('close',()=>{process.send({event:'server-closed'});process.disconnect();});return server;};
    process.on('message',message=>{if(message==='stop')process.emit('SIGTERM');});
    process.argv=[process.execPath,entry,'--dir',root,'--port','0'];
    try{await import(entry);}catch(error){process.send({event:'fixture-error',code:error.code||'import_failed'});process.exitCode=1;process.disconnect();}
  `, entry, root], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.resume(); child.stderr.resume();
  let serverClosed = false;
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  t.after(async () => {
    if (child.connected) child.send('stop');
    await closed; fs.rmSync(root, { recursive: true, force: true });
  });
  const ready = await new Promise((resolve, reject) => {
    child.on('message', message => {
      if (message.event === 'server-closed') serverClosed = true;
      if (message.event === 'listening') resolve(message);
      if (message.event === 'fixture-error') reject(new Error(message.code));
    });
    child.once('error', reject); child.once('close', () => reject(new Error('Adapter closed before listening')));
  });
  const response = await fetch(`http://127.0.0.1:${ready.port}/api/sessions`);
  assert.equal(response.status, 200); await response.json();
  child.send('stop');
  assert.deepEqual(await closed, { code: 0, signal: null });
  assert.equal(serverClosed, true);
  await assert.rejects(fetch(`http://127.0.0.1:${ready.port}/api/sessions`));
});
