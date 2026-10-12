// 화면 번호(보관함 글의 위치를 앱 위에 번호로)와 값 바꾸기(찍은 요소를 그 자리에서 바꿔 보고 바꾼 값을 함께 보냄) 시험. 실행: npm test
// 이름 뒤 괄호는 그 요청.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { A, makeDir, startServer, openWidget, closeBrowser } from './helpers.mjs';
import { formatMessage } from '../scripts/chat-format.mjs';

after(closeBrowser);

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const readChat = (srv) => JSON.parse(fs.readFileSync(path.join(srv.dir, 'chat.json'), 'utf8')).messages;
const h1Size = (page) => page.evaluate(() => getComputedStyle(document.getElementById('x')).fontSize);

test('보관함 글 중 이 화면에 찍은 것만 앱 위에 번호로 보이고, 누르면 그 글을 연다 (#1769 화면 번호)', async () => {
  const drafts = [
    { id: 1, to: A, text: '제목 키우기', label: '디자인', at: iso(9000), where: { url: '/t.html', selector: '#x', text: '앱 제목' } },
    { id: 2, to: A, text: '위치 없음', label: null, at: iso(8000) },
    { id: 3, to: A, text: '다른 화면', label: null, at: iso(7000), where: { url: '/other', selector: '#y' } },
  ];
  const srv = await startServer(makeDir({ drafts }));
  try {
    const { w, page, ctx } = await openWidget(srv, { open: false });
    const pins = await w.eval((r) => [...r.querySelectorAll('#pins .pin')].filter((p) => !p.hidden).map((p) => ({ n: p.textContent, x: parseFloat(p.style.left), y: parseFloat(p.style.top) })));
    assert.deepEqual(pins.map((p) => p.n), ['1']);
    const h = await page.evaluate(() => { const r = document.getElementById('x').getBoundingClientRect(); return { x: r.left, y: r.top }; });
    assert.ok(Math.abs(pins[0].x - h.x) < 14 && Math.abs(pins[0].y - h.y) < 14, '번호가 찍은 요소 모서리에 붙는다');

    await w.click('#pins .pin');
    await w.idle();
    assert.equal(await w.eval((r) => r.getElementById('panel').hidden), false, '대화창이 열린다');
    assert.equal(await w.eval((r) => r.getElementById('dsheet').hidden), false, '보관함이 열린다');
    assert.match(await w.eval((r) => r.querySelector('.draft[data-id="1"] .loc').textContent), /📍1/, '카드에도 같은 번호');

    await w.click('#pinsToggle');
    await w.idle(300);
    assert.equal(await w.eval((r) => r.getElementById('pins').hidden), true, '끄면 숨는다');
    const again = await openWidget(srv, { ctx, open: false });
    assert.equal(await again.w.eval((r) => r.getElementById('pins').hidden), true, '끈 것은 이 기기에 남는다');
    await ctx.close();
  } finally { srv.stop(); }
});

