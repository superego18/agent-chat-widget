#!/usr/bin/env node
// 실제 앱 화면에 피드백 버튼을 끼워 보여 주는 프록시. 의존성 없음 (Node 18+).
// 사용: node app-proxy.mjs --app http://localhost:3001 [--port 4798] [--review http://localhost:4799] [--lan --dir .ui-feedback]
//   --lan: 폰 등 다른 기기에서도 열리게 한다(접속 키 필요, 키는 리뷰 서버와 같은 <dir>/lan-key, lan-auth.mjs).
//   http://localhost:<port>/ 로 열면 앱을 그대로 보여 주고, HTML 응답에만 피드백 위젯 스크립트를 넣는다.
//   위젯이 보낸 메시지는 리뷰 서버(/api/chat)로 넘어가 리뷰 대화와 같은 기록(chat.json)에 쌓인다.
//   앱 코드는 고치지 않는다. dev 서버의 실시간 갱신(HMR) 웹소켓도 그대로 앱으로 넘긴다
//   (Turbopack 등은 이 연결이 있어야 화면 코드가 동작한다).

import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lanAuth } from './lan-auth.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const app = new URL(arg('app', 'http://localhost:3001'));
const review = new URL(arg('review', 'http://localhost:4799'));
const port = Number(arg('port', '4798'));
const auth = lanAuth({ dir: path.resolve(arg('dir', '.ui-feedback')), lan: process.argv.includes('--lan') });
const widgetPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'app-widget.js');
const TAG = '<script src="/__uifb/widget.js" defer></script>';
function forward(req, res, target, rewrite) {
  const headers = { ...req.headers, host: target.host };
  // 폰 등 다른 주소로 열면 Origin·Referer 가 그 주소라서 dev 서버(Next 등)가 다른 출처 요청으로 막는다(403, 실시간 갱신이 끊겨 페이지가 계속 새로고침됨).
  // 접속 확인은 이 프록시가 이미 했으므로 앱에는 같은 출처로 넘긴다.
  if (headers.origin) headers.origin = target.origin;
  if (headers.referer) headers.referer = headers.referer.replace(/^https?:\/\/[^/]+/, target.origin);
  delete headers['accept-encoding'];
  const upstream = http.request(
    { hostname: target.hostname, port: target.port, path: rewrite ?? req.url, method: req.method, headers },
    (up) => {
      const type = up.headers['content-type'] || '';
      if (!rewrite && type.includes('text/html')) {
        let body = '';
        up.setEncoding('utf8');
        up.on('data', (c) => (body += c));
        up.on('end', () => {
          body = body.includes('</body>') ? body.replace('</body>', TAG + '</body>') : body + TAG;
          const h = { ...up.headers };
          delete h['content-length'];
          delete h['content-encoding'];
          res.writeHead(up.statusCode, h);
          res.end(body);
        });
        return;
      }
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`연결 실패: ${target.origin} (${err.code})`);
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  if (!auth.check(req, res)) return;
  if (req.url === '/__uifb/widget.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(widgetPath));
  }
  if (req.url.startsWith('/__uifb/api/')) {
    return forward(req, res, review, req.url.replace('/__uifb', ''));
  }
  forward(req, res, app);
});

// WebSocket(HMR 등)은 앱 서버로 그대로 이어 준다.
server.on('upgrade', (req, socket, head) => {
  if (!auth.checkUpgrade(req)) return socket.destroy();
  const up = net.connect(Number(app.port) || 80, app.hostname, () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i];
      const lk = k.toLowerCase();
      lines.push(`${k}: ${lk === 'host' ? app.host : lk === 'origin' ? app.origin : req.rawHeaders[i + 1]}`);
    }
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `포트 ${port} 이(가) 이미 쓰이고 있습니다. --port 로 바꾸세요.` : err.message);
  process.exit(1);
});

server.listen(port, auth.host, () => {
  console.log(`피드백 버튼이 붙은 앱: http://localhost:${port}/  (원본 ${app.origin}, 리뷰 서버 ${review.origin})`);
  for (const u of auth.urls(port)) console.log(`다른 기기(폰)에서: ${u}`);
});
