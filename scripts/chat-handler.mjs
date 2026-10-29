// 대화창 서버의 요청 처리. 의존성 없음 (Node 18+).
// createChatHandler({ root, auth }) 가 돌려주는 handle(req, res, url) 를 http 서버에 붙인다(혼자 쓸 때는 chat-server.mjs, 비교 페이지와 함께 쓸 때는 그쪽 서버가 붙인다).
//   대화(<root>/chat.json), 세션 목록·상태, 보관함(drafts.json), 설정(prefs.json), 쓰던 글, 읽음, 휴대폰 알림, 대화창 새로고침을 맡고,
//   대화창 위젯 파일(assets/app-widget.js 등)을 /__uifb/* 로 내보낸다.
//   세션별 대화: 등록된 세션(<root>/sessions/)을 /api/sessions 로 알려 주고, 메시지는 to(받는 세션)·session(보낸 세션)으로 나눈다.
//   Codex 세션에게 온 메시지는 `codex queue` 로 그 세션에 바로 넣어 깨운다(감시 명령이 필요 없다). 답은 Codex 대화 기록에서 읽어 보여 준다.
// handle 은 자기 요청이면 true, 아니면 false 를 돌려준다(다른 처리기로 넘기게). 접속 키 확인과 /__uifb/api → /api 바꾸기는 붙이는 쪽이 한다.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import zlib from 'node:zlib';
import { readQueuePickups } from './codex-pickup.mjs';
import { vapidKeys, sendPush } from './web-push.mjs';
import { readJsonSafe, writeJsonAtomic, adjustText, ADJUST_KEYS, formatMessage, quoteLines, interruptedSince } from './chat-format.mjs';

const assetsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
// 위젯 파일. 요청마다 새로 읽으므로 고치면 열린 화면도 새로고침만으로 바뀐다.
const SHARED = {
  '/__uifb/widget.js': ['app-widget.js', 'text/javascript; charset=utf-8'],
  '/__uifb/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/__uifb/icon-180.png': ['icon-180.png', 'image/png'],
  '/__uifb/icon-192.png': ['icon-192.png', 'image/png'],
  '/__uifb/icon-512.png': ['icon-512.png', 'image/png'],
};
const MAX_BODY = 256 * 1024;
const NOT_MINE = Symbol('not mine');

export function createChatHandler({ root, auth = { key: null }, queueSpawn = spawn, queueTimeoutMs = 15000 }) {
if (!Number.isFinite(queueTimeoutMs) || queueTimeoutMs <= 0) throw new Error('queueTimeoutMs must be positive');
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
// 대화 기록은 쌓일수록 커져(수천 개면 2MB) 폰에서 3초마다 받으면 다른 요청(보내기)까지 막힌다. 받을 수 있으면 gzip 으로 줄여 보낸다.
function sendGzip(req, res, status, body) {
  if (!/\bgzip\b/.test(req.headers?.['accept-encoding'] || '')) return send(res, status, body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
  res.end(zlib.gzipSync(JSON.stringify(body), { level: 6 }));
}

const chatFile = path.join(root, 'chat.json');
const sessionsDir = path.join(root, 'sessions');
const TAIL_BYTES = 4 * 1024 * 1024;
const transcriptCache = new Map();

function stripTags(text) {
  return text
    .replace(/<system-reminder[^>]*>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<(local-command-[a-z]+|command-[a-z]+)>[\s\S]*?<\/\1>/g, '')
    .trim();
}

function readChat() {
  try {
    return JSON.parse(fs.readFileSync(chatFile, 'utf8'));
  } catch {
    return { messages: [] };
  }
}

// A previous process may have submitted the request before losing its outcome.
const interrupted = readChat();
let recovered = false;
for (const message of interrupted.messages) {
  if (message.queue?.state !== 'pending') continue;
  message.queue = { ...message.queue, state: 'unknown', error: 'interrupted', at: new Date().toISOString() };
  recovered = true;
}
if (recovered) writeJsonAtomic(chatFile, interrupted);

function queueWatch(session) {
  const configured = process.platform === 'win32' ? Boolean(windowsQueueCommand()) :
    (process.env.PATH || '').split(path.delimiter).some(dir => {
      try { fs.accessSync(path.join(dir, 'codex'), fs.constants.X_OK); return true; } catch { return false; }
    });
  return { active: configured, configured, via: 'queue', handlesDone: true,
    agent: session.agent || session.name, session: session.sessionId };
}

// register-session.mjs 가 등록한 세션들(.ui-feedback/sessions/<세션 id>.json)
function listSessions() {
  let files = [];
  try {
    files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
  } catch {}
  return files
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(a.registeredAt).localeCompare(String(b.registeredAt)))
    .map((s) => ({ id: s.sessionId, name: s.name, tool: s.tool, agent: s.agent, watch: s.tool === 'codex' ? queueWatch(s) : readWatchFile(`watch-${s.sessionId}.json`), status: readStatus(s.sessionId), compact: !!s.cmux?.surface, ctx: readCtx(s) }));
}

// 컨텍스트 사용률(#1856). Claude 는 상태 줄 스크립트가 남긴 값(.ui-feedback/statusline/<세션>.json)을 쓰고,
// Codex 는 대화 기록의 마지막 token_count(마지막 요청의 입력 토큰 ÷ 컨텍스트 창)로 어림한다. 모르면 null.
const ctxCache = new Map();
function readCtx(s) {
  try {
    if (s.tool !== 'codex') {
      const f = path.join(root, 'statusline', `${s.sessionId}.json`);
      const j = JSON.parse(fs.readFileSync(f, 'utf8')).context_window || {};
      if (!Number.isFinite(j.used_percentage)) return null;
      return { pct: Math.round(j.used_percentage), used: j.total_input_tokens ?? null, size: j.context_window_size ?? null, at: fs.statSync(f).mtime.toISOString() };
    }
    const st = fs.statSync(s.path);
    const key = `${s.path}:${st.size}:${st.mtimeMs}`;
    if (ctxCache.get(s.sessionId)?.key === key) return ctxCache.get(s.sessionId).v;
    const len = Math.min(st.size, 512 * 1024);
    const fd = fs.openSync(s.path, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    const line = buf.toString('utf8').split('\n').reverse().find((l) => l.includes('"token_count"') && l.includes('model_context_window'));
    const info = line && JSON.parse(line).payload?.info;
    const used = info?.last_token_usage?.input_tokens, size = info?.model_context_window;
    const v = used && size ? { pct: Math.round((used / size) * 100), used, size, at: st.mtime.toISOString(), approx: true } : null;
    ctxCache.set(s.sessionId, { key, v });
    return v;
  } catch {
    return null;
  }
}

// hook-relay.mjs 가 보낸 세션 상태(작업 중·승인 대기·쉬는 중). 오래된 "작업 중"은 믿지 않는다.
function readStatus(id) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(root, `status-${id}.json`), 'utf8'));
    if (s.state !== 'idle' && Date.now() - Date.parse(s.at) > 30 * 60_000) return { state: 'unknown' };
    // 터미널에서 Esc 로 멈추면 Stop 훅이 오지 않는다. 대화 기록에 남은 중단 시각으로, 중지 단추를 누른 것처럼 "중지함"을 보인다(#1928).
    const stoppedAt = s.state !== 'idle' && interruptedSince(findSession(id)?.path, s.at);
    if (stoppedAt) return { state: 'idle', detail: '중지함', at: stoppedAt };
    return s;
  } catch {
    return { state: 'unknown' };
  }
}

function findSession(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(sessionsDir, `${id}.json`), 'utf8'));
  } catch {
    return null;
  }
}

// Codex 세션은 훅이 없어서 대화 기록 파일에서 사용자 입력과 에이전트 답만 뽑아 보여 준다(내부 형식).
// Claude 세션은 hook-relay.mjs 훅이 chat.json 으로 보내므로 여기서는 읽지 않는다.
const sid = (v) => (typeof v === 'string' && /^[\w.-]{1,80}$/.test(v) ? v : undefined);

function cleanWhere(w) {
  if (!w || typeof w !== 'object') return undefined;
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  const num = (o) => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).filter(([, v]) => Number.isFinite(v)).slice(0, 4)) : undefined);
  const adjustValue = (k, v) => k === 'text' ? String(v ?? '') : String(v ?? '').slice(0, 120);
  const adj = w.adjust && typeof w.adjust === 'object'
    ? Object.fromEntries(ADJUST_KEYS.filter((k) => w.adjust[k]).map((k) => [k, { from: adjustValue(k, w.adjust[k].from), to: adjustValue(k, w.adjust[k].to) }]))
    : {};
  return { url: str(w.url, 300), selector: str(w.selector, 300), text: str(w.text, 120), component: str(w.component, 80), rect: num(w.rect), viewport: num(w.viewport), ...(Object.keys(adj).length ? { adjust: adj } : {}) };
}

