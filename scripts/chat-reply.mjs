#!/usr/bin/env node
// 리뷰 페이지 대화 창에 에이전트 답장을 보낸다. 의존성 없음 (Node 18+).
// 사용: node chat-reply.mjs [--port 4799] [--round <N>] [--agent "Claude Code"] "답장 내용"
//   내용은 마지막 인자로 주거나, 인자가 없으면 표준 입력에서 읽는다(따옴표가 많은 긴 답장).

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const port = arg('port', '4799');
const round = arg('round', null);
const agent = arg('agent', '작업 세션');
const flags = new Set(['--port', '--round', '--agent']);
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
  body: JSON.stringify({ from: 'agent', agent, text, round }),
});
if (!res.ok) {
  console.error(`보내기 실패: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log('보냄');
