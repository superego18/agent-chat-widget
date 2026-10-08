#!/usr/bin/env node
// 지금 이 세션의 대화 기록 파일을 찾아 리뷰 서버에 등록한다. 의존성 없음 (Node 18+).
// 사용: node register-session.mjs --name "작업 세션" --marker <아무 글자 8자 이상> [--dir .ui-feedback] [--agent "Claude Code"] [--port 4799] [--tool claude|codex]
//   --name: 대화 창 탭에 보일 세션 이름(역할). 한 프로젝트에 여러 세션을 등록할 수 있다.
//   --tool: 그 도구의 기록만 찾는다. 다른 세션이 대신 등록할 때(예: Claude 세션이 Codex 세션을 등록) 표시가 자기 기록에도 남으므로 꼭 붙인다.
//   --marker 는 명령에 글자 그대로 적는다(예: uifb-k3x9q2m7). 셸 변수·$(...)를 쓰면 기록에 남는 글자와 달라져 못 찾는다.
//   이 명령 자체가 세션 기록에 남으므로, 최근 기록 파일 중 marker 가 들어 있는 파일이 곧 이 세션의 파일이다.
//   찾으면 <dir>/sessions/<세션 id>.json 에 { name, tool, sessionId, path, agent, port } 를 쓴다.
//   Claude: hook-relay.mjs 훅이 이 sessionId 의 대화만 리뷰 서버로 보낸다. Codex: 리뷰 서버가 path 의 기록을 읽어 보여 준다.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const marker = arg('marker', '');
const dir = path.resolve(arg('dir', '.ui-feedback'));
const name = arg('name', '작업 세션');
const agent = arg('agent', name);
const port = Number(arg('port', '4799'));
if (marker.length < 8) {
  console.error('--marker 에 8자 이상의 고유한 글자를 직접 적어 주세요(예: uifb-k3x9q2m7).');
  process.exit(2);
}

const home = os.homedir();
const RECENT_MS = 6 * 60 * 60 * 1000;

function walk(root, depth, out) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isDirectory() && depth > 0) walk(p, depth - 1, out);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
  }
}

// Codex 기록 폴더: CODEX_HOME 과, 홈 폴더의 .codex 로 시작하는 폴더 중 sessions 가 있는 것(.codex, .codex-<계정> 등).
// 계정 이름을 스크립트에 적지 않고 이 규칙으로 찾는다.
function codexHomes() {
  const out = new Set();
  if (process.env.CODEX_HOME) out.add(path.resolve(process.env.CODEX_HOME));
  let names = [];
  try {
    names = fs.readdirSync(home).filter((n) => n.startsWith('.codex'));
  } catch {}
  for (const n of names) if (fs.existsSync(path.join(home, n, 'sessions'))) out.add(path.join(home, n));
  return [...out];
}

function candidates() {
  const files = [];
  const only = arg('tool', '');
  if (only !== 'codex') walk(path.join(home, '.claude', 'projects'), 1, files);
  if (only !== 'claude') for (const h of codexHomes()) walk(path.join(h, 'sessions'), 4, files);
  const now = Date.now();
  return files
    .map((p) => ({ p, m: fs.statSync(p).mtimeMs }))
    .filter((f) => now - f.m < RECENT_MS)
    .sort((a, b) => b.m - a.m)
    .map((f) => f.p);
}

function tailContains(file, text) {
  const size = fs.statSync(file).size;
  const len = Math.min(size, 2 * 1024 * 1024);
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, size - len);
  fs.closeSync(fd);
  return buf.toString('utf8').includes(text);
}

const deadline = Date.now() + 20_000;
let found = null;
while (!found && Date.now() < deadline) {
  found = candidates().find((f) => tailContains(f, marker)) || null;
  if (!found) await new Promise((r) => setTimeout(r, 1000));
}
if (!found) {
  console.error('대화 기록 파일을 찾지 못했습니다. 터미널 대화는 페이지에 보이지 않고, 대화 창만 씁니다.');
  process.exit(1);
}

const tool = found.includes(`${path.sep}.claude${path.sep}`) ? 'claude' : 'codex';
// Codex 기록 파일 이름(rollout-<시각>-<스레드 id>)에서는 스레드 id 만 쓴다. `codex queue --thread` 가 이 id 로 세션을 찾는다.
const base = path.basename(found, '.jsonl');
const thread = tool === 'codex' ? base.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)?.[0] : null;
const sessionId = (thread || base).replace(/[^\w.-]/g, '_');
const sessionsDir = path.join(dir, 'sessions');
fs.mkdirSync(sessionsDir, { recursive: true });
// 같은 이름으로 등록된 다른(예전) 세션은 지운다. 한 이름 = 한 세션.
for (const f of fs.readdirSync(sessionsDir)) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf8'));
    if (s.name === name && s.sessionId !== sessionId) fs.rmSync(path.join(sessionsDir, f));
  } catch {}
}
fs.rmSync(path.join(dir, 'session.json'), { force: true });
fs.writeFileSync(
  path.join(sessionsDir, `${sessionId}.json`),
  JSON.stringify({ name, tool, sessionId, path: found, agent, port, registeredAt: new Date().toISOString() }, null, 2) + '\n',
);
console.log(`등록함: ${name} · ${tool} · ${sessionId}`);