// ── 알림(웹 푸시) 구독 ──
const subsFile = path.join(root, 'push-subs.json');
const plainBody = (t) => String(t).replace(/^\s*<re[^>]*>\s*/, '').replace(/[`*#>]/g, '').replace(/\s+/g, ' ').slice(0, 140);
function readSubs() {
  try { return JSON.parse(fs.readFileSync(subsFile, 'utf8')); } catch { return []; }
}
function writeSubs(list) {
  fs.writeFileSync(subsFile, JSON.stringify(list, null, 2) + '\n', { mode: 0o600 });
}
// 기기마다 고른 알림 종류. answer 세션 답장, done 작업 끝남, permission 승인 필요, review 비교 페이지 준비, stale 오래 멈춤, peer 세션끼리 메시지.
// quiet: 그 기기에서 대화창을 보고 있는 동안(최근 30초 안에 보고 있다고 알려 옴)에는 보내지 않는다.
const PUSH_DEFAULTS = { answer: true, done: true, permission: true, review: true, stale: true, peer: false, work: true, quiet: true };
const prefsOf = (s) => ({ ...PUSH_DEFAULTS, ...(s.prefs || {}) });
// 구독한 기기 중 kind 를 켠 기기에 보낸다(kind 가 없으면 모두, 시험용). 끝난 구독(404·410)은 지운다. 보낸 수를 돌려준다(실패해도 대화 기록은 막지 않는다).
// 대화창 새로고침 번호(/api/reload-widgets). 파일에 남겨, 서버를 다시 띄워도 번호가 바뀌어 대화창이 저절로 새로고침되지 않게 한다.
const reloadFile = path.join(root, 'reload.json');
let reloadToken = (() => { try { return JSON.parse(fs.readFileSync(reloadFile, 'utf8')).r || 0; } catch { return 0; } })();
const answerPushed = new Set(); // 답장 알림으로 이미 알린 세션 답 번호(작업 끝 알림이 같은 글로 한 번 더 가지 않게)
async function pushAll(data, kind, skip) {
  const subs = readSubs().filter((s) => {
    if (!kind) return true;
    const p = prefsOf(s);
    if (skip && skip(p)) return false;
    const viewing = s.viewingAt && Date.now() - Date.parse(s.viewingAt) < 30_000;
    // 다른 세션 작업 중: 대화창을 보고 있는 기기 중 그 세션이 아닌 탭을 보는 기기에만 조용히 보낸다.
    if (kind === 'work') return p.work && viewing && s.viewingTab !== data.session;
    return p[kind] && !(p.quiet && viewing);
  });
  if (!subs.length) { console.log(`[알림] ${new Date().toLocaleTimeString('ko-KR')} ${kind || 'test'} → 보낼 기기 없음(꺼짐·보는 중) · ${data.title}`); return 0; }
  const keys = vapidKeys(root);
  let sent = 0;
  const gone = new Set();
  await Promise.all(subs.map(async (s) => {
    try {
      const st = await sendPush(keys, s, { ...data, url: s.url });
      if (st === 404 || st === 410) gone.add(s.endpoint);
      else if (st < 300) sent++;
    } catch {}
  }));
  if (gone.size) writeSubs(readSubs().filter((s) => !gone.has(s.endpoint)));
  console.log(`[알림] ${new Date().toLocaleTimeString('ko-KR')} ${kind || 'test'} → ${sent}대 · ${data.title}`); // 알림이 몇 번 갔는지 서버 출력으로 확인한다
  return sent;
}

// 상태가 바뀔 때의 알림: 작업 끝남(작업 중 → 쉬는 중), 승인 필요(→ 승인 대기).
const workPushedAt = {}; // 세션마다 마지막으로 "작업 중" 알림을 보낸 시각(20초에 한 번까지만)
function notifyStatus(s, prev) {
  const name = findSession(s.session)?.name || '세션';
  // 다른 세션이 하는 일이 바뀌면 그 탭을 보고 있지 않은 기기에 조용히 알린다(같은 알림을 바꿔 끼워 쌓이지 않게).
  if (s.state === 'working' && s.detail && s.detail !== prev.detail && Date.now() - (workPushedAt[s.session] || 0) > 20_000) {
    workPushedAt[s.session] = Date.now();
    pushAll({ title: `${name} 작업 중`, body: String(s.detail).slice(0, 120), tag: `uifb-work-${s.session}`, silent: true, session: s.session }, 'work');
  }
  const busy = (x) => x === 'working' || x === 'permission';
  if (s.state === 'permission' && prev.state !== 'permission') pushAll({ title: `${name} 승인 필요`, body: s.detail || '터미널에서 승인을 기다리는 중', tag: `uifb-perm-${s.session}`, session: s.session }, 'permission');
  if (s.state === 'idle' && busy(prev.state)) {
    // 마지막 답은 작업이 끝나는 것과 거의 같은 때 기록되므로 잠깐 기다렸다가 그 답을 알림 본문에 담는다.
    setTimeout(() => {
      const last = readChat().messages.filter((m) => m.from === 'agent' && m.session === s.session).at(-1);
      // 마지막 답을 이미 답장 알림으로 보냈으면, 답장 알림을 켠 기기에는 작업 끝 알림을 또 보내지 않는다(같은 글이 두 번 오지 않게).
      const dup = s.lastPushed || (!s.last && last && answerPushed.has(last.id));
      pushAll({ title: `${name} 작업 끝`, body: s.last ? plainBody(s.last) : last ? plainBody(last.text) : '하던 일을 마쳤습니다', tag: `uifb-done-${s.session}`, session: s.session }, 'done', dup ? (p) => p.answer : null);
    }, 3000);
  }
}
// Codex 세션 상태: Codex 에는 hook-relay 훅이 없어서, 대화 기록(rollout)의 마지막 턴 표시로 읽는다.
// task_started 뒤에 task_complete·turn_aborted 가 없으면 작업 중(하는 일은 그 뒤 마지막 도구), 있으면 쉬는 중.
// 승인 대기는 대화 기록에 남지 않아 알 수 없다. 대화 기록이 마지막으로 바뀐 시각을 at 으로 적어 "오래 멈춤"이 실제로 멈췄을 때만 울리게 한다.
function codexToolLabel(name = '') {
  if (/^(exec|exec_command|shell|local_shell)$/.test(name)) return '명령 실행 중';
  if (name === 'apply_patch') return '파일 수정 중';
  if (name === 'read_file') return '파일 읽는 중';
  if (name.startsWith('mcp__')) return `${name.split('__')[1]} 도구 사용 중`;
  return name ? `${name} 사용 중` : '생각하는 중';
}
function codexStatus(file) {
  try {
    const st = fs.statSync(file);
    const len = Math.min(st.size, 512 * 1024);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    let tool = '';
    for (const l of buf.toString('utf8').split('\n').reverse()) {
      if (!l.includes('"type"')) continue;
      let o;
      try { o = JSON.parse(l); } catch { continue; }
      const t = o.payload?.type;
      if (!tool && (t === 'function_call' || t === 'custom_tool_call')) tool = String(o.payload.name || '');
      if (t === 'task_complete') return { state: 'idle', last: o.payload.last_agent_message || '', at: st.mtime.toISOString() };
      if (t === 'turn_aborted') return { state: 'idle', at: st.mtime.toISOString() };
      if (t === 'task_started') return { state: 'working', detail: codexToolLabel(tool), at: st.mtime.toISOString() };
    }
  } catch {}
  return null;
}
const codexSeen = new Map(); // 세션마다 마지막으로 본 대화 기록 상태(처음 본 상태는 알리지 않는다)
const codexAnswered = new Map(); // 세션마다 답장 알림을 보낸 마지막 Codex 답 번호
setInterval(() => {
  let files = [];
  try { files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json')); } catch {}
  for (const f of files) {
    const s = readJsonSafe(path.join(sessionsDir, f));
    if (s?.tool !== 'codex' || !s.path || !sid(s.sessionId)) continue;
    // 새 최종 답(중간 안내 빼고)이 대화 기록에 생기면 답장 알림을 보낸다(Claude 세션이 답을 남길 때와 같게).
    const answers = readTranscript(s.sessionId).items.filter((m) => m.from === 'agent' && !m.interim);
    const lastAns = answers.at(-1)?.id ?? null, seenAns = codexAnswered.get(s.sessionId);
    if (seenAns === undefined) codexAnswered.set(s.sessionId, lastAns); // 서버를 띄웠을 때 이미 있던 답은 알리지 않는다
    else if (lastAns !== seenAns) {
      codexAnswered.set(s.sessionId, lastAns);
      const from = answers.findIndex((x) => x.id === seenAns);
      for (const m of from < 0 && seenAns !== null ? answers.slice(-1) : answers.slice(from + 1)) { // 앞 답이 읽는 범위 밖으로 밀려났으면 마지막 답만
        answerPushed.add(m.id);
        pushAll({ title: `${s.name || '세션'} 답장`, body: plainBody(m.text), tag: `uifb-${s.sessionId}`, session: s.sessionId }, 'answer');
      }
    }
    const now = codexStatus(s.path);
    if (!now) continue;
    if (now.state === 'idle' && lastAns && answerPushed.has(lastAns)) now.lastPushed = true;
    const key = `${now.state}|${now.detail || ''}|${now.at}`, before = codexSeen.get(s.sessionId);
    if (before === key) continue;
    codexSeen.set(s.sessionId, key);
    const prev = readStatus(s.sessionId);
    if (before !== undefined && (now.state !== prev.state || (now.detail || '') !== (prev.detail || ''))) notifyStatus({ session: s.sessionId, ...now }, prev);
    fs.writeFileSync(path.join(root, `status-${s.sessionId}.json`), JSON.stringify({ state: now.state, detail: now.detail || '', at: now.at }) + '\n');
  }
}, 2000).unref();
// 오래 멈춤: "작업 중"이 5분 넘게 그대로면 그 상태에 한 번 알린다.
const staleSent = new Map();
setInterval(() => {
  for (const x of listSessions()) {
    const st = x.status;
    if (st?.state !== 'working' || !st.at || Date.now() - Date.parse(st.at) < 5 * 60_000 || staleSent.get(x.id) === st.at) continue;
    staleSent.set(x.id, st.at);
    pushAll({ title: `${x.name} 오래 멈춤`, body: `"${st.detail || '작업 중'}" 상태가 5분 넘게 그대로예요`, tag: `uifb-stale-${x.id}`, session: x.id }, 'stale');
  }
}, 60_000).unref();
// 비교 페이지 준비: .ui-feedback 에 review*.html 이 새로 생기면 알린다.
try {
  const known = new Set(fs.readdirSync(root).filter((f) => /^review.*\.html$/.test(f)));
  fs.watch(root, (ev, f) => {
    if (!f || !/^review.*\.html$/.test(f) || known.has(f) || !fs.existsSync(path.join(root, f))) return;
    known.add(f);
    setTimeout(() => {
      const title = /<title>([^<]*)<\/title>/.exec(fs.readFileSync(path.join(root, f), 'utf8'))?.[1] || f;
      pushAll({ title: '비교 페이지 준비', body: `${title} — 평가할 차례예요`, tag: `uifb-review-${f}` }, 'review');
    }, 1500);
  });
} catch {}

// ── 세션끼리 주고받은 메시지 ──
// 보낸 세션의 훅이 보낼 때(PreToolUse SendMessage) 한 번, 받은 세션의 훅이 받을 때(UserPromptSubmit) 한 번 알려 온다.
// SendMessage 는 받는 쪽을 세션 이름(peer 이름)으로 부르고, 그 이름은 대화창 탭 이름과 다르다.
// 받은 쪽이 같은 글을 알려 오면 그 이름이 어느 세션인지 배워 peers.json 에 적어 두고, 다음부터는 보낼 때 바로 찾는다.
const peersFile = path.join(root, 'peers.json');
const peerName = (v) => (typeof v === 'string' ? v.replace(/\s*\[[^\]]*\]\s*$/, '').trim().slice(0, 80) : '');
function readPeers() {
  try { return JSON.parse(fs.readFileSync(peersFile, 'utf8')); } catch { return {}; }
}
function addPeer(msg, text) {
  const chat = readChat();
  const peers = readPeers();
  const now = new Date().toISOString();
  if (sid(msg.to)) {
    // 받은 쪽: 10분 안에 같은 글을 보낸 기록이 있으면 그 기록에 받은 세션과 받은 시각을 적는다.
    const sent = chat.messages.findLast((m) => m.from === 'peer' && !m.readAt && m.text === text && Date.now() - Date.parse(m.at) < 10 * 60_000 && (!m.to || m.to === msg.to));
    const fromName = peerName(msg.fromName);
    if (sent) {
      sent.to = msg.to;
      sent.readAt = now;
      if (sent.toName) peers[sent.toName] = msg.to;
      if (fromName && sent.session) peers[fromName] = sent.session;
      fs.writeFileSync(peersFile, JSON.stringify(peers, null, 2) + '\n');
    } else {
      chat.messages.push({ id: chat.messages.length + 1, from: 'peer', text, at: now, to: msg.to, readAt: now, ...(fromName ? { fromName } : {}), ...(peers[fromName] ? { session: peers[fromName] } : {}) });
    }
  } else {
    const toName = peerName(msg.toName);
    const entry = { id: chat.messages.length + 1, from: 'peer', text, at: now, toName };
    if (sid(msg.session)) entry.session = msg.session;
    if (peers[toName]) entry.to = peers[toName];
    chat.messages.push(entry);
  }
  writeJsonAtomic(chatFile, chat); // 한 번에 바꿔 다른 쪽이 반쯤 쓴 파일을 읽지 않게
  const last = chat.messages.at(-1);
  if (!sid(msg.to)) pushAll({ title: `${findSession(last.session)?.name || '세션'} → ${last.to ? findSession(last.to)?.name || last.toName : last.toName}`, body: plainBody(text), tag: 'uifb-peer' }, 'peer');
  return last;
}

// 보관함에서 보낸 메시지의 구조(분류, 항목마다 글·위치·저장 시각·커밋·담은 화면). 대화창이 사용자가 쓴 글과 위치 같은 덧붙인 정보를 나눠 보이고,
// 다시 보내기에서 글만 고치게 한다. 세션에 가는 글(text)은 이 구조로 만든다.
function cleanDraft(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.items) || !v.items.length) return undefined;
  const items = v.items.slice(0, 50).map((d) => ({
    ...(Number.isInteger(d?.id) ? { id: d.id } : {}), // 보관함 항목 번호(보낸 기록과 메시지를 잇는다)
    text: typeof d?.text === 'string' ? d.text.trim().slice(0, 4000) : '',
    where: cleanWhere(d?.where),
    at: typeof d?.at === 'string' && !Number.isNaN(Date.parse(d.at)) ? d.at : null,
    commit: typeof d?.commit === 'string' && /^[0-9a-f]{4,40}$/.test(d.commit) ? d.commit : null,
    round: Number(d?.round) || null,
    device: d?.device === 'mobile' || d?.device === 'desktop' ? d.device : null,
    ...(cleanQuotes(d?.quotes) ? { quotes: cleanQuotes(d.quotes) } : {}), // 이 항목 글 속 표시와 짝인 답장·참고
  })).filter((d) => d.text);
  return items.length ? { label: cleanLabel(v.label) || '미분류', items } : undefined;
}
function draftMessageText(draft) {
  const { label, items } = draft;
  if (items.length > 1) return `[${label}] 보관함에서 모아 보낸 ${items.length}개입니다.\n\n` + items.map((d, i) => `${i + 1}. ${draftText(d).replace(/\n/g, '\n   ')}`).join('\n\n');
  return `[${label}] ` + draftText(items[0]);
}

// 한 글 안 여러 곳에 붙인 답장·참고(글 속 [↩#번호]·[📎#번호] 표시와 순서대로 짝, #1955). 앞 번호만, 10개까지.
// 붙일 수 있는 메시지 번호: 대화창 기록의 숫자 번호(지금 메시지보다 앞) 또는 Codex 대화 기록에서 읽은 답의 x 번호(#2113).
const msgRef = (v, below = Infinity) => (Number.isInteger(v) && v > 0 && v < below) || (typeof v === 'string' && /^x[\w-]{1,80}$/.test(v));
function cleanQuotes(q, below = Infinity) {
  if (!Array.isArray(q)) return undefined;
  const out = q.filter((x) => msgRef(x?.id, below)).slice(0, 30)
    .map((x) => ({ id: x.id, ...(typeof x.quote === 'string' && x.quote.trim() ? { quote: x.quote.trim().slice(0, 500) } : {}), ...(x.refer === true ? { refer: true } : {}) }));
  return out.length ? out : undefined;
}

// 대화 기록에 메시지를 더하고, Codex 세션에게 온 사용자 메시지는 그 세션에 바로 넣는다.
function addChat(msg) {
  const draft = msg.from === 'user' ? cleanDraft(msg.draft) : undefined;
  const text = draft ? draftMessageText(draft) : typeof msg.text === 'string' ? msg.text.trim().slice(0, 12000) : '';
  if (text && msg.from === 'peer') return addPeer(msg, text);
  if (!text || !['user', 'agent', 'sub'].includes(msg.from)) return null; // sub: 세션의 서브에이전트가 돌려준 보고
  const chat = readChat();
  // 같은 cid 로 다시 온 글(느린 망에서 다시 누름)은 새로 만들지 않고 먼저 받은 것을 돌려준다.
  const cid = typeof msg.cid === 'string' ? msg.cid.slice(0, 80) : null;
  if (cid) { const dup = chat.messages.find((x) => x.cid === cid); if (dup) return dup; }
  const entry = { id: chat.messages.length + 1, from: msg.from, text, round: Number(msg.round) || null, at: new Date().toISOString() };
  if (cid) entry.cid = cid;
  if (msg.from === 'agent' && typeof msg.agent === 'string') entry.agent = msg.agent.slice(0, 40);
  if (msg.from === 'sub' && typeof msg.sub === 'string') entry.sub = msg.sub.slice(0, 40);
  // 세션 답 맨 앞의 <re 1090 1091>: 이 답이 어느 메시지에 대한 답인지. 글에서는 떼어 내고 re 로 남긴다(대화창이 연결선으로 잇는다).
  if (msg.from === 'agent') {
    const mk = /^\s*<re\s+([#\d,\s]+)>\s*/.exec(text);
    if (mk) {
      entry.re = [...new Set(mk[1].match(/\d+/g).map(Number))].filter((n) => n < entry.id).slice(0, 50);
      entry.text = text.slice(mk[0].length) || text;
    }
  }
  // 사용자 메시지는 받을 세션(to), 에이전트 답과 터미널 입력은 그 세션(session)을 적는다.
  if (sid(msg.to)) entry.to = msg.to;
  if (sid(msg.session)) entry.session = msg.session;
  if (typeof msg.context === 'string') entry.context = msg.context.slice(0, 20);
  if (msg.device === 'mobile' || msg.device === 'desktop') entry.device = msg.device;
  if (cleanWhere(msg.where)) entry.where = cleanWhere(msg.where);
  if (draft) entry.draft = draft;
  if (msgRef(msg.replyTo, entry.id)) {
    entry.replyTo = msg.replyTo;
    if (msg.refer === true) entry.refer = true; // 답장이 아니라 참고로만 붙인 인용
    if (typeof msg.replyQuote === 'string' && msg.replyQuote.trim()) entry.replyQuote = msg.replyQuote.trim().slice(0, 500); // 원문 중 사용자가 고른 부분만 인용
  }
  if (msg.interject === true && entry.from === 'user') entry.interject = true;
  if (entry.from === 'user' && cleanQuotes(msg.quotes, entry.id)) entry.quotes = cleanQuotes(msg.quotes, entry.id);
  if (Number.isInteger(msg.resendOf) && msg.resendOf > 0 && msg.resendOf < entry.id) entry.resendOf = msg.resendOf;
  // 곁질문 묶음(#2083): 묶음 번호는 그 묶음 첫 질문의 번호다.
  if (entry.context === 'side') entry.sideGroup = Number.isInteger(msg.sideGroup) && msg.sideGroup > 0 && msg.sideGroup <= entry.id ? msg.sideGroup : entry.id;
  // 메시지를 밀어(또는 단추로) 연 곁질문은 그 메시지(sideOn)에 대한 묶음이다(#2099).
  if (entry.context === 'side' && entry.from === 'user' && msgRef(msg.sideOn, entry.id)) entry.sideOn = msg.sideOn;
  chat.messages.push(entry);
  writeJsonAtomic(chatFile, chat); // 한 번에 바꿔 다른 쪽이 반쯤 쓴 파일을 읽지 않게
  const target = entry.from === 'user' && entry.to ? findSession(entry.to) : null;
  if (target?.tool === 'codex' && !msg.noQueue) queueToCodex(target, entry); // noQueue: the host queues review completion separately.
  // 사용자가 터미널이나 화면에서 그 세션에 말을 걸었다면 그때까지의 답은 읽은 것이다.
  // 세션이 답하면 알림을 켠 기기들에 알린다.
  if (entry.from === 'agent' && entry.session) {
    const name = findSession(entry.session)?.name || '세션';
    answerPushed.add(entry.id);
    pushAll({ title: `${name} 답장`, body: plainBody(entry.text), tag: `uifb-${entry.session}`, session: entry.session }, 'answer');
  }
  // keepUnread: 사용자가 직접 쓴 글이 아니라 서버가 대신 남기는 글(평가 완료 요약)은 읽음으로 치지 않는다(#1874).
  const talkedTo = entry.from === 'user' && !msg.keepUnread ? entry.session || entry.to : null;
  if (talkedTo) markSeen({ [talkedTo]: entry.at });
  if (entry.from === 'user' && entry.to && !msg.keepUnread) setTimeout(() => nudge(entry.to), 2000);
  return entry;
}

// 깨우기(#1923·#1925): 감시가 꺼진 Claude 세션(Esc 로 멈춰 감시를 다시 못 켠 때 등)에 대화창 글이 오면,
// 그 세션의 cmux 터미널에 고정 문구를 입력해 깨운다. 쉬는 중일 때만, 세션마다 1분에 한 번만. 보낸 글 자체는 치지 않는다.
const NUDGE_TEXT = '[자동생성] 감시를 깨우고 대화창의 새 메시지를 확인합니다.';
const nudgedAt = new Map();
function nudge(id) {
  const s = findSession(id);
  if (!s || s.tool === 'codex' || !s.cmux?.surface) return;
  if (readWatchFile(`watch-${s.sessionId}.json`).active) return;
  if (['working', 'permission'].includes(readStatus(s.sessionId).state)) return;
  if (Date.now() - (nudgedAt.get(id) || 0) < 60_000) return;
  nudgedAt.set(id, Date.now());
  try {
    execFileSync(cmuxCli(), ['send', '--surface', s.cmux.surface, NUDGE_TEXT], { timeout: 5000, stdio: 'pipe' });
    execFileSync(cmuxCli(), ['send-key', '--surface', s.cmux.surface, 'enter'], { timeout: 5000, stdio: 'pipe' });
  } catch {}
}
const cmuxCli = () => process.env.CMUX_BUNDLED_CLI_PATH || (fs.existsSync('/Applications/cmux.app/Contents/Resources/bin/cmux') ? '/Applications/cmux.app/Contents/Resources/bin/cmux' : 'cmux');

// ── 읽음 상태 ──
// 세션마다 사용자가 마지막으로 읽은 답의 시각. 앱 화면(4798)과 리뷰 페이지(4799)는 주소가 달라 브라우저 저장소를 함께 못 쓰므로 서버에 둔다.
// Actual pickup only. Queue acceptance is stored separately on the message.
const deliveredFile = path.join(root, 'delivered.json');
let lastDelivered = {};
function readDelivered() {
  const d = readJsonSafe(deliveredFile);
  if (d) lastDelivered = d; // 다른 쪽이 쓰는 중이라 못 읽으면 마지막으로 읽은 기록을 쓴다(빈 기록을 대화창에 보내지 않게)
  const delivered = d || lastDelivered;
  const messages = readChat().messages.filter(m => m.queue?.receipt && !delivered._at?.[m.id]);
  let changed = false;
  for (const id of new Set(messages.map(m => m.to))) {
    const session = findSession(id);
    if (session?.tool !== 'codex') continue;
    for (const [messageId, at] of Object.entries(readQueuePickups(session, messages))) {
      delivered._at = { ...(delivered._at || {}), [messageId]: at };
      changed = true;
    }
  }
  if (changed) writeJsonAtomic(deliveredFile, delivered);
  return delivered;
}
const seenFile = path.join(root, 'seen.json');
function readSeen() {
  try {
    return JSON.parse(fs.readFileSync(seenFile, 'utf8'));
  } catch {
    return {};
  }
}
// 더 나중 시각만 받아들인다(늦게 도착한 옛 값이 읽음을 되돌리지 않게).
function markSeen(updates) {
  const seen = readSeen();
  let changed = false;
  for (const [id, at] of Object.entries(updates || {})) {
    if (!sid(id) || typeof at !== 'string' || at.length > 40) continue;
    if (!seen[id] || at > seen[id]) { seen[id] = at; changed = true; }
  }
  if (changed) fs.writeFileSync(seenFile, JSON.stringify(seen, null, 2) + '\n');
  return seen;
}

// ── 화면 설정 ──
// 대화 창 크기·입력칸 높이는 데스크톱과 모바일을 따로 두고({ desktop: {...}, mobile: {...} }), 고른 세션 탭(tab)은 함께 쓴다.
const prefsFile = path.join(root, 'prefs.json');
function readPrefs() {
  try {
    return JSON.parse(fs.readFileSync(prefsFile, 'utf8'));
  } catch {
    return {};
  }
}
function savePrefs(req) {
  const device = req.device === 'mobile' ? 'mobile' : 'desktop';
  const prefs = readPrefs();
  const cur = prefs[device] || {};
  const num = (v) => (Number.isFinite(v) && v > 0 && v < 5000 ? Math.round(v) : null);
  if ('panel' in req) cur.panel = req.panel && num(req.panel.w) && num(req.panel.h) ? { w: num(req.panel.w), h: num(req.panel.h) } : null;
  if ('inputH' in req) cur.inputH = num(req.inputH);
  if ('tab' in req && sid(req.tab)) prefs.tab = req.tab;
  // 보관함에 담을 때 마지막으로 고른 분류(두 화면 공용)
  // 세션마다 따로 둔다(분류는 세션마다 다르다).
  if ('draftLabel' in req && sid(req.session)) prefs.draftLabels = { ...(prefs.draftLabels || {}), [req.session]: typeof req.draftLabel === 'string' && req.draftLabel.trim() ? req.draftLabel.trim().slice(0, 30) : null };
  // 세션마다 보고 있던 메시지(맨 위에 보이던 메시지 id, 맨 아래면 'bottom'). 화면 폭과 상관없이 같은 메시지로 돌아간다.
  // 세션마다 대화창 위에 고정해 둔 메시지 번호들(#1999, 두 화면 공용)
  if (req.pins && sid(req.pins.session) && Array.isArray(req.pins.ids)) prefs.pins = { ...(prefs.pins || {}), [req.pins.session]: [...new Set(req.pins.ids.filter((n) => msgRef(n)))].slice(0, 10) };
  if (req.pos && sid(req.pos.session) && typeof req.pos.id === 'string' && req.pos.id.length < 80) prefs.pos = { ...(prefs.pos || {}), [req.pos.session]: req.pos.id };
  // 보관함에서 접어 둔 분류와 "최근 보낸 것·지운 것"을 펼쳤는지(세션마다, 두 화면 공용)
  if (req.fold && sid(req.fold.session)) {
    const labels = Array.isArray(req.fold.labels) ? req.fold.labels.filter((x) => typeof x === 'string').map((x) => x.slice(0, 30)).slice(0, 50) : [];
    prefs.fold = { ...(prefs.fold || {}), [req.fold.session]: { labels, trash: req.fold.trash === true } };
  }
  if ('panel' in req || 'inputH' in req) prefs[device] = cur;
  fs.writeFileSync(prefsFile, JSON.stringify(prefs, null, 2) + '\n');
  return prefs;
}

// ── 쓰던 글 ──
// 세션 탭마다 입력칸에 쓰다가 아직 보내지 않은 글. 새로고침해도 남고, 앱 화면·리뷰 페이지에서 이어 쓸 수 있다.
const composeFile = path.join(root, 'compose.json');
function readCompose() {
  try {
    return JSON.parse(fs.readFileSync(composeFile, 'utf8'));
  } catch {
    return {};
  }
}
function saveCompose(req) {
  const all = readCompose();
  if (!sid(req.session)) return all;
  const text = typeof req.text === 'string' ? req.text.slice(0, 12000) : '';
  if (text) all[req.session] = { text, at: new Date().toISOString() };
  else delete all[req.session];
  fs.writeFileSync(composeFile, JSON.stringify(all, null, 2) + '\n');
  return all;
}

// ── 보관함 ──
const draftsFile = path.join(root, 'drafts.json');
const projectDir = path.dirname(root);

// trash: 보낸 것·지운 것을 7일 동안 남겨 두어, 보관함에서 확인하고 다시 담을 수 있게 한다.
const TRASH_DAYS = 7;
function readDrafts() {
  let store;
  try {
    store = JSON.parse(fs.readFileSync(draftsFile, 'utf8'));
  } catch {
    store = { nextId: 1, drafts: [] };
  }
  store.trash = (store.trash || []).filter((d) => Date.now() - Date.parse(d.goneAt) < TRASH_DAYS * 86_400_000);
  return store;
}
const toTrash = (store, list, gone, extra = {}) => {
  const now = new Date().toISOString();
  store.trash.push(...list.map((d) => ({ ...d, gone, goneAt: now, ...(extra[d.id] || {}) })));
};

function writeDrafts(d) {
  fs.writeFileSync(draftsFile, JSON.stringify(d, null, 2) + '\n');
}

// 저장 당시 코드 버전. 나중에 화면이 바뀌어도 세션이 그때 코드와 비교해 어디를 말한 것인지 찾게 한다.
function currentCommit() {
  try {
    return execFileSync('git', ['-C', projectDir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

const shortTime = (iso) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const cleanLabel = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 30) : null);

// 보관함 항목 하나를 보낼 글로 만든다. 위치는 저장 당시 맥락(시각·커밋·문구)을 함께 적는다.
function draftText(d) {
  const lines = [d.text];
  if (d.where?.url || d.where?.selector) {
    lines.push(`위치(${shortTime(d.at)} 저장${d.commit ? ` · 커밋 ${d.commit}` : ''} 기준): ${d.where.url || ''}${d.where.selector ? ' · ' + d.where.selector : ''}${d.where.component ? ' · 컴포넌트 ' + d.where.component : ''}${d.where.text ? ` · 당시 문구 "${d.where.text}"` : ''}`);
    if (adjustText(d.where)) lines.push(adjustText(d.where));
  }
  if (d.round || d.device) lines.push(`(${[d.round ? `${d.round}차 비교 페이지를 보다가` : '', d.device === 'mobile' ? '모바일에서' : d.device === 'desktop' ? '데스크톱에서' : ''].filter(Boolean).join(' ')} 남김)`);
  return lines.join('\n');
}

// 고른 항목을 받는 세션별로 묶어 보낸다. combine 이면 세션마다 번호 매긴 메시지 하나, 아니면 하나씩.
// device: 보내기를 누른 화면(대화 라벨에 붙음). 항목마다 담은 화면은 본문에 "(모바일에서 남김)"으로 남는다.
// 보류에서 보내기: 보관함 형식(분류·위치 덧붙임) 없이 처음 쓴 그대로 보낸다. 보낸 것은 7일 기록에 남긴다.
function sendPlain(ids, device, interject) {
  const store = readDrafts();
  const picked = store.drafts.filter((d) => ids.includes(d.id));
  const sent = picked.map((d) => addChat({ from: 'user', to: d.to, text: d.text, where: d.where, context: d.context, round: d.round, device: device || d.device, interject, replyTo: d.replyTo, replyQuote: d.replyQuote, refer: d.refer, quotes: d.quotes })).filter(Boolean);
  toTrash(store, picked, 'sent', Object.fromEntries(picked.map((d, i) => [d.id, { msgId: sent[i]?.id }])));
  store.drafts = store.drafts.filter((d) => !ids.includes(d.id));
  writeDrafts(store);
  return sent;
}

function sendDrafts(ids, combine, device) {
  const store = readDrafts();
  const picked = store.drafts.filter((d) => ids.includes(d.id));
  // 받는 세션과 분류가 같은 것끼리 한 메시지로 묶는다. 받는 세션도 분류 단위로 처리할 수 있게 첫 줄에 분류를 적는다.
  const groups = new Map();
  for (const d of picked) {
    const k = d.to + '\u0000' + (d.label || '');
    groups.set(k, [...(groups.get(k) || []), d]);
  }
  // 항목마다 붙인 답장·참고(#1965): 예전 한 개 답장(replyTo)은 글 앞에 표시를 붙여 같은 방식으로 맞춘다.
  // 묶어 보낸 메시지의 quotes 는 항목 순서대로 이어 붙여, 합친 글 속 표시 순서와 짝이 맞게 한다.
  const withQ = (d) => {
    if (d.quotes?.length || !d.replyTo) return d;
    return { ...d, text: `[${d.refer ? '📎' : '↩'}#${d.replyTo}] ${d.text}`, quotes: [{ id: d.replyTo, ...(d.replyQuote ? { quote: d.replyQuote } : {}), ...(d.refer ? { refer: true } : {}) }] };
  };
  const quotesOf = (items) => items.flatMap((d) => d.quotes || []);
  const sent = [];
  for (const raw of groups.values()) {
    const list = raw.map(withQ);
    const to = list[0].to;
    const label = list[0].label || '미분류'; // 분류 없이 담은 것도 [미분류]로 붙여 받는 세션이 묶음을 알게 한다
    if (combine && list.length > 1) {
      sent.push(addChat({ from: 'user', to, draft: { label, items: list }, quotes: quotesOf(list), device, context: list.every((d) => d.context === 'review') ? 'review' : 'app' }));
    } else {
      for (const d of list) sent.push(addChat({ from: 'user', to, draft: { label, items: [d] }, quotes: quotesOf([d]), context: d.context, round: d.round, where: d.where, device: device || d.device }));
    }
  }
  // 보낸 항목은 어느 메시지로 갔는지(msgId)와 함께 7일 동안 남긴다.
  const msgOf = {};
  for (const e of sent.filter(Boolean)) for (const it of e.draft?.items || []) if (it.id) msgOf[it.id] = { msgId: e.id };
  toTrash(store, picked, 'sent', msgOf);
  store.drafts = store.drafts.filter((d) => !ids.includes(d.id));
  writeDrafts(store);
  return sent.filter(Boolean);
}

// 보관함 요청: add(새 항목) · update(글·받는 세션·위치 고치기) · delete · send
function handleDrafts(req) {
  const store = readDrafts();
  const ids = Array.isArray(req.ids) ? req.ids.filter(Number.isInteger) : [];
  if (req.action === 'add') {
    const text = typeof req.text === 'string' ? req.text.trim().slice(0, 4000) : '';
    if (!text || !sid(req.to)) return { status: 400, body: { error: 'text와 to(세션)가 필요합니다.' } };
    const cid = typeof req.cid === 'string' ? req.cid.slice(0, 80) : null;
    const dup = cid && [...store.drafts, ...store.trash].find((x) => x.cid === cid);
    if (dup) return { status: 200, body: dup };
    const d = { id: store.nextId++, to: req.to, text, label: cleanLabel(req.label), device: req.device === 'mobile' ? 'mobile' : req.device === 'desktop' ? 'desktop' : null, context: req.context === 'review' ? 'review' : 'app', round: Number(req.round) || null, where: cleanWhere(req.where), commit: currentCommit(), at: new Date().toISOString(), ...(req.hold === true ? { hold: true } : {}), ...(Number.isInteger(req.fromMsg) ? { fromMsg: req.fromMsg } : {}), ...(cid ? { cid } : {}),
      // 답장·참고를 붙인 채 담았으면 그대로 남겨, 보류에서 보낼 때 함께 보낸다.
      ...(msgRef(req.replyTo) ? { replyTo: req.replyTo, ...(typeof req.replyQuote === 'string' && req.replyQuote.trim() ? { replyQuote: req.replyQuote.trim().slice(0, 500) } : {}), ...(req.refer === true ? { refer: true } : {}) } : {}), ...(cleanQuotes(req.quotes) ? { quotes: cleanQuotes(req.quotes) } : {}) };
    store.drafts.push(d);
    writeDrafts(store);
    return { status: 200, body: d };
  }
  if (req.action === 'update') {
    const d = store.drafts.find((x) => x.id === req.id);
    if (!d) return { status: 404, body: { error: '없는 항목입니다.' } };
    if (typeof req.text === 'string' && req.text.trim()) d.text = req.text.trim().slice(0, 4000);
    if (sid(req.to)) d.to = req.to;
    if ('label' in req) d.label = cleanLabel(req.label);
    // 보류(대화창 맨 아래에 잠깐 대기) ↔ 보관함(완전 나중)
    if ('hold' in req) { if (req.hold === true) d.hold = true; else delete d.hold; }
    if (req.where !== undefined) {
      d.where = cleanWhere(req.where);
      d.commit = currentCommit();
      d.at = new Date().toISOString();
    }
    writeDrafts(store);
    return { status: 200, body: d };
  }
  if (req.action === 'delete') {
    toTrash(store, store.drafts.filter((d) => ids.includes(d.id)), 'deleted');
    store.drafts = store.drafts.filter((d) => !ids.includes(d.id));
    writeDrafts(store);
    return { status: 200, body: { ok: true } };
  }
  // 보낸 것·지운 것을 보관함으로 되돌린다.
  if (req.action === 'restore') {
    const back = store.trash.filter((d) => ids.includes(d.id));
    store.trash = store.trash.filter((d) => !ids.includes(d.id));
    store.drafts.push(...back.map(({ gone, goneAt, msgId, ...d }) => d));
    writeDrafts(store);
    return { status: 200, body: { ok: true, restored: back.length } };
  }
  if (req.action === 'send') {
    if (!ids.length) return { status: 400, body: { error: '보낼 항목(ids)이 필요합니다.' } };
    const device = req.device === 'mobile' || req.device === 'desktop' ? req.device : null;
    if (req.plain === true) return { status: 200, body: { sent: sendPlain(ids, device, req.interject === true) } };
    return { status: 200, body: { sent: sendDrafts(ids, req.combine !== false, device) } };
  }
  return { status: 400, body: { error: 'action은 add·update·delete·restore·send 중 하나입니다.' } };
}

const QUEUE_PREFIX = '[대화/피드백 · ';
const queueRequests = new Map();

function saveQueue(entry, outcome, expectedAttempt) {
  const chat = readChat();
  const saved = chat.messages.find((m) => m.id === entry.id);
  if (expectedAttempt && saved?.queue?.attempt !== expectedAttempt) return;
  entry.queue = { ...outcome, at: new Date().toISOString() };
  if (saved) { saved.queue = entry.queue; writeJsonAtomic(chatFile, chat); }
}

async function sendChatEntry(res, entry) {
  await queueRequests.get(entry.id);
  const saved = readChat().messages.find((m) => m.id === entry.id) || entry;
  send(res, ['failed', 'unknown'].includes(saved.queue?.state) ? 502 : 200, saved);
}

// 페이지 메시지를 실행 중인 Codex 세션에 넣는다. 쉬고 있으면 바로 새 턴이 시작되고, 작업 중이면 그 턴이 끝난 뒤 처리된다.
// Pass arguments directly, including on Windows; shell shims can corrupt quotes and newlines.
function queueToCodex(session, entry) {
  const where = entry.where?.url || entry.where?.selector
    ? `\n위치: ${entry.where.url || ''}${entry.where.selector ? ' · ' + entry.where.selector : ''}${entry.where.component ? ' · 컴포넌트 ' + entry.where.component : ''}${entry.where.text ? ' · "' + entry.where.text + '"' : ''}${adjustText(entry.where) ? '\n' + adjustText(entry.where) : ''}`
    : '';
  const src = (entry.context === 'app' ? '앱 화면' : '비교 페이지') + (entry.device === 'mobile' ? ' · 모바일' : entry.device === 'desktop' ? ' · 데스크톱' : '');
  const attempt = randomUUID();
  const receipt = entry.queue?.receipt || randomUUID();
  saveQueue(entry, { state: 'pending', attempt, receipt });
  // 답장·참고로 붙인 원문도 함께 넣는다(Claude 세션이 받는 글과 같게). Codex 답은 대화 기록에서 찾는다.
  const quotes = quoteLines(entry, [...readChat().messages, ...readTranscript(session.sessionId).items]);
  const request = queueText(session, `${QUEUE_PREFIX}${src}${entry.round ? ` · ${entry.round}차` : ''}] [uifb-receipt:${receipt}] ${entry.text}${quotes.length ? '\n' + quotes.join('\n') : ''}${where}`)
    .then((outcome) => {
      saveQueue(entry, { ...outcome, attempt, receipt }, attempt);
      if (queueRequests.get(entry.id) === request) queueRequests.delete(entry.id);
      return outcome;
    });
  queueRequests.set(entry.id, request);
  return request;
}

function windowsQueueCommand() {
  for (const entry of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const dir = entry.replace(/^"(.*)"$/, '$1');
    const executable = path.join(dir, 'codex.exe');
    if (fs.existsSync(executable)) return { file: executable, prefix: [] };
    const shim = ['codex.cmd', 'codex.ps1'].some((name) => fs.existsSync(path.join(dir, name)));
    const cli = path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (shim && fs.existsSync(cli)) return { file: process.execPath, prefix: [cli] };
  }
  return null;
}

function queueText(session, message) {
  const args = ['queue', '--thread', session.sessionId, '--message', message];
  // Resolve once. Return only diagnostic categories, never raw stderr or prompt fragments.
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (outcome) => { if (!settled) { settled = true; clearTimeout(timer); resolve(outcome); } };
    try {
      const command = process.platform === 'win32' ? windowsQueueCommand() : { file: 'codex', prefix: [] };
      if (!command) { finish({ ok: false, state: 'failed', error: 'spawn_failed', diagnostic: 'cli_not_found' }); return; }
      const child = queueSpawn(command.file, [...command.prefix, ...args], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      timer = setTimeout(() => {
        finish({ ok: false, state: 'unknown', error: 'queue_timeout' });
        try { child.kill?.(); } catch {}
      }, queueTimeoutMs);
      let stderr = '';
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk).slice(0, 4096); });
      child.once('error', () => finish({ ok: false, state: 'failed', error: 'spawn_failed' }));
      child.once('close', (code, signal) => finish(code === 0 && !signal
        ? { ok: true, state: 'accepted', code: 0 }
        : { ok: false, state: signal ? 'unknown' : 'failed', error: signal ? 'queue_interrupted' : 'queue_failed', code, signal: signal || null, ...(stderr.trim() ? { diagnostic: /unexpected argument|unrecognized (?:argument|option)|invalid (?:argument|value)|unknown option/i.test(stderr) ? 'invalid_arguments' : 'cli_error' } : {}) }));
    } catch {
      finish({ ok: false, state: 'failed', error: 'spawn_failed' });
    }
  });
}

