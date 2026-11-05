import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCodexControlReader } from '../scripts/codex-control.mjs';

test('control availability requires a live loaded-thread observation and recovers without sending', async () => {
  let at = 0, calls = 0, fail = true;
  const reader = createCodexControlReader({ now: () => at, read: async () => {
    calls++; if (fail) throw new Error('connection_lost'); return ['own'];
  } });
  assert.equal(reader.snapshot('own').state, 'checking');
  await reader.settled();
  assert.equal(reader.snapshot('own').available, false);
  assert.equal(reader.snapshot('own').state, 'disconnected');
  assert.equal(calls, 1, 'polling reuses the bounded observation');
  fail = false; at = 30001;
  assert.equal(reader.snapshot('own').available, false, 'stale observations never enable a control');
  await reader.settled();
  assert.equal(reader.snapshot('own').available, true);
  assert.equal(reader.snapshot('other').state, 'not_loaded');
  await reader.shutdown(); at += 30001;
  assert.equal(reader.snapshot('own').available, false);
  assert.equal(calls, 2, 'shutdown never starts a new observation');
});

test('slow observations do not block snapshots, overlap or survive shutdown unjoined', async () => {
  let resolve, calls = 0;
  const reader = createCodexControlReader({ read: () => { calls++; return new Promise(r => { resolve = r; }); } });
  reader.snapshot('own'); await Promise.resolve();
  for (let i = 0; i < 10; i++) assert.equal(reader.snapshot('own').available, false);
  assert.equal(calls, 1);
  let closed = false;
  const closing = reader.shutdown().then(() => { closed = true; });
  await Promise.resolve(); assert.equal(closed, false);
  resolve(['own']); await closing;
  assert.equal(reader.snapshot('own').available, false);
});
