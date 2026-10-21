// 대화창 핵심 흐름 시험(휴대폰 크기 크롬). 실행: npm test
// 각 시험은 실제로 있었던 문제에서 나왔다. 이름 뒤 괄호는 그 요청이나 문제.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { A, B, makeDir, startServer, openWidget, closeBrowser, sleep } from './helpers.mjs';
import { writeJsonAtomic, interruptedSince } from '../scripts/chat-format.mjs';

after(closeBrowser);

const here = path.dirname(fileURLToPath(import.meta.url));
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const readChat = (srv) => JSON.parse(fs.readFileSync(path.join(srv.dir, 'chat.json'), 'utf8')).messages;

function writeFakeClaude(bin, source) {
  const windows = process.platform === 'win32';
  fs.writeFileSync(path.join(bin, windows ? 'claude.cjs' : 'claude'), source, { mode: 0o755 });
  if (windows) fs.writeFileSync(path.join(bin, 'claude.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0claude.cjs" %*\r\n`);
}

test('보내면 메시지가 하나 생기고 입력칸이 빈다', async () => {
  const srv = await startServer(makeDir());
  try {
    const { w, ctx } = await openWidget(srv);
    await w.type('안녕');
    await w.click('#form button[type="submit"]');
    await w.idle(1200);
    assert.equal(await w.inputValue(), '');
    const sent = readChat(srv).filter((m) => m.from === 'user');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, '안녕');
    assert.ok((await w.msgs()).some((m) => m.text === '안녕'));
    await ctx.close();
  } finally { srv.stop(); }
});

test('서버 답이 늦어 다시 눌러도 메시지는 한 번만 생긴다 (보내기 로딩·다시 누르기)', async () => {
  const srv = await startServer(makeDir());
  try {
    const { w, page, ctx } = await openWidget(srv);
    let first = true;
    await page.route('**/__uifb/api/chat', async (route) => {
      if (route.request().method() === 'POST' && first) { first = false; await sleep(10_000); }
      await route.continue();
    });
    await w.type('늦은 글');
    await w.click('#form button[type="submit"]');
    await sleep(300);
    assert.equal(await w.eval((r) => r.querySelector('#form button[type="submit"]').classList.contains('busy')), true, '보내는 동안 단추가 돈다');
    assert.equal(await w.inputValue(), '늦은 글', '서버가 받기 전에는 입력칸을 비우지 않는다');
    await sleep(8300);
    assert.equal(await w.eval((r) => r.querySelector('#form button[type="submit"]').classList.contains('busy')), false, '8초 뒤에는 다시 누를 수 있다');
    await w.click('#form button[type="submit"]');
    await sleep(3500);
    assert.equal(readChat(srv).filter((m) => m.text === '늦은 글').length, 1);
    assert.equal(await w.inputValue(), '');
    await ctx.close();
  } finally { srv.stop(); }
});

test('안 읽힌 글에는 보내기 취소·보류로가 있고 다시 보내기는 읽힌 뒤에만 있다', async () => {
  const srv = await startServer(makeDir({ messages: [{ id: 1, from: 'user', to: A, text: '첫 글', context: 'app', at: iso(5000) }] }));
  try {
    const { w, ctx } = await openWidget(srv);
    let m = (await w.msgs()).find((x) => x.id === '1');
    assert.ok(m.buttons.includes('보내기 취소') && m.buttons.includes('보류로'));
    assert.ok(!m.buttons.includes('다시 보내기'));
    fs.writeFileSync(path.join(srv.dir, 'delivered.json'), JSON.stringify({ [A]: 1, _at: { 1: iso(1000) } }));
    await w.idle(3500);
    m = (await w.msgs()).find((x) => x.id === '1');
    assert.ok(m.buttons.includes('다시 보내기'));
    assert.ok(!m.buttons.includes('보내기 취소'));
    await ctx.close();
  } finally { srv.stop(); }
});

test('안 읽힌 글을 보류로 돌리면 취소되고 같은 글이 보류에 생긴다', async () => {
  const srv = await startServer(makeDir({ messages: [{ id: 1, from: 'user', to: A, text: '보류할 글', context: 'app', at: iso(5000) }] }));
  try {
    const { w, ctx } = await openWidget(srv);
    await w.clickText('보류로', '.msg[data-id="1"]');
    await w.idle(1500);
    assert.ok(readChat(srv).find((m) => m.id === 1).cancelled);
    assert.deepEqual((await w.holds()).map((h) => h.text), ['보류할 글']);
    await ctx.close();
  } finally { srv.stop(); }
});

test('새로고침해도 입력칸 글과 붙여 둔 참고가 남는다 (하던 것은 보존)', async () => {
  const srv = await startServer(makeDir({ messages: [{ id: 1, from: 'agent', session: A, text: '세션 답', at: iso(5000) }] }));
  try {
    let { w, page, ctx } = await openWidget(srv);
    await w.clickText('참고', '.msg[data-id="1"]');
    await w.type((await w.inputValue()) + '쓰던 글');
    await sleep(1500);
    await page.close();
    ({ w } = await openWidget(srv, { ctx }));
    await w.idle(800);
    assert.equal(await w.inputValue(), '📎1「세션…」 쓰던 글');
    assert.equal(await w.eval((r) => !r.getElementById('reply').hidden && r.getElementById('reply').classList.contains('ref')), true);
    await ctx.close();
  } finally { srv.stop(); }
});

test('세션이 보낸 마크다운 표는 표로 보인다 (#1812)', async () => {
  const text = '앞 글\n\n| 바꿀 것 | 찍을 곳 |\n|---|---|\n| 버튼 색 | **그 버튼** |\n| 간격 | 감싼 상자 |\n\n뒷 글';
  const srv = await startServer(makeDir({ messages: [{ id: 1, from: 'agent', session: A, text, at: iso(5000) }] }));
  try {
    const { w, ctx } = await openWidget(srv);
    const t = await w.eval((r) => { const tb = r.querySelector('.msg[data-id="1"] table'); return tb && { th: [...tb.querySelectorAll('th')].map((x) => x.textContent), rows: tb.querySelectorAll('tr').length, strong: !!tb.querySelector('td strong'), txt: r.querySelector('.msg[data-id="1"]').textContent }; });
    assert.deepEqual(t.th, ['바꿀 것', '찍을 곳']);
    assert.equal(t.rows, 3, '구분줄(|---|)은 줄로 그리지 않는다');
    assert.ok(t.strong, '칸 안의 굵은 글도 살린다');
    assert.match(t.txt, /앞 글[\s\S]*뒷 글/);
    await ctx.close();
  } finally { srv.stop(); }
});

test('이전 대화 더 보기: 120개씩 더 그리고 보던 메시지 자리를 지키며, 탭을 바꾸거나 다시 열면 120개로 돌아간다', async () => {
  const messages = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, from: i % 2 ? 'agent' : 'user', to: A, session: A, text: `글 ${i + 1}`, at: iso((300 - i) * 60_000) }));
  const srv = await startServer(makeDir({ messages, delivered: Object.fromEntries(messages.map((m) => [m.id, m.at])) }));
  try {
    const { w, ctx } = await openWidget(srv);
    const count = () => w.eval((r) => r.querySelectorAll('#msgs .msg').length);
    assert.equal(await count(), 120);
    assert.match(await w.eval((r) => r.getElementById('more').textContent), /남은 180개/);
    await w.eval((r) => { r.getElementById('msgs').scrollTop = 0; });
    await w.idle(200);
    const before = await w.eval((r) => { const m = r.querySelector('#msgs .msg'); return { id: m.dataset.id, y: m.getBoundingClientRect().top }; });
    await w.click('#more');
    await w.idle(200);
    assert.equal(await count(), 240);
    const after = await w.eval((r, id) => r.querySelector(`#msgs .msg[data-id="${id}"]`).getBoundingClientRect().top, before.id);
    assert.ok(Math.abs(after - before.y) < 2, `보던 메시지가 제자리에 (${before.y} → ${after})`);
    await w.click('#more');
    assert.equal(await count(), 300);
    assert.equal(await w.eval((r) => !!r.getElementById('more')), false, '다 보이면 단추가 없다');
    await w.eval((r) => r.querySelectorAll('#tabs .chipbtn')[1].click());
    await w.eval((r) => r.querySelectorAll('#tabs .chipbtn')[0].click());
    await w.idle(200);
    assert.equal(await count(), 120, '탭을 바꾸면 120개로');
    await w.click('#more');
    await w.click('#btn');
    await w.click('#btn');
    await w.idle(200);
    assert.equal(await count(), 120, '다시 열면 120개로');
    await ctx.close();
  } finally { srv.stop(); }
});

