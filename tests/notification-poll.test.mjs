import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createChatHandler } from '../scripts/chat-handler.mjs';

for (const oversized of [false, true]) test(`answer/status polling is not capped by receipt registration budgets (oversized=${oversized})`, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-notification-'));
  fs.mkdirSync(path.join(root, 'sessions'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (let n = 0; n < 64; n++) fs.writeFileSync(path.join(root, 'sessions', `${String(n).padStart(3, '0')}.json`), JSON.stringify({ sessionId: `other-${n}`, tool: 'claude' }));
  const session = 'zz-last', native = path.join(root, 'native.jsonl');
  fs.writeFileSync(path.join(root, 'sessions', session + '.json'), JSON.stringify({ sessionId: session, tool: 'codex', name: 'Synthetic last actor', path: native, ...(oversized ? { metadata: 'x'.repeat(9000) } : {}) }));
  const append = payload => fs.appendFileSync(native, JSON.stringify({ timestamp: new Date().toISOString(), ...payload }) + '\n');
  append({ type: 'event_msg', payload: { type: 'task_started' } });
  const logs = [];
  t.mock.method(console, 'log', (...args) => logs.push(args.join(' ')));
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const handler = createChatHandler({ root });
  t.after(() => handler.shutdown());
  t.mock.timers.tick(2000); // Baseline: no historical answer notification.
  assert.equal(logs.filter(line => line.includes('answer \u2192')).length, 0);
  append({ type: 'response_item', payload: { id: 'fresh-final', type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Synthetic final answer while working' }] } });
  t.mock.timers.tick(2000);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'status-' + session + '.json'))).state, 'working');
  assert.equal(logs.filter(line => line.includes('answer \u2192')).length, 1);
  t.mock.timers.tick(2000);
  assert.equal(logs.filter(line => line.includes('answer \u2192')).length, 1, 'unchanged history cannot notify twice');
  append({ type: 'event_msg', payload: { type: 'task_complete' } });
  t.mock.timers.tick(2000);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'status-' + session + '.json'))).state, 'idle');
  t.mock.timers.tick(4000);
  assert.equal(logs.filter(line => line.includes('answer \u2192')).length, 1, 'completion cannot repeat the final answer');
  const req = new EventEmitter(); req.method = 'GET'; let transcript;
  handler.handle(req, { writeHead(status) { assert.equal(status, 200); }, end(body) { transcript = JSON.parse(body); } }, new URL('/api/transcript?session=' + session, 'http://fixture.invalid'));
  assert.ok(transcript.items.some(item => item.text === 'Synthetic final answer while working'));
});
