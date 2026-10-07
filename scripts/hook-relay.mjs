#!/usr/bin/env node
// Claude Code 훅에서 불려, 터미널 대화를 리뷰 서버 대화 기록(chat.json)으로 보낸다. 의존성 없음 (Node 18+).
// 훅 설정: UserPromptSubmit, MessageDisplay 이벤트에 command 훅으로 `node <이 파일>` 을 건다.
//   - 입력 JSON 은 표준 입력으로 받는다. 표준 출력에는 아무것도 쓰지 않는다(MessageDisplay 는 출력이 없으면 원문을 그대로 표시한다).
//   - <cwd>/.ui-feedback/session.json 이 있고 그 sessionId 가 이 훅의 session_id 와 같을 때만 보낸다.
//     그 밖의 프로젝트·세션에서는 아무것도 하지 않고 끝난다.
//   - 어떤 오류가 나도 조용히 끝난다(대화 표시를 막지 않는다).

import fs from 'node:fs';
import path from 'node:path';

async function readStdin() {
  let s = '';
  for await (const chunk of process.stdin) s += chunk;
  return s;
}

async function post(port, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    await fetch(`http://localhost:${port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// 사람이 친 입력이 아닌 자동 턴(백그라운드 알림, 다른 세션 메시지, 슬래시 명령 출력)은 뺀다.
function isAutomatic(text) {
  const t = text.trimStart();
  return (
    t.startsWith('<task-notification') ||
    t.startsWith('<local-command') ||
    t.startsWith('<command-') ||
    t.startsWith('Another Claude session sent a message') ||
    t.startsWith('<cross-session-message')
  );
}

try {
  const input = JSON.parse(await readStdin());
  const dir = path.join(input.cwd || process.cwd(), '.ui-feedback');
  const session = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8'));
  if (!session.sessionId || session.sessionId !== input.session_id) process.exit(0);
  const port = session.port || 4799;
  const base = { context: 'terminal', target: 'system', agent: session.agent };

  if (input.hook_event_name === 'UserPromptSubmit') {
    const text = String(input.prompt_text ?? input.prompt ?? '').trim();
    if (text && !isAutomatic(text)) await post(port, { ...base, from: 'user', text });
  }

  if (input.hook_event_name === 'MessageDisplay') {
    // 한 답이 여러 조각으로 오므로 final 이 올 때까지 모았다가 한 번에 보낸다.
    const buf = path.join(dir, `.display-${input.session_id}.txt`);
    fs.appendFileSync(buf, String(input.delta ?? ''));
    if (input.final) {
      const text = fs.readFileSync(buf, 'utf8').trim();
      fs.rmSync(buf, { force: true });
      if (text) await post(port, { ...base, from: 'agent', text });
    }
  }
} catch {
  // 조용히 끝낸다.
}
process.exit(0);
