import { createHash } from 'node:crypto';

const inputNames = new Set(['request_user_input', 'request_user_input_async']);
const shortName = name => String(name || '').replace(/^functions\./, '');
const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; } };
const idFor = (session, kind, id) => 'x' + createHash('sha256').update(`${session}:${kind}:${id}`).digest('hex');

// Only native question-tool records establish question identity. Ordinary quoted
// tool names, question-like prose, and unrelated outputs are not questions.
export function questionCalls(record) {
  const p = record.payload;
  let calls = [];
  if (record.type === 'response_item' && p?.type === 'function_call' && inputNames.has(shortName(p.name))) {
    calls = [{ id: p.call_id, provider: 'codex', name: shortName(p.name), input: parse(p.arguments) }];
  } else if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
    calls = record.message.content.filter(b => b.type === 'tool_use' && b.name === 'AskUserQuestion')
      .map(b => ({ id: b.id, provider: 'claude', name: b.name, input: b.input }));
  }
  return calls.filter(c => typeof c.id === 'string' && c.id && Array.isArray(c.input?.questions))
    .map(c => ({ ...c, at: record.timestamp, questions: c.input.questions.map(q => ({
      id: q?.id, title: q?.title || q?.question, multiple: q?.multiSelect === true,
      options: Array.isArray(q?.options) ? q.options.map(o => typeof o === 'string' ? o : typeof o?.label === 'string' ? o.label + (typeof o.description === 'string' && o.description ? ' — ' + o.description : '') : '').filter(Boolean) : [],
    })) })).filter(c => Number.isFinite(Date.parse(c.at)) && c.questions.length && c.questions.every(q => typeof q.title === 'string' && q.title.trim()));
}

const questionText = call => '세션의 질문\n\n' + call.questions.map((q, i) =>
  `${i + 1}. ${q.title}${q.multiple ? ' (여러 개 선택 가능)' : ''}${q.options.length ? '\n' + q.options.map(o => '   - ' + o).join('\n') : ''}`).join('\n\n');
const answerText = answers => '질문에 답변\n\n' + answers.map(([q, answer]) => `${q}\n답변: ${Array.isArray(answer) ? answer.join(', ') : answer || '(빈 답변)'}`).join('\n\n');

export function codexQuestionReply(text, calls, at) {
  const m = /^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/.exec(text);
  if (!m) return null;
  const values = parse(m[1]);
  if (!Array.isArray(values) || !values.length) return null;
  const answers = [];
  for (const value of values) {
    const key = parse(value?.questionItemId);
    if (!Array.isArray(key) || key.length !== 3 || !inputNames.has(key[0]) || !Number.isInteger(key[2])) return null;
    const call = calls.get(key[1]), q = call?.questions[key[2]];
    if (!q || call.provider !== 'codex' || call.name !== key[0] || typeof value.answer !== 'string' ||
      value.question !== q.title || !Number.isFinite(Date.parse(at)) || Date.parse(at) < Date.parse(call.at)) return null;
    answers.push([q.title, value.answer]);
  }
  return answerText(answers);
}

export function nativeQuestionEntries(rows, session) {
  const calls = new Map();
  for (const { o } of rows) for (const call of questionCalls(o)) {
    if (call.provider === session.tool) calls.set(call.id, call);
  }
  const answered = new Map();
  const toolAnswers = [];
  for (const { o } of rows) {
    const p = o.payload;
    if (o.type === 'response_item' && p?.type === 'function_call_output') {
      const call = calls.get(p.call_id), result = parse(p.output);
      if (call?.provider === 'codex' && call.questions.every(q => typeof q.id === 'string') && result?.answers && Number.isFinite(Date.parse(o.timestamp)) && Date.parse(o.timestamp) >= Date.parse(call.at)) {
        const selected = call.questions.filter(q => Object.hasOwn(result.answers, q.id)).map(q => [q.title, result.answers[q.id]?.answers]);
        if (selected.length && selected.every(([, a]) => Array.isArray(a) && a.length && a.every(v => typeof v === 'string'))) {
          answered.set(call.id, new Set(call.questions.map((_, i) => i)));
          toolAnswers.push({ id: idFor(session.sessionId, 'question-answer', call.id), from: 'user', session: session.sessionId, context: 'terminal', text: answerText(selected), at: o.timestamp });
        }
      }
    }
    if (p?.type !== 'message' || p.role !== 'user') continue;
    const text = (p.content || []).map(c => c.text || '').join('\n');
    if (!codexQuestionReply(text, calls, o.timestamp)) continue;
    const match = /^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/.exec(text);
    for (const a of parse(match[1])) {
      const [, id, index] = parse(a.questionItemId);
      if (!answered.has(id)) answered.set(id, new Set());
      answered.get(id).add(index);
    }
  }
  const items = [...calls.values()].map(call => ({ id: idFor(session.sessionId, 'question', call.id),
    from: 'agent', session: session.sessionId, context: 'terminal', agent: session.agent,
    text: questionText(call), at: call.at,
    ...(answered.get(call.id)?.size === call.questions.length ? {} : { nativeQuestion: { itemId: call.id, provider: call.provider, tool: call.name } }) }));
  items.push(...toolAnswers);
  for (const { o } of rows) {
    if (session.tool === 'claude' && o.type === 'user' && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) {
        const call = calls.get(b.tool_use_id), answers = o.toolUseResult?.answers;
        if (b.type !== 'tool_result' || b.is_error || !call || !answers || typeof answers !== 'object' || !Number.isFinite(Date.parse(o.timestamp)) || Date.parse(o.timestamp) < Date.parse(call.at)) continue;
        const selected = call.questions.filter(q => Object.hasOwn(answers, q.title)).map(q => [q.title, answers[q.title]]);
        if (!selected.length || selected.some(([, a]) => typeof a !== 'string' && !(Array.isArray(a) && a.every(v => typeof v === 'string')))) continue;
        delete items.find(i => i.id === idFor(session.sessionId, 'question', call.id)).nativeQuestion;
        items.push({ id: idFor(session.sessionId, 'question-answer', call.id), from: 'user', session: session.sessionId,
          context: 'terminal', text: answerText(selected), at: o.timestamp });
      }
    }
  }
  return { calls, items };
}
