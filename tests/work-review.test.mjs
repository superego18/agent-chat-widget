import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import http from 'node:http';
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

async function provider(t, f) {
  const state = { item: { id: 'actual-item', source: { project: 'synthetic-project' }, managedRecord: { id: 'actual-task', candidate: 'candidate-one', state: 'owner-review', ownerReviewCid: null }, sourceKey: 'actual-source', version: 'actual-version', status: 'review' }, requests: [], mode: 'normal', wait: null };
  const server = http.createServer(async (req, res) => {
    state.requests.push({ method: req.method, path: req.url, cookie: req.headers.cookie || null, authorization: req.headers.authorization || null });
    if (req.url === '/') {
      if (state.mode === 'redirect') { res.writeHead(302, { location: '/unexpected' }); res.end(); return; }
      res.writeHead(200, { 'set-cookie': 'fixture-auth=synthetic; HttpOnly; SameSite=Strict' }); res.end('Synthetic bootstrap'); return;
    }
    if (req.url !== '/api/items' || req.method !== 'GET' || req.headers.cookie !== 'fixture-auth=synthetic') { res.writeHead(403); res.end(); return; }
    if (state.entered) state.entered();
    if (state.wait) await state.wait;
    if (res.destroyed) return;
    if (state.mode === 'auth') { res.writeHead(401); res.end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(state.mode === 'json' ? '{invalid' : JSON.stringify({ items: [state.item] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)); });
  state.url = 'http://127.0.0.1:' + server.address().port + '/';
  state.configure = (url, extra = {}) => fs.writeFileSync(path.join(f.root, 'project-links.json'), JSON.stringify({ workReviewProvider: { kind: 'development-workbench', url, projectKey: 'synthetic-project', publicUrl: 'https://workbench.invalid/', ...extra } }));
  state.configure(state.url);
  state.binding = () => ({ project: state.item.source.project, task: state.item.managedRecord.id, item: state.item.id, sourceKey: state.item.sourceKey, version: state.item.version, candidate: state.item.managedRecord.candidate });
  state.close = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  return state;
}

test('explicit workbench binding joins six identities using only configured GET origin and same-origin cookie', async t => {
  const f = fixture(t), p = await provider(t, f);
  const item = (await f.act('work-start', { expectedText: f.original })).body;
  const bound = await f.act('work-bind-review', { revision: item.work.revision, binding: { ...p.binding(), url: 'http://untrusted.invalid/' } });
  assert.equal(bound.status, 200);
  assert.equal(bound.body.work.reviewTarget.url, 'https://workbench.invalid/?item=actual-item');
  assert.equal(JSON.stringify(bound.body.work.reviewTarget).includes('fixture-auth'), false);
  assert.equal(JSON.stringify(bound.body.work.reviewTarget).includes('untrusted.invalid'), false);
  assert.equal(bound.body.text, f.original);
  assert.equal(bound.body.work.state, 'working', 'a reference is not completion or approval');
  assert.deepEqual(p.requests.map(x => [x.method, x.path]), [['GET', '/'], ['GET', '/api/items']]);
  assert.equal(p.requests[1].cookie, 'fixture-auth=synthetic');
  assert.equal(p.requests[1].authorization, null);
  assert.equal(fs.existsSync(path.join(f.root, 'chat.json')), false);
});

test('foreign identity, missing provider, rejected bootstrap/auth/json and stale revision leave originals untouched', async t => {
  const f = fixture(t), p = await provider(t, f);
  const item = (await f.act('work-start', { expectedText: f.original })).body;
  const bytes = fs.readFileSync(path.join(f.root, 'drafts.json'));
  const refuse = async extra => { assert.notEqual((await f.act('work-bind-review', { revision: item.work.revision, binding: p.binding(), ...extra })).status, 200); assert.deepEqual(fs.readFileSync(path.join(f.root, 'drafts.json')), bytes); };
  for (const key of ['project', 'task', 'item', 'sourceKey', 'version', 'candidate']) await refuse({ binding: { ...p.binding(), [key]: 'wrong' } });
  await refuse({ actor: 'foreign' }); await refuse({ revision: 0 });
  p.item.source.project = 'foreign-project'; await refuse({ binding: p.binding() }); p.item.source.project = 'synthetic-project';
  for (const url of ['https://127.0.0.1/', 'http://example.invalid/', 'http://user:password@127.0.0.1/', p.url + '?token=secret']) { p.configure(url); const calls = p.requests.length; await refuse({}); assert.equal(p.requests.length, calls); }
  fs.unlinkSync(path.join(f.root, 'project-links.json')); await refuse({});
  for (const publicUrl of ['https://user:password@workbench.invalid/', 'https://workbench.invalid/?key=secret', 'javascript:alert(1)']) { p.configure(p.url, { publicUrl }); const calls = p.requests.length; await refuse({}); assert.equal(p.requests.length, calls); }
  p.configure(p.url);
  for (const mode of ['redirect', 'auth', 'json']) { p.mode = mode; await refuse({}); }
  assert.equal(p.requests.some(x => x.path === '/unexpected'), false, 'redirects are never followed');
  assert.equal(fs.existsSync(path.join(f.root, 'chat.json')), false);
});

test('binding preserves old answers and bindings; exact old CID replay stays write-free after revision advance', async t => {
  const f = fixture(t), p = await provider(t, f);
  let item = (await f.act('work-start', { expectedText: f.original })).body;
  item = (await f.act('work-review', { revision: item.work.revision, note: 'Original review' })).body;
  const answer = { revision: item.work.revision, decision: 'approved', cid: 'original-answer', text: 'Original owner answer' };
  item = (await f.act('work-answer', answer)).body;
  const originalAnswer = structuredClone(item.work.answer), chatBytes = fs.readFileSync(path.join(f.root, 'chat.json'));
  item = (await f.act('work-bind-review', { revision: item.work.revision, binding: p.binding() })).body;
  const firstBinding = structuredClone(item.work.reviewTarget);
  p.item.version = 'next-actual-version';
  item = (await f.act('work-bind-review', { revision: item.work.revision, binding: p.binding() })).body;
  assert.deepEqual(item.work.reviewBindings, [firstBinding]);
  assert.deepEqual(item.work.answer, originalAnswer);
  const bytes = fs.readFileSync(path.join(f.root, 'drafts.json'));
  assert.equal((await f.act('work-answer', answer)).status, 200);
  for (const action of ['work-answer', 'work-review']) assert.equal((await f.act(action, { revision: item.work.revision, decision: 'approved', cid: 'new-answer', note: 'Overwrite' })).status, 409);
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'drafts.json')), bytes);
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'chat.json')), chatBytes);
});

