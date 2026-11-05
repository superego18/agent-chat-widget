import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createCodexQuestionBridge } from '../scripts/codex-questions.mjs';
import { createChatHandler } from '../scripts/chat-handler.mjs';
import { getBrowser, closeBrowser } from './helpers.mjs';
import { webkit } from 'playwright-core';
after(closeBrowser);
let webkitBrowser;
after(async () => { await webkitBrowser?.close(); });
const session = { sessionId: '11111111-1111-4111-8111-111111111111', tool: 'codex' };
const request = () => ({ id: 51, method: 'item/tool/requestUserInput', params: { threadId: session.sessionId, turnId: 'turn1', itemId: 'call1', isBlocking: false, questions: [{ id: 'destination', header: 'Destination', question: 'Where should it go?', isOther: true, options: [{ label: 'Local only', description: 'Keep private' }] }] } });
function setup(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-question-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [], responses = [], listeners = new Set(), pending = new Map();
  const rpc = async (_, operation) => operation(async (method, params) => {
    calls.push({ method, params });
    if (method === 'thread/loaded/list') return { data: options.loaded === false ? [] : [session.sessionId] };
    if (method === 'thread/resume') { if (!options.stale) { const r = options.request || request(); pending.set(r.id, r); } return {}; }
    throw Error('Unexpected method: ' + method);
  }, { requests: pending, listen(fn) { listeners.add(fn); return () => listeners.delete(fn); }, respond(id, result) {
    responses.push({ id, result });
    if (options.lost) throw Error('lost');
    if (options.unresolved) return;
    pending.delete(id);
    for (const fn of listeners) fn({ method: 'serverRequest/resolved', params: { threadId: session.sessionId, requestId: id } });
  } });
  const make = () => createCodexQuestionBridge({ root, rpc, replayMs: 0, resolveMs: 10 });
  const bridge = make();
  return { root, bridge, make, calls, responses, pending, options };
}
const answer = view => ({ revision: view.revision, answers: [{ id: 'destination', value: 'My private workspace' }] });

test('native answer uses the exact live request and receives original-question resolution, with no message fallback', async t => {
  const f = setup(t), view = await f.bridge(session, 'call1');
  assert.equal(view.state, 'pending');
  const input = answer(view), result = await f.bridge(session, 'call1', input);
  assert.equal(result.state, 'resolved');
  assert.deepEqual(JSON.parse(JSON.stringify(f.responses)), [{ id: 51, result: { answers: { destination: { answers: ['My private workspace'] } } } }]);
  assert.deepEqual(await f.make()(session, 'call1', input), result, 'same answer is not issued twice, even after handler reconstruction');
  assert.equal(f.responses.length, 1);
  assert(f.calls.every(c => ['thread/loaded/list', 'thread/resume'].includes(c.method)));
  assert(f.calls.filter(c => c.method === 'thread/resume').every(c => JSON.stringify(c.params) === JSON.stringify({ threadId: session.sessionId, excludeTurns: true })));
});
for (const kind of ['stale', 'unloaded', 'foreign', 'secret', 'revision', 'empty', 'unknown-option']) test(`native answer refuses ${kind} before any response`, async t => {
  const f = setup(t), view = await f.bridge(session, 'call1');
  const input = answer(view);
  if (kind === 'stale') { f.options.stale = true; f.pending.clear(); }
  if (kind === 'unloaded') f.options.loaded = false;
  if (kind === 'foreign') { f.options.request = request(); f.options.request.params.threadId = 'foreign'; f.pending.clear(); }
  if (kind === 'secret') { f.options.request = request(); f.options.request.params.questions[0].isSecret = true; }
  if (kind === 'revision') input.revision = 'changed';
  if (kind === 'empty') input.answers[0].value = '';
  if (kind === 'unknown-option') { f.options.request = request(); f.options.request.params.questions[0].isOther = false; const current = await f.bridge(session, 'call1'); input.revision = current.revision; }
  assert.equal((await f.bridge(session, 'call1', input)).ok, false);
  assert.equal(f.responses.length, 0);
});
test('loss after issuing a response remains unknown and cannot resend or change the answer', async t => {
  const f = setup(t), view = await f.bridge(session, 'call1'); f.options.lost = true;
  const input = answer(view);
  assert.equal((await f.bridge(session, 'call1', input)).state, 'unknown');
  assert.equal((await f.make()(session, 'call1', input)).state, 'unknown');
  input.answers[0].value = 'Changed';
  assert.equal((await f.make()(session, 'call1', input)).state, 'stale');
  assert.equal(f.responses.length, 1);
  const saved = fs.readdirSync(f.root).map(n => fs.readFileSync(path.join(f.root, n), 'utf8')).join();
  assert(!saved.includes('My private workspace'), 'attempt metadata stores hashes, not answer text');
});
test('Claude without a native reply transport is explicit unsupported, never ordinary chat', async t => {
  const f = setup(t);
  assert.equal((await f.bridge({ ...session, tool: 'claude' }, 'call1')).state, 'unsupported');
  assert.equal(f.calls.length, 0);
});