test('압축: cmux 창이 적힌 세션 탭에만 단추가 있고, 작업 중이면 받지 않는다 (#1851)', async () => {
  const dir = makeDir({ status: { [A]: { state: 'working', detail: '편집' } } });
  const f = path.join(dir, 'sessions', `${A}.json`);
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), cmux: { surface: '00000000-0000-4000-8000-00000000000f' } }));
  const srv = await startServer(dir);
  try {
    const { w, page, ctx } = await openWidget(srv);
    page.on('dialog', (d) => d.accept());
    assert.equal(await w.eval((r) => r.getElementById('compact').hidden), false, 'cmux 창이 있는 세션');
    await w.click('#compact');
    await w.idle(500);
    assert.match(await w.eval((r) => r.getElementById('toast').textContent), /작업 중/);
    assert.equal(await w.eval((r) => r.getElementById('stopBtn').hidden), false, '작업 중이면 중지 단추(#1910)');
    await w.eval((r) => r.querySelectorAll('#tabs .chipbtn')[1].click());
    assert.equal(await w.eval((r) => r.getElementById('compact').hidden), true, 'cmux 창 정보가 없는 세션은 단추가 없다');
    assert.equal(await w.eval((r) => r.getElementById('stopBtn').hidden), true);
    await ctx.close();
  } finally { srv.stop(); }
});

test('세션 탭에 컨텍스트 사용률: Claude 는 상태 줄이 남긴 값, Codex 는 기록의 token_count (#1856)', async () => {
  const dir = makeDir();
  fs.mkdirSync(path.join(dir, 'statusline'));
  fs.writeFileSync(path.join(dir, 'statusline', `${A}.json`), JSON.stringify({ session_id: A, context_window: { used_percentage: 85.4, total_input_tokens: 170800, context_window_size: 200000 } }));
  const roll = path.join(dir, 'rollout.jsonl');
  fs.writeFileSync(roll, JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 64600 }, model_context_window: 258400 } } }) + '\n');
  const f = path.join(dir, 'sessions', `${B}.json`);
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), tool: 'codex', path: roll }));
  const srv = await startServer(dir);
  try {
    const { w, ctx } = await openWidget(srv);
    const chips = await w.eval((r) => [...r.querySelectorAll('#tabs .chipbtn .tctx')].map((c) => [c.textContent, c.classList.contains('hi')]));
    assert.deepEqual(chips, [['85%', true], ['~25%', false]]);
    await ctx.close();
  } finally { srv.stop(); }
});

test('Codex 세션 상태는 대화 기록의 턴 표시로 읽는다 (#2113)', async () => {
  const dir = makeDir();
  const roll = path.join(dir, 'rollout.jsonl');
  const line = (payload) => JSON.stringify({ timestamp: new Date().toISOString(), type: payload.type === 'custom_tool_call' ? 'response_item' : 'event_msg', payload }) + '\n';
  fs.writeFileSync(roll, line({ type: 'task_complete', last_agent_message: '앞 답' }) + line({ type: 'task_started' }) + line({ type: 'custom_tool_call', name: 'exec' }));
  const f = path.join(dir, 'sessions', `${B}.json`);
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), tool: 'codex', path: roll }));
  const srv = await startServer(dir);
  const stateOf = async () => (await srv.api('/api/sessions')).sessions.find((x) => x.id === B).status;
  const until = async (ok) => { for (let i = 0; i < 40; i++) { const st = await stateOf(); if (ok(st)) return st; await new Promise((r) => setTimeout(r, 200)); } return stateOf(); };
  try {
    const st = await until((x) => x.state === 'working');
    assert.equal(st.state, 'working');
    assert.equal(st.detail, '명령 실행 중');
    fs.appendFileSync(roll, JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'message', id: 'a1', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: '다 했어' }] } }) + '\n');
    fs.appendFileSync(roll, line({ type: 'task_complete', last_agent_message: '다 했어' }));
    assert.equal((await until((x) => x.state === 'idle')).state, 'idle');
    for (let i = 0; i < 30 && !/answer → .*작업 세션 답장/.test(srv.log()); i++) await new Promise((r) => setTimeout(r, 200));
    assert.match(srv.log(), /answer → .*작업 세션 답장/, '새 Codex 답에 답장 알림');
  } finally { srv.stop(); }
});

test('Codex 답에도 답장 단추가 있고, 답장하면 원문이 Codex 에 함께 간다 (#2113)', async () => {
  const dir = makeDir();
  const roll = path.join(dir, 'rollout.jsonl');
  fs.writeFileSync(roll, JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: '코덱스 답' }] } }) + '\n');
  const f = path.join(dir, 'sessions', `${B}.json`);
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), tool: 'codex', path: roll }));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'uifb-bin-'));
  const log = path.join(bin, 'args.json');
  const fake = `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));\n`;
  fs.writeFileSync(path.join(bin, 'codex'), fake, { mode: 0o755 });
  // Windows 에서는 npm 설치 모양(codex.cmd 옆의 node_modules/@openai/codex/bin/codex.js)을 찾아 node 로 바로 부른다.
  if (process.platform === 'win32') {
    const cli = path.join(bin, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(cli, fake);
    fs.writeFileSync(path.join(bin, 'codex.cmd'), '@echo off\r\nexit /b 99\r\n');
  }
  const oldPath = process.env.PATH;
  process.env.PATH = bin + path.delimiter + oldPath;
  const srv = await startServer(dir);
  process.env.PATH = oldPath;
  try {
    const { w, ctx } = await openWidget(srv, { tab: B });
    await w.eval((r) => new Promise((ok) => { const t = setInterval(() => { if (r.querySelector('.msg[data-id="xmsg_1"] .rp')) { clearInterval(t); ok(); } }, 50); }));
    assert.deepEqual(await w.eval((r) => [...r.querySelectorAll('.msg[data-id="xmsg_1"] .rp')].map((b) => b.textContent)).then((l) => l.slice(0, 4)), ['답장', '참고', '복사', '고정']);
    await w.eval((r) => r.querySelector('.msg[data-id="xmsg_1"] .rp').click());
    const v = await w.inputValue();
    assert.match(v, /↩xmsg_1「/, '입력칸에 답장 칩이 들어간다');
    await w.type(v + '이거 다시');
    await w.click('#form button[type="submit"]');
    for (let i = 0; i < 40 && !fs.existsSync(log); i++) await new Promise((r) => setTimeout(r, 100));
    const msg = JSON.parse(fs.readFileSync(log, 'utf8')).at(-1);
    assert.match(msg, /이거 다시/);
    assert.match(msg, /답장 대상 \[xmsg_1\] 에이전트: 코덱스 답/);
    await ctx.close();
  } finally { srv.stop(); fs.rmSync(bin, { recursive: true, force: true }); }
});

