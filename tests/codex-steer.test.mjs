import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Duplex, Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import bundle from 'playwright-core/lib/utilsBundle';
import { steerCodex, queueCodexImages } from '../scripts/codex-steer.mjs';
import { cancelCodexQueued } from '../scripts/codex-cancel.mjs';
import { createRpcCleanupOwner, withCodexRpc } from '../scripts/codex-rpc.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const WebSocketServer = bundle.wsServer;
const steerTest = (name, fn) => test(name, { skip: typeof WebSocket !== 'function' && 'Steering requires Node 22+ native WebSocket' }, fn);

function fixture(t, { loaded = ['target'], nextLoaded, turn = { id: 'turn_active', status: 'inProgress' }, steerError, disconnectAt, queuePages = [], deleted = true, collidingRequest = false, question } = {}) {
  const server = new WebSocketServer({ noServer: true }), requests = [], children = [];
  t.after(() => server.close());
  const spawnImpl = (file, args, options) => {
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => { child.stdin.destroy(); child.stdout.destroy(); child.emit('close', 0); }; children.push(child);
    // Feed the production client's HTTP upgrade into an actual WebSocket server.
    let headers = Buffer.alloc(0);
    const socket = Duplex.from({ readable: child.stdin, writable: child.stdout });
    const receiveHeaders = chunk => {
        headers = Buffer.concat([headers, chunk]);
        const end = headers.indexOf('\r\n\r\n'); if (end < 0) return;
        const text = headers.subarray(0, end).toString(), lines = text.split('\r\n'), h = Object.fromEntries(lines.slice(1).map(l => { const i = l.indexOf(':'); return [l.slice(0, i).toLowerCase(), l.slice(i + 1).trim()]; }));
        socket.removeListener('data', receiveHeaders);
        socket.setTimeout = () => {}; socket.setNoDelay = () => {}; socket.setKeepAlive = () => {};
        server.handleUpgrade({ method: 'GET', url: '/', headers: h, httpVersion: '1.1' }, socket, headers.subarray(end + 4), ws => {
          ws.on('error', () => {});
          ws.on('message', data => {
            const r = JSON.parse(data); requests.push(r); if (!r.id) return;
            if (question && Object.hasOwn(r, 'result')) { ws.send(JSON.stringify({ method: 'serverRequest/resolved', params: { threadId: 'target', requestId: r.id } })); return; }
            if (collidingRequest) ws.send(JSON.stringify({ id: r.id, method: 'item/commandExecution/requestApproval', params: {} }));
            if (r.method === disconnectAt) { ws.terminate(); return; }
            let result;
            if (r.method === 'initialize') result = {};
            else if (r.method === 'thread/loaded/list') result = r.params.cursor ? { data: nextLoaded, nextCursor: null } : { data: loaded, nextCursor: nextLoaded ? 'page_two' : null };
            else if (r.method === 'thread/turns/list') result = { data: turn ? [turn] : [] };
            else if (r.method === 'turn/steer') result = { turnId: turn.id };
            else if (r.method === 'thread/queue/list') result = { data: queuePages[r.params.cursor ? 1 : 0] || [], nextCursor: !r.params.cursor && queuePages.length > 1 ? 'next' : null };
            else if (r.method === 'thread/queue/delete') result = { deleted };
            else if (r.method === 'thread/queue/add') result = { queuedSubmission: { id: 'image-queued' } };
            else if (r.method === 'thread/resume' && question) { ws.send(JSON.stringify(question)); result = {}; }
            ws.send(JSON.stringify({ id: r.id, ...(r.method === 'turn/steer' && steerError ? { error: { code: -32600, message: steerError } } : { result }) }));
          });
        });
    };
    socket.on('data', receiveHeaders);
    return child;
  };
  return { requests, children, rpc: fn => withCodexRpc({ file: 'codex', prefix: [] }, fn, { spawnImpl, timeoutMs: 1000 }), images: imagePaths => queueCodexImages({ file: 'codex', prefix: [] }, 'target', 'image prompt', { spawnImpl, timeoutMs: 1000, clientUserMessageId: 'image-receipt', imagePaths }), cancel: receipt => cancelCodexQueued({ file: 'codex', prefix: [] }, 'target', receipt, { spawnImpl, timeoutMs: 1000 }), send: (text = '한글🙂 "quote"\nnext', imagePaths) => steerCodex({ file: 'codex', prefix: [] }, 'target', text, { spawnImpl, timeoutMs: 1000, clientUserMessageId: 'receipt-one', imagePaths }) };
}