// 곁질문(#2055): 세션을 복제한 사본에게 묻는다. 원래 세션에는 전달되지 않고 대화 기록도 바뀌지 않는다.
// 사본은 원래 대화를 다 알고, 앞부분은 캐시로 읽는다(실측: Claude 87%, Codex 1회째 뒤 거의 전부). 읽기 도구만 쓴다.
// 묶음(#2083): 묶음의 첫 질문이 사본을 만들고(side-groups.json 에 사본 id), 같은 묶음의 다음 질문은 그 사본에 이어 묻는다.
// 그래서 사본은 묶음 안의 앞 질문·답을 기억하지만, 사본을 만든 뒤 원래 세션에서 오간 대화는 모른다.
// 사본의 훅은 끈다(원래 세션 이름으로 대화창·알림에 새지 않게). 프로젝트 폴더(.ui-feedback 의 상위)에서 실행해야 세션을 찾는다.
const SIDE_HEAD = '[곁질문] 사용자가 원래 작업을 끊지 않고 따로 묻는 질문입니다. 파일은 읽기만 하고 아무것도 고치지 말고, 지금까지의 대화를 바탕으로 짧게 답하세요.';
const sideFile = path.join(root, 'side-groups.json');
const sideQueue = new Map(); // 묶음별로 한 번에 하나씩(앞 질문이 사본을 만든 뒤에 다음 질문이 이어 묻게)
function askSide(s, q) {
  const prev = sideQueue.get(q.sideGroup) || Promise.resolve();
  const run = prev.then(() => new Promise((done) => runSide(s, q, done)));
  sideQueue.set(q.sideGroup, run);
}
function runSide(s, q, done) {
  const all = [...readChat().messages, ...readTranscript(s.sessionId).items], on = q.sideOn && all.find((m) => m.id === q.sideOn);
  const prompt = [SIDE_HEAD, ...(on ? [`이 질문은 대화의 #${on.id} 메시지에 대한 것입니다: "${on.text.slice(0, 2000)}"`] : []), ...formatMessage(q, all)].join('\n');
  const settings = path.join(root, 'side-settings.json');
  fs.writeFileSync(settings, '{"disableAllHooks":true}');
  const fork = (readJsonSafe(sideFile) || {})[q.sideGroup]?.fork;
  const codex = s.tool === 'codex';
  const args = codex
    ? (fork
      ? ['exec', 'resume', '--skip-git-repo-check', '--json', '--disable', 'hooks', '-c', 'sandbox_mode=read-only', fork, '-']
      : ['exec', '--skip-git-repo-check', '--json', '--disable', 'hooks', '-s', 'read-only', 'fork', s.sessionId, '-'])
    : ['-p', '--resume', fork || s.sessionId, ...(fork ? [] : ['--fork-session']), '--settings', settings, '--tools', 'Read,Grep,Glob', '--output-format', 'json'];
  // Keep Windows paths as individual arguments; disable profile output and preserve UTF-8.
  const options = { cwd: path.dirname(root), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true };
  const command = codex ? 'codex' : 'claude';
  const child = process.platform === 'win32'
    ? spawn(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference = 'Stop'; [Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; $OutputEncoding = [Console]::OutputEncoding; $sideArgs = ConvertFrom-Json $env:UIFB_SIDE_ARGS; & $env:UIFB_SIDE_COMMAND @sideArgs; exit $LASTEXITCODE"], { ...options, env: { ...process.env, UIFB_SIDE_COMMAND: command, UIFB_SIDE_ARGS: JSON.stringify(args) } })
    : spawn(command, args, options);
  let out = '', err = '';
  child.stdout.on('data', (b) => { out += b; });
  child.stderr.on('data', (b) => { err += b; });
  const timer = setTimeout(() => child.kill(), 5 * 60_000);
  let replied = false;
  const reply = (text) => { if (replied) return; replied = true; addChat({ from: 'agent', session: s.sessionId, context: 'side', sideGroup: q.sideGroup, agent: s.agent || s.name, text: `<re ${q.id}> ${text}` }); done(); };
  child.on('error', (e) => { clearTimeout(timer); reply(`곁질문을 실행하지 못했습니다: ${e.message}`); });
  child.on('close', (code) => {
    clearTimeout(timer);
    if (replied) return;
    let text = '', id = '';
    try {
      if (codex) {
        const ev = out.trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        id = ev.find((o) => o.type === 'thread.started')?.thread_id || '';
        text = ev.filter((o) => o.type === 'item.completed' && o.item?.type === 'agent_message').at(-1)?.item.text || '';
      } else ({ result: text = '', session_id: id = '' } = JSON.parse(out));
    } catch {}
    if (!fork && sid(id)) { const g = readJsonSafe(sideFile) || {}; g[q.sideGroup] = { session: s.sessionId, fork: id }; writeJsonAtomic(sideFile, g); }
    reply(text.trim() || `곁질문 답을 받지 못했습니다(종료 코드 ${code}). ${(err || out).trim().slice(-300)}`);
  });
  child.stdin.end(prompt);
}

function readTranscript(id) {
  const session = findSession(id);
  if (!session) return { items: [] };
  if (session.tool !== 'codex') return { items: [], via: 'hooks' };
  let st;
  try {
    st = fs.statSync(session.path);
  } catch {
    return { items: [] };
  }
  const key = `${st.size}:${st.mtimeMs}`;
  const cached = transcriptCache.get(id);
  if (cached && cached.key === key) return cached.data;
  const len = Math.min(st.size, TAIL_BYTES);
  const fd = fs.openSync(session.path, 'r');
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, st.size - len);
  fs.closeSync(fd);
  const lines = buf.toString('utf8').split('\n');
  if (len < st.size) lines.shift();
  const items = [];
  for (const line of lines) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const p = o.payload;
    if (o.type !== 'response_item' || p?.type !== 'message' || !['user', 'assistant'].includes(p.role)) continue;
    const text = stripTags((p.content || []).filter((b) => b.type === 'input_text' || b.type === 'output_text').map((b) => b.text).join('\n'));
    if (!text || (p.role === 'user' && (text.startsWith('<') || text.startsWith(QUEUE_PREFIX) || text.includes('AGENTS.md instructions')))) continue;
    items.push({ id: `x${p.id || o.ordinal}`, from: p.role === 'user' ? 'user' : 'agent', session: id, context: 'terminal', agent: session.agent, text: text.slice(0, 8000), at: o.timestamp, ...(p.phase === 'commentary' ? { interim: true } : {}) });
  }
  const data = { items: items.slice(-300) };
  transcriptCache.set(id, { key, data });
  return data;
}

