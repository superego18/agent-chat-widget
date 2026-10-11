#!/usr/bin/env node
// 대화창 서버를 혼자 띄운다. 의존성 없음 (Node 18+).
// 사용: node chat-server.mjs [--dir .ui-feedback] [--port 4799] [--lan]
//   --lan: 폰 등 다른 기기에서도 열리게 한다(접속 키 필요, lan-auth.mjs).
//   앱 화면에 대화창을 붙이려면 app-proxy.mjs --review http://localhost:<이 포트> 로 앱 앞에 세운다.
//   비교 페이지(ui-review-page)와 함께 쓰려면 이 서버 대신 두 처리기를 함께 붙인 서버를 쓴다.
import http from 'node:http';
import path from 'node:path';
import { lanAuth } from './lan-auth.mjs';
import { createChatHandler } from './chat-handler.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback; };
const root = path.resolve(arg('dir', '.ui-feedback'));
const port = Number(arg('port', '4799'));
const auth = lanAuth({ dir: root, lan: process.argv.includes('--lan') });
const chat = createChatHandler({ root, auth });

const server = http.createServer((req, res) => {
  if (!auth.check(req, res)) return;
  const url = new URL(req.url, 'http://localhost');
  // 위젯은 /__uifb/api/* 로 부르므로 앞의 /__uifb 를 떼고 같은 API 로 처리한다.
  if (url.pathname.startsWith('/__uifb/api/')) url.pathname = url.pathname.slice('/__uifb'.length);
  if (chat.handle(req, res, url)) return;
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});
server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `포트 ${port} 이(가) 이미 쓰이고 있습니다. --port 로 바꾸세요.` : err.message);
  process.exit(1);
});
server.listen(port, auth.host, () => {
  console.log(`대화창 서버: http://localhost:${port}/`);
  for (const u of auth.urls(port)) console.log(`다른 기기(폰)에서: ${u}`);
});
