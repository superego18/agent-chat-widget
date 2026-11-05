import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPollDeltas } from '../scripts/poll-delta.mjs';

test('deltas retain edits, deletion, reordering and metadata; unknown/evicted bases fall back', () => {
  const delta = createPollDeltas(), first = { items: [{ id: 1, text: 'a'.repeat(20000) }, { id: '2', text: 'old' }], total: 2 };
  assert.equal(delta('s', first, 'items', 'one'), null);
  const second = { items: [{ id: '2', text: 'edited' }, first.items[0], { id: 3, text: 'new' }], total: 3 };
  const patch = delta('s', second, 'items', 'two', 'one');
  assert.deepEqual(patch.items, [second.items[0], second.items[2]]); assert.deepEqual(patch.order, ['2', 1, 3]); assert.equal(patch.total, 3);
  assert(JSON.stringify(patch).length < JSON.stringify(second).length / 10);
  assert.deepEqual(delta('s', { items: [] }, 'items', 'empty', 'two').order, []);
  assert.equal(delta('other-session', second, 'items', 'two', 'one'), null);
  assert.equal(delta('s', second, 'items', 'two', 'unknown'), null);
  for (let i = 0; i < 17; i++) delta('s', first, 'items', 'later' + i);
  assert.equal(delta('s', second, 'items', 'two', 'one'), null);
  assert.equal(delta('s', { items: [{ id: 1 }, { id: 1 }] }, 'items', 'bad', 'two'), null);
});
