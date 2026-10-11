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
  if (orig && m.replyQuote) lines.push(`    답장 대상 [${orig.id}] ${who} 메시지 중 이 부분: "${m.replyQuote}"`);
  else if (orig) lines.push(`    답장 대상 [${orig.id}] ${who}: ${orig.text.replace(/\s+/g, ' ').slice(0, 200)}`);
  // 보관함에서 온 글은 본문에 저장 당시 위치가 이미 있으므로 다시 적지 않는다.
  if ((m.where?.selector || m.where?.url) && !m.text.includes('\n위치(')) {
    lines.push(`    위치: ${m.where.url || ''}${m.where.selector ? ' · ' + m.where.selector : ''}${m.where.text ? ' · "' + m.where.text + '"' : ''}`);
  }
  return lines;
}

// 이 세션에게 온 페이지·앱 메시지 중, 이 세션이 그 뒤에 아직 답하지 않았고 아직 받아 가지 않은 것.
// seen: 이 번호까지는 처리한 것으로 본다(감시 --seen, 또는 delivered.json 에 적힌 이미 받아 간 번호).
export function pendingFor(messages, sid, seen) {
  const mine = messages.filter((m) => (m.from === 'user' && m.to === sid && m.context !== 'terminal' && !m.cancelled) || (m.from === 'agent' && m.session === sid));
  const lastAgent = mine.map((m) => m.from).lastIndexOf('agent');
  return mine.slice(lastAgent + 1).filter((m) => m.from === 'user' && m.id > seen);
}
