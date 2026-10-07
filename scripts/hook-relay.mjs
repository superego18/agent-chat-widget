#!/usr/bin/env node
// Claude Code 훅에서 불려, 터미널 대화를 리뷰 서버 대화 기록(chat.json)으로 보낸다. 의존성 없음 (Node 18+).
// 훅 설정: UserPromptSubmit, MessageDisplay, PreToolUse, Stop, Notification 이벤트에 command 훅으로 `node <이 파일>` 을 건다.
//   - 대화: 사용자 입력과 화면에 표시되는 에이전트 답을 chat.json 으로 보낸다.
//   - 상태: 작업 시작·도구 사용·응답 끝·승인 대기를 /api/status 로 보내, 대화 창에 "작업 중" 표시를 한다.
//   - 입력 JSON 은 표준 입력으로 받는다. 표준 출력에는 아무것도 쓰지 않는다(MessageDisplay 는 출력이 없으면 원문을 그대로 표시한다).
//   - <cwd>/.ui-feedback/sessions/<session_id>.json 으로 등록된 세션일 때만 보낸다.
//     그 밖의 프로젝트·세션에서는 아무것도 하지 않고 끝난다.
//   - 어떤 오류가 나도 조용히 끝난다(대화 표시를 막지 않는다).

import fs from 'node:fs';
import path from 'node:path';

async function readStdin() {
  let s = '';
  for await (const chunk of process.stdin) s += chunk;
  return s;
}

async function post(port, body, api = 'chat') {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    await fetch(`http://localhost:${port}/api/${api}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// 도구 이름을 사용자가 알아볼 말로 바꾼다. Bash 는 명령 설명(description)이 있으면 그것을 쓴다.
function toolLabel(name = '', input = {}) {
  const n = String(name);
  if (n === 'Bash') return input?.description ? `명령 실행: ${String(input.description).slice(0, 60)}` : '명령 실행 중';
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(n)) return `파일 수정: ${path.basename(String(input?.file_path ?? ''))}`;
  if (n === 'Read') return `파일 읽기: ${path.basename(String(input?.file_path ?? ''))}`;
  if (/^(Grep|Glob)$/.test(n)) return '코드 검색 중';
  if (n.startsWith('mcp__playwright__')) return '브라우저로 화면 확인 중';
  if (n === 'Agent' || n === 'Task') return '하위 작업 진행 중';
  if (n === 'SendMessage') return '다른 세션에 메시지 보내는 중';
  if (n.startsWith('mcp__')) return `${n.split('__')[1]} 도구 사용 중`;
  return `${n} 사용 중`;
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
  if (!/^[\w.-]+$/.test(String(input.session_id))) process.exit(0);
  const session = JSON.parse(fs.readFileSync(path.join(dir, 'sessions', `${input.session_id}.json`), 'utf8'));
  const port = session.port || 4799;
  const base = { context: 'terminal', session: session.sessionId, agent: session.agent };

  const status = (state, detail = '') => post(port, { session: session.sessionId, state, detail }, 'status');

  if (input.hook_event_name === 'UserPromptSubmit') {
    const text = String(input.prompt_text ?? input.prompt ?? '').trim();
    await status('working', '생각하는 중');
    if (text && !isAutomatic(text)) await post(port, { ...base, from: 'user', text });
  }

  if (input.hook_event_name === 'PreToolUse') {
    await status('working', toolLabel(input.tool_name, input.tool_input));
  }

  if (input.hook_event_name === 'Stop') {
    await status('idle');
  }

  if (input.hook_event_name === 'Notification') {
    const msg = String(input.message ?? '');
    if (/permission|approve|승인|허용/i.test(msg) || /permission/i.test(String(input.notification_type ?? ''))) {
      await status('permission', '터미널에서 승인을 기다리는 중');
    }
  }

  if (input.hook_event_name === 'MessageDisplay') {
    // 한 답이 여러 조각으로 오고, 조각마다 훅이 따로(동시에) 실행된다. 조각을 번호(index)별 파일로 따로 저장하고,
    // 마지막 조각(final)을 받은 실행이 앞 번호 조각들이 모두 저장될 때까지 잠시 기다렸다가 번호 순서대로 합쳐 보낸다.
    const index = Number.isInteger(input.index) ? input.index : 0;
    const chunkDir = path.join(dir, `.display-${input.session_id}`);
    fs.mkdirSync(chunkDir, { recursive: true });
    fs.writeFileSync(path.join(chunkDir, String(index).padStart(6, '0')), String(input.delta ?? ''));
    if (fs.existsSync(path.join(dir, '.hook-debug'))) {
      fs.appendFileSync(path.join(dir, '.hook-debug.log'), `${new Date().toISOString()} index=${index} final=${input.final} len=${String(input.delta ?? '').length}\n`);
    }
    if (input.final) {
      const deadline = Date.now() + 3000;
      const have = () => fs.readdirSync(chunkDir).filter((f) => Number(f) <= index);
      while (have().length < index + 1 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      const files = have().sort();
      const text = files.map((f) => fs.readFileSync(path.join(chunkDir, f), 'utf8')).join('').trim();
      for (const f of files) fs.rmSync(path.join(chunkDir, f), { force: true });
      if (text) await post(port, { ...base, from: 'agent', text });
    }
  }
} catch {
  // 조용히 끝낸다.
}
process.exit(0);