test('비교 페이지 자동 이어가기는 받을 세션의 감시만 본다 (#2113)', async () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, `watch-${A}.json`), JSON.stringify({ session: A, name: '스킬 세션', handlesDone: true, pid: process.pid, startedAt: new Date().toISOString() }));
  const srv = await startServer(dir);
  try {
    assert.equal((await srv.api('/api/watch?session=' + encodeURIComponent('작업 세션'))).active, false, '다른 세션의 감시로 켜짐이 뜨지 않는다');
    assert.equal((await srv.api('/api/watch?session=' + encodeURIComponent('스킬 세션'))).active, true);
  } finally { srv.stop(); }
});

test('Codex 의 중간 안내는 최종 답과 구분해 보인다 (#2113)', async () => {
  const dir = makeDir();
  const roll = path.join(dir, 'rollout.jsonl');
  const msg = (id, text, phase) => JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'message', id, role: 'assistant', phase, content: [{ type: 'output_text', text }] } }) + '\n';
  fs.writeFileSync(roll, msg('m1', '확인할게', 'commentary') + msg('m2', '다 됐어', 'final_answer'));
  const f = path.join(dir, 'sessions', `${B}.json`);
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), tool: 'codex', path: roll }));
  const srv = await startServer(dir);
  try {
    const { w, ctx } = await openWidget(srv, { tab: B });
    await w.eval((r) => new Promise((ok) => { const t = setInterval(() => { if (r.querySelector('.msg[data-id="xm2"]')) { clearInterval(t); ok(); } }, 50); }));
    assert.deepEqual(await w.eval((r) => ['xm1', 'xm2'].map((id) => r.querySelector(`.msg[data-id="${id}"]`).classList.contains('interim'))), [true, false]);
    assert.match(await w.eval((r) => r.querySelector('.msg[data-id="xm1"] .tag').textContent), /중간 안내/);
    await ctx.close();
  } finally { srv.stop(); }
});

test('세션 탭은 머리줄 단추 옆에 갇히지 않고 한 줄에 들어가면 한 줄로 (#2136)', async () => {
  const srv = await startServer(makeDir());
  try {
    const { w, ctx } = await openWidget(srv);
    const tops = await w.eval((r) => [...r.querySelectorAll('#tabs .chipbtn')].map((b) => b.offsetTop));
    assert.equal(tops.length, 2);
    assert.equal(tops[0], tops[1], '두 탭이 같은 줄');
    // 좁은 폭에서도 탭 하나 안의 글은 한 줄(#2143)
    assert.ok(await w.eval((r) => [...r.querySelectorAll('#tabs .chipbtn')].every((b) => getComputedStyle(b).whiteSpace === 'nowrap')));
    await ctx.close();
  } finally { srv.stop(); }
});

test('데스크톱에서 끌어 정한 대화창 크기가 다시 열어도 남는다(높이 포함) (#1864)', async () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, 'prefs.json'), JSON.stringify({ desktop: { panel: { w: 500, h: 400 } } }));
  const srv = await startServer(dir);
  try {
    const { w, page, ctx } = await openWidget(srv);
    await page.setViewportSize({ width: 1200, height: 800 });
    await w.idle(1500);
    const sz = () => w.eval((r) => { const p = r.getElementById('panel').getBoundingClientRect(); return [Math.round(p.width), Math.round(p.height)]; });
    assert.deepEqual(await sz(), [500, 400]);
    await w.click('#close');
    await w.click('#btn');
    await w.idle(500);
    assert.deepEqual(await sz(), [500, 400], '닫았다 열어도 같은 크기');
    await ctx.close();
  } finally { srv.stop(); }
});

test('보류 글의 보관함 단추는 보류할 때가 아니라 누를 때 골라 둔 분류로 옮긴다 (#1869)', async () => {
  const drafts = [
    { id: 1, to: A, text: '분류 있음', label: '디자인', hold: true, at: iso(9000) },
    { id: 2, to: A, text: '분류 없음', label: null, hold: true, at: iso(8000) },
  ];
  const srv = await startServer(makeDir({ drafts }));
  try {
    const { w, ctx } = await openWidget(srv);
    await w.eval((r) => r.querySelectorAll('.msg.hold .tostash')[0].click());
    await w.idle(500);
    const d = JSON.parse(fs.readFileSync(path.join(srv.dir, 'drafts.json'), 'utf8')).drafts.find((x) => x.id === 1);
    assert.equal(d.hold, undefined);
    assert.equal(d.label, null, '눌렀을 때 골라 둔 분류(미분류)로 옮겨진다');
    await ctx.close();
  } finally { srv.stop(); }
});

test('보관함 글을 보류로 꺼낸다 (#1878)', async () => {
  const srv = await startServer(makeDir({ drafts: [{ id: 1, to: A, text: '나중 글', label: null, at: iso(9000) }, { id: 2, to: A, text: '다른 글', label: null, at: iso(8000) }] }));
  try {
    const { w, ctx } = await openWidget(srv);
    await w.click('#draftsBtn');
    await w.idle(300);
    await w.eval((r) => { const b = r.querySelector('.draft[data-id="1"] .tohold'); b.focus(); b.click(); }); // 마우스로 누르면 단추에 초점이 남는다
    await w.idle(800);
    assert.equal(JSON.parse(fs.readFileSync(path.join(srv.dir, 'drafts.json'), 'utf8')).drafts.find((d) => d.id === 1).hold, true);
    assert.equal(await w.eval((r) => !!r.querySelector('#drafts .draft[data-id="1"]')), false, '보관함에서 바로 빠진다(#1903)');
    assert.equal(await w.eval((r) => r.querySelectorAll('.msg.hold').length), 1, '대화창 맨 아래 보류로 보인다');
    await ctx.close();
  } finally { srv.stop(); }
});

test('보관함에서 보내면(이것만 보내기·분류 보내기) 보관함이 닫힌다 (#1881, #1883)', async () => {
  const srv = await startServer(makeDir({ drafts: [{ id: 1, to: A, text: '하나', label: null, at: iso(9000) }, { id: 2, to: A, text: '둘', label: null, at: iso(8000) }] }));
  try {
    const { w, ctx } = await openWidget(srv);
    await w.click('#draftsBtn');
    await w.idle(300);
    assert.equal(await w.eval((r) => r.getElementById('dsheet').hidden), false);
    await w.click('.draft[data-id="1"] .send1');
    await w.idle(800);
    assert.equal(await w.eval((r) => r.getElementById('dsheet').hidden), true, '남은 글이 있어도 닫힌다');
    await ctx.close();
  } finally { srv.stop(); }
});

test('보관함이 열려 있을 때 알림은 보관함 머리줄에 떠서 분류 칩을 가리지 않는다 (#1885)', async () => {
  const srv = await startServer(makeDir({ drafts: [{ id: 1, to: A, text: '하나', label: '기능', at: iso(9000) }, { id: 2, to: A, text: '둘', label: '디자인', at: iso(8000) }] }));
  try {
    const { w, ctx } = await openWidget(srv);
    await w.click('#draftsBtn');
    await w.idle(300);
    await w.eval((r) => { const s = r.querySelector('.draft[data-id="1"] select[aria-label="분류 바꾸기"]'); s.value = '디자인'; s.dispatchEvent(new Event('change')); });
    await w.idle(500);
    const [t, h, c] = await w.eval((r) => ['toast', 'dsheet', 'composeRow'].map((id) => { const b = (id === 'dsheet' ? r.getElementById(id).querySelector('.dhead') : r.getElementById(id)).getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; }));
    assert.ok(t.top >= h.top - 2 && t.bottom <= h.bottom + 2, `머리줄 안에 (${JSON.stringify([t, h])})`);
    assert.ok(t.bottom < c.top, '분류 칩 줄보다 위');
    await ctx.close();
  } finally { srv.stop(); }
});