test('binding awaits no store lock and refuses a concurrent request revision change', async t => {
  const f = fixture(t), p = await provider(t, f);
  const item = (await f.act('work-start', { expectedText: f.original })).body;
  let release, entered; p.wait = new Promise(resolve => { release = resolve; }); const waiting = new Promise(resolve => { entered = resolve; }); p.entered = entered;
  const binding = f.act('work-bind-review', { revision: item.work.revision, binding: p.binding() });
  await waiting;
  const changed = await f.act('work-review', { revision: item.work.revision, note: 'Concurrent current review' });
  assert.equal(changed.status, 200, 'unrelated normal draft API can proceed while the external GET is pending');
  release(); assert.equal((await binding).status, 409);
  const saved = JSON.parse(fs.readFileSync(path.join(f.root, 'drafts.json'))).drafts[0];
  assert.equal(saved.work.note, 'Concurrent current review'); assert.equal(saved.work.reviewTarget, undefined);
});

test('timeout, lost provider and changed provider configuration refuse binding without writes', async t => {
  const f = fixture(t), p = await provider(t, f);
  const item = (await f.act('work-start', { expectedText: f.original })).body;
  const bytes = fs.readFileSync(path.join(f.root, 'drafts.json'));
  let release, entered; p.wait = new Promise(resolve => { release = resolve; }); const waiting = new Promise(resolve => { entered = resolve; }); p.entered = entered;
  const pending = f.act('work-bind-review', { revision: item.work.revision, binding: p.binding() });
  await waiting;
  const started = performance.now();
  assert.equal((await pending).status, 409);
  assert.ok(performance.now() - started < 8000, 'the actual GET deadline is bounded, never a fabricated success');
  release(); p.wait = null; p.entered = null;
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'drafts.json')), bytes);
  const changed = new Promise(resolve => { p.entered = () => { p.configure(p.url, { projectKey: 'changed' }); resolve(); }; });
  assert.equal((await f.act('work-bind-review', { revision: item.work.revision, binding: p.binding() })).status, 409); await changed;
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'drafts.json')), bytes);
  p.configure(p.url); await p.close();
  assert.equal((await f.act('work-bind-review', { revision: item.work.revision, binding: p.binding() })).status, 409);
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'drafts.json')), bytes);
});

test('linked finish needs explicit latest binding and actual done state plus review receipt; never auto-finishes', async t => {
  const f = fixture(t), p = await provider(t, f);
  let item = (await f.act('work-start', { expectedText: f.original })).body;
  item = (await f.act('work-bind-review', { revision: item.work.revision, binding: p.binding() })).body;
  let bytes = fs.readFileSync(path.join(f.root, 'drafts.json'));
  assert.equal((await f.act('work-finish', { revision: item.work.revision })).status, 409);
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'drafts.json')), bytes);
  p.item.status = 'done'; p.item.managedRecord.state = 'done'; p.item.managedRecord.ownerReviewCid = 'actual-owner-review'; p.item.version = 'done-version';
  assert.equal((await f.act('work-finish', { revision: item.work.revision })).status, 409, 'a changed version requires explicit rebind');
  item = (await f.act('work-bind-review', { revision: item.work.revision, binding: p.binding() })).body;
  assert.equal(item.work.state, 'working');
  for (const change of [{ status: 'review' }, { managedRecord: { ...p.item.managedRecord, state: 'owner-review' } }, { managedRecord: { ...p.item.managedRecord, ownerReviewCid: '' } }]) {
    const previous = structuredClone(p.item); Object.assign(p.item, change); bytes = fs.readFileSync(path.join(f.root, 'drafts.json'));
    assert.equal((await f.act('work-finish', { revision: item.work.revision })).status, 409);
    assert.deepEqual(fs.readFileSync(path.join(f.root, 'drafts.json')), bytes); p.item = previous;
  }
  assert.equal((await f.act('work-finish', { revision: item.work.revision, actor: 'foreign' })).status, 409);
  const finished = await f.act('work-finish', { revision: item.work.revision });
  assert.equal(finished.status, 200); assert.equal(finished.body.work.state, 'done'); assert.equal(finished.body.text, f.original);
  assert.equal(fs.existsSync(path.join(f.root, 'chat.json')), false);
});

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
