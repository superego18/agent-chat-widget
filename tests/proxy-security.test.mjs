// Isolated regression tests of optional proxy security flags.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';


const proxyScript = fileURLToPath(new URL('../scripts/app-proxy.mjs', import.meta.url));
async function listen(server, port) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server.address().port;
}
async function proxyFixture(t, flags, lan = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-proxy-security-'));
  const upstream = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/html' ? 'text/html' : 'application/json');
    if (req.url === '/html') return res.end('<body>Original app</body>');
    req.resume(); req.once('end', () => res.end(JSON.stringify({ method: req.method, origin: req.headers.origin, path: req.url })));
  });
  const upstreamPort = await listen(upstream, 0);
  const reserve = http.createServer();
  const port = await listen(reserve, 0);
  await new Promise(resolve => reserve.close(resolve));
  const child = spawn(process.execPath, [proxyScript,
    '--app', `http://127.0.0.1:${upstreamPort}`, '--review', `http://127.0.0.1:${upstreamPort}`,
    '--port', String(port), '--dir', root, ...(lan ? ['--lan'] : []), ...flags], {
    env: { ...process.env, CODEX_HOME: root }, windowsHide: true, stdio: 'ignore',
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; }
    upstream.closeAllConnections?.();
    await new Promise(resolve => upstream.close(resolve));
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('widget-proxy-security-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let n = 0; n < 80; n++) {
    try { if ((await fetch(base + '/__uifb/widget.js')).ok) return { base, root, upstreamPort }; } catch {}
    if (child.exitCode !== null) throw new Error('Isolated proxy exited');
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error('Isolated proxy did not become ready');
}

test('strict-origin validates before rewrite; loopback with LAN auth denies unauthenticated Serve traffic', async t => {
  const f = await proxyFixture(t, ['--loopback', '--strict-origin']);
  const write = origin => ({ method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: '{}' });
  assert.equal((await fetch(f.base + '/__uifb/api/compose', write())).status, 403);
  assert.equal((await fetch(f.base + '/__uifb/api/compose', write('https://other.test'))).status, 403);
  const accepted = await fetch(f.base + '/__uifb/api/compose', write(f.base));
  assert.equal(accepted.status, 200);
  const forwarded = await accepted.json();
  assert.equal(forwarded.path, '/api/compose');
  assert.equal(forwarded.origin, `http://127.0.0.1:${f.upstreamPort}`);
  assert.match(await (await fetch(f.base + '/html')).text(), /__uifb\/widget.js/);
  const remoteHeaders = { 'x-forwarded-for': '100.64.0.2', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'owner.ts.net' };
  assert.equal((await fetch(f.base + '/html', { headers: remoteHeaders })).status, 401);
  const cookie = `uifb_k=${fs.readFileSync(path.join(f.root, 'lan-key'), 'utf8').trim()}`;
  const remoteWrite = write('https://owner.ts.net');
  Object.assign(remoteWrite.headers, remoteHeaders, { cookie });
  assert.equal((await fetch(f.base + '/__uifb/api/compose', remoteWrite)).status, 200);
  const address = Object.values(os.networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && !a.internal)?.address;
  if (address) await assert.rejects(fetch(`http://${address}:${new URL(f.base).port}/html`, { signal: AbortSignal.timeout(600) }));
});

test('without new flags, original proxy default write behavior is unchanged', async t => {
  const f = await proxyFixture(t, []);
  assert.equal((await fetch(f.base + '/__uifb/api/compose', { method: 'POST', body: '{}' })).status, 200);
  assert.equal((await fetch(f.base + '/__uifb/api/compose', { method: 'POST', headers: { origin: 'https://legacy.test' }, body: '{}' })).status, 200);
});

test('loopback local-only proxy rejects retained Serve mappings for app and widget paths', async t => {
  const f = await proxyFixture(t, ['--loopback', '--strict-origin'], false);
  for (const pathname of ['/html', '/__uifb/widget.js', '/__uifb/api/sessions']) {
    assert.equal((await fetch(f.base + pathname)).status, 200);
    for (const header of ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'tailscale-user-login']) {
      assert.equal((await fetch(f.base + pathname, { headers: { [header]: 'remote' } })).status, 401);
    }
  }
});
