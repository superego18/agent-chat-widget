// 리뷰 서버·앱 프록시를 다른 기기(폰 등)에서도 열 때 쓰는 접속 키. 의존성 없음 (Node 18+).
// --lan 을 켜면 모든 네트워크에서 받되, 이 컴퓨터 밖에서 온 요청은 접속 키가 있어야 통과한다.
//   처음 한 번 http://<주소>:<포트>/?k=<키> 로 열면 그 브라우저에 30일짜리 쿠키를 남기고 k 없는 주소로 다시 보낸다.
//   이 컴퓨터 안(127.0.0.1)에서 온 요청(내 브라우저·에이전트 스크립트·훅·앱 프록시)은 키 없이 통과한다.
// 키는 <dir>/lan-key 에 두어 서버를 다시 켜도 같은 키를 쓴다(폰을 다시 등록할 필요 없음). 바꾸려면 그 파일을 지운다.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const COOKIE = 'uifb_k';

export function lanAuth({ dir, lan }) {
  let key = null;
  if (lan) {
    const file = path.join(dir, 'lan-key');
    try {
      key = fs.readFileSync(file, 'utf8').trim();
    } catch {}
    if (!key) {
      key = crypto.randomBytes(18).toString('base64url');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, key + '\n', { mode: 0o600 });
    }
  }
  const isLocal = (req) => LOCAL.has(req.socket.remoteAddress);
  const hasCookie = (req) => (req.headers.cookie || '').split(/;\s*/).some((c) => c === `${COOKIE}=${key}`);
  const ok = (req) => !lan || isLocal(req) || hasCookie(req);

  return {
    host: lan ? '0.0.0.0' : '127.0.0.1',
    // 요청을 계속 처리해도 되면 true. 아니면 응답(키 저장 후 이동 또는 거절)을 끝내고 false.
    check(req, res) {
      if (ok(req)) return true;
      const url = new URL(req.url, 'http://x');
      if (url.searchParams.get('k') === key) {
        url.searchParams.delete('k');
        res.writeHead(302, {
          'Set-Cookie': `${COOKIE}=${key}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`,
          Location: url.pathname + (url.search || ''),
        });
        res.end();
        return false;
      }
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('접속 키가 필요합니다. 이 서버를 켠 컴퓨터의 터미널에 나온 주소(?k=…)로 한 번 열어 주세요.');
      return false;
    },
    // 웹소켓 연결은 쿠키로만 확인한다.
    checkUpgrade: (req) => ok(req),
    // 다른 기기에서 열 주소(이 컴퓨터의 네트워크 주소마다 하나)
    urls(port) {
      if (!lan) return [];
      return Object.values(os.networkInterfaces())
        .flat()
        .filter((a) => a && a.family === 'IPv4' && !a.internal)
        .map((a) => `http://${a.address}:${port}/?k=${key}`);
    },
  };
}