steerTest('native question responses use server request IDs and observe matching resolution over real WebSocket framing', async t => {
  const question = { id: 501, method: 'item/tool/requestUserInput', params: { threadId: 'target', itemId: 'call_question' } };
  const f = fixture(t, { question });
  await f.rpc(async (call, incoming) => {
    await call('thread/resume', { threadId: 'target', excludeTurns: true });
    assert.deepEqual(incoming.requests.get(501), question);
    const closed = new Promise(resolve => {
      const stop = incoming.listen(m => { if (m.method === 'serverRequest/resolved' && m.params.requestId === 501) { stop(); resolve(); } });
    });
    incoming.respond(501, { answers: { q1: { answers: ['Selected'] } } });
    await closed;
    assert.equal(incoming.requests.size, 0);
    assert.throws(() => incoming.respond(501, {}), /request_not_pending/);
  });
  assert.deepEqual(f.requests.find(r => Object.hasOwn(r, 'result')), { id: 501, result: { answers: { q1: { answers: ['Selected'] } } } });
  assert(f.children.every(c => c.stdin.destroyed));
});

steerTest('image queue and steer carry localImage input without shell interpolation or text-only fallback', async t => {
  const f = fixture(t), file = 'C:/owned/사진 "one".png';
  assert.equal((await f.images([file])).state, 'accepted');
  assert.deepEqual(f.requests.find(r => r.method === 'thread/queue/add').params.input, [{ type: 'text', text: 'image prompt' }, { type: 'localImage', path: file }]);
  await f.send('image steer', [file]);
  assert.deepEqual(f.requests.find(r => r.method === 'turn/steer').params.input, [{ type: 'text', text: 'image steer' }, { type: 'localImage', path: file }]);
  assert.ok(f.children.every(c => c.stdin.destroyed));
});

steerTest('lost image queue acknowledgement is unknown and never triggers a second submission', async t => {
  const f = fixture(t, { disconnectAt: 'thread/queue/add' });
  assert.equal((await f.images(['/owned/image.png'])).state, 'unknown');
  assert.equal(f.requests.filter(r => r.method === 'thread/queue/add').length, 1);
  assert.ok(!f.requests.some(r => r.method === 'turn/start'));
});

const receipt = '11111111-1111-4111-8111-111111111111';
steerTest('server requests with a colliding ID never resolve client RPC responses', async t => {
  const f = fixture(t, { collidingRequest: true });
  assert.equal((await f.send()).state, 'accepted');
  assert.ok(f.requests.every(r => !Object.hasOwn(r, 'result')), 'client never auto-approves a server request');
});
const queued = { id: 'queued-own', clientUserMessageId: 'cli-generated-id', input: [{ type: 'text', text: `[대화/피드백 · 앱 화면] [uifb-receipt:${receipt}] Request` }] };
steerTest('cancel finds the exact legacy CLI receipt across pages and deletes only that submission', async t => {
  const f = fixture(t, { queuePages: [[{ ...queued, id: 'quoted', input: [{ type: 'text', text: 'Quoted: ' + queued.input[0].text }] }], [queued]] });
  assert.equal((await f.cancel(receipt)).ok, true);
  assert.deepEqual(f.requests.find(r => r.method === 'thread/queue/delete').params, { threadId: 'target', queuedSubmissionId: 'queued-own' });
  assert.ok(!f.requests.some(r => /resume|start|steer|interrupt|add/.test(r.method)));
});
for (const [name, options, state] of [
  ['missing', { queuePages: [[]] }, 'not_pending'],
  ['duplicate receipts', { queuePages: [[queued, { ...queued, id: 'second' }]] }, 'not_pending'],
  ['consumed during delete', { queuePages: [[queued]], deleted: false }, 'not_pending'],
  ['lost before deletion', { disconnectAt: 'thread/queue/list' }, 'failed'],
  ['lost after deletion request', { queuePages: [[queued]], disconnectAt: 'thread/queue/delete' }, 'unknown']
]) steerTest(`cancel never claims success: ${name}`, async t => { const f = fixture(t, options); assert.equal((await f.cancel(receipt)).state, state); });

