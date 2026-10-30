import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readCodexHistory } from '../scripts/transcript-store.mjs';
import { nextOrcaBinding } from '../scripts/codex-peers.mjs';

function fixture(t, { previousTerminals = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-delivery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'sessions'));
  const source = { sessionId: 'source', name: 'Source', tool: 'codex', path: path.join(root, 'source.jsonl') };
  const target = { ...source, sessionId: 'target', name: 'Target', path: path.join(root, 'target.jsonl'), orca: { terminal: 'term_new', previousTerminals } };
  for (const s of [source, target]) fs.writeFileSync(path.join(root, 'sessions', s.sessionId + '.json'), JSON.stringify(s));
  const at = seconds => new Date(Date.parse('2026-10-30T00:00:00Z') + seconds * 1000).toISOString();
  const send = (literal, seconds, { accepted = true, terminal = 'term_new', sender = source } = {}) => {
    const cmd = `orca terminal send --terminal ${terminal} --text ${literal} --enter --json`;
    const records = [{ timestamp: at(seconds), type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd }) } }];
    if (accepted) records.push({ timestamp: at(seconds + 1), type: 'event_msg', payload: { type: 'item_completed', item: {
      type: 'CommandExecution', command: ['powershell.exe', '-Command', cmd], exit_code: 0, started_at_ms: Date.parse(at(seconds)),
      aggregated_output: JSON.stringify({ ok: true, result: { send: { accepted: true, handle: terminal, prompt: { requestId: `${sender.sessionId}-${seconds}` } } } })
    } } });
    fs.appendFileSync(sender.path, records.map(JSON.stringify).join('\n') + '\n');
  };
  const receive = (id, text, seconds) => fs.appendFileSync(target.path, JSON.stringify({ timestamp: at(seconds), type: 'response_item', payload: { id, type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }) + '\n');
  return { root, source, target, send, receive, read: () => readCodexHistory(root, target).items };
}

test('accepted delayed sends can cover one combined input, without changing text or IDs', t => {
  const f = fixture(t);
  f.send("'First report'", 0);
  f.send('"`n`nSecond report"', 3500);
  f.receive('combined', 'First report\nSecond report', 3501);
  f.receive('repeat', 'First report\nSecond report', 3502);
  const items = f.read();
  assert.deepEqual(items.map(x => x.from), ['peer', 'user']);
  assert.equal(items[0].id, 'xcombined');
  assert.equal(items[0].text, 'First report\nSecond report');
  assert.equal(items[0].peerSends.length, 2);
  assert.equal(f.read()[0].from, 'peer', 'all send evidence persists across re-reading');
});

test('historical handles are valid only before their recorded end time', t => {
  const f = fixture(t, { previousTerminals: [{ terminal: 'term_old', until: '2026-10-30T00:00:20Z' }] });
  f.send("'Before replacement'", 0, { terminal: 'term_old' });
  f.send("'After replacement'", 30, { terminal: 'term_old' });
  f.receive('before', 'Before replacement', 2);
  f.receive('after', 'After replacement', 32);
  assert.deepEqual(f.read().map(x => x.from), ['peer', 'user']);
});

test('re-registering the same session preserves bounded historical handles and omitted binding', () => {
  const old = { terminal: 'term_old' };
  const next = nextOrcaBinding(old, 'term_new', '2026-10-30T00:00:20Z');
  assert.deepEqual(next, { terminal: 'term_new', previousTerminals: [{ terminal: 'term_old', until: '2026-10-30T00:00:20Z' }] });
  assert.deepEqual(nextOrcaBinding(next, '', '2026-10-30T00:01:00Z'), next);
  assert.deepEqual(nextOrcaBinding(next, 'term_new', '2026-10-30T00:01:00Z'), next);
});

test('PowerShell newline, tab and escaped quote literals match native trimmed input', t => {
  const f = fixture(t);
  f.send('"`nHello`t`"world`"`r`nDone`n"', 0);
  f.receive('escapes', 'Hello\t"world"\r\nDone', 2);
  assert.equal(f.read()[0].from, 'peer');
});

test('unconfirmed delays, expired receipts, mixed owner text and arbitrary prefixes stay user messages', t => {
  const f = fixture(t);
  f.send("'Unconfirmed'", 0, { accepted: false });
  f.send("'Expired'", 1);
  f.send("'Confirmed'", 2);
  f.send("'Prefix'", 3);
  f.receive('unconfirmed', 'Unconfirmed', 3500);
  f.receive('expired', 'Expired', 90000);
  f.receive('owner', 'Confirmed\nOwner added this', 3501);
  f.receive('prefix', '00Prefix', 3502);
  assert.deepEqual(f.read().map(x => x.from), ['user', 'user', 'user', 'user']);
});

test('combined input with different registered senders stays unresolved', t => {
  const f = fixture(t);
  const other = { ...f.source, sessionId: 'other', name: 'Other', path: path.join(f.root, 'other.jsonl') };
  fs.writeFileSync(path.join(f.root, 'sessions', 'other.json'), JSON.stringify(other));
  f.send("'Source part'", 0);
  f.send("'Other part'", 1, { sender: other });
  f.receive('mixed', 'Source part\nOther part', 3);
  assert.equal(f.read()[0].from, 'user');
});

test('a receipt belongs to one execution attempt, including payload-level execution timestamps', t => {
  const f = fixture(t);
  f.send("'Retry'", 0, { accepted: false });
  f.send("'Retry'", 5);
  const records = fs.readFileSync(f.source.path, 'utf8').trim().split('\n').map(JSON.parse);
  const completion = records.at(-1);
  completion.payload.started_at_ms = completion.payload.item.started_at_ms;
  delete completion.payload.item.started_at_ms;
  fs.writeFileSync(f.source.path, records.map(JSON.stringify).join('\n'));
  f.receive('first', 'Retry', 3500);
  f.receive('owner', 'Retry', 3501);
  assert.deepEqual(f.read().map(x => x.from), ['peer', 'user']);
});

test('consumed evidence stays reserved if the native rollout no longer includes the earlier input', t => {
  const f = fixture(t);
  f.send("'Already delivered'", 0);
  f.receive('original', 'Already delivered', 2);
  assert.equal(f.read()[0].from, 'peer');
  fs.writeFileSync(f.target.path, '');
  f.receive('owner', 'Already delivered', 3);
  assert.deepEqual(f.read().map(x => x.from), ['peer', 'user']);
});
