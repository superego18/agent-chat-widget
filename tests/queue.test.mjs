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

// Exercise the HTTP handler without sockets, CLI processes, hooks or real sessions.
function fixture(t, spawnImpl, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-queue-test-'));
  t.after(() => {
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
  t.mock.method(fs, 'watch', () => ({}));
  const makeHandler = () => createChatHandler({ root, queueSpawn, ...extra });
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