test('목록 창: 서버가 준 공통 틀(제목·주소·상태·설명·단추)대로 그리고 숨긴 것은 따로 본다 (#1886, #1899)', async () => {
  const dir = makeDir();
  const row = (title, href, status, hidden) => ({ title, href, status, meta: ['44차', '작업 세션'], at: iso(1000), hidden, actions: [{ label: hidden ? '다시 보이기' : '숨기기', url: '/api/pages', body: { file: 'x', hidden: !hidden } }] });
  fs.writeFileSync(path.join(dir, 'pages-fixture.json'), JSON.stringify({ title: '비교 페이지', port: 4799, items: [
    row('44차 비교', '/', { text: '평가 완료', tone: 'done' }, false),
    row('칩 비교', '/review-x.html', { text: '평가 중 1/2', tone: 'part' }, false),
    row('옛 비교', '/review-old.html', { text: '평가 전', tone: 'todo' }, true),
  ] }));
  const srv = await startServer(dir);
  try {
    const { w, ctx } = await openWidget(srv);
    await w.click('#pagesBtn');
    await w.idle(500);
    const rows = () => w.eval((r) => [...r.querySelectorAll('#plist .page')].map((d) => [d.querySelector('a').textContent, d.querySelector('.pst').textContent]));
    assert.deepEqual(await rows(), [['44차 비교', '평가 완료'], ['칩 비교', '평가 중 1/2']]);
    assert.match(await w.eval((r) => r.querySelector('#plist .page a').getAttribute('href')), /:4799\/$/, '앱 화면에서는 비교 페이지 서버 주소로');
    await w.click('#phid');
    assert.equal((await rows()).length, 3, '숨긴 것 보기');
    await w.click('#pclose');
    assert.equal(await w.eval((r) => r.getElementById('psheet').hidden), true);
    await ctx.close();
  } finally { srv.stop(); }
});

test('페이지에서 대화창 바깥을 누르면 대화창이 닫히고, 안쪽을 누르면 그대로다 (#1906)', async () => {
  const srv = await startServer(makeDir());
  try {
    const { w, page, ctx } = await openWidget(srv);
    await page.setViewportSize({ width: 1200, height: 800 });
    await w.idle(500);
    const r = await w.eval((r) => { const b = r.getElementById('input').getBoundingClientRect(); return { x: b.left + 10, y: b.top + 10 }; });
    await page.mouse.click(r.x, r.y);
    assert.equal(await w.eval((r) => r.getElementById('panel').hidden), false, '안쪽은 그대로');
    await page.mouse.click(1100, 100);
    assert.equal(await w.eval((r) => r.getElementById('panel').hidden), true, '바깥을 누르면 닫힘');
    await ctx.close();
  } finally { srv.stop(); }
});

test('읽힌 뒤 중지했으면 답하는 중이 아니라 멈췄다고 보인다 (#1928)', async () => {
  const srv = await startServer(makeDir({ messages: [{ id: 1, from: 'user', to: A, text: '해 줘', context: 'app', at: iso(60000) }], delivered: { [A]: 1, _at: { 1: iso(50000) } }, status: { [A]: { state: 'idle', detail: '중지함' } } }));
  try {
    const { w, ctx } = await openWidget(srv);
    assert.match(await w.eval((r) => r.getElementById('msgs').textContent), /중지해서 멈췄습니다/);
    await ctx.close();
  } finally { srv.stop(); }
});

test('세션끼리: 이 세션이 보낸 글에 상대 세션이 보낸 답을 선으로 잇는다 (#1936)', async () => {
  const messages = [
    { id: 1, from: 'peer', session: A, to: B, text: '이것 확인해 줘', at: iso(60000), readAt: iso(59000) },
    { id: 2, from: 'peer', session: B, to: A, text: '확인했어', at: iso(30000), readAt: iso(29000) },
  ];
  const srv = await startServer(makeDir({ messages }));
  try {
    const { w, ctx } = await openWidget(srv);
    await w.idle(500);
    assert.ok(await w.eval((r) => r.querySelectorAll('#msgs svg.links path').length) > 0, '연결선이 그려진다');
    await ctx.close();
  } finally { srv.stop(); }
});

test('대화 순서: 읽힌 시각 순서로 놓되, 한참 뒤 다시 넘긴 옛 메시지는 보낸 자리에 둔다', async () => {
  const srv = await startServer(makeDir({
    messages: [
      { id: 1, from: 'user', to: A, text: '옛 글', context: 'app', at: iso(3 * 3600_000) },
      { id: 2, from: 'agent', session: A, text: '옛 답', at: iso(3 * 3600_000 - 60_000) },
      { id: 3, from: 'user', to: A, text: '작업 중에 보낸 글', context: 'app', at: iso(30_000) },
      { id: 4, from: 'agent', session: A, text: '그 사이 나온 답', at: iso(20_000) },
    ],
    // 1번은 방금 다시 넘겨졌고(3시간 뒤), 3번은 답(4번)이 나온 뒤에 읽혔다
    delivered: { [A]: 3, _at: { 1: iso(1000), 3: iso(10_000) } },
  }));
  try {
    const { w, ctx } = await openWidget(srv);
    const ids = (await w.msgs()).map((m) => m.id);
    assert.deepEqual(ids, ['1', '2', '4', '3']);
    await ctx.close();
  } finally { srv.stop(); }
});

test('위젯 파일이 바뀌기만 해서는 새로고침하지 않고, reload-widgets 를 부르면 안내를 띄운 뒤 새로고침한다', async () => {
  const srv = await startServer(makeDir());
  try {
    const { page, w, ctx } = await openWidget(srv);
    await page.evaluate(() => { window.__mark = 1; });
    await sleep(6000);
    assert.equal(await page.evaluate(() => window.__mark), 1, '저절로 새로고침하지 않는다');
    await srv.api('/api/reload-widgets', {});
    let shown = false;
    for (let i = 0; i < 70 && !shown; i++) { shown = await w.eval((r) => !r.getElementById('reloadCover').hidden).catch(() => false); if (!shown) await sleep(100); }
    assert.ok(shown, '새로 고치는 중 안내가 뜬다');
    await page.waitForFunction(() => window.__mark === undefined, null, { timeout: 5000 });
    await ctx.close();
  } finally { srv.stop(); }
});

test('서브에이전트 보고는 내 글이 아니라 서브에이전트 메시지로 남고, 앞 3줄만 보이다 펼치면 다 보인다 (#1945, #1948)', async () => {
  const srv = await startServer(makeDir());
  const cwd = fs.mkdtempSync(path.join(srv.dir, '..', 'uifb-cwd-'));
  try {
    fs.symlinkSync(srv.dir, path.join(cwd, '.ui-feedback'), process.platform === 'win32' ? 'junction' : 'dir');
    const sf = path.join(srv.dir, 'sessions', `${A}.json`);
    fs.writeFileSync(sf, JSON.stringify({ ...JSON.parse(fs.readFileSync(sf, 'utf8')), port: srv.port }));
    const report = Array.from({ length: 8 }, (_, i) => `  보고 ${i + 1}줄`).join('\n');
    const prompt = `<agent-message from="a1b2">\n[Subagent hand-back] 안내문. The report follows:\n${report}\n</agent-message>`;
    const output = execFileSync(process.execPath, [path.join(here, '..', 'scripts', 'hook-relay.mjs')], { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: A, cwd, prompt }), encoding: 'utf8', timeout: 10_000 });
    assert.equal(output, '', 'The hook exits without stray output or hanging');
    const [m] = readChat(srv);
    assert.equal(m.from, 'sub');
    assert.equal(m.sub, 'a1b2');
    assert.ok(m.text.startsWith('보고 1줄\n보고 2줄'), '안내문과 들여쓰기는 뗀다');
    const { w, ctx } = await openWidget(srv);
    await w.idle(300);
    const h = () => w.eval((r) => r.querySelector('.msg.sub .mbody').clientHeight);
    const folded = await h();
    assert.equal(await w.eval((r) => r.querySelector('.msg.sub .tag').textContent), '서브에이전트 보고');
    await w.eval((r) => r.querySelector('.msg.sub .subt').click());
    await w.idle(200);
    assert.ok((await h()) > folded * 2, '펼치면 길어진다');
    await ctx.close();
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); srv.stop(); }
});

