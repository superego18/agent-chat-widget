#!/usr/bin/env node
// 이 프로젝트의 .claude/settings.local.json 에 터미널 대화 중계 훅(hook-relay.mjs)을 등록한다. 의존성 없음 (Node 18+).
// 사용: node install-hooks.mjs [--project .] [--remove]
//   이 컴퓨터의 node 실행 파일과 hook-relay.mjs 를 절대 경로로 적어서 macOS·Windows 모두 그대로 동작한다.
//   기존 설정은 그대로 두고, 이 스킬이 넣은 항목(hook-relay.mjs)만 추가·교체·제거한다.
//   실행 중인 Claude Code 세션에도 바로 적용된다(설정 파일 감시). .gitignore 에 settings.local.json 이 없으면 추가한다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const project = path.resolve(arg('project', '.'));
const remove = process.argv.includes('--remove');
const relay = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hook-relay.mjs');
const file = path.join(project, '.claude', 'settings.local.json');
const EVENTS = ['UserPromptSubmit', 'MessageDisplay'];

let settings = {};
if (fs.existsSync(file)) settings = JSON.parse(fs.readFileSync(file, 'utf8'));
settings.hooks = settings.hooks || {};

const isOurs = (h) => (h.args || []).some((a) => String(a).endsWith('hook-relay.mjs')) || String(h.command || '').includes('hook-relay.mjs');
for (const ev of EVENTS) {
  const groups = (settings.hooks[ev] || [])
    .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h)) }))
    .filter((g) => g.hooks.length > 0);
  if (!remove) groups.push({ hooks: [{ type: 'command', command: process.execPath, args: [relay], timeout: 5 }] });
  if (groups.length) settings.hooks[ev] = groups;
  else delete settings.hooks[ev];
}
if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');

const gi = path.join(project, '.gitignore');
const line = '.claude/settings.local.json';
const current = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
if (!remove && !current.split(/\r?\n/).includes(line)) {
  fs.appendFileSync(gi, (current && !current.endsWith('\n') ? '\n' : '') + line + '\n');
}

console.log(`${remove ? '제거함' : '등록함'}: ${file}`);
