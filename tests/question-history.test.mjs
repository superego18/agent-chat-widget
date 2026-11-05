import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createChatHandler } from '../scripts/chat-handler.mjs';
import { getBrowser, closeBrowser } from './helpers.mjs';
after(closeBrowser);
const at = '2026-11-04T00:00:00Z';
const codexCall = { timestamp: at, type: 'response_item', payload: { type: 'function_call', name: 'request_user_input_async', call_id: 'call_question', arguments: JSON.stringify({ questions: [{ title: 'Which destination?', options: ['Local only', 'Shared workspace'] }] }) } };
const codexReply = (call = 'call_question') => ({ timestamp: '2026-11-04T00:00:01Z', type: 'response_item', payload: { type: 'message', role: 'user', id: 'reply', content: [{ type: 'input_text', text: '<send_user_message_question_reply>\n' + JSON.stringify([{ answer: 'Local only', question: 'Which destination?', questionItemId: JSON.stringify(['request_user_input_async', call, 0]) }]) + '\n</send_user_message_question_reply>' }] } });
const claudeCall = { timestamp: at, type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'ask_question', name: 'AskUserQuestion', input: { questions: [{ question: 'Which destination?', header: 'Destination', multiSelect: true, options: [{ label: 'Local only', description: 'Keep private' }, { label: 'Shared workspace', description: 'Share with the team' }] }] } }] } };
const claudeReply = { timestamp: '2026-11-04T00:00:01Z', type: 'user', uuid: 'claude-reply', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'ask_question', content: 'Native answered summary' }] }, toolUseResult: { questions: claudeCall.message.content[0].input.questions, answers: { 'Which destination?': 'Local only' }, annotations: {} } };

async function fixture(t, tool, rows) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-questions-'));
  const id = '11111111-1111-4111-8111-111111111111', file = path.join(root, 'native.jsonl');
  fs.mkdirSync(path.join(root, 'sessions'));
  fs.writeFileSync(file, rows.map(JSON.stringify).join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'sessions', id + '.json'), JSON.stringify({ sessionId: id, name: 'Question session', tool, agent: tool, path: file }));
  const handler = createChatHandler({ root, readControl: async () => [] });
  let browserContext;
  const server = http.createServer((req, res) => {
    if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><meta name="viewport" content="width=device-width"><body>Question fixture<script src="/__uifb/widget.js"></script></body>'); }
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname.startsWith('/__uifb/api/')) url.pathname = url.pathname.slice('/__uifb'.length);
    if (!handler.handle(req, res, url)) { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await browserContext?.close();
    await handler.shutdown();
    await new Promise(r => { server.close(r); server.closeAllConnections(); });
    fs.rmSync(root, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  return { file, root, base, ownContext: ctx => { browserContext = ctx; }, read: () => fetch(base + '/api/transcript?session=' + id).then(r => r.json()) };
}

for (const [tool, call, reply] of [['codex', codexCall, codexReply()], ['claude', claudeCall, claudeReply]]) test(`${tool} question and native answer are visible exactly once through the real transcript API`, async t => {
  const { file, read } = await fixture(t, tool, [call]);
  const before = fs.readFileSync(file);
  let data = await read();
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].from, 'agent');
  assert.match(data.items[0].text, /Which destination\?/);
  assert.match(data.items[0].text, /Local only/);
  assert.match(data.items[0].text, /Shared workspace/);
  if (tool === 'claude') assert.match(data.items[0].text, /Keep private/);
  assert.deepEqual(fs.readFileSync(file), before, 'provider history is read-only');
  const questionId = data.items[0].id;
  fs.appendFileSync(file, JSON.stringify(reply) + '\n');
  data = await read();
  assert.equal(data.items.length, 2);
  assert.equal(data.items[0].id, questionId);
  assert.equal(data.items[1].from, 'user');
  assert.match(data.items[1].text, /Which destination\?/);
  assert.match(data.items[1].text, /Local only/);
  assert.doesNotMatch(data.items[1].text, /send_user_message_question_reply|questionItemId|Native answered summary/);
  assert.deepEqual((await read()).items, data.items, 'repeated polling cannot duplicate a question or answer');
});

test('Codex keeps the question across large tool output, partial UTF-8 append and provider replacement', async t => {
  const { file, read } = await fixture(t, 'codex', [codexCall]);
  const first = await read();
  fs.appendFileSync(file, JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'unrelated', output: 'x'.repeat(600000) } }) + '\n');
  const reply = codexReply();
  reply.payload.content[0].text = reply.payload.content[0].text.replace('Local only', '개인 공간');
  const bytes = Buffer.from(JSON.stringify(reply) + '\n');
  const split = bytes.indexOf(Buffer.from('개인')) + 1;
  fs.appendFileSync(file, bytes.subarray(0, split));
  assert.equal((await read()).items.length, 1);
  fs.appendFileSync(file, bytes.subarray(split));
  assert.match((await read()).items[1].text, /개인 공간/);
  fs.renameSync(file, file + '.old');
  fs.writeFileSync(file, '');
  const retained = await read();
  assert.equal(retained.items.length, 2);
  assert.equal(retained.items[0].id, first.items[0].id);
});

