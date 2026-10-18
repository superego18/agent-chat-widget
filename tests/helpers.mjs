// 대화창 자동 시험 도우미: 시험마다 빈 .ui-feedback 폴더와 리뷰 서버를 새로 띄우고, 휴대폰 크기 크롬으로 대화창을 연다.
// 설치된 크롬(channel: 'chrome')을 쓰므로 브라우저를 따로 받지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverJs = path.join(here, 'test-server.mjs');

export const A = 'aaaaaaaa-0000-4000-8000-000000000001'; // 스킬 세션 역할
export const B = 'bbbbbbbb-0000-4000-8000-000000000002'; // 작업 세션 역할

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 시험용 .ui-feedback 폴더. messages: chat.json 에 미리 넣을 메시지, status: 세션 상태(working 이면 끼워넣기 단추가 보임)
export function makeDir({ messages = [], delivered = {}, drafts = [], status = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uifb-test-'));
  fs.mkdirSync(path.join(dir, 'sessions'));
  for (const [id, name] of [[A, '스킬 세션'], [B, '작업 세션']]) {
    fs.writeFileSync(path.join(dir, 'sessions', `${id}.json`), JSON.stringify({ name, tool: 'claude', sessionId: id, agent: 'Claude Code', registeredAt: id === A ? '2026-01-01T00:00:00Z' : '2026-01-01T00:00:01Z' }));
  }
  for (const [id, st] of Object.entries(status)) fs.writeFileSync(path.join(dir, `status-${id}.json`), JSON.stringify({ at: new Date().toISOString(), ...st }));
  fs.writeFileSync(path.join(dir, 'chat.json'), JSON.stringify({ messages }));
  fs.writeFileSync(path.join(dir, 'delivered.json'), JSON.stringify(delivered));
  fs.writeFileSync(path.join(dir, 'drafts.json'), JSON.stringify({ nextId: drafts.length + 1, drafts, trash: [] }));
  const page = '<!doctype html><meta name="viewport" content="width=device-width"><title>t</title><body><h1 id="x">앱 제목</h1><script src="/__uifb/widget.js"></script></body>';
  fs.writeFileSync(path.join(dir, 'review.html'), page);
  fs.writeFileSync(path.join(dir, 't.html'), page);
  return dir;
}

// 리뷰 서버를 빈 포트에 띄운다. 끝나면 stop() 으로 끄고 폴더도 지운다.
export async function startServer(dir) {
  const port = 47100 + Math.floor(Math.random() * 800);
  const child = spawn(process.execPath, [serverJs, '--dir', dir, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (b) => { out += b; });
  child.stderr.on('data', (b) => { out += b; });
  for (let i = 0; i < 100 && !out.includes('시험 서버'); i++) await sleep(50);
  if (!out.includes('시험 서버')) { child.kill(); throw new Error('리뷰 서버가 뜨지 않았습니다:\n' + out); }
  const base = `http://127.0.0.1:${port}`;
  const api = async (p, body) => {
    const r = await fetch(base + p, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.json();
  };
  return { base, port, dir, api, log: () => out, stop: () => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

let browser;
export async function getBrowser() {
  browser ||= await chromium.launch({ channel: 'chrome', headless: true });
  return browser;
}
export async function closeBrowser() {
  await browser?.close();
  browser = null;
}

// 휴대폰 크기(390×800, 터치)로 시험 페이지를 열고 대화창을 연다. ctx 를 넘기면 같은 기기(저장소 공유)에서 새로고침한 것처럼 쓴다.
export async function openWidget(srv, { ctx, tab = A, open = true } = {}) {
  const b = await getBrowser();
  ctx ||= await b.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.addInitScript((t) => { try { if (!localStorage.getItem('__uifb_tab')) localStorage.setItem('__uifb_tab', t); } catch {} }, tab);
  await page.goto(srv.base + '/t.html');
  await page.waitForFunction(() => [...document.querySelectorAll('*')].some((e) => e.shadowRoot?.getElementById('panel')));
  const w = new Widget(page);
  await sleep(600);
  if (open && (await w.eval((r) => r.getElementById('panel').hidden))) await w.click('#btn');
  await w.idle();
  return { ctx, page, w };
}

// 대화창(shadow DOM) 안을 다루는 도우미
export class Widget {
  constructor(page) { this.page = page; }
  eval(fn, arg) {
    return this.page.evaluate(([src, a]) => {
      const r = [...document.querySelectorAll('*')].find((e) => e.shadowRoot?.getElementById('panel')).shadowRoot;
      return (0, eval)('(' + src + ')')(r, a);
    }, [fn.toString(), arg]);
  }
  click(sel) { return this.eval((r, s) => r.querySelector(s).click(), sel); }
  // 글자로 단추를 찾아 누른다(scope 안에서). 없으면 오류.
  clickText(text, scope = '#panel') {
    return this.eval((r, [t, s]) => {
      const b = [...r.querySelector(s).querySelectorAll('button')].find((x) => x.textContent.trim() === t);
      if (!b) throw new Error('단추 없음: ' + t);
      b.click();
    }, [text, scope]);
  }
  type(text) { return this.eval((r, t) => { const i = r.getElementById('input'); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); }, text); }
  inputValue() { return this.eval((r) => r.getElementById('input').value); }
  // 화면의 메시지 말풍선(번호 있는 것)
  msgs() { return this.eval((r) => [...r.getElementById('msgs').querySelectorAll('.msg[data-id]')].map((e) => ({ id: e.dataset.id, cls: e.className, text: e.querySelector('.mbody')?.textContent || '', buttons: [...e.querySelectorAll('small button')].map((b) => b.textContent.trim()) }))); }
  holds() { return this.eval((r) => [...r.getElementById('msgs').querySelectorAll('.msg.hold')].map((e) => ({ text: e.querySelector('.mbody, textarea')?.value ?? e.querySelector('.mbody')?.textContent, quote: e.querySelector('.quote')?.className || null, buttons: [...e.querySelectorAll('.hacts button')].map((b) => b.textContent.trim()) }))); }
  // 대화창이 서버와 한 번 더 맞춰질 때까지 기다린다(3초마다 확인하므로 넉넉히)
  async idle(ms = 700) { await sleep(ms); }
}

export { sleep };
