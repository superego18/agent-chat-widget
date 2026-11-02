import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { B, makeDir, startServer, sleep } from './helpers.mjs';

test('native turn start remains stable when unrelated tool records update the rollout', async () => {
  const root = makeDir(), file = path.join(root, 'native.jsonl');
  const startedAt = new Date(Date.now() - 7 * 60_000).toISOString();
  fs.writeFileSync(file, JSON.stringify({ timestamp: startedAt, type: 'event_msg', payload: { type: 'task_started' } }) + '\n');
  const sessionFile = path.join(root, 'sessions', B + '.json');
  fs.writeFileSync(sessionFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(sessionFile)), tool: 'codex', path: file }));
  const server = await startServer(root);
  const status = async () => (await server.api('/api/sessions')).sessions.find(s => s.id === B).status;
  try {
    let before;
    for (let n = 0; n < 60; n++) { before = await status(); if (before.state === 'working') break; await sleep(50); }
    assert.equal(before.startedAt, startedAt);
    fs.appendFileSync(file, JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'function_call', name: 'exec_command' } }) + '\n');
    let after;
    for (let n = 0; n < 60; n++) { after = await status(); if (after.at !== before.at) break; await sleep(50); }
    assert.notEqual(after.at, before.at);
    assert.equal(after.startedAt, startedAt);
  } finally { server.stop(); }
});