test('메인 턴이 끝나도 백그라운드 서브에이전트가 돌면 작업 중으로 두고, 모두 끝나면 쉬는 중으로 바꾼다', async () => {
  const srv = await startServer(makeDir());
  const cwd = fs.mkdtempSync(path.join(srv.dir, '..', 'uifb-cwd-'));
  try {
    fs.symlinkSync(srv.dir, path.join(cwd, '.ui-feedback'), process.platform === 'win32' ? 'junction' : 'dir');
    const sf = path.join(srv.dir, 'sessions', `${A}.json`);
    fs.writeFileSync(sf, JSON.stringify({ ...JSON.parse(fs.readFileSync(sf, 'utf8')), port: srv.port }));
    const hook = (hook_event_name, extra = {}) => execFileSync(process.execPath, [path.join(here, '..', 'scripts', 'hook-relay.mjs')],
      { input: JSON.stringify({ hook_event_name, session_id: A, cwd, ...extra }), encoding: 'utf8', timeout: 10_000 });
    const state = () => JSON.parse(fs.readFileSync(path.join(srv.dir, `status-${A}.json`), 'utf8'));
    hook('UserPromptSubmit', { prompt: '' });
    hook('SubagentStart', { agent_id: 'bg1' });
    assert.equal(state().state, 'working');
    hook('Stop');
    assert.equal(state().state, 'working', '서브에이전트가 남아 있으면 쉬는 중으로 바꾸지 않는다');
    assert.match(state().detail, /하위 작업 1개/);
    hook('SubagentStop', { agent_id: 'bg1' });
    assert.equal(state().state, 'idle', '마지막 서브에이전트가 끝나면 쉬는 중');
    hook('UserPromptSubmit', { prompt: '' });
    hook('SubagentStart', { agent_id: 'fg1' });
    hook('SubagentStop', { agent_id: 'fg1' });
    assert.equal(state().state, 'working', '메인 턴 중에 끝난 서브에이전트는 쉬는 중을 보내지 않는다');
    hook('Stop');
    assert.equal(state().state, 'idle');
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); srv.stop(); }
});

test('끼워넣기는 서브에이전트의 도구 훅에는 넣지 않고 메인 세션의 도구 훅에 넣는다', async () => {
  const srv = await startServer(makeDir({ messages: [
    { id: 1, from: 'user', to: A, text: '중간에 한마디', interject: true, at: iso(1000) },
  ] }));
  const cwd = fs.mkdtempSync(path.join(srv.dir, '..', 'uifb-cwd-'));
  try {
    fs.symlinkSync(srv.dir, path.join(cwd, '.ui-feedback'), process.platform === 'win32' ? 'junction' : 'dir');
    fs.writeFileSync(path.join(srv.dir, 'delivered.json'), JSON.stringify({}));
    const hook = (extra = {}) => execFileSync(process.execPath, [path.join(here, '..', 'scripts', 'hook-relay.mjs')],
      { input: JSON.stringify({ hook_event_name: 'PostToolUse', session_id: A, cwd, tool_name: 'Bash', tool_input: {}, ...extra }), encoding: 'utf8', timeout: 10_000 });
    assert.equal(hook({ agent_id: 'sub1' }), '', '서브에이전트에는 넣지 않는다');
    assert.match(hook(), /중간에 한마디/, '메인 세션에는 넣는다');
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); srv.stop(); }
});

test('한 글 안 여러 곳에 답장·참고: 커서 자리에 줄을 바꾸지 않고 표시가 들어가고, 아래 목록에 무엇인지 보이며, 보내면 그 자리에 인용이 그려진다 (#1955, #1957, #1964)', async () => {
  const srv = await startServer(makeDir({ messages: [
    { id: 1, from: 'agent', session: A, text: '첫 번째 답', at: iso(9000) },
    { id: 2, from: 'agent', session: A, text: '두 번째 답', at: iso(8000) },
    { id: 3, from: 'agent', session: A, text: '세 번째 답', at: iso(7000) },
  ] }));
  try {
    const { w, ctx } = await openWidget(srv);
    await w.clickText('답장', '.msg[data-id="1"]');
    await w.type((await w.inputValue()) + '이건 좋아');
    await w.clickText('참고', '.msg[data-id="2"]');
    await w.type((await w.inputValue()) + '이것도 같이 봐');
    await w.clickText('답장', '.msg[data-id="3"]');
    assert.equal(await w.inputValue(), '↩1「첫\u00a0번…」 이건 좋아 📎2「두\u00a0번…」 이것도 같이 봐 ↩3「세\u00a0번…」 ');
    assert.deepEqual(await w.eval((r) => [...r.querySelectorAll('#reply .rref span')].map((e) => e.textContent.split(' · ')[0])), ['↩#1 답장', '📎#2 참고', '↩#3 답장']);
    await w.eval((r) => r.querySelectorAll('#reply .rref')[2].lastElementChild.click()); // 마지막 것을 빼면 글 속 표시도 지워진다
    assert.equal(await w.inputValue(), '↩1「첫\u00a0번…」 이건 좋아 📎2「두\u00a0번…」 이것도 같이 봐 ');
    await w.eval((r) => r.getElementById('form').requestSubmit());
    await w.idle(800);
    const m = readChat(srv).at(-1);
    assert.equal(m.text, '[↩#1] 이건 좋아 [📎#2] 이것도 같이 봐');
    assert.deepEqual(m.quotes, [{ id: 1 }, { id: 2, refer: true }]);
    assert.equal(await w.eval((r) => r.getElementById('reply').hidden), true);
    const kids = await w.eval((r, id) => [...r.querySelector(`.msg[data-id="${id}"] .mbody`).children].map((e) => e.className), m.id);
    assert.deepEqual(kids, ['quote whole', 'seg', 'quote ref', 'seg']);
    await ctx.close();
  } finally { srv.stop(); }
});

