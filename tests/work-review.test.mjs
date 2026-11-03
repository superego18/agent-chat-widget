import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createChatHandler } from '../scripts/chat-handler.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-work-review-'));
  fs.mkdirSync(path.join(root, 'sessions'));
  const actor = 'synthetic-worker', original = 'Keep review requests outside the chat';
  fs.writeFileSync(path.join(root, 'sessions', actor + '.json'), JSON.stringify({ sessionId: actor, tool: 'claude', name: 'Synthetic worker' }));
  fs.writeFileSync(path.join(root, 'drafts.json'), JSON.stringify({ nextId: 2, drafts: [{ id: 1, to: actor, text: original, hold: true, at: new Date().toISOString() }], trash: [] }));
  const handler = createChatHandler({ root });
  t.after(async () => { await handler.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  const api = body => new Promise(resolve => {
    const req = new EventEmitter(); req.method = 'POST';
    let status;
    handler.handle(req, { writeHead(code) { status = code; }, end(raw) { resolve({ status, body: JSON.parse(raw) }); } }, new URL('http://fixture.invalid/api/drafts'));
    req.emit('data', JSON.stringify(body)); req.emit('end');
  });
  const act = (action, extra = {}) => api({ action, id: 1, actor, ...extra });
  return { root, actor, original, api, act };
}

test('a registered assigned session takes an unchanged draft without deleting the original', async t => {
  const f = fixture(t);
  assert.equal((await f.act('work-start', { expectedText: 'stale' })).status, 409);
  assert.equal((await f.act('work-start', { actor: 'unregistered', expectedText: f.original })).status, 403);
  const started = await f.act('work-start', { expectedText: f.original });
  assert.equal(started.status, 200);
  assert.equal(started.body.work.state, 'working');
  assert.equal(started.body.text, f.original);
  assert.equal(started.body.hold, true);
  assert.equal((await f.act('work-start', { expectedText: f.original })).body.work.revision, started.body.work.revision);
  assert.equal((await f.api({ action: 'send', ids: [1] })).status, 409, 'active work cannot also be sent as a pending draft');
  assert.equal((await f.act('update', { text: 'overwrite original' })).status, 409);
  assert.equal((await f.api({ action: 'delete', ids: [1] })).status, 409);
});

test('review answers are durable, revision-bound and delivered once; approval does not fabricate completion', async t => {
  const f = fixture(t);
  let item = (await f.act('work-start', { expectedText: f.original })).body;
  item = (await f.act('work-review', { revision: item.work.revision, note: 'Please inspect the isolated result' })).body;
  assert.equal(item.work.state, 'review');
  assert.equal((await f.act('work-finish', { revision: item.work.revision })).status, 409);
  assert.equal((await f.act('work-answer', { revision: item.work.revision - 1, decision: 'approved', cid: 'answer-one' })).status, 409);
  const answer = { revision: item.work.revision, decision: 'approved', cid: 'answer-one', text: 'Looks good' };
  const result = await f.act('work-answer', answer);
  assert.equal(result.status, 200);
  assert.equal(result.body.work.state, 'review', 'only the actual worker records completion');
  assert.equal(result.body.work.answer.decision, 'approved');
  assert.equal((await f.act('work-answer', answer)).status, 200, 'retrying the same answer is idempotent');
  const chat = JSON.parse(fs.readFileSync(path.join(f.root, 'chat.json')));
  assert.equal(chat.messages.length, 1);
  assert.equal(chat.messages[0].to, f.actor);
  assert.ok(chat.messages[0].text.includes('Looks good'));
  const finished = await f.act('work-finish', { revision: result.body.work.revision });
  assert.equal(finished.body.work.state, 'done');
  assert.equal(finished.body.text, f.original);
});

test('a requested correction returns to work and an old approval cannot approve a new review', async t => {
  const f = fixture(t);
  let item = (await f.act('work-start', { expectedText: f.original })).body;
  item = (await f.act('work-review', { revision: item.work.revision, note: 'First result' })).body;
  const oldRevision = item.work.revision;
  item = (await f.act('work-answer', { revision: oldRevision, decision: 'changes', cid: 'change-one', text: 'Fix the missing case' })).body;
  assert.equal(item.work.state, 'working');
  assert.equal((await f.act('work-finish', { revision: item.work.revision })).status, 409);
  item = (await f.act('work-review', { revision: item.work.revision, note: 'Corrected result' })).body;
  assert.equal((await f.act('work-answer', { revision: oldRevision, decision: 'approved', cid: 'old-approval' })).status, 409);
});

test('a reused client CID in a new review stores a new answer, and malformed retries cannot throw', async t => {
  const f = fixture(t);
  let item = (await f.act('work-start', { expectedText: f.original })).body;
  item = (await f.act('work-review', { revision: item.work.revision, note: 'First result' })).body;
  const first = { revision: item.work.revision, decision: 'approved', cid: 'same-client-id', text: 'First answer' };
  item = (await f.act('work-answer', first)).body;
  for (const text of [{}, 1]) assert.equal((await f.act('work-answer', { ...first, text })).status, 400);
  item = (await f.act('work-review', { revision: item.work.revision, note: 'New result' })).body;
  item = (await f.act('work-answer', { revision: item.work.revision, decision: 'approved', cid: first.cid, text: 'New answer' })).body;
  const chat = JSON.parse(fs.readFileSync(path.join(f.root, 'chat.json')));
  assert.equal(chat.messages.length, 2);
  assert.ok(chat.messages[1].text.includes('New answer'));
  assert.equal(item.work.answer.messageId, chat.messages[1].id);
});

test('a saved chat reply with an uncommitted work record recovers once and refuses a changed-body retry', async t => {
  const f = fixture(t);
  let item = (await f.act('work-start', { expectedText: f.original })).body;
  item = (await f.act('work-review', { revision: item.work.revision, note: 'Inspect the result' })).body;
  const rename = fs.renameSync;
  let refuse = true;
  t.mock.method(fs, 'renameSync', function(from, to) {
    if (refuse && to === path.join(f.root, 'drafts.json')) { refuse = false; throw Object.assign(new Error('Synthetic full disk'), { code: 'ENOSPC' }); }
    return rename.call(this, from, to);
  });
  const answer = { revision: item.work.revision, decision: 'approved', cid: 'recover-once', text: 'Original answer' };
  assert.equal((await f.act('work-answer', answer)).status, 503);
  assert.equal((await f.act('work-answer', { ...answer, text: 'Different answer' })).status, 409);
  assert.equal((await f.act('work-answer', answer)).status, 200);
  const chat = JSON.parse(fs.readFileSync(path.join(f.root, 'chat.json')));
  assert.equal(chat.messages.length, 1, 'recovering the metadata never sends the answer twice');
});