steerTest('steering addresses only the loaded active turn and preserves exact input', async t => {
  const f = fixture(t), result = await f.send();
  assert.equal(result.state, 'accepted'); assert.equal(result.turnId, 'turn_active'); assert.equal(result.mode, 'steer');
  const request = f.requests.find(r => r.method === 'turn/steer');
  assert.deepEqual(request.params, { threadId: 'target', expectedTurnId: 'turn_active', clientUserMessageId: 'receipt-one', input: [{ type: 'text', text: '한글🙂 "quote"\nnext' }] });
  assert.ok(!f.requests.some(r => /resume|start|interrupt|fork/.test(r.method)));
});

steerTest('steering finds the target on a later loaded-thread page', async t => {
  const f = fixture(t, { loaded: ['another'], nextLoaded: ['target'] });
  assert.equal((await f.send()).state, 'accepted');
  assert.equal(f.requests.filter(r => r.method === 'thread/loaded/list').length, 2);
});

for (const [name, options, state] of [
  ['unloaded thread', { loaded: [] }, 'failed'],
  ['completed turn', { turn: { id: 'old', status: 'completed' } }, 'failed'],
  ['stale turn rejected', { steerError: 'expected turn does not match' }, 'failed'],
  ['connection lost before send', { disconnectAt: 'thread/loaded/list' }, 'failed'],
  ['connection lost after send', { disconnectAt: 'turn/steer' }, 'unknown']
]) steerTest(name, async t => { const f = fixture(t, options), r = await f.send(); assert.equal(r.state, state); assert.ok(!f.requests.some(r => r.method === 'turn/start')); });

steerTest('a proxy stdin EPIPE returns failure without crashing the HTTP server', async () => {
  const child = new EventEmitter();
  child.stdin = new Writable({ write(chunk, encoding, callback) { callback(Object.assign(new Error('proxy stdin closed'), { code: 'EPIPE' })); } });
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => child.emit('close', 1);
  const result = await steerCodex({ file: 'codex', prefix: [] }, 'target', 'text', { spawnImpl: () => child, timeoutMs: 1000 });
  assert.equal(result.state, 'failed'); assert.equal(result.diagnostic, 'connection_lost');
});

// A real disposable child carries real WebSocket bytes. Delaying the fixture's
// kill request is portable; it does not pretend Windows delivers POSIX signals.
async function ownedProxy(t, { delay = 100, cleanupThrows = false, initialize = true } = {}) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const sockets = new Set(), calls = [], children = [];
  let sawInitialize;
  const initialized = new Promise(resolve => { sawInitialize = resolve; });
  server.on('connection', socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket));
    socket.on('message', bytes => {
      const request = JSON.parse(bytes); calls.push(request);
      if (request.method === 'initialize') sawInitialize();
      if (request.id && initialize) socket.send(JSON.stringify({ id: request.id, result: {} }));
    });
  });
  const owner = createRpcCleanupOwner();
  let kills = 0;
  const spawnImpl = () => {
    const child = spawn(process.execPath, ['-e', `const socket=require('node:net').connect(${server.address().port},'127.0.0.1');
      socket.on('error',()=>{});process.stdin.on('error',()=>{});process.stdout.on('error',()=>{});
      process.stdin.pipe(socket);socket.pipe(process.stdout);setInterval(()=>{},1000);`],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const kill = child.kill.bind(child);
    child.kill = () => {
      kills++; setTimeout(() => kill(), delay);
      if (cleanupThrows) throw new Error('private provider text must never enter diagnostics');
      return true;
    };
    children.push(child); return child;
  };
  t.after(async () => {
    await owner.shutdown();
    for (const socket of sockets) socket.close();
    await new Promise(resolve => server.close(resolve));
  });
  return { owner, children, calls, spawnImpl, initialized, kills: () => kills };
}

