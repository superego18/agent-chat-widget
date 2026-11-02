import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Inject process events rather than claiming Windows console-signal delivery.
// Copy into the widget tests directory before running this regression.
test('standalone shutdown retains duplicate signal listeners until the real owned queue child closes', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-duplicate-signal-'));
  const bin = path.join(root, 'fixture-bin');
  fs.mkdirSync(bin);
  // This marker is only resolved, never executed: the child fixture intercepts spawn.
  fs.writeFileSync(path.join(bin, 'codex.exe'), 'synthetic executable marker');
  fs.mkdirSync(path.join(root, 'sessions'));
  const sessionId = 'aaaaaaaa-0000-4000-8000-000000000001';
  fs.writeFileSync(path.join(root, 'sessions', `${sessionId}.json`), JSON.stringify({ sessionId, tool: 'codex', name: 'Synthetic queue' }));
  const entry = new URL('../scripts/chat-server.mjs', import.meta.url).href;
  const script = String.raw`
    import http from 'node:http';
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import path from 'node:path';
    const entry=process.argv[1], root=process.argv[2], create=http.createServer, spawn=childProcess.spawn;
    let queueChild, serverClosed=false, queueClosed=true, kills=0;
    const report=message=>process.send?.(message);
    const finish=()=>{if(serverClosed&&queueClosed&&process.connected)process.disconnect();};
    process.env.PATH=path.join(root,'fixture-bin')+path.delimiter+(process.env.PATH||'');
    childProcess.spawn=(file,args,options)=>{
      if(!args.includes('queue'))throw new Error('Unexpected fixture spawn');
      queueClosed=false;
      queueChild=spawn(process.execPath,['-e',
        "const timer=setInterval(()=>{},1000);process.on('message',message=>{if(message==='release'){clearInterval(timer);process.disconnect();}});process.send('ready');"
      ],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
      // Hold the actual child open after disposal is requested; release is explicit.
      queueChild.kill=()=>{kills++;report({event:'queue-stop-requested',kills,pid:queueChild.pid});return true;};
      queueChild.once('message',()=>report({event:'queue-ready',pid:queueChild.pid}));
      queueChild.once('close',(code,signal)=>{queueClosed=true;report({event:'queue-closed',code,signal,kills});finish();});
      return queueChild;
    };
    syncBuiltinESMExports();
    http.createServer=(...args)=>{const server=create(...args);
      server.once('listening',()=>report({event:'listening',port:server.address().port}));
      server.once('close',()=>{serverClosed=true;report({event:'server-closed'});finish();});return server;};
    process.on('message',message=>{
      if(message==='stop'){
        process.emit('SIGTERM');
        report({event:'signal-observed',listeners:process.listenerCount('SIGTERM'),queueClosed,kills});
      }
      if(message==='release')queueChild?.send('release');
    });
    process.argv=[process.execPath,entry,'--dir',root,'--port','0'];
    await import(entry);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, entry, root],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.resume(); child.stderr.resume();
  const events = [], waiters = new Set();
  let sequence = 0;
  const onEvent = message => {
    const event = { ...message, sequence: ++sequence }; events.push(event);
    for (const waiter of [...waiters]) if (waiter.match(event)) { waiters.delete(waiter); waiter.resolve(event); }
  };
  child.on('message', onEvent);
  const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  const wait = (eventName, after = 0) => {
    const match = event => event.event === eventName && event.sequence > after;
    const existing = events.find(match); if (existing) return Promise.resolve(existing);
    return Promise.race([
      new Promise(resolve => waiters.add({ match, resolve })),
      closed.then(() => { throw new Error(`Fixture closed before ${eventName}`); }),
    ]);
  };
  t.after(async () => {
    if (child.connected) { child.send('stop'); child.send('release'); }
    await closed;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const ready = await wait('listening');
  const response = await fetch(`http://127.0.0.1:${ready.port}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'user', to: sessionId, text: 'Synthetic held queue input', ack: 'stored' }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).queue.state, 'pending');
  const owned = await wait('queue-ready'); assert.ok(owned.pid > 0);
  child.send('stop');
  const first = await wait('signal-observed');
  assert.equal(first.queueClosed, false); assert.equal(first.kills, 1);
  child.send('stop');
  const second = await wait('signal-observed', first.sequence);
  // Run every critical assertion after release, so a failure cannot strand a child.
  const held = { exitCode: child.exitCode, signalCode: child.signalCode };
  child.send('release');
  const queueClose = await wait('queue-closed');
  const result = await closed;
  assert.equal(first.listeners, 1, 'first signal must retain the idempotent shutdown listener');
  assert.equal(second.listeners, 1, 'second signal must retain the same listener while shutdown is pending');
  assert.equal(second.queueClosed, false, 'issued shutdown cannot certify an open child as closed');
  assert.equal(second.kills, 1, 'duplicate shutdown cannot issue duplicate disposal');
  assert.deepEqual(held, { exitCode: null, signalCode: null });
  assert.deepEqual({ code: queueClose.code, signal: queueClose.signal }, { code: 0, signal: null });
  assert.ok(events.some(event => event.event === 'server-closed'));
  assert.deepEqual(result, { code: 0, signal: null });
});