test('an unresolved native response cannot claim question closure', async t => {
  const f = setup(t, { unresolved: true }), view = await f.bridge(session, 'call1');
  assert.equal((await f.bridge(session, 'call1', answer(view))).state, 'unknown');
  assert.equal(f.responses.length, 1);
});
test('separate handler instances share a create-only issue fence', async t => {
  const f = setup(t), view = await f.bridge(session, 'call1');
  const results = await Promise.all([f.bridge(session, 'call1', answer(view)), f.make()(session, 'call1', answer(view))]);
  assert.equal(f.responses.length, 1); assert(results.some(r => r.state === 'resolved'));
});

for (const [engine, width] of [['chrome', 390], ['chrome', 1440], ['webkit', 390]]) test(`actual widget submits native question ID and preserves typed answer through polling at ${engine} ${width}px`, async t => {
  const f = setup(t); fs.mkdirSync(path.join(f.root, 'sessions'));
  const nativeFile = path.join(f.root, 'native.jsonl');
  fs.writeFileSync(nativeFile, JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'function_call', name: 'request_user_input', call_id: 'call1', arguments: JSON.stringify({ questions: [{ id: 'destination', question: 'Where should it go?', options: [{ label: 'Local only', description: 'Keep private' }] }] }) } }) + '\n');
  fs.writeFileSync(path.join(f.root, 'sessions', session.sessionId + '.json'), JSON.stringify({ ...session, name: 'Synthetic question session', agent: 'Codex', path: nativeFile }));
  const handler = createChatHandler({ root: f.root, readControl: async () => [], questionSend: f.bridge });
  const posts = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') posts.push(req.url);
    if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><meta name="viewport" content="width=device-width"><body>Fixture<script src="/__uifb/widget.js"></script></body>'); }
    const url = new URL(req.url, 'http://fixture'); if (url.pathname.startsWith('/__uifb/api/')) url.pathname = url.pathname.slice('/__uifb'.length);
    if (!handler.handle(req, res, url)) { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = engine === 'webkit' ? (webkitBrowser ||= await webkit.launch()) : await getBrowser();
  const context = await browser.newContext({ viewport: { width, height: 850 } });
  t.after(async () => { await context.close(); await handler.shutdown(); await new Promise(r => { server.close(r); server.closeAllConnections(); }); });
  const page = await context.newPage(), base = 'http://127.0.0.1:' + server.address().port;
  await page.goto(base); await page.locator('.btn').click();
  await page.getByRole('button', { name: '원래 질문에 답변', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '원래 질문에 답변' });
  await dialog.getByRole('textbox').fill('My private workspace');
  await page.waitForTimeout(2500);
  assert.equal(await dialog.getByRole('textbox').inputValue(), 'My private workspace');
  const box = await dialog.boundingBox(); assert(box.x >= 0 && box.x + box.width <= width);
  await dialog.getByRole('button', { name: '질문에 답변 보내기' }).click();
  await page.getByText('답변을 전송했고 원래 질문의 종료를 확인했습니다.', { exact: false }).waitFor();
  assert.equal(f.responses.length, 1);
  assert(!posts.some(p => /\/api\/chat(?:\?|$)|interject/.test(p)), 'native answer cannot become an ordinary message');
  assert.equal(fs.readFileSync(nativeFile, 'utf8').split('\n').filter(Boolean).length, 1, 'provider transcript untouched by fixture');
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
});
