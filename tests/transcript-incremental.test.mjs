import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readCodexHistory } from '../scripts/transcript-store.mjs';

const message = (id, text = id) => JSON.stringify({ timestamp: '2026-11-03T00:00:00Z', type: 'response_item', payload: { id, type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] } });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-incremental-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = { sessionId: 'synthetic', agent: 'Codex', path: path.join(root, 'native.jsonl') };
  return { root, session, read: () => readCodexHistory(root, session).items };
}

test('a tool-only append does not reread native history, and an appended final answer is immediately visible', t => {
  const f = fixture(t);
  fs.writeFileSync(f.session.path, message('first') + '\n' + JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', output: 'x'.repeat(1024 * 1024) } }) + '\n');
  assert.equal(f.read().length, 1);
  let bytes = 0;
  const originalRead = fs.readSync, originalFile = fs.readFileSync;
  t.mock.method(fs, 'readSync', function(fd, buffer, offset, length, position) {
    const count = originalRead.call(this, fd, buffer, offset, length, position);
    bytes += count; return count;
  });
  t.mock.method(fs, 'readFileSync', function(file, ...args) {
    const result = originalFile.call(this, file, ...args);
    if (file === f.session.path) bytes += Buffer.byteLength(result);
    return result;
  });
  fs.appendFileSync(f.session.path, JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }) + '\n');
  assert.equal(f.read().length, 1);
  fs.appendFileSync(f.session.path, message('final', 'Final answer while still working') + '\n');
  assert.deepEqual(f.read().map(x => x.id), ['xfirst', 'xfinal']);
  assert.ok(bytes < 32768, `append polling reread ${bytes} bytes of old history`);
});

test('partial UTF-8 lines, valid unterminated lines, truncation and replacement retain complete displayed history', t => {
  const f = fixture(t), line = Buffer.from(message('unicode', '한글 😀'));
  fs.writeFileSync(f.session.path, message('old') + '\n');
  assert.equal(f.read().length, 1);
  const split = line.indexOf(Buffer.from('한')) + 1;
  fs.appendFileSync(f.session.path, line.subarray(0, split));
  assert.equal(f.read().length, 1, 'incomplete line is not an answer');
  fs.appendFileSync(f.session.path, line.subarray(split));
  assert.equal(f.read().find(x => x.id === 'xunicode').text, '한글 😀');
  fs.appendFileSync(f.session.path, '\n' + message('next') + '\n');
  assert.equal(f.read().length, 3, 'unterminated answer is not duplicated');
  fs.writeFileSync(f.session.path, message('reset') + '\n');
  assert.equal(f.read().length, 4, 'rollout truncation cannot erase displayed history');
  const replacement = f.session.path + '.new';
  fs.writeFileSync(replacement, message('replace') + '\n' + ' '.repeat(4096));
  fs.renameSync(replacement, f.session.path);
  assert.equal(f.read().length, 5);
  assert.equal(f.read().length, 5, 'unchanged poll is idempotent');
});

test('same-size rewrites and truncate-then-grow reset parsing; read failure keeps durable answers', t => {
  const f = fixture(t);
  const write = text => fs.writeFileSync(f.session.path, message('same', text) + '\n');
  write('before'); f.read();
  write('edited');
  fs.utimesSync(f.session.path, new Date(), new Date(Date.now() + 2000));
  assert.equal(f.read()[0].text, 'edited');
  fs.writeFileSync(f.session.path, message('after', 'replacement that is longer than the previous native file') + '\n');
  assert.ok(f.read().some(x => x.id === 'xafter'));
  const open = fs.openSync;
  t.mock.method(fs, 'openSync', function(file, ...args) {
    if (file === f.session.path) throw new Error('synthetic read failure');
    return open.call(this, file, ...args);
  });
  assert.ok(f.read().some(x => x.id === 'xafter'), 'read failure cannot discard saved answers');
});

test('normal append during a cold read accepts the captured prefix and incrementally reads the next answer', t => {
  const f = fixture(t);
  fs.writeFileSync(f.session.path, message('first') + '\n' + JSON.stringify({ type: 'event_msg', payload: { text: 'x'.repeat(100000) } }) + '\n');
  const read = fs.readSync;
  let appended = false, bytes = 0;
  t.mock.method(fs, 'readSync', function(fd, buffer, offset, length, position) {
    const count = read.call(this, fd, buffer, offset, length, position);
    bytes += count;
    if (!appended && length > 10000) {
      appended = true;
      fs.appendFileSync(f.session.path, message('second') + '\n');
    }
    return count;
  });
  assert.deepEqual(f.read().map(x => x.id), ['xfirst'], 'ongoing native activity must not suppress a captured final answer');
  bytes = 0;
  assert.deepEqual(f.read().map(x => x.id), ['xfirst', 'xsecond']);
  assert.ok(bytes < 20000, `concurrent append caused a cold reread of ${bytes} bytes`);
});

test('tool-only native growth does not rebuild or serialize the complete displayed conversation', t => {
  const f = fixture(t);
  const retained = 'x'.repeat(2 * 1024 * 1024 + 100);
  fs.writeFileSync(f.session.path, message('retained', retained) + '\n');
  assert.equal(f.read()[0].text, retained, 'conversation history larger than the receipt cache remains complete');
  let fullSerializations = 0;
  const stringify = JSON.stringify;
  t.mock.method(JSON, 'stringify', function(value, ...args) {
    if (value?.items?.some(x => x.id === 'xretained')) fullSerializations++;
    return stringify.call(this, value, ...args);
  });
  fs.appendFileSync(f.session.path, '{"type":"event_msg","payload":{"type":"task_started"}}\n');
  assert.equal(f.read().length, 1);
  assert.equal(fullSerializations, 0, 'tool activity must not repeatedly rebuild the unchanged full conversation');
  fs.appendFileSync(f.session.path, message('new-answer') + '\n');
  assert.ok(f.read().some(x => x.id === 'xnew-answer'), 'a real answer invalidates the displayed-history cache');
});
