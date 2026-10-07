#!/usr/bin/env node
// 리뷰 페이지 대화 창에 에이전트 답장을 보낸다. 의존성 없음 (Node 18+).
// 사용: node chat-reply.mjs --session <이름 또는 id> [--dir .ui-feedback] [--port 4799] [--round <N>] "답장 내용"
//   --session: 답하는 이 세션(register-session.mjs 로 등록). 그 세션 탭에 답이 보이고, 감시가 "답함"으로 처리한다.
//   내용은 마지막 인자로 주거나, 인자가 없으면 표준 입력에서 읽는다(따옴표가 많은 긴 답장).

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const port = arg('port', '4799');
const round = arg('round', null);
import fs from 'node:fs';
import path from 'node:path';
const dir = path.resolve(arg('dir', '.ui-feedback'));
const want = arg('session', '');
let session = null;
try {
  for (const f of fs.readdirSync(path.join(dir, 'sessions'))) {
    const s = JSON.parse(fs.readFileSync(path.join(dir, 'sessions', f), 'utf8'));
    if (s.sessionId === want || s.name === want) session = s;
  }
} catch {}
if (!session) {
  console.error(`--session 에 등록된 세션 이름이나 id 를 주세요. 받은 값: "${want}"`);
  process.exit(2);
}
const agent = arg('agent', session.agent || session.name);
const flags = new Set(['--port', '--round', '--agent', '--session', '--dir']);
const rest = process.argv.slice(2).filter((a, i, all) => !flags.has(a) && !flags.has(all[i - 1]));
let text = rest.join(' ').trim();
if (!text) {
  text = '';
  for await (const chunk of process.stdin) text += chunk;
  text = text.trim();
}
if (!text) {
  console.error('보낼 내용이 없습니다.');
  process.exit(2);
}

const res = await fetch(`http://localhost:${port}/api/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ from: 'agent', agent, session: session.sessionId, context: 'reply', text, round }),
});
if (!res.ok) {
  console.error(`보내기 실패: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log('보냄');
