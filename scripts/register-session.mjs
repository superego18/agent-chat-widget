#!/usr/bin/env node
// 지금 이 세션의 대화 기록 파일을 찾아 리뷰 서버에 등록한다. 의존성 없음 (Node 18+).
// 사용: node register-session.mjs --marker <아무 글자 8자 이상> [--dir .ui-feedback] [--agent "Claude Code"]
//   --marker 는 명령에 글자 그대로 적는다(예: uifb-k3x9q2m7). 셸 변수·$(...)를 쓰면 기록에 남는 글자와 달라져 못 찾는다.
//   이 명령 자체가 세션 기록에 남으므로, 최근 기록 파일 중 marker 가 들어 있는 파일이 곧 이 세션의 파일이다.
//   찾으면 <dir>/session.json 에 { tool, path, agent } 를 쓴다. 리뷰 서버는 이 파일을 읽어 터미널 대화를 페이지에 보여 준다.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const marker = arg('marker', '');
const dir = path.resolve(arg('dir', '.ui-feedback'));
const agent = arg('agent', '작업 세션');
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

function candidates() {
  const files = [];
  walk(path.join(home, '.claude', 'projects'), 1, files);
  for (const h of ['.codex', '.codex-chanju']) walk(path.join(home, h, 'sessions'), 4, files);
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
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
  path.join(dir, 'session.json'),
  JSON.stringify({ tool, path: found, agent, registeredAt: new Date().toISOString() }, null, 2) + '\n',
);
console.log(`등록함: ${tool} · ${found}`);