steerTest('fulfilled provider result survives pending real child cleanup and one shutdown join', async t => {
  const f = await ownedProxy(t), accepted = { ok: true, state: 'accepted', turnId: 'exact-turn' };
  const result = await withCodexRpc({ file: 'disposable', prefix: [] }, () => accepted,
    { spawnImpl: f.spawnImpl, cleanupOwner: f.owner, cleanupObservationMs: 1 });
  assert.strictEqual(result, accepted);
  assert.equal(f.children[0].exitCode, null, 'observation ended before actual child close');
  assert.ok(f.owner.snapshot().some(x => x.resources.some(r => r.kind === 'child' && !r.closed)));
  const first = f.owner.shutdown(); assert.strictEqual(f.owner.shutdown(), first);
  await first;
  assert.ok(f.children[0].exitCode !== null || f.children[0].signalCode !== null, 'actual child close may report a signal instead of a numeric exit'); assert.equal(f.kills(), 1);
  assert.deepEqual(f.owner.snapshot(), []);
});

steerTest('secondary cleanup failure cannot replace delete acceptance or primary rejection', async t => {
  const f = await ownedProxy(t, { cleanupThrows: true });
  const deleted = { ok: true, queuedSubmissionId: 'exact-queued-id' };
  assert.strictEqual(await withCodexRpc({ file: 'disposable', prefix: [] }, () => deleted,
    { spawnImpl: f.spawnImpl, cleanupOwner: f.owner, cleanupObservationMs: 0 }), deleted);
  assert.ok(f.owner.snapshot().some(x => x.errors.includes('child:cleanup_error')));
  assert.doesNotMatch(JSON.stringify(f.owner.snapshot()), /private provider text/);
  const rejected = Object.assign(new Error('exact rejection'), { rpc: true });
  await assert.rejects(withCodexRpc({ file: 'disposable', prefix: [] }, () => { throw rejected; },
    { spawnImpl: f.spawnImpl, cleanupOwner: f.owner, cleanupObservationMs: 0 }), error => error === rejected);
  await f.owner.shutdown(); assert.equal(f.children.length, 2); assert.equal(f.kills(), 2);
});

steerTest('one operation deadline covers initialization; abort joins real resources without retry', async t => {
  const f = await ownedProxy(t, { initialize: false });
  let operations = 0;
  await assert.rejects(withCodexRpc({ file: 'disposable', prefix: [] }, () => { operations++; },
    { spawnImpl: f.spawnImpl, cleanupOwner: f.owner, timeoutMs: 50, cleanupObservationMs: 0 }), /connection_lost/);
  assert.equal(operations, 0); assert.equal(f.children.length, 1);
  await f.owner.shutdown(); assert.deepEqual(f.owner.snapshot(), []);
  let spawned = false;
  await assert.rejects(withCodexRpc({ file: 'disposable', prefix: [] }, () => {},
    { cleanupOwner: f.owner, spawnImpl: () => { spawned = true; } }), /connection_lost/);
  assert.equal(spawned, false);
});

steerTest('real spawn failure and an already aborted call cannot claim a child cleanup', async () => {
  const owner = createRpcCleanupOwner();
  await assert.rejects(withCodexRpc({ file: '__uifb_absent_executable__', prefix: [] }, () => {},
    { cleanupOwner: owner, timeoutMs: 100, cleanupObservationMs: 1 }), /connection_lost/);
  await owner.shutdown(); assert.deepEqual(owner.snapshot(), []);
  const signal = new AbortController(); signal.abort(); let spawned = false;
  await assert.rejects(withCodexRpc({ file: 'unused', prefix: [] }, () => {},
    { signal: signal.signal, spawnImpl: () => { spawned = true; } }), /connection_lost/);
  assert.equal(spawned, false);
});

steerTest('abort after real initialization traffic retains ownership until actual child close', async t => {
  const f = await ownedProxy(t, { initialize: false }), controller = new AbortController();
  const pending = withCodexRpc({ file: 'disposable', prefix: [] }, () => assert.fail('operation must not run'),
    { spawnImpl: f.spawnImpl, cleanupOwner: f.owner, signal: controller.signal, timeoutMs: 1000, cleanupObservationMs: 0 });
  const failure = assert.rejects(pending, /connection_lost/);
  await Promise.race([f.initialized, failure.then(() => { throw new Error('Fixture failed before initialize traffic'); })]);
  controller.abort(); await failure;
  assert.equal(f.children.length, 1);
  await f.owner.shutdown(); assert.deepEqual(f.owner.snapshot(), []);
});