test('찍은 요소의 값을 바꿔 보면 화면에 바로 보이고, 보낼 때 바꾼 값이 위치와 함께 가며 화면은 원래대로 돌아온다 (#1769 값 바꾸기)', async () => {
  const srv = await startServer(makeDir());
  try {
    const { w, page, ctx } = await openWidget(srv);
    const before = await h1Size(page);
    await page.evaluate(() => { document.getElementById('x').__reactFiber$t = { type: 'h1', return: { type: function AppTitle() {} } }; }); // React 개발 모드가 요소에 남기는 것을 흉내
    await w.click('#pick');
    const r = await page.evaluate(() => { const b = document.getElementById('x').getBoundingClientRect(); return { x: b.left + 4, y: b.bottom - 4 }; });
    await page.mouse.click(r.x, r.y);
    await w.idle(300);
    assert.equal(await w.eval((r) => r.getElementById('adj').hidden), false, '앱 요소를 찍으면 값 바꾸기 창이 바로 열린다(#1792)');
    assert.equal(await w.eval((r) => r.getElementById('panel').hidden), true, '바꾸는 동안 대화창은 비킨다');
    assert.equal(await w.eval((r) => r.getElementById('boxTag').textContent), 'AppTitle', '찍은 요소 테두리에 컴포넌트 이름');
    assert.match(await w.eval((r) => r.getElementById('adjWhat').textContent), /^AppTitle · /);
    const near = await page.evaluate(() => document.getElementById('x').getBoundingClientRect().bottom);
    const top = await w.eval((r) => r.getElementById('adj').getBoundingClientRect().top);
    assert.ok(top > near && top - near < 20, `창이 요소 바로 아래에 붙는다 (${near} → ${top})`);
    assert.equal(await w.eval((r) => r.querySelectorAll('#adjFields [data-k]').length), 20, 'Codex 조정과 같은 20개(#1785)');
    assert.equal(await w.eval((r) => !!r.querySelector('#adjFields [data-k="justifyContent"]')), false, '배치는 flex·grid 요소에만');
    await w.eval((r) => { const i = r.querySelector('#adjFields [data-k="fontSize"]'); i.value = '20'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await h1Size(page), '20px', '바꾼 값이 화면에 바로 보인다');
    await w.eval((r) => { const i = r.querySelector('#adjFields [data-k="marginTop"]'); i.value = '40'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await w.eval((r) => { const i = r.querySelector('#adjFields [data-k="marginTop"]'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await w.click('#adjDone');
    assert.equal(await w.eval((r) => r.getElementById('panel').hidden), false);
    assert.match(await w.eval((r) => r.getElementById('whereText').textContent), /바꾼 값 1개/);
    assert.equal(await w.eval((r) => r.getElementById('adjBtn').hidden), false, '닫은 뒤에도 위치 줄에서 다시 열 수 있다');

    await w.type('이 크기로');
    await w.click('#form button[type="submit"]');
    await w.idle(1200);
    const m = readChat(srv).find((x) => x.text === '이 크기로');
    assert.deepEqual(m.where.adjust, { fontSize: { from: before, to: '20px' } });
    assert.equal(m.where.component, 'AppTitle');
    assert.equal(await h1Size(page), before, '보낸 뒤에는 원래 모습으로');
    assert.ok(formatMessage(m, [m]).some((l) => l.includes(`글꼴 크기 ${before} → 20px`)), '세션이 읽는 글에도 바꾼 값이 적힌다');
    assert.ok(formatMessage(m, [m]).some((l) => l.includes('컴포넌트 AppTitle')), '컴포넌트 이름도 적힌다');
    await ctx.close();
  } finally { srv.stop(); }
});

test('flex 요소를 찍으면 배치(방향·정렬·분배·간격)도 바꿀 수 있다 (#1787)', async () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, 't.html'), '<!doctype html><meta name="viewport" content="width=device-width"><title>t</title><body><div id="row" style="display:flex;padding:10px"><b>가</b><b>나</b></div><script src="/__uifb/widget.js"></script></body>');
  const srv = await startServer(dir);
  try {
    const { w, page, ctx } = await openWidget(srv);
    await w.click('#pick');
    await page.mouse.click(375, 30); // 가운데 위는 안내줄이 가린다
    await w.idle(300);
    assert.equal(await w.eval((r) => r.getElementById('boxTag').textContent), 'div#row', 'React가 아니면 태그 이름');
    for (const k of ['flexDirection', 'alignItems', 'justifyContent', 'columnGap', 'rowGap']) assert.ok(await w.eval((r, k) => !!r.querySelector(`#adjFields [data-k="${k}"]`), k), k);
    await w.eval((r) => { const s = r.querySelector('#adjFields [data-k="justifyContent"]'); s.value = 'space-between'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('row')).justifyContent), 'space-between');
    await ctx.close();
  } finally { srv.stop(); }
});
