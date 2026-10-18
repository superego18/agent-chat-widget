import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readQueuePickups } from '../scripts/codex-pickup.mjs';

const RECEIPT = '12345678-1234-4123-8123-123456789abc';
const OTHER = 'abcdefab-1234-4123-8123-123456789abc';
const SENT = '2026-10-18T01:00:00.000Z';
const PICKED = '2026-10-18T01:00:01.000Z';
const LATER = '2026-10-18T01:00:02.000Z';
const PREFIX = '[\uB300\uD654/\uD53C\uB4DC\uBC31 \u00B7 synthetic source]';
const prompt = (receipt = RECEIPT) => `${PREFIX} [uifb-receipt:${receipt}] Synthetic feedback`;
const input = (text) => ({ type: 'input_text', text });
const native = (text = prompt(), timestamp = PICKED) => ({
  timestamp, type: 'response_item',
  payload: { type: 'message', role: 'user', content: [input(text)] },
});
const queued = (id = 1, receipt = RECEIPT) => ({ id, to: 'synthetic-session', at: SENT, queue: { receipt } });
const jsonl = (records) => records.map((record) => JSON.stringify(record)).join('\n') + '\n';

function fixture(t, records = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-pickup-test-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('codex-pickup-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const file = path.join(root, 'synthetic-rollout.jsonl');
  fs.writeFileSync(file, jsonl(records));
  return { root, file, session: { sessionId: 'synthetic-session', path: file } };
}

test('matches receipts to individual destinations and returns the earliest eligible ISO time', (t) => {
  const f = fixture(t, [
    native(prompt(), '2026-10-18T00:59:59Z'),
    native(prompt(), LATER), native(prompt(), '2026-10-18T10:00:01+09:00'),
    native(prompt(OTHER), SENT),
  ]);
  const messages = [queued(), queued(2, OTHER), { ...queued(3), to: 'another-session' }];
  const original = structuredClone(messages);
  assert.deepEqual(readQueuePickups(f.session, messages), { 1: PICKED, 2: SENT });
  assert.deepEqual(messages, original);
});

test('accepts optional whitespace after the first bracket and native input_text arrays', (t) => {
  const f = fixture(t);
  for (const whitespace of ['', ' ', '\t', '\r\n']) {
    const record = native(`${PREFIX}${whitespace}[uifb-receipt:${RECEIPT}] Body`);
    record.payload.content.push(input('Additional user text'), { type: 'input_image', image_url: 'synthetic' });
    fs.writeFileSync(f.file, jsonl([record]));
    assert.deepEqual(readQueuePickups(f.session, [queued()]), { 1: PICKED });
  }
});

test('rejects quoted, embedded, displaced, malformed and inexact markers', (t) => {
  const forgeries = [
    `Quoted: ${prompt()}`, `"${prompt()}"`, `> ${prompt()}`, `\`\`\`\n${prompt()}\n\`\`\``,
    ` ${prompt()}`, `\n${prompt()}`, `<system-reminder>${prompt()}</system-reminder>`,
    `[other prefix] [uifb-receipt:${RECEIPT}]`,
    `[uifb-receipt:${RECEIPT}] ${PREFIX}`, `${PREFIX} Body [uifb-receipt:${RECEIPT}]`,
    `${PREFIX} [quoted] [uifb-receipt:${RECEIPT}]`,
    `${PREFIX} [uifb-receipt: ${RECEIPT}]`, `${PREFIX} [uifb-receipt:${RECEIPT} ]`,
    `${PREFIX} [UIFB-receipt:${RECEIPT}]`, `${PREFIX} [uifb-receipt:${RECEIPT}0]`,
    `${PREFIX} [uifb-receipt:invalid-uuid]`, prompt(RECEIPT.toUpperCase()),
  ];
  const f = fixture(t, forgeries.map((text) => native(text)));
  assert.deepEqual(readQueuePickups(f.session, [queued()]), {});
});

test('never inspects assistant, tool, event, nested or non-input_text content', (t) => {
  const user = native();
  const f = fixture(t, [
    ...['assistant', 'tool', 'system', 'developer'].map((role) => ({ ...user, payload: { ...user.payload, role } })),
    { ...user, payload: { ...user.payload, content: [{ type: 'output_text', text: prompt() }] } },
    { ...user, payload: { ...user.payload, type: 'function_call', arguments: prompt() } },
    { ...user, payload: { ...user.payload, content: prompt() } },
    { ...user, payload: { ...user.payload, content: [null, {}, { type: 'input_text', text: { text: prompt() } }] } },
    { ...user, payload: { ...user.payload, content: [input('Quoted below:'), input(prompt())] } },
    { type: 'event_msg', timestamp: PICKED, payload: { type: 'user_message', message: prompt() } },
    { type: 'event_msg', timestamp: PICKED, payload: { type: 'agent_message', message: prompt() } },
    { ...user, payload: { type: 'message', role: 'user', nested: { content: [input(prompt())] } } },
  ]);
  assert.deepEqual(readQueuePickups(f.session, [queued()]), {});
});

test('requires receipt, matching destination and valid non-earlier native timestamps', (t) => {
  const f = fixture(t, [
    native(prompt(), '2026-10-18T00:59:59.999Z'),
    ...[undefined, null, 123, 'invalid'].map((at) => ({ ...native(), timestamp: at })),
    { ...native(prompt(), LATER), payload: { ...native().payload, role: 'assistant' } },
  ]);
  assert.deepEqual(readQueuePickups(f.session, [queued()]), {});
  fs.appendFileSync(f.file, jsonl([native()]));
  const invalid = [
    { ...queued(), queue: undefined }, { ...queued(), queue: { receipt: OTHER } },
    { ...queued(), to: undefined }, { ...queued(), to: 'another-session' },
    ...[undefined, null, 123, 'invalid', LATER].map((at) => ({ ...queued(), at })),
  ];
  assert.deepEqual(readQueuePickups(f.session, invalid), {});
  assert.deepEqual(readQueuePickups(f.session, [queued()]), { 1: PICKED });
});

test('reads only session.path and never reuses another session or message result', (t) => {
  const f = fixture(t, [native()]);
  const otherPath = path.join(f.root, 'other-rollout.jsonl');
  fs.writeFileSync(otherPath, '');
  assert.deepEqual(readQueuePickups(f.session, [queued()]), { 1: PICKED });
  assert.deepEqual(readQueuePickups({ ...f.session, path: otherPath }, [queued()]), {});
  assert.deepEqual(readQueuePickups({ ...f.session, sessionId: 'other-session' }, [queued()]), {});
  assert.deepEqual(readQueuePickups(f.session, [{ ...queued(), id: 7 }]), { 7: PICKED });
  assert.deepEqual(readQueuePickups(f.session, [{ ...queued(), at: LATER }]), {});
});

test('tolerates missing files, malformed records and partial first and last lines', (t) => {
  const f = fixture(t);
  assert.deepEqual(readQueuePickups({ ...f.session, path: path.join(f.root, 'missing') }, [queued()]), {});
  assert.deepEqual(readQueuePickups({ ...f.session, path: f.root }, [queued()]), {});
  assert.deepEqual(readQueuePickups(null, [queued()]), {});
  const last = JSON.stringify(native(prompt(OTHER), LATER));
  fs.writeFileSync(f.file, 'truncated first line\n{bad JSON}\nnull\n42\n' + jsonl([native()]) + last.slice(0, -5));
  assert.deepEqual(readQueuePickups(f.session, [queued(), queued(2, OTHER)]), { 1: PICKED });
  fs.appendFileSync(f.file, last.slice(-5) + '\n');
  assert.deepEqual(readQueuePickups(f.session, [queued(), queued(2, OTHER)]), { 1: PICKED, 2: LATER });
});

test('reads at most the last 4 MiB and drops the partial first record', (t) => {
  const f = fixture(t);
  const tailBytes = 4 * 1024 * 1024;
  const cutRecord = native('x'.repeat(tailBytes) + prompt());
  fs.writeFileSync(f.file, jsonl([native(), cutRecord, native(prompt(OTHER))]));
  const originalRead = fs.readSync;
  const reads = [];
  t.mock.method(fs, 'readSync', (...args) => {
    reads.push({ length: args[3], position: args[4] });
    return originalRead(...args);
  });
  assert.deepEqual(readQueuePickups(f.session, [queued(), queued(2, OTHER)]), { 2: PICKED });
  assert.deepEqual(reads, [{ length: tailBytes, position: fs.statSync(f.file).size - tailBytes }]);
});

test('caches by file path, size and mtime and discards missing-file evidence', (t) => {
  const f = fixture(t, [native()]);
  const originalRead = fs.readSync;
  let reads = 0;
  t.mock.method(fs, 'readSync', (...args) => { reads++; return originalRead(...args); });
  assert.deepEqual(readQueuePickups(f.session, [queued()]), { 1: PICKED });
  assert.deepEqual(readQueuePickups(f.session, [queued()]), { 1: PICKED });
  assert.equal(reads, 1);
  const before = fs.statSync(f.file);
  fs.writeFileSync(f.file, jsonl([native(prompt(OTHER))]));
  assert.equal(fs.statSync(f.file).size, before.size);
  fs.utimesSync(f.file, before.atime, new Date(before.mtimeMs + 2000));
  assert.deepEqual(readQueuePickups(f.session, [queued(), queued(2, OTHER)]), { 2: PICKED });
  assert.equal(reads, 2);
  fs.appendFileSync(f.file, jsonl([native()]));
  assert.deepEqual(readQueuePickups(f.session, [queued()]), { 1: PICKED });
  assert.equal(reads, 3);
  fs.unlinkSync(f.file);
  assert.deepEqual(readQueuePickups(f.session, [queued()]), {});
});

test('caps the module cache at 16 files', (t) => {
  const f = fixture(t, [native()]);
  const originalRead = fs.readSync;
  let reads = 0;
  t.mock.method(fs, 'readSync', (...args) => { reads++; return originalRead(...args); });
  assert.deepEqual(readQueuePickups(f.session, [queued()]), { 1: PICKED });
  for (let i = 0; i < 16; i++) {
    const file = path.join(f.root, `synthetic-${i}.jsonl`);
    fs.writeFileSync(file, jsonl([native()]));
    assert.deepEqual(readQueuePickups({ ...f.session, path: file }, [queued()]), { 1: PICKED });
  }
  assert.equal(reads, 17);
  assert.deepEqual(readQueuePickups(f.session, [queued()]), { 1: PICKED });
  assert.equal(reads, 18);
});
