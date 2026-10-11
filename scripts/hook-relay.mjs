#!/usr/bin/env node
// Claude Code 훅에서 불려, 터미널 대화를 리뷰 서버 대화 기록(chat.json)으로 보낸다. 의존성 없음 (Node 18+).
// 훅 설정: UserPromptSubmit, MessageDisplay, PreToolUse, PostToolUse, Stop, Notification 이벤트에 command 훅으로 `node <이 파일>` 을 건다.
//   - 대화: 사용자 입력과 화면에 표시되는 에이전트 답, 세션끼리 주고받은 메시지(SendMessage)를 chat.json 으로 보낸다.
//   - 상태: 작업 시작·도구 사용·응답 끝·승인 대기를 /api/status 로 보내, 대화 창에 "작업 중" 표시를 한다.
//   - 끼워 넣기: 작업 중에 대화창에서 "끼워넣기"로 보낸 메시지를 도구를 하나 쓸 때마다(PostToolUse) 세션에 바로 넣는다(터미널에서 작업 중에 입력하는 것처럼).
//   - 입력 JSON 은 표준 입력으로 받는다. 표준 출력에는 끼워 넣기(PostToolUse) 말고는 아무것도 쓰지 않는다(MessageDisplay 는 출력이 없으면 원문을 그대로 표시한다).
//   - <cwd>/.ui-feedback/sessions/<session_id>.json 으로 등록된 세션일 때만 보낸다.
//     그 밖의 프로젝트·세션에서는 아무것도 하지 않고 끝난다.
//   - 어떤 오류가 나도 조용히 끝난다(대화 표시를 막지 않는다).

import fs from 'node:fs';
import path from 'node:path';
import { formatMessage } from './chat-format.mjs';

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
  if (!/^[\w.-]+$/.test(String(input.session_id))) process.exit(0);
  // 세션이 하위 폴더(.ui-feedback 안 포함)로 cd 해 있어도 찾도록, 위로 올라가며 이 세션이 등록된 .ui-feedback 을 찾는다.
  let dir = null;
  for (let d = path.resolve(input.cwd || process.cwd()); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.ui-feedback', 'sessions', `${input.session_id}.json`))) { dir = path.join(d, '.ui-feedback'); break; }
    if (path.dirname(d) === d) process.exit(0);
  }
  const session = JSON.parse(fs.readFileSync(path.join(dir, 'sessions', `${input.session_id}.json`), 'utf8'));
  const port = session.port || 4799;
  const base = { context: 'terminal', session: session.sessionId, agent: session.agent };

  const status = (state, detail = '') => post(port, { session: session.sessionId, state, detail }, 'status');

  if (input.hook_event_name === 'UserPromptSubmit') {
    const text = String(input.prompt_text ?? input.prompt ?? '').trim();
    await status('working', '생각하는 중');
    if (text && !isAutomatic(text)) await post(port, { ...base, from: 'user', text });
    // 다른 세션이 보낸 메시지를 받았으면 알린다. 서버가 보낸 쪽 기록과 맞춰 "받음"을 적는다.
    for (const m of text.matchAll(/<cross-session-message\b([^>]*)>([\s\S]*?)<\/cross-session-message>/g)) {
      const fromName = /from-name="([^"]*)"/.exec(m[1])?.[1] || '';
      if (m[2].trim()) await post(port, { from: 'peer', to: session.sessionId, fromName, text: m[2].trim() });
    }
  }

  if (input.hook_event_name === 'PreToolUse') {
    const ti = input.tool_input || {};
    const peer = input.tool_name === 'SendMessage' && typeof ti.message === 'string' ? String(ti.to || '') : '';
    await post(port, { session: session.sessionId, state: 'working', detail: toolLabel(input.tool_name, ti), ...(peer ? { peer } : {}) }, 'status');
    // 세션끼리 보내는 메시지도 대화창에 남긴다(보낸 세션 기준).
    if (peer) await post(port, { from: 'peer', session: session.sessionId, toName: peer, text: ti.message });
  }

  if (input.hook_event_name === 'PostToolUse') {
    const all = JSON.parse(fs.readFileSync(path.join(dir, 'chat.json'), 'utf8')).messages || [];
    const file = path.join(dir, 'delivered.json');
    let d = {};
    try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    // 사용자가 "끼워넣기"로 보낸 것만 넣는다. 나머지는 일이 끝난 뒤 감시 명령이 넘긴다.
    // 일하는 도중 내 중간 안내가 대화에 먼저 기록돼도 건너뛰지 않게, "마지막 답 뒤" 조건 없이 아직 안 넘긴 끼워넣기 메시지를 모두 넣는다.
    const sid = session.sessionId;
    const pending = all.filter((m) => m.from === 'user' && m.to === sid && m.context !== 'terminal' && m.interject && !m.cancelled && m.id > (d[sid] || 0) && !d._at?.[m.id]);
    if (pending.length) {
      const now = new Date().toISOString();
      const stamp = Object.fromEntries(pending.map((m) => [m.id, now]));
      const recent = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[0] - a[0]).slice(0, 500));
      // 받은 번호(_at)와 읽은 시각(_read)만 적는다. 마지막 번호는 올리지 않는다(그 앞의 끼워넣지 않은 메시지는 감시 명령이 넘겨야 한다).
      fs.writeFileSync(file, JSON.stringify({ ...d, _at: recent({ ...(d._at || {}), ...stamp }), _read: recent({ ...(d._read || {}), ...stamp }) }, null, 2) + '\n');
      const lines = ['[대화창 · 작업 중에 끼워넣은 메시지] 사용자가 작업하는 동안 대화창에서 "끼워넣기"로 보냈습니다. 지금 읽고 하던 일에 반영하세요. 답은 이번 턴의 마지막 답에 함께 쓰면 대화창에 보입니다.'];
      for (const m of pending) lines.push(...formatMessage(m, all));
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: lines.join('\n') } }));
    }
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
