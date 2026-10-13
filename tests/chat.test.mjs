// 대화창 핵심 흐름 시험(휴대폰 크기 크롬). 실행: npm test
// 각 시험은 실제로 있었던 문제에서 나왔다. 이름 뒤 괄호는 그 요청이나 문제.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { A, B, makeDir, startServer, openWidget, closeBrowser, sleep } from './helpers.mjs';

after(closeBrowser);

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const readChat = (srv) => JSON.parse(fs.readFileSync(path.join(srv.dir, 'chat.json'), 'utf8')).messages;

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
    await w.type('쓰던 글');
    await sleep(1500);
    await page.close();
    ({ w } = await openWidget(srv, { ctx }));
    await w.idle(800);
    assert.equal(await w.inputValue(), '쓰던 글');
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
