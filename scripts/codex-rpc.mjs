import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// One owner belongs to one handler. An observation timeout never releases it.
export function createRpcCleanupOwner() {
  const records = new Map();
  let stopping = false, shutdownPromise;
  return {
    open(abort) {
      if (stopping) throw new Error('connection_lost');
      const id = randomUUID(), resources = [], errors = [];
      let sealed = false, cleaning = false, resolveClosed;
      const closed = new Promise(resolve => { resolveClosed = resolve; });
      const complete = () => {
        if (sealed && resources.every(r => r.closed)) { records.delete(id); resolveClosed(); }
      };
      const record = {
        id, startedAt: new Date().toISOString(), resources, errors, abort, closed,
        track(kind, resource, dispose) {
          const row = { kind, dispose, closed: false, pid: kind === 'child' ? resource.pid ?? null : null };
          const markClosed = () => { row.closed = true; complete(); };
          if (resource.addEventListener) resource.addEventListener('close', markClosed, { once: true });
          else resource.once('close', markClosed);
          resources.push(row);
          return markClosed;
        },
        cleanup() {
          if (cleaning) return;
          cleaning = true;
          for (const row of resources) if (!row.closed) {
            try { row.dispose(); } catch { errors.push(`${row.kind}:cleanup_error`); }
          }
        },
        seal() { sealed = true; complete(); },
        async observe(ms) {
          let timer;
          try { await Promise.race([closed, new Promise(resolve => { timer = setTimeout(resolve, ms); })]); }
          finally { clearTimeout(timer); }
        },
      };
      records.set(id, record);
      return record;
    },
    snapshot() {
      return [...records.values()].map(r => ({ id: r.id, startedAt: r.startedAt, errors: [...r.errors],
        resources: r.resources.map(x => ({ kind: x.kind, pid: x.pid, closed: x.closed })) }));
    },
    shutdown() {
      if (shutdownPromise) return shutdownPromise;
      stopping = true;
      const pending = [...records.values()];
      shutdownPromise = Promise.all(pending.map(r => r.closed)).then(() => undefined);
      for (const r of pending) { r.abort(); r.cleanup(); }
      return shutdownPromise;
    },
  };
}

// The proxy carries raw WebSocket bytes over stdio, not JSONL.
export async function withCodexRpc(command, operation, { spawnImpl = spawn, timeoutMs = 15000,
  cleanupObservationMs = 5000, cleanupOwner = createRpcCleanupOwner(), signal } = {}) {
  const enteredAt = Date.now();
  if (!command || typeof WebSocket !== 'function') throw new Error('rpc_unavailable');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(cleanupObservationMs) || cleanupObservationMs < 0) throw new Error('rpc_invalid_deadline');
  let child, socket, ws, server, sequence = 0, settled = false, aborted = false, rejectAbort;
  const pending = new Map();
  const serverRequests = new Map(), listeners = new Set();
  const incoming = {
    requests: serverRequests,
    listen(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    respond(id, result) {
      if (aborted || !serverRequests.has(id)) throw new Error('request_not_pending');
      ws.send(JSON.stringify({ id, result }));
    },
  };
  const interruption = new Promise((_, reject) => { rejectAbort = reject; });
  const lost = () => {
    if (settled || aborted) return;
    aborted = true;
    const error = new Error('connection_lost');
    rejectAbort(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  const record = cleanupOwner.open(lost);
  const timer = setTimeout(lost, Math.max(0, enteredAt + Math.min(timeoutMs, 15000) - Date.now()));
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    if (aborted) return reject(new Error('connection_lost'));
    const id = ++sequence; pending.set(id, { resolve, reject });
    try { ws.send(JSON.stringify({ id, method, params })); }
    catch (error) { pending.delete(id); reject(error); }
  });
  signal?.addEventListener('abort', lost, { once: true });
  if (signal?.aborted) lost();
  const run = async () => {
    if (aborted) throw new Error('connection_lost');
    child = spawnImpl(command.file, [...command.prefix, 'app-server', 'proxy'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    record.track('child', child, () => {
      for (const stream of [child.stdin, child.stdout, child.stderr]) { try { stream?.destroy(); } catch {} }
      child.kill();
    });
    child.on('error', lost); child.on('close', lost); child.stderr?.resume();
    child.stdin.on('error', lost); child.stdout.on('error', lost);
    const token = randomUUID();
    server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
    const serverClosed = record.track('server', server, () => server.close(error => {
      // No listening handle exists if listen failed before binding.
      if (error?.code === 'ERR_SERVER_NOT_RUNNING' && !server.listening) serverClosed();
    }));
    server.on('error', lost);
    server.on('upgrade', (req, connection, head) => {
      if (aborted || socket || req.url !== `/${token}` || req.headers.origin) { connection.destroy(); return; }
      socket = connection;
      record.track('socket', socket, () => socket.destroy());
      server.close();
      socket.on('error', lost); child.stdout.pipe(socket);
      const headers = req.rawHeaders.reduce((lines, value, i, all) => i % 2 ? lines : lines + `${value}: ${all[i + 1]}\r\n`, '');
      child.stdin.write(`GET / HTTP/1.1\r\n${headers}\r\n`);
      if (head.length) child.stdin.write(head);
      socket.pipe(child.stdin);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    if (aborted) throw new Error('connection_lost');
    await new Promise((resolve, reject) => {
      ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/${token}`);
      record.track('websocket', ws, () => ws.close());
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => { lost(); reject(new Error('connection_lost')); }, { once: true });
      ws.addEventListener('close', lost);
      ws.addEventListener('message', event => {
        let message; try { message = JSON.parse(event.data); } catch { return; }
        if (Object.hasOwn(message, 'method')) {
          if (Object.hasOwn(message, 'id')) serverRequests.set(message.id, message);
          if (message.method === 'serverRequest/resolved') serverRequests.delete(message.params?.requestId);
          for (const fn of listeners) fn(message);
          return;
        }
        if (Object.hasOwn(message, 'method') || (!Object.hasOwn(message, 'result') && !Object.hasOwn(message, 'error'))) return;
        const request = pending.get(message.id); if (!request) return;
        pending.delete(message.id);
        if (message.error) { const error = new Error('rpc_rejected'); error.rpc = true; request.reject(error); }
        else request.resolve(message.result);
      });
    });
    await call('initialize', { clientInfo: { name: 'ui_feedback_widget', version: '1.0.0' }, capabilities: { experimentalApi: true } });
    ws.send(JSON.stringify({ method: 'initialized' }));
    return operation(call, incoming);
  };
  try { return await Promise.race([run(), interruption]); }
  finally {
    settled = true;
    clearTimeout(timer); signal?.removeEventListener('abort', lost);
    record.seal(); record.cleanup();
    await record.observe(Math.min(cleanupObservationMs, 5000));
  }
}