function readWatchFile(name) {
  try {
    const watch = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
    if (watch.state === 'handling') {
      if (Date.parse(watch.until) < Date.now()) return { active: false };
      return { active: true, handling: true, agent: watch.agent, session: watch.session, handlesDone: !!watch.handlesDone, round: watch.round };
    }
    if (watch.expiresAt && Date.parse(watch.expiresAt) < Date.now()) return { active: false };
    process.kill(watch.pid, 0);
    return { active: true, agent: watch.agent, session: watch.session, handlesDone: !!watch.handlesDone, round: watch.round, expiresAt: watch.expiresAt };
  } catch {
    return { active: false };
  }
}

// 리뷰 완료 표시를 받아 반영할 감시(handlesDone)가 살아 있는지. 페이지 위쪽 "자동 이어가기" 표시에 쓴다.
// 리뷰를 반영하는 세션(REVIEW.session)을 이름이나 id 로 찾는다.
function findSessionByKey(key) {
  if (!key) return null;
  return findSession(key) || listSessions().map((s) => findSession(s.id)).find((s) => s?.name === key) || null;
}

// 완료 표시를 받을 세션이 있는지. Claude 는 --done 감시, Codex 는 완료 때 codex queue 로 "피드백 확인해"를 넣는다.
function readReviewWatch(sessionKey, round) {
  let files = [];
  try {
    files = fs.readdirSync(root).filter((f) => /^watch-.+\.json$/.test(f));
  } catch {}
  // 감시가 라운드를 정했으면 그 라운드 페이지에만 보인다. 다른 라운드·비교 페이지에 "자동 이어가기 켜짐"으로 잘못 뜨지 않게.
  // 페이지가 받을 세션을 정했으면 그 세션의 감시만 본다(다른 세션의 감시로 "켜짐"이 뜨지 않게 #2113).
  const s = findSessionByKey(sessionKey);
  const live = files.map(readWatchFile).filter((w) => w.active && w.handlesDone && (!s || w.session === s.sessionId) && (w.round == null || !round || String(w.round) === round));
  if (live[0]) return live[0];
  // 평가 완료는 대화로도 그 세션에 가므로(onDone → addChat), 그 세션의 대화 감시가 살아 있어도 이어진다.
  const chatWatch = s && readWatchFile(`watch-${s.sessionId}.json`);
  if (chatWatch?.active) return { ...chatWatch, handlesDone: true, via: 'chat' };
  if (s?.tool === 'codex') return queueWatch(s);
  return { active: false };
}

