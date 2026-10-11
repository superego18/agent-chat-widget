// 시험용 서버: 대화창 처리기에 시험 페이지(t.html 등 폴더의 html)를 내보내는 일만 더한다.
// 사용: node tests/test-server.mjs --dir <폴더> --port <포트>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createChatHandler } from '../scripts/chat-handler.mjs';

const arg = (name) => process.argv[process.argv.indexOf(`--${name}`) + 1];
const root = path.resolve(arg('dir'));
const port = Number(arg('port'));
const chat = createChatHandler({ root });
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/__uifb/api/')) url.pathname = url.pathname.slice('/__uifb'.length);
  if (chat.handle(req, res, url)) return;
  const file = path.join(root, path.basename(url.pathname));
  if (file.endsWith('.html') && fs.existsSync(file)) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(file)); }
  res.writeHead(404);
  res.end();
}).listen(port, '127.0.0.1', () => console.log(`시험 서버: http://localhost:${port}/`));