test('보관함에서 분류째 묶어 보내도 항목마다 붙인 답장·참고가 그 자리에 남는다 (#1965)', async () => {
  const messages = [
    { id: 1, from: 'agent', session: A, text: '첫 번째 답', at: iso(9000) },
    { id: 2, from: 'agent', session: A, text: '두 번째 답', at: iso(8000) },
  ];
  const drafts = [
    { id: 1, to: A, label: '묶음', text: '[↩#1] 이건 좋아', quotes: [{ id: 1, quote: '첫 번째' }], at: iso(5000) },
    { id: 2, to: A, label: '묶음', text: '예전 방식 참고', replyTo: 2, refer: true, at: iso(4000) },
  ];
  const srv = await startServer(makeDir({ messages, drafts }));
  try {
    await srv.api('/api/drafts', { action: 'send', ids: [1, 2] });
    const m = readChat(srv).at(-1);
    assert.deepEqual(m.quotes, [{ id: 1, quote: '첫 번째' }, { id: 2, refer: true }]);
    assert.match(m.text, /\[↩#1\] 이건 좋아[\s\S]*\[📎#2\] 예전 방식 참고/);
    const { w, ctx } = await openWidget(srv);
    await w.idle(300);
    assert.deepEqual(await w.eval((r, id) => [...r.querySelectorAll(`.msg[data-id="${id}"] .mbody .quote`)].map((e) => e.className), m.id), ['quote part', 'quote ref']);
    await ctx.close();
  } finally { srv.stop(); }
});

test('입력칸 아래 붙인 답장·참고 줄을 누르면 원문이 다 펼쳐지고, 원문으로를 누르면 그 메시지로 간다 (#1971)', async () => {
  const long = '긴 원문 '.repeat(40) + '끝부분';
  const srv = await startServer(makeDir({ messages: [{ id: 1, from: 'agent', session: A, text: long, at: iso(9000) }] }));
  try {
    const { w, ctx } = await openWidget(srv);
    await w.clickText('답장', '.msg[data-id="1"]');
    assert.doesNotMatch(await w.eval((r) => r.querySelector('#reply .rref span').textContent), /끝부분/);
    await w.eval((r) => r.querySelector('#reply .rref span').click());
    assert.match(await w.eval((r) => r.querySelector('#reply .rref span').textContent), /끝부분/);
    await w.clickText('원문으로', '#reply');
    await w.idle(100);
    assert.equal(await w.eval((r) => r.querySelector('.msg[data-id="1"]').classList.contains('flashing')), true);
    await ctx.close();
  } finally { srv.stop(); }
});

test('입력칸 속 답장·참고 표시는 칩처럼 칠해지고, 지우면 한 글자씩이 아니라 통째로 지워진다 (#1973, #1977)', async () => {
  const srv = await startServer(makeDir({ messages: [{ id: 12, from: 'agent', session: A, text: '세션 답', at: iso(9000) }] }));
  try {
    const { w, page, ctx } = await openWidget(srv);
    await w.clickText('답장', '.msg[data-id="12"]');
    await w.type((await w.inputValue()) + '좋아');
    assert.deepEqual(await w.eval((r) => [...r.querySelectorAll('#inback mark')].map((e) => e.textContent)), ['↩12「세션…」']);
    await w.eval((r) => { const i = r.getElementById('input'); i.focus(); i.setSelectionRange(8, 8); }); // 칩 바로 뒤(빈칸 앞)
    await page.keyboard.press('Backspace');
    assert.equal(await w.inputValue(), ' 좋아');
    assert.equal(await w.eval((r) => r.getElementById('reply').hidden), true, '칩을 지우면 붙인 것도 빠진다');
    await w.clickText('답장', '.msg[data-id="12"]');
    await page.keyboard.type('a'); // 붙인 직후 친 글자는 칩 뒤 빈칸 뒤에 붙는다(빈칸을 덮어쓰지 않는다, #1986)
    assert.equal(await w.inputValue(), '↩12「세션…」 a좋아');
    await ctx.close();
  } finally { srv.stop(); }
});

test('좁은 창이어도 터치 화면이 아니면 데스크톱에서 보낸 것으로 적는다 (#1982)', async () => {
  const srv = await startServer(makeDir());
  try {
    const b = await (await import('./helpers.mjs')).getBrowser();
    const ctx = await b.newContext({ viewport: { width: 500, height: 800 } });
    const { w } = await openWidget(srv, { ctx });
    await w.type('좁은 데스크톱 창');
    await w.eval((r) => r.getElementById('form').requestSubmit());
    await w.idle(600);
    assert.equal(readChat(srv).at(-1).device, 'desktop');
    await ctx.close();
  } finally { srv.stop(); }
});

test('메시지를 고정하면 대화창 위에 남고, 거기서 답장·참고·고정 해제를 원래 말풍선과 똑같이 한다 (#1999)', async () => {
  const messages = [
    { id: 1, from: 'agent', session: A, text: '고정할 답', at: iso(9000) },
    ...Array.from({ length: 130 }, (_, i) => ({ id: i + 2, from: 'agent', session: A, text: `다른 답 ${i}`, at: iso(8000 - i * 10) })),
  ];
  const srv = await startServer(makeDir({ messages }));
  try {
    const { w, ctx } = await openWidget(srv);
    await w.idle(300);
    await w.clickText('고정', '.msg[data-id="131"]');
    await w.idle(200);
    assert.equal(await w.eval((r) => r.querySelector('#pinbar .msg').dataset.id), '131');
    await w.clickText('고정 해제', '#pinbar');
    await w.idle(200);
    assert.equal(await w.eval((r) => r.getElementById('pinbar').hidden), true);
    // 120개 밖의 옛 메시지도 고정해 두면 다시 열었을 때 보인다(두 화면 공용 설정)
    await srv.api('/api/prefs', { pins: { session: A, ids: [1] } });
    const { w: w2 } = await openWidget(srv, { ctx });
    await w2.idle(500);
    assert.match(await w2.eval((r) => r.querySelector('#pinbar .msg .mbody').textContent), /고정할 답/);
    await w2.clickText('참고', '#pinbar');
    assert.match(await w2.inputValue(), /^📎1「고정할…」 $/);
    await ctx.close();
  } finally { srv.stop(); }
});

test('고정 칸: 처음엔 한 줄씩, 3줄씩으로 바꿀 수 있고, 찾은 것을 눌러 펼친다 (#2006, #2011)', async () => {
  const long = Array.from({ length: 12 }, (_, i) => `${i + 1}째 줄`).join('\n\n');
  const srv = await startServer(makeDir({ messages: [{ id: 1, from: 'agent', session: A, text: long, at: iso(9000) }, { id: 2, from: 'agent', session: A, text: '짧은 답', at: iso(8000) }] }));
  try {
    await srv.api('/api/prefs', { pins: { session: A, ids: [1, 2] } });
    const { w, ctx } = await openWidget(srv);
    await w.idle(500);
    const h = () => w.eval((r) => r.querySelector('#pinbar .msg[data-id="1"] .mbody').getBoundingClientRect().height);
    const one = await h();
    assert.ok(one < 30, '처음엔 한 줄');
    assert.equal(await w.eval((r) => [...r.querySelectorAll('#pinbar .msg[data-id="1"] small button')].find((b) => b.textContent === '펼치기').offsetParent !== null), true, '한 줄 모드에서도 시간·단추 줄과 펼치기가 보인다 (#2013, #2015)');
    assert.equal(await w.eval((r) => !!r.querySelector('#pinbar .msg[data-id="1"] .mbody > .tag')), true, '꼬리표는 글 첫 줄에');
    await w.clickText('3줄씩 보기', '#pinbar');
    await w.idle(100);
    const three = await h();
    assert.ok(three > one * 2 && three < 90, '3줄');
    await w.eval((r) => r.querySelector('#pinbar .msg[data-id="1"] .mbody').click()); // 말풍선을 눌러 펼친다
    await w.idle(100);
    assert.ok((await h()) > three * 2, '펼치면 다 보인다');
    await w.clickText('접기', '#pinbar .msg[data-id="1"]');
    await w.idle(100);
    assert.ok((await h()) < 90);
    await ctx.close();
  } finally { srv.stop(); }
});

test('보관함에서 지우면 그 자리에서 바로 빠진다 (#2019)', async () => {
  const srv = await startServer(makeDir({ drafts: [{ id: 1, to: A, text: '지울 글', label: null, at: iso(9000) }, { id: 2, to: A, text: '다른 글', label: null, at: iso(8000) }] }));
  try {
    const { w, ctx } = await openWidget(srv);
    await w.click('#draftsBtn');
    await w.idle(300);
    await w.eval((r) => { const b = [...r.querySelectorAll('.draft[data-id="1"] button')].find((x) => x.textContent.trim() === '지우기'); b.focus(); b.click(); });
    await w.idle(500);
    assert.equal(await w.eval((r) => !!r.querySelector('#drafts .draft[data-id="1"]')), false);
    await ctx.close();
  } finally { srv.stop(); }
});

test('앱 화면에서 대화창을 열어 둬도, 같은 기기의 비교 페이지로 가면 닫혀 있다 (#2028)', async () => {
  const srv = await startServer(makeDir());
  try {
    fs.writeFileSync(path.join(srv.dir, 'r.html'), '<!doctype html><meta name="viewport" content="width=device-width"><title>r</title><body><script>window.__uifbConfig = { context: "review", label: "비교 페이지" };</script><script src="/__uifb/widget.js"></script></body>');
    const { w, page, ctx } = await openWidget(srv); // 앱 화면에서 연다
    assert.equal(await w.eval((r) => r.getElementById('panel').hidden), false);
    await page.goto(srv.base + '/r.html');
    await page.waitForFunction(() => [...document.querySelectorAll('*')].some((e) => e.shadowRoot?.getElementById('panel')));
    await sleep(800);
    assert.equal(await w.eval((r) => r.getElementById('panel').hidden), true, '비교 페이지에서는 닫혀 있다');
    await page.goto(srv.base + '/t.html');
    await page.waitForFunction(() => [...document.querySelectorAll('*')].some((e) => e.shadowRoot?.getElementById('panel')));
    await sleep(800);
    assert.equal(await w.eval((r) => r.getElementById('panel').hidden), false, '앱 화면으로 돌아오면 다시 열려 있다');
    await ctx.close();
  } finally { srv.stop(); }
});

test('메시지마다 복사 단추로 글을 복사한다: 원래 글과 서식 둘 다 (#2036, #2038)', async () => {
  const srv = await startServer(makeDir({ messages: [{ id: 1, from: 'agent', session: A, text: '복사할 **글**\n- 항목\n  - 하위', at: iso(9000) }] }));
  try {
    const { w, page, ctx } = await openWidget(srv);
    await page.evaluate(() => { window.__copied = null; navigator.clipboard.write = async ([it]) => { window.__copied = { plain: await (await it.getType('text/plain')).text(), html: await (await it.getType('text/html')).text() }; }; });
    await w.clickText('복사', '.msg[data-id="1"]');
    await w.idle(200);
    const c = await page.evaluate(() => window.__copied);
    assert.equal(c.plain, '복사할 **글**\n- 항목\n  - 하위');
    assert.match(c.html, /<strong>글<\/strong>[\s\S]*<ul><li>항목<ul><li>하위<\/li><\/ul><\/li><\/ul>/, '서식(굵게·글머리)도 함께 (#2038)');
    await ctx.close();
  } finally { srv.stop(); }
});

test('글머리 항목: 입력칸에서 이어 쓰고 들이고, 보낸 메시지에서는 목록으로 보인다 (#2040)', async () => {
  const srv = await startServer(makeDir({ messages: [{ id: 1, from: 'agent', session: A, text: '목록\n- 하나\n  - 하위\n1. 번호', at: iso(9000) }] }));
  try {
    const { w, page, ctx } = await openWidget(srv);
    assert.deepEqual(await w.eval((r) => [...r.querySelectorAll('.msg[data-id="1"] .li')].map((e) => [e.textContent, e.style.getPropertyValue('--d')])), [['•하나', '0'], ['•하위', '1'], ['1.번호', '0']]);
    await w.eval((r) => r.getElementById('input').focus());
    await page.keyboard.type('- 첫째');
    await page.keyboard.press('Shift+Enter');
    assert.equal(await w.inputValue(), '- 첫째\n- ');
    await page.keyboard.press('Tab');
    await page.keyboard.type('하위');
    assert.equal(await w.inputValue(), '- 첫째\n  - 하위');
    assert.deepEqual(await w.eval((r) => [...r.querySelectorAll('#inback i.bul')].map((e) => e.textContent)), ['-', '-'], '입력칸에서도 줄 머리 -는 •로 보인다 (#2046)');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.press('Shift+Enter'); // 빈 항목에서 한 번 더 바꾸면 목록이 끝난다
    assert.equal(await w.inputValue(), '- 첫째\n  - 하위\n');
    await page.keyboard.type('- 둘째');
    for (let k = 0; k < 3; k++) await page.keyboard.press('Tab'); // 윗줄보다 한 단계까지만 들어간다 (#2051)
    assert.equal(await w.inputValue(), '- 첫째\n  - 하위\n    - 둘째');
    await w.eval((r) => { const i = r.getElementById('input'); i.value = '1. 가\n2. 나'; i.setSelectionRange(i.value.length, i.value.length); });
    await page.keyboard.press('Tab'); // 하위 번호는 1부터
    assert.equal(await w.inputValue(), '1. 가\n  1. 나');
    await page.keyboard.press('Shift+Tab'); // 내어 쓰면 그 단계 앞 번호 다음
    assert.equal(await w.inputValue(), '1. 가\n2. 나');
    await ctx.close();
  } finally { srv.stop(); }
});

test('곁질문: 세션에 보내지 않고 사본 답을 같은 칸에 붙인다 (#2055)', async () => {
  // 가짜 claude: 받은 인자와 질문을 그대로 답으로 돌려준다.
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'uifb-bin-'));
  writeFakeClaude(bin, `#!/usr/bin/env node\nlet s='';process.stdin.on('data',(b)=>s+=b).on('end',()=>console.log(JSON.stringify({session_id:'fork-1',result:'사본 답 '+process.argv.slice(2).join(' ')+' | '+s})));\n`);
  const oldPath = process.env.PATH;
  process.env.PATH = bin + path.delimiter + oldPath;
  const srv = await startServer(makeDir());
  process.env.PATH = oldPath;
  try {
    const { w, ctx } = await openWidget(srv);
    await w.type('곁으로 묻기');
    await w.eval((r) => r.getElementById('side').click());
    let msgs = [];
    for (let i = 0; i < 40 && msgs.length < 2; i++) { await new Promise((r) => setTimeout(r, 100)); msgs = (await srv.api('/api/chat')).messages; }
    const [q, a] = msgs;
    assert.equal(q.context, 'side');
    assert.equal(q.to, undefined, '질문은 세션에 전달되지 않는다');
    assert.equal(q.session, A);
    assert.equal(a.from, 'agent');
    assert.deepEqual(a.re, [q.id]);
    assert.match(a.text, /--resume aaaaaaaa-0000-4000-8000-000000000001 --fork-session/);
    assert.match(a.text, /--tools Read,Grep,Glob/);
    assert.match(a.text, /\[곁질문\][\s\S]*곁으로 묻기/);
    await w.eval((r) => new Promise((ok) => { const t = setInterval(() => { if (r.querySelectorAll('.msg.side').length === 2) { clearInterval(t); ok(); } }, 100); }));
    assert.equal(await w.eval((r) => r.querySelector('.msg.side .tag').textContent), '곁질문 · 모바일');
    assert.equal(await w.inputValue(), '');
    // 끊으면 숨고, 목록에서 다시 펼쳐 이어 물으면 같은 사본에 이어 묻는다 (#2083·#2090)
    await w.eval((r) => r.getElementById('sideCut').click());
    assert.equal(await w.eval((r) => r.querySelectorAll('.msg.side').length), 0, '평소에는 곁질문이 숨는다');
    await w.eval((r) => r.getElementById('side').click()); // 입력칸이 비었으면 묶음 목록
    assert.equal(await w.eval((r) => r.querySelectorAll('#sidepop button').length), 1);
    await w.eval((r) => r.querySelector('#sidepop button').click());
    assert.equal(await w.eval((r) => r.querySelectorAll('.msg.side').length), 2);
    await w.type('이어서 묻기');
    await w.eval((r) => r.getElementById('side').click());
    for (let i = 0; i < 40 && msgs.length < 4; i++) { await new Promise((r) => setTimeout(r, 100)); msgs = (await srv.api('/api/chat')).messages; }
    assert.deepEqual(msgs.map((m) => m.sideGroup), [q.id, q.id, q.id, q.id]);
    assert.match(msgs[3].text, /--resume fork-1 --settings/, '같은 묶음은 만들어 둔 사본에 이어 묻는다');
    await ctx.close();
  } finally { srv.stop(); fs.rmSync(bin, { recursive: true, force: true }); }
});

