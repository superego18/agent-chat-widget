import fs from 'node:fs';

// 값 바꾸기(대화창에서 찍은 요소의 값을 바꿔 본 것, where.adjust)를 세션이 읽을 한 줄로. 없으면 빈 글.
const SIDE = { Top: '위', Bottom: '아래', Left: '왼쪽', Right: '오른쪽' };
const ADJUST_LABELS = {
  text: '내용', fontFamily: '글꼴', fontSize: '글꼴 크기', fontWeight: '글꼴 굵기', color: '글자 색상',
  backgroundColor: '배경색', opacity: '불투명도', borderRadius: '모서리 반경', borderColor: '테두리 색상', borderWidth: '테두리 두께',
  width: '너비', height: '높이', padding: '안쪽 여백',
  ...Object.fromEntries(Object.entries(SIDE).flatMap(([k, v]) => [[`padding${k}`, `안쪽 여백 ${v}`], [`margin${k}`, `바깥 여백 ${v}`]])),
  flexDirection: '레이아웃 방향', alignItems: '정렬', justifyContent: '분배', columnGap: '가로 간격', rowGap: '세로 간격',
};
export const ADJUST_KEYS = Object.keys(ADJUST_LABELS);
export function adjustText(w) {
  const e = Object.entries(w?.adjust || {}).filter(([k]) => ADJUST_LABELS[k]);
  return e.length ? '바꿔 본 값: ' + e.map(([k, v]) => `${ADJUST_LABELS[k]} ${v.from} → ${v.to}`).join(', ') : '';
}
// 세션에 넘길 대화창 메시지를 사람이 읽을 줄로 만든다. 감시 명령(wait-review)과 중계 훅(hook-relay, 작업 중 끼워 넣기)이 함께 쓴다.
// all: chat.json 의 전체 메시지(답장 원문을 찾을 때 쓴다).
export function formatMessage(m, all) {
  const lines = [];
  const dev = m.device === 'mobile' ? '·모바일' : m.device === 'desktop' ? '·데스크톱' : '';
  lines.push(`[${m.id}]${m.context === 'app' ? `[앱 화면${dev}]` : `[비교 페이지${dev}]`}${m.round ? `[${m.round}차]` : ''} ${m.text}`);
  if (m.resendOf) lines.push(`    [${m.resendOf}]을(를) 사용자가 고쳐 다시 보낸 메시지`);
  // 이전 메시지에 단 답장이면 원문을 붙인다.
  const orig = m.replyTo ? all.find((x) => x.id === m.replyTo) : null;
  const who = orig ? (orig.from === 'user' ? '사용자' : orig.from === 'peer' ? '세션끼리' : '에이전트') : '';
  // 참고(refer)는 그 메시지에 답하라는 뜻이 아니라 함께 보라고 붙인 것이다.
  const label = m.refer ? '참고로 붙인 메시지(답장 아님)' : '답장 대상';
  if (orig && m.replyQuote) lines.push(`    ${label} [${orig.id}] ${who} 메시지 중 이 부분: "${m.replyQuote}"`);
  else if (orig) lines.push(`    ${label} [${orig.id}] ${who}: ${orig.text.replace(/\s+/g, ' ').slice(0, 200)}`);
  // 보관함에서 온 글은 본문에 저장 당시 위치가 이미 있으므로 다시 적지 않는다.
  if ((m.where?.selector || m.where?.url) && !m.text.includes('\n위치(')) {
    lines.push(`    위치: ${m.where.url || ''}${m.where.selector ? ' · ' + m.where.selector : ''}${m.where.component ? ' · 컴포넌트 ' + m.where.component : ''}${m.where.text ? ' · "' + m.where.text + '"' : ''}`);
    if (adjustText(m.where)) lines.push(`    ${adjustText(m.where)}`);
  }
  return lines;
}

// 받아 갔는지: 받아 간 메시지는 delivered.json 의 _at 에 번호별로 남는다. _at 이 생기기 전의 옛 메시지(하루 넘은 것)는
// 그 세션이 받아 간 마지막 번호까지를 받아 간 것으로 본다.
const DAY = 86_400_000;
export const wasDelivered = (m, d) => !!d._at?.[m.id] || (m.id <= (d[m.to] || 0) && Date.now() - Date.parse(m.at) > DAY);

// 이 세션에게 온 페이지·앱 메시지 중 아직 받아 가지 않은 것(취소한 것 빼고).
// 세션의 답보다 앞에 있어도 넘긴다(작업 중에 보낸 메시지가 작업을 마치며 쓴 답 때문에 건너뛰어지지 않게).
// seen: 이 번호까지는 처리한 것으로 본다(감시 --seen).
export function pendingFor(messages, sid, seen, d) {
  return messages.filter((m) => m.from === 'user' && m.to === sid && m.context !== 'terminal' && !m.cancelled && m.id > seen && !wasDelivered(m, d));
}

// delivered.json 은 감시 명령·중계 훅·서버가 함께 쓴다. 한쪽이 쓰는 도중에 다른 쪽이 읽으면 반쯤 쓴 파일을 읽어
// 빈 기록({})으로 착각하고, 그러면 받아 간 메시지를 모두 다시 넘기거나 기록을 통째로 지운다.
// 그래서 쓸 때는 임시 파일에 쓴 뒤 이름을 바꿔 한 번에 바꾸고, 읽다 실패하면 빈 기록이 아니라 null(이번엔 건너뜀)을 돌려준다.
export function readJsonSafe(file) {
  for (let i = 0; i < 5; i++) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return {};
      const until = Date.now() + 20;
      while (Date.now() < until) {} // 잠깐 기다렸다 다시 읽는다(다른 쪽이 쓰는 중)
    }
  }
  return null;
}
export function writeJsonAtomic(file, obj) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}