function inner(req, res, url) {
  // 대화/피드백 위젯(assets/app-widget.js)은 앱 화면(app-proxy)과 비교 페이지가 같은 파일을 쓴다.
  if (SHARED[url.pathname]) {
    const [file, type] = SHARED[url.pathname];
    // 서비스 워커는 /__uifb/ 아래 있지만 페이지 전체(/)를 맡게 한다(화면 요청은 가로채지 않고 알림만 띄운다).
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', ...(file === 'sw.js' ? { 'Service-Worker-Allowed': '/' } : {}) });
    return res.end(fs.readFileSync(path.join(assetsDir, file)));
  }
  if (url.pathname === '/api/watch') {
    return send(res, 200, readReviewWatch(url.searchParams.get('session') || '', url.searchParams.get('round') || ''));
  }

  if (url.pathname === '/api/status' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) req.destroy();
    });
    req.on('end', () => {
      try {
        const s = JSON.parse(body);
        if (!/^[\w.-]{1,80}$/.test(String(s.session)) || !['working', 'permission', 'idle'].includes(s.state)) throw new Error();
        // 다른 세션에 메시지를 보내는 중이면(peer) 받는 세션을 함께 적어, 대화창이 세션 탭 사이에 화살표를 그린다.
        const to = s.peer ? readPeers()[peerName(s.peer)] : undefined;
        const prev = readStatus(s.session);
        notifyStatus(s, prev);
        fs.writeFileSync(path.join(root, `status-${s.session}.json`), JSON.stringify({ state: s.state, detail: String(s.detail || '').slice(0, 120), at: new Date().toISOString(), ...(s.peer ? { peer: peerName(s.peer) } : {}), ...(to ? { peerTo: to } : {}) }) + '\n');
        send(res, 200, { ok: true });
      } catch {
        send(res, 400, { error: 'session, state(working|permission|idle)가 필요합니다.' });
      }
    });
    return;
  }

  // 홈 화면에 앱처럼 설치하기 위한 정보. start 는 설치한 화면의 주소(앱 화면이면 /worklog 등).
  if (url.pathname === '/__uifb/manifest.webmanifest') {
    const start = /^\/[\w\-./]*$/.test(url.searchParams.get('start') || '') ? url.searchParams.get('start') : '/';
    const startUrl = start + (auth.key ? `?k=${auth.key}` : '');
    return send(res, 200, { name: '대화/피드백', short_name: '대화', start_url: startUrl, scope: '/', display: 'standalone', background_color: '#f6f5f1', theme_color: '#4f46e5', icons: [192, 512].map((n) => ({ src: `/__uifb/icon-${n}.png`, sizes: `${n}x${n}`, type: 'image/png' })) });
  }

  // 알림(웹 푸시): 공개 키 주기, 기기 구독 받기·빼기, 시험 보내기
  // 대화창 위젯 파일이 바뀌었는지(고친 시각). 홈 화면 앱처럼 새로고침이 없는 곳에서 새 버전을 알려 주는 데 쓴다.
  // r: 대화창 새로고침 번호. 세션이 위젯을 고친 뒤 원할 때 POST /api/reload-widgets 로 바꾸면, 열려 있는 대화창이 안내를 띄우고 새로고침한다.
  if (url.pathname === '/api/widget-version') return send(res, 200, { v: fs.statSync(path.join(assetsDir, 'app-widget.js')).mtimeMs, r: reloadToken });
  if (url.pathname === '/api/reload-widgets' && req.method === 'POST') { reloadToken = Date.now(); fs.writeFileSync(reloadFile, JSON.stringify({ r: reloadToken })); return send(res, 200, { ok: true, r: reloadToken }); }
  if (url.pathname === '/api/push-key') return send(res, 200, { publicKey: vapidKeys(root).publicKey });
  if ((url.pathname === '/api/push-subscribe' || url.pathname === '/api/push-unsubscribe' || url.pathname === '/api/push-test' || url.pathname === '/api/push-prefs' || url.pathname === '/api/push-viewing') && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) req.destroy();
    });
    req.on('end', async () => {
      let b = {};
      try { b = JSON.parse(body); } catch {}
      const subs = readSubs();
      if (url.pathname === '/api/push-test') {
        const n = await pushAll({ title: '대화/피드백', body: '알림이 잘 옵니다.', tag: 'uifb-test' });
        return send(res, 200, { sent: n });
      }
      const ep = b.subscription?.endpoint || b.endpoint;
      if (typeof ep !== 'string' || !/^https:\/\//.test(ep)) return send(res, 400, { error: 'endpoint 가 필요합니다.' });
      // 이 기기의 알림 설정 읽기·바꾸기, 이 기기에서 대화창을 보고 있다는 신호
      const me = subs.find((x) => x.endpoint === ep);
      if (url.pathname === '/api/push-prefs') {
        if (!me) return send(res, 404, { error: '알림을 켠 기기가 아닙니다.' });
        if (b.prefs && typeof b.prefs === 'object') me.prefs = Object.fromEntries(Object.keys(PUSH_DEFAULTS).map((k) => [k, k in b.prefs ? b.prefs[k] === true : prefsOf(me)[k]]));
        writeSubs(subs);
        return send(res, 200, { prefs: prefsOf(me) });
      }
      if (url.pathname === '/api/push-viewing') {
        if (me) { if (b.off === true) delete me.viewingAt; else { me.viewingAt = new Date().toISOString(); me.viewingTab = sid(b.tab) ? b.tab : null; } writeSubs(subs); }
        return send(res, 200, { ok: true });
      }
      const rest = subs.filter((s) => s.endpoint !== ep);
      if (url.pathname === '/api/push-subscribe') {
        const k = b.subscription?.keys;
        if (!k?.p256dh || !k?.auth) return send(res, 400, { error: 'keys 가 필요합니다.' });
        rest.push({ endpoint: ep, keys: { p256dh: String(k.p256dh), auth: String(k.auth) }, url: typeof b.url === 'string' && b.url.startsWith('/') ? b.url.slice(0, 200) : '/', device: b.device === 'mobile' ? 'mobile' : 'desktop', at: new Date().toISOString() });
      }
      writeSubs(rest);
      send(res, 200, { ok: true, count: rest.length });
    });
    return;
  }

  if (url.pathname === '/api/sessions') {
    return send(res, 200, { sessions: listSessions() });
  }

  if (url.pathname === '/api/transcript') {
    return send(res, 200, readTranscript(url.searchParams.get('session') || ''));
  }

  // 진단 기록: 폰에서만 생기는 문제(초점이 엉뚱한 곳으로 가는 등)를 원인까지 보려고, 위젯이 그 순간 전후의 터치·초점 순서를 남긴다.
  if (url.pathname === '/api/diag' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) req.destroy();
    });
    req.on('end', () => {
      try {
        const file = path.join(root, 'diag.jsonl');
        if (!fs.existsSync(file) || fs.statSync(file).size < 500_000) fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...JSON.parse(body) }) + '\n');
        send(res, 200, { ok: true });
      } catch {
        send(res, 400, { error: 'JSON 형식이 아닙니다.' });
      }
    });
    return;
  }
  if (url.pathname === '/api/compose') {
    if (req.method === 'GET') return send(res, 200, readCompose());
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_BODY) req.destroy();
      });
      req.on('end', () => {
        try {
          send(res, 200, saveCompose(JSON.parse(body)));
        } catch {
          send(res, 400, { error: 'JSON 형식이 아닙니다.' });
        }
      });
      return;
    }
    return send(res, 405, { error: 'GET 또는 POST만 됩니다.' });
  }

  if (url.pathname === '/api/prefs') {
    if (req.method === 'GET') return send(res, 200, readPrefs());
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_BODY) req.destroy();
      });
      req.on('end', () => {
        try {
          send(res, 200, savePrefs(JSON.parse(body)));
        } catch {
          send(res, 400, { error: 'JSON 형식이 아닙니다.' });
        }
      });
      return;
    }
    return send(res, 405, { error: 'GET 또는 POST만 됩니다.' });
  }

  if (url.pathname === '/api/seen') {
    if (req.method === 'GET') return send(res, 200, readSeen());
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_BODY) req.destroy();
      });
      req.on('end', () => {
        try {
          send(res, 200, markSeen(JSON.parse(body)));
        } catch {
          send(res, 400, { error: 'JSON 형식이 아닙니다.' });
        }
      });
      return;
    }
    return send(res, 405, { error: 'GET 또는 POST만 됩니다.' });
  }

  if (url.pathname === '/api/drafts') {
    if (req.method === 'GET') { const st = readDrafts(); return send(res, 200, { drafts: st.drafts, trash: st.trash }); }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_BODY) req.destroy();
      });
      req.on('end', () => {
        let r;
        try {
          r = JSON.parse(body);
        } catch {
          return send(res, 400, { error: 'JSON 형식이 아닙니다.' });
        }
        const out = handleDrafts(r);
        send(res, out.status, out.body);
      });
      return;
    }
    return send(res, 405, { error: 'GET 또는 POST만 됩니다.' });
  }

  // 보내기 취소: 세션이 아직 받아 가지 않은 내 메시지만 취소된다(받아 간 뒤에는 되돌릴 수 없다).
  // 압축: 세션이 떠 있는 cmux 터미널 창에 /compact 를 입력한다(#1849·#1851). 글자는 /compact 로 고정이고 다른 글은 넣지 않는다.
  // 작업 중이면 입력이 다음 요청으로 끼어들 수 있어 받지 않는다(Codex는 상태를 알 수 없어 그대로 보낸다).
  // 중지(#1910): 세션의 cmux 터미널에 Esc 를 보내 하던 작업을 멈춘다(Claude·Codex 모두 Esc 로 멈춤). 압축과 같은 창 정보를 쓴다.
  if ((url.pathname === '/api/compact' || url.pathname === '/api/stop') && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) req.destroy();
    });
    req.on('end', () => {
      let id;
      try { id = String(JSON.parse(body).session || ''); } catch {}
      const s = sid(id) && findSession(id);
      if (!s?.cmux?.surface) return send(res, 400, { error: '이 세션은 cmux 창 정보가 없습니다. 세션을 cmux 안에서 다시 등록해 주세요.' });
      const stop = url.pathname === '/api/stop';
      const st = readStatus(id).state;
      if (!stop && (st === 'working' || st === 'permission')) return send(res, 409, { error: '세션이 작업 중이라 지금은 압축할 수 없습니다. 끝난 뒤 다시 눌러 주세요.' });
      const cli = cmuxCli();
      try {
        if (stop) {
          execFileSync(cli, ['send-key', '--surface', s.cmux.surface, 'escape'], { timeout: 5000, stdio: 'pipe' });
          // Esc 로 멈추면 Claude 는 응답 끝 훅(Stop)을 부르지 않아 "작업 중"이 남는다(#1920). 쉬는 중으로 적어 둔다(다시 일하면 훅이 바로 고친다).
          fs.writeFileSync(path.join(root, `status-${id}.json`), JSON.stringify({ state: 'idle', detail: '중지함', at: new Date().toISOString() }) + '\n');
          // 받은 글을 처리하던 중(handling)이면 그 표시도 지운다. 그래야 다음 대화창 글이 깨우기로 전달된다.
          try { if (JSON.parse(fs.readFileSync(path.join(root, `watch-${id}.json`), 'utf8')).state === 'handling') fs.rmSync(path.join(root, `watch-${id}.json`)); } catch {}
        }
        else {
          execFileSync(cli, ['send', '--surface', s.cmux.surface, '/compact'], { timeout: 5000, stdio: 'pipe' });
          execFileSync(cli, ['send-key', '--surface', s.cmux.surface, 'enter'], { timeout: 5000, stdio: 'pipe' });
        }
      } catch (e) {
        return send(res, 502, { error: '터미널 창에 입력하지 못했습니다(cmux 창이 닫혔을 수 있음): ' + String(e.stderr || e.message).trim().slice(0, 200) });
      }
      send(res, 200, { ok: true });
    });
    return;
  }

  if (url.pathname === '/api/side' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) req.destroy();
    });
    req.on('end', () => {
      let msg;
      try { msg = JSON.parse(body); } catch { return send(res, 400, { error: 'JSON 형식이 아닙니다.' }); }
      const s = sid(msg.session) && findSession(msg.session);
      if (!s) return send(res, 400, { error: '곁질문할 세션이 없습니다.' });
      // 질문은 세션에 전달되지 않게 받는 쪽(to) 없이 그 세션 칸(session)에만 남긴다.
      // 이어 물을 묶음(sideGroup)은 이 세션의 곁질문 묶음일 때만 받는다. 아니면 새 묶음을 연다.
      const chat = readChat();
      const before = chat.messages.length;
      const g = chat.messages.find((x) => x.id === msg.sideGroup && x.context === 'side' && x.session === s.sessionId);
      const q = addChat({ ...msg, from: 'user', to: undefined, session: s.sessionId, context: 'side', interject: false, sideGroup: g ? g.id : undefined });
      if (!q) return send(res, 400, { error: '질문이 비어 있습니다.' });
      if (q.id > before) askSide(s, q); // 같은 질문을 다시 눌렀으면(cid 같음) 다시 묻지 않는다
      send(res, 200, q);
    });
    return;
  }

  if (url.pathname === '/api/chat-retry' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > MAX_BODY) req.destroy(); });
    req.on('end', () => {
      let id, confirmUnknown;
      try { const input = JSON.parse(body); id = Number(input.id); confirmUnknown = input.confirmUnknown === true; } catch {}
      const entry = readChat().messages.find((m) => m.id === id);
      const session = entry && findSession(entry.to);
      if (!entry || entry.from !== 'user' || entry.cancelled || session?.tool !== 'codex') return send(res, 400, { error: '재시도할 메시지가 없습니다.' });
      const d = readDelivered();
      if (d._at?.[id] || !['failed', 'unknown'].includes(entry.queue?.state)) return send(res, 409, { error: '재시도할 수 없는 메시지입니다.' });
      if (entry.queue.state === 'unknown' && !confirmUnknown) return send(res, 409, { error: '이미 전달됐을 수 있습니다. 중복 전송 가능성을 확인해야 합니다.' });
      queueToCodex(session, entry);
      sendChatEntry(res, entry);
    });
    return;
  }

  if (url.pathname === '/api/chat-cancel' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) req.destroy();
    });
    req.on('end', () => {
      let id;
      try { id = Number(JSON.parse(body).id); } catch {}
      const chat = readChat();
      const m = chat.messages.find((x) => x.id === id);
      const d = readDelivered();
      if (!m || m.from !== 'user' || !m.to || m.context === 'terminal') return send(res, 400, { error: '취소할 수 없는 메시지입니다.' });
      if (m.id <= (d[m.to] || 0) || d._at?.[m.id] || findSession(m.to)?.tool === 'codex') return send(res, 409, { error: '세션이 이미 받아 가서 취소할 수 없습니다.' });
      m.cancelled = new Date().toISOString();
      writeJsonAtomic(chatFile, chat); // 한 번에 바꿔 다른 쪽이 반쯤 쓴 파일을 읽지 않게
      send(res, 200, { ok: true });
    });
    return;
  }

  // 이미 보낸(아직 안 받아 간) 메시지를 끼워넣기로 바꾸거나 끼워넣기를 취소한다.
  if (url.pathname === '/api/chat-interject' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) req.destroy();
    });
    req.on('end', () => {
      let id, on;
      try { ({ id, on } = JSON.parse(body)); } catch {}
      const chat = readChat();
      const m = chat.messages.find((x) => x.id === Number(id));
      const d = readDelivered();
      if (!m || m.from !== 'user' || !m.to || m.cancelled || m.context === 'terminal') return send(res, 400, { error: '바꿀 수 없는 메시지입니다.' });
      if (d._at?.[m.id] || findSession(m.to)?.tool === 'codex') return send(res, 409, { error: '세션이 이미 받아 갔습니다.' });
      if (on === true) m.interject = true;
      else delete m.interject;
      writeJsonAtomic(chatFile, chat); // 한 번에 바꿔 다른 쪽이 반쯤 쓴 파일을 읽지 않게
      send(res, 200, { ok: true });
    });
    return;
  }

  if (url.pathname === '/api/chat') {
    if (req.method === 'GET') return sendGzip(req, res, 200, { ...readChat(), delivered: readDelivered() });
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_BODY) req.destroy();
      });
      req.on('end', () => {
        let msg;
        try {
          msg = JSON.parse(body);
        } catch {
          return send(res, 400, { error: 'JSON 형식이 아닙니다.' });
        }
        const entry = addChat(msg);
        if (!entry) return send(res, 400, { error: 'from(user|agent|peer)과 text가 필요합니다.' });
        sendChatEntry(res, entry);
      });
      return;
    }
    return send(res, 405, { error: 'GET 또는 POST만 됩니다.' });
  }

  return NOT_MINE;
}

  return {
    handle: (req, res, url) => inner(req, res, url) !== NOT_MINE,
    // 비교 페이지와 함께 쓸 때 평가 완료를 대화에 남기고 그 세션을 깨우는 데 쓴다.
    addChat,
    findSessionByKey,
    queueText,
    QUEUE_PREFIX,
  };
}