test('말풍선을 오른쪽으로 밀면 그 메시지에 대한 곁질문 화면이 된다 (#2099·#2102)', async () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'uifb-bin-'));
  writeFakeClaude(bin, `#!/usr/bin/env node\nlet s='';process.stdin.on('data',(b)=>s+=b).on('end',()=>console.log(JSON.stringify({session_id:'fork-2',result:'사본 답 | '+s})));\n`);
  const oldPath = process.env.PATH;
  process.env.PATH = bin + path.delimiter + oldPath;
  const srv = await startServer(makeDir());
  process.env.PATH = oldPath;
  try {
    await srv.api('/api/chat', { from: 'agent', session: A, text: '첫 답' });
    await srv.api('/api/chat', { from: 'agent', session: A, text: '둘째 답' });
    const { w, ctx } = await openWidget(srv);
    await w.eval((r) => new Promise((ok) => { const t = setInterval(() => { if (r.querySelectorAll('.msg[data-id]').length === 2) { clearInterval(t); ok(); } }, 50); }));
    await w.eval((r) => {
      const el = r.querySelector('.msg[data-id="1"] .mbody'), b = el.getBoundingClientRect();
      const fire = (type, x) => { const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: b.top + 5 }); el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, composed: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t] })); };
      fire('touchstart', b.left + 5);
      for (const dx of [15, 40, 70, 90]) fire('touchmove', b.left + 5 + dx);
      fire('touchend', b.left + 95);
    });
    assert.match(await w.eval((r) => r.getElementById('sideText').textContent), /#1에 대한 새 곁질문/);
    assert.deepEqual(await w.eval((r) => [...r.querySelectorAll('.msg[data-id]')].map((e) => e.dataset.id)), ['1'], '곁질문 화면에는 고른 메시지만 보인다');
    await w.type('이거 왜?');
    await w.eval((r) => r.getElementById('side').click());
    let msgs = [];
    for (let i = 0; i < 40 && msgs.length < 4; i++) { await new Promise((r) => setTimeout(r, 100)); msgs = (await srv.api('/api/chat')).messages; }
    assert.equal(msgs[2].sideOn, 1);
    assert.match(msgs[3].text, /#1 메시지에 대한 것입니다: "첫 답"/);
    await w.eval((r) => new Promise((ok) => { const t = setInterval(() => { if (r.querySelectorAll('.msg[data-id]').length === 3) { clearInterval(t); ok(); } }, 50); }));
    assert.deepEqual(await w.eval((r) => [...r.querySelectorAll('.msg[data-id]')].map((e) => e.dataset.id)), ['1', '3', '4']);
    await w.eval((r) => r.getElementById('sideCut').click());
    assert.deepEqual(await w.eval((r) => [...r.querySelectorAll('.msg[data-id]')].map((e) => e.dataset.id)), ['1', '2'], '끊으면 원래 대화로');
    assert.match(await w.eval((r) => r.querySelector('.msg[data-id="1"] .sideb').textContent), /곁질문 2/);
    await ctx.close();
  } finally { srv.stop(); fs.rmSync(bin, { recursive: true, force: true }); }
});

