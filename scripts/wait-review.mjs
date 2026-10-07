#!/usr/bin/env node
// 이 세션에 온 리뷰 페이지·앱 화면 메시지나 리뷰 완료 표시를 기다린다. 의존성 없음 (Node 18+).
// 사용: node wait-review.mjs --session <이름 또는 id> [--round <N> --done] [--dir .ui-feedback] [--minutes 30] [--agent "Claude Code"]
//   --session: register-session.mjs 로 등록한 이 세션. 이 세션에게 온(to) 메시지에만 깨어난다.
//   --done:    리뷰 완료 표시도 받는다(리뷰를 반영하는 작업 세션만 붙인다). --round 와 함께 쓴다.
//   --seen <id>: 이 번호까지의 메시지는 이미 처리한 것으로 본다. 답을 턴의 마지막 문장으로 쓰고 감시를 먼저 다시 켤 때,
//                답이 훅으로 전달되기 전에 같은 메시지로 다시 깨어나지 않게 한다.
//   기다리는 동안 <dir>/watch-<세션 id>.json 을 남겨, 페이지가 이 세션의 "바로 읽음" 상태를 표시하게 한다.
//   - 답하지 않은 메시지: CHAT 과 그 메시지들을 출력하고 0으로 끝난다(답하면 같은 명령으로 다시 켠다).
//   - 완료 표시(--done): REVIEW_DONE 과 평가 JSON 을 출력하고 0으로 끝난다.
//   - 시간이 다 되면 TIMEOUT 을 출력하고 1로 끝난다.

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dir = path.resolve(arg('dir', '.ui-feedback'));
const round = arg('round', '');
const handlesDone = process.argv.includes('--done');
const minutes = Number(arg('minutes', '30'));
const want = arg('session', '');
const seen = Number(arg('seen', '0')) || 0;

function findSession(key) {
  let files = [];
  try {
    files = fs.readdirSync(path.join(dir, 'sessions')).filter((f) => f.endsWith('.json'));
  } catch {}
  for (const f of files) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, 'sessions', f), 'utf8'));
      if (s.sessionId === key || s.name === key) return s;
    } catch {}
  }
  return null;
}

const session = findSession(want);
if (!session) {
  console.error(`--session 에 등록된 세션 이름이나 id 를 주세요(register-session.mjs 로 먼저 등록). 받은 값: "${want}"`);
  process.exit(2);
}
if (handlesDone && !/^\d{1,3}$/.test(round)) {
  console.error('--done 에는 --round <라운드 번호> 가 필요합니다.');
  process.exit(2);
}

const sid = session.sessionId;
const agent = arg('agent', session.agent || session.name);
const feedbackFile = path.join(dir, `r${round}.json`);
const chatFile = path.join(dir, 'chat.json');
const watchFile = path.join(dir, `watch-${sid}.json`);
const expiresAt = Date.now() + minutes * 60_000;

fs.writeFileSync(
  watchFile,
  JSON.stringify({ session: sid, name: session.name, agent, round: Number(round) || null, handlesDone, pid: process.pid, startedAt: new Date().toISOString(), expiresAt: new Date(expiresAt).toISOString() }, null, 2) + '\n',
);

function cleanup() {
  try {
    fs.unlinkSync(watchFile);
  } catch {}
}
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

// 이 세션에게 온 페이지·앱 메시지 중, 이 세션이 그 뒤에 아직 답하지 않은 것
function pendingMessages() {
  let messages = [];
  try {
    messages = JSON.parse(fs.readFileSync(chatFile, 'utf8')).messages || [];
  } catch {}
  const mine = messages.filter((m) => (m.from === 'user' && m.to === sid && m.context !== 'terminal') || (m.from === 'agent' && m.session === sid));
  const lastAgent = mine.map((m) => m.from).lastIndexOf('agent');
  return mine.slice(lastAgent + 1).filter((m) => m.from === 'user' && m.id > seen);
}

let timer;
function finish(code, lines) {
  clearInterval(timer);
  cleanup();
  for (const l of lines) console.log(l);
  process.exit(code);
}

function check() {
  const pending = pendingMessages();
  if (pending.length > 0) {
    const lines = [`CHAT session=${session.name}`];
    for (const m of pending) {
      lines.push(`[${m.id}]${m.context === 'app' ? '[앱 화면]' : '[리뷰]'}${m.round ? `[${m.round}차]` : ''} ${m.text}`);
      if (m.where?.selector || m.where?.url) {
        lines.push(`    위치: ${m.where.url || ''}${m.where.selector ? ' · ' + m.where.selector : ''}${m.where.text ? ' · "' + m.where.text + '"' : ''}`);
      }
    }
    finish(0, lines);
  }
  if (handlesDone) {
    let data = null;
    try {
      data = JSON.parse(fs.readFileSync(feedbackFile, 'utf8'));
    } catch {}
    if (data?.done === true) finish(0, [`REVIEW_DONE round=${round}`, JSON.stringify(data, null, 2)]);
  }
  if (Date.now() > expiresAt) finish(1, [`TIMEOUT: ${minutes}분 동안 메시지나 완료 표시가 없어 감시를 끝냈습니다.`]);
}

timer = setInterval(check, 2000);
check();
