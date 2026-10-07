#!/usr/bin/env node
// 리뷰 완료 표시를 기다린다. 의존성 없음 (Node 18+).
// 사용: node wait-review.mjs --round <N> [--dir .ui-feedback] [--minutes 30] [--agent "Claude Code"]
//   기다리는 동안 <dir>/watch-r<N>.json 을 남겨 리뷰 페이지가 "자동 이어가기 켜짐"을 표시하게 한다.
//   완료 표시가 되면 평가 JSON을 출력하고 0으로, 시간이 다 되면 1로 끝난다.

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

if (!/^\d{1,3}$/.test(round)) {
  console.error('--round 에 라운드 번호(숫자)를 주세요.');
  process.exit(2);
}

const feedbackFile = path.join(dir, `r${round}.json`);
const watchFile = path.join(dir, `watch-r${round}.json`);
const expiresAt = Date.now() + minutes * 60_000;

fs.writeFileSync(
  watchFile,
  JSON.stringify({ round: Number(round), agent, pid: process.pid, startedAt: new Date().toISOString(), expiresAt: new Date(expiresAt).toISOString() }, null, 2) + '\n',
);

function cleanup() {
  try {
    fs.unlinkSync(watchFile);
  } catch {}
}

process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

const timer = setInterval(() => {
  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(feedbackFile, 'utf8'));
  } catch {}
  if (data?.done === true) {
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
}, 2000);