test('감시를 쓰던 세션이 감시 없이 턴을 끝내려 하면 한 번 막고, 감시가 살아 있거나 이미 한 번 막았으면 끝낸다', async () => {
  const srv = await startServer(makeDir());
  const cwd = fs.mkdtempSync(path.join(srv.dir, '..', 'uifb-cwd-'));
  try {
    fs.symlinkSync(srv.dir, path.join(cwd, '.ui-feedback'), process.platform === 'win32' ? 'junction' : 'dir');
    const wf = path.join(srv.dir, `watch-${A}.json`);
    const stop = (extra = {}) => execFileSync(process.execPath, [path.join(here, '..', 'scripts', 'hook-relay.mjs')],
      { input: JSON.stringify({ hook_event_name: 'Stop', session_id: A, cwd, ...extra }), encoding: 'utf8', timeout: 10_000 });
    fs.rmSync(wf, { force: true });
    assert.equal(stop(), '', '감시를 쓴 적 없는 세션은 막지 않는다');
    fs.writeFileSync(wf, JSON.stringify({ session: A, pid: null, state: 'handling' }));
    const out = JSON.parse(stop());
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /wait-review\.mjs/);
    assert.equal(stop({ stop_hook_active: true }), '', '같은 턴에 두 번은 막지 않는다');
    fs.writeFileSync(wf, JSON.stringify({ session: A, pid: process.pid }));
    assert.equal(stop(), '', '감시가 살아 있으면 막지 않는다');
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); srv.stop(); }
});

test('Windows 에서 이름 바꾸기가 잠깐 막혀도(EPERM) 다시 시도하고, 끝내 막히면 대상 파일에 바로 써서 프로세스를 죽이지 않는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uifb-atomic-'));
  const file = path.join(dir, 'chat.json');
  const real = fs.renameSync;
  try {
    let fails = 2;
    fs.renameSync = (...a) => { if (fails-- > 0) throw Object.assign(new Error('busy'), { code: 'EPERM' }); return real(...a); };
    writeJsonAtomic(file, { n: 1 });
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).n, 1, '두 번 막힌 뒤 바꾸기에 성공한다');
    fs.renameSync = () => { throw Object.assign(new Error('busy'), { code: 'EPERM' }); };
    writeJsonAtomic(file, { n: 2 });
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).n, 2, '끝내 막히면 바로 쓴다');
    assert.deepEqual(fs.readdirSync(dir), ['chat.json'], '임시 파일을 남기지 않는다');
  } finally { fs.renameSync = real; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('터미널에서 Esc 로 멈춰 작업 중이 남아도, 대화 기록의 중단 표시가 더 늦으면 쉬는 중으로 본다', async () => {
  const at = new Date(Date.now() - 60_000).toISOString();
  const dir = makeDir({ status: { [A]: { state: 'working', detail: '명령 실행', at } } });
  const roll = path.join(dir, 'transcript.jsonl');
  const line = (ts) => JSON.stringify({ type: 'user', timestamp: ts, message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } });
  fs.writeFileSync(roll, line(new Date(Date.now() - 120_000).toISOString()) + '\n');
  assert.equal(interruptedSince(roll, at), null, '상태보다 앞선 중단은 지난 일이다');
  const f = path.join(dir, 'sessions', `${A}.json`);
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), path: roll }));
  const srv = await startServer(dir);
  try {
    const state = async () => (await srv.api('/api/sessions')).sessions.find((s) => s.id === A).status.state;
    assert.equal(await state(), 'working');
    fs.appendFileSync(roll, line(new Date().toISOString()) + '\n');
    assert.ok(interruptedSince(roll, at));
    assert.equal(await state(), 'idle', '중단 뒤에는 쉬는 중');
    const st = (await srv.api('/api/sessions')).sessions.find((s) => s.id === A).status;
    assert.equal(st.detail, '중지함', '중지 단추를 누른 것처럼 멈췄다고 보인다');
    assert.ok(Date.parse(st.at) > Date.parse(at), '중단 시각이 상태 시각이 된다');
  } finally { srv.stop(); }
});

test('마지막 글이 세션 답이어도 그 뒤에 중지했으면 작업을 중지했다고 보이고, 답 뒤에 끝났으면 보이지 않는다', async () => {
  const msg = { id: 1, from: 'agent', session: A, text: '지금 시작할게', at: iso(60000) };
  const srv = await startServer(makeDir({ messages: [msg], status: { [A]: { state: 'idle', detail: '중지함', at: iso(30000) } } }));
  try {
    const { w, ctx } = await openWidget(srv);
    assert.match(await w.eval((r) => r.getElementById('msgs').textContent), /작업을 중지했어요/);
    await ctx.close();
  } finally { srv.stop(); }
  const done = await startServer(makeDir({ messages: [msg], status: { [A]: { state: 'idle', detail: '', at: iso(30000) } } }));
  try {
    const { w, ctx } = await openWidget(done);
    assert.doesNotMatch(await w.eval((r) => r.getElementById('msgs').textContent), /중지/);
    await ctx.close();
  } finally { done.stop(); }
});
