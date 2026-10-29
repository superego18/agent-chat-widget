import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/register-session.mjs', import.meta.url));
const oldId = '11111111-1111-4111-8111-111111111111';
const newId = '22222222-2222-4222-8222-222222222222';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-replacement-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'codex');
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(root, 'sessions'));
  const marker = `replacement-${path.basename(root)}`;
  const rollout = path.join(home, 'sessions', `rollout-${newId}.jsonl`);
  fs.writeFileSync(rollout, JSON.stringify({ marker }) + '\n');
  const write = (file, data) => fs.writeFileSync(path.join(root, file), JSON.stringify(data));
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  write(`sessions/${oldId}.json`, { name: 'Product', tool: 'claude', sessionId: oldId, path: '/never-touch-original.jsonl' });
  const run = () => spawnSync(process.execPath, [script, '--dir', root, '--name', 'Product', '--tool', 'codex', '--marker', marker], { env: { ...process.env, CODEX_HOME: home }, encoding: 'utf8' });
  return { root, write, read, run };
}

test('same-name replacement preserves chat, drafts, references and preferences with a backup', t => {
  const f = fixture(t);
  const queue = { state: 'unknown', receipt: 'do-not-resend' };
  f.write('chat.json', { messages: [{ id: 7, from: 'user', to: oldId, text: oldId, replyTo: 3, queue }, { id: 8, from: 'agent', session: oldId, text: 'answer' }] });
  f.write('drafts.json', { nextId: 3, drafts: [{ id: 1, to: oldId, text: 'draft', hold: true }], trash: [{ id: 2, to: oldId, text: 'trash' }] });
  f.write('prefs.json', { tab: oldId, draftLabels: { [oldId]: 'Photos' }, pos: { [oldId]: '7@32', [newId]: 'bottom' } });
  f.write('delivered.json', { [oldId]: 8, _at: { 7: '2026-10-29T00:00:00Z' } });
  const before = fs.readFileSync(path.join(f.root, 'chat.json'), 'utf8');
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.read('chat.json').messages[0].to, newId);
  assert.equal(f.read('chat.json').messages[0].text, oldId, 'message body is not rewritten');
  assert.deepEqual(f.read('chat.json').messages[0].queue, queue);
  assert.equal(f.read('chat.json').messages[0].replyTo, 3);
  assert.equal(f.read('chat.json').messages[1].session, newId);
  assert.equal(f.read('drafts.json').drafts[0].to, newId);
  assert.equal(f.read('drafts.json').trash[0].to, newId);
  assert.equal(f.read('prefs.json').draftLabels[newId], 'Photos');
  assert.equal(f.read('prefs.json').pos[newId], 'bottom', 'current position wins');
  assert.equal(f.read('prefs.json').tab, newId);
  assert.equal(f.read('delivered.json')._at[7], '2026-10-29T00:00:00Z');
  const backups = fs.readdirSync(path.join(f.root, 'session-migrations'));
  assert.equal(fs.readFileSync(path.join(f.root, 'session-migrations', backups[0], 'chat.json'), 'utf8'), before);
  assert.ok(fs.existsSync(path.join(f.root, 'sessions', `${newId}.json`)));
});

test('invalid state aborts replacement before changing files or removing the old registration', t => {
  const f = fixture(t);
  f.write('chat.json', { messages: [{ id: 1, to: oldId, text: 'keep' }] });
  fs.writeFileSync(path.join(f.root, 'drafts.json'), '{broken');
  const before = fs.readFileSync(path.join(f.root, 'chat.json'), 'utf8');
  assert.notEqual(f.run().status, 0);
  assert.equal(fs.readFileSync(path.join(f.root, 'chat.json'), 'utf8'), before);
  assert.ok(fs.existsSync(path.join(f.root, 'sessions', `${oldId}.json`)));
});
