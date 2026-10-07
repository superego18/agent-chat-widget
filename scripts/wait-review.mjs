#!/usr/bin/env node
// 리뷰 완료 표시나 리뷰 페이지 대화 메시지를 기다린다. 의존성 없음 (Node 18+).
// 사용: node wait-review.mjs --round <N> [--dir .ui-feedback] [--minutes 30] [--agent "Claude Code"] [--target system|skill|all]
//   --target: 이 대상의 대화 메시지에만 깨어난다(기본 all). 여러 세션이 대상을 나눠 맡을 때 쓴다.
//             skill 은 리뷰 완료 표시에는 깨어나지 않는다(완료 반영은 작업 세션 몫).
//   기다리는 동안 <dir>/watch-r<N>.json 을 남겨 리뷰 페이지가 "자동 이어가기 켜짐"을 표시하게 한다.
//   - 완료 표시: REVIEW_DONE 과 평가 JSON 을 출력하고 0으로 끝난다.
//   - 답하지 않은 사용자 메시지(chat.json 의 마지막 메시지가 user): CHAT 과 그 메시지들을 출력하고 0으로 끝난다.
//     에이전트는 chat-reply.mjs 로 답한 뒤 같은 명령으로 감시를 다시 켠다.
//   - 시간이 다 되면 TIMEOUT 을 출력하고 1로 끝난다.

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dir = path.resolve(arg('dir', '.ui-feedback'));
const round = arg('round', '');
const minutes = Number(arg('minutes', '30'));
const agent = arg('agent', 'AI');
const target = arg('target', 'all');

if (!/^\d{1,3}$/.test(round)) {
  console.error('--round 에 라운드 번호(숫자)를 주세요.');
  process.exit(2);
}

const feedbackFile = path.join(dir, `r${round}.json`);
const watchFile = path.join(dir, `watch-r${round}${target === 'all' ? '' : '-' + target}.json`);
const chatFile = path.join(dir, 'chat.json');
const expiresAt = Date.now() + minutes * 60_000;

fs.writeFileSync(
  watchFile,
  JSON.stringify({ round: Number(round), agent, target, pid: process.pid, startedAt: new Date().toISOString(), expiresAt: new Date(expiresAt).toISOString() }, null, 2) + '\n',
);

function cleanup() {
  try {
    fs.unlinkSync(watchFile);
  } catch {}
}

process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

function unansweredUserMessages() {
  let messages = [];
  try {
    messages = JSON.parse(fs.readFileSync(chatFile, 'utf8')).messages || [];
  } catch {}
  // 터미널 대화(훅이 넣은 context: terminal)는 이미 세션 안에 있으므로 깨울 대상이 아니다.
  // 다만 터미널에 쓴 에이전트 답은 시스템 쪽 질문에 대한 답으로 친다.
  messages = messages.filter((m) =>
    m.context === 'terminal'
      ? target !== 'skill' && m.from === 'agent'
      : target === 'all' || (m.target === 'skill' ? 'skill' : 'system') === target,
  );
  const lastAgent = messages.map((m) => m.from).lastIndexOf('agent');
  return messages.slice(lastAgent + 1).filter((m) => m.from === 'user');
}

function check() {
  const pending = unansweredUserMessages();
  if (pending.length > 0) {
    clearInterval(timer);
    cleanup();
    console.log(`CHAT round=${round}`);
    for (const m of pending) {
      console.log(`[${m.id}][${m.target === 'skill' ? '스킬' : '시스템'}]${m.context === 'app' ? '[앱 화면]' : ''} ${m.text}`);
      if (m.where?.selector || m.where?.url) {
        console.log(`    위치: ${m.where.url || ''}${m.where.selector ? ' · ' + m.where.selector : ''}${m.where.text ? ' · "' + m.where.text + '"' : ''}`);
      }
    }
    process.exit(0);
  }
  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(feedbackFile, 'utf8'));
  } catch {}
  // 완료 표시는 리뷰를 반영하는 쪽(시스템·전체 감시)만 받는다. 스킬 대상만 보는 감시는 대화에만 깨어난다.
  if (data?.done === true && target !== 'skill') {
    clearInterval(timer);
    cleanup();
    console.log(`REVIEW_DONE round=${round}`);
    console.log(JSON.stringify(data, null, 2));
    process.exit(0);
  }
  if (Date.now() > expiresAt) {
    clearInterval(timer);
    cleanup();
    console.log(`TIMEOUT: ${minutes}분 동안 완료 표시가 없어 감시를 끝냈습니다.`);
    process.exit(1);
  }
}

const timer = setInterval(check, 2000);
check();