test('unmatched or quoted Codex reply envelopes stay ordinary input', async t => {
  const { read } = await fixture(t, 'codex', [codexReply('foreign-call')]);
  const data = await read();
  assert.equal(data.items.length, 1);
  assert.match(data.items[0].text, /send_user_message_question_reply/);
});

test('a matching native Codex tool answer closes its reply control and is displayed once; accepted output is not an answer', async t => {
  const call = structuredClone(codexCall);
  call.payload.name = 'request_user_input';
  call.payload.arguments = JSON.stringify({ questions: [{ id: 'destination', question: 'Which destination?', options: [{ label: 'Local only' }] }] });
  const { file, read } = await fixture(t, 'codex', [call]);
  assert.equal((await read()).items[0].nativeQuestion.itemId, 'call_question');
  fs.appendFileSync(file, JSON.stringify({ timestamp: '2026-11-04T00:00:01Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_question', output: JSON.stringify({ accepted: true }) } }) + '\n');
  assert.equal((await read()).items.length, 1);
  fs.appendFileSync(file, JSON.stringify({ timestamp: '2026-11-04T00:00:02Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_question', output: JSON.stringify({ answers: { destination: { answers: ['Local only'] } } }) } }) + '\n');
  const data = await read();
  assert.equal(data.items.length, 2); assert.equal(data.items[0].nativeQuestion, undefined);
  assert.match(data.items[1].text, /Local only/);
  assert.deepEqual((await read()).items, data.items);
});

test('Claude error or unrelated tool output is not displayed as an answered question', async t => {
  const error = structuredClone(claudeReply);
  error.message.content[0].is_error = true;
  const foreign = structuredClone(claudeReply);
  foreign.message.content[0].tool_use_id = 'foreign-call';
  const { read } = await fixture(t, 'claude', [claudeCall, error, foreign]);
  const data = await read();
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].from, 'agent');
});

test('unsupported asynchronous questions show the native-window boundary and refuse an answer without a message fallback', async t => {
  const f = await fixture(t, 'codex', [codexCall]);
  const original = fs.readFileSync(f.file);
  const response = await fetch(f.base + '/api/question', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: '11111111-1111-4111-8111-111111111111', itemId: 'call_question', submission: { revision: 'invented', answers: [{ id: 'q1', value: 'Local only' }] } }) });
  assert.equal(response.status, 409); assert.equal((await response.json()).state, 'unsupported');
  assert.deepEqual(fs.readFileSync(f.file), original);
  const ctx = await (await getBrowser()).newContext({ viewport: { width: 390, height: 844 } }); f.ownContext(ctx);
  const page = await ctx.newPage(); await page.goto(f.base); await page.locator('#btn').click();
  await page.locator('.native-question-note').waitFor();
  assert.match(await page.locator('.native-question-note').textContent(), /미지원/);
  assert.equal(await page.locator('.question-open').count(), 0);
});

for (const width of [390, 1440]) for (const [tool, call, reply] of [['codex', codexCall, codexReply()], ['claude', claudeCall, claudeReply]]) test(`${tool} question, choices and readable reply fit the actual widget at ${width}px`, async t => {
  const { base, ownContext } = await fixture(t, tool, [call, reply]);
  const ctx = await (await getBrowser()).newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
  ownContext(ctx);
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  await page.goto(base);
  await page.locator('#btn').click();
  await page.locator('#msgs .msg').filter({ hasText: '세션의 질문' }).waitFor();
  const question = page.locator('#msgs .msg').filter({ hasText: '세션의 질문' });
  const answer = page.locator('#msgs .msg').filter({ hasText: '질문에 답변' });
  assert.equal(await question.count(), 1);
  assert.equal(await answer.count(), 1);
  assert.match(await question.textContent(), /Which destination\?/);
  assert.match(await question.textContent(), /Shared workspace/);
  assert.match(await answer.textContent(), /Local only/);
  assert.doesNotMatch(await answer.textContent(), /questionItemId|send_user_message_question_reply/);
  assert.equal(await question.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.UIFB_QUESTION_EVIDENCE_DIR) {
    fs.mkdirSync(process.env.UIFB_QUESTION_EVIDENCE_DIR, { recursive: true });
    await page.locator('#msgs').screenshot({ path: path.join(process.env.UIFB_QUESTION_EVIDENCE_DIR, `${tool}-${width}.png`) });
  }
});
