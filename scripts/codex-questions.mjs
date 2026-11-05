import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { withCodexRpc } from './codex-rpc.mjs';
import { readJsonSafe, writeJsonAtomic } from './chat-format.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure = (state, error) => ({ ok: false, state, error });

// Only a currently loaded thread's replayed native request can be answered.
// Historical tool calls and ordinary message delivery never authorize a reply.
export function createCodexQuestionBridge({ root, command, cleanupOwner, rpc = withCodexRpc, replayMs = 250, resolveMs = 5000 }) {
  const busy = new Set();
  return async function question(session, itemId, submission) {
    if (session.tool !== 'codex') return failure('unsupported', '이 세션은 원래 질문창의 답변 연결을 지원하지 않습니다. 전용 답장 창에서 답해 주세요.');
    if (busy.has(session.sessionId)) return failure('busy', '이 세션의 질문을 확인하고 있습니다.');
    busy.add(session.sessionId);
    const file = path.join(root, `question-reply-${hash([session.sessionId, itemId])}.json`);
    let issued = false;
    try {
      const prior = readJsonSafe(file);
      if (fs.existsSync(file)) {
        if (!prior?.fingerprint) return failure('unknown', '이 질문의 이전 전송 기록을 확인하지 못했습니다. 원래 질문창을 확인해 주세요. 다시 전송하지 않습니다.');
        if (!submission || prior.fingerprint === hash(submission)) return prior.result || failure('unknown', '이 답변은 이미 전송을 시작했습니다. 원래 질문창에서 처리 상태를 확인해 주세요. 다시 전송하지 않습니다.');
        return failure('stale', '이미 답변 전송을 시작한 질문입니다. 다른 답변으로 다시 전송하지 않습니다.');
      }
      return await rpc(command, async (call, incoming) => {
        let cursor, loaded = false;
        do {
          const page = await call('thread/loaded/list', cursor ? { cursor } : {});
          loaded ||= page.data?.includes(session.sessionId) === true;
          cursor = page.nextCursor;
        } while (cursor && !loaded);
        if (!loaded) return failure('unavailable', '실행 중인 원래 세션에 연결되지 않았습니다. 전용 답장 창에서 답해 주세요.');
        // No configuration overrides, new thread, turn, message, or provider call.
        await call('thread/resume', { threadId: session.sessionId, excludeTurns: true });
        await new Promise(resolve => setTimeout(resolve, replayMs));
        const request = [...incoming.requests.values()].find(r => r.method === 'item/tool/requestUserInput' && r.params?.threadId === session.sessionId && r.params?.itemId === itemId);
        if (!request) return failure('stale', '현재 답변을 기다리는 원래 질문을 찾지 못했습니다. 이미 종료됐거나 이 연결에서 지원하지 않는 질문입니다.');
        const p = request.params, questions = p.questions;
        if (!Array.isArray(questions) || !questions.length || questions.length > 4 || questions.some(q => q.isSecret || typeof q.id !== 'string' || typeof q.question !== 'string') || new Set(questions.map(q => q.id)).size !== questions.length) return failure('unsupported', '이 질문 형식은 전용 답장 창에서 답해 주세요.');
        const revision = hash(request);
        const view = { itemId, revision, questions: questions.map(q => ({ id: q.id, title: q.question, options: (q.options || []).map(o => ({ label: o.label, description: o.description })), allowOther: q.isOther === true || !q.options?.length })) };
        if (!submission) return { ok: true, state: 'pending', ...view };
        if (submission.revision !== revision || !Array.isArray(submission.answers) || submission.answers.length !== questions.length) return failure('stale', '질문이 바뀌었습니다. 질문을 다시 열어 확인해 주세요.');
        const answers = Object.create(null);
        for (const q of questions) {
          const selected = submission.answers.filter(a => a?.id === q.id);
          const a = selected[0];
          if (selected.length !== 1 || typeof a.value !== 'string' || !a.value.trim() || Buffer.byteLength(a.value, 'utf8') > 16000 || (!q.isOther && q.options?.length && !q.options.some(o => o.label === a.value))) return failure('invalid', '각 질문에 유효한 답변을 하나씩 입력해 주세요.');
          answers[q.id] = { answers: [a.value] };
        }
        // Fence again at the last synchronous point before issuing the response.
        if (incoming.requests.get(request.id) !== request) return failure('stale', '원래 질문이 이미 종료됐습니다. 답변을 전송하지 않았습니다.');
        fs.writeFileSync(file, JSON.stringify({ session: session.sessionId, itemId, revision, fingerprint: hash(submission), at: new Date().toISOString(), result: null }), { flag: 'wx', mode: 0o600 });
        issued = true;
        let timer, stop;
        const resolved = new Promise(resolve => {
          stop = incoming.listen(message => {
            if (message.method === 'serverRequest/resolved' && message.params?.threadId === session.sessionId && message.params?.requestId === request.id) resolve(true);
          });
          timer = setTimeout(() => resolve(false), resolveMs);
        });
        let closed;
        try { incoming.respond(request.id, { answers }); closed = await resolved; }
        finally { clearTimeout(timer); stop(); }
        // A resolved event can also mean cancellation or an answer elsewhere.
        // Do not claim that our particular answer was consumed by the model.
        const result = closed ? { ok: true, state: 'resolved', message: '답변을 전송했고 원래 질문의 종료를 확인했습니다. 답변 반영은 세션의 다음 응답에서 확인해 주세요.' } : failure('unknown', '답변을 전송했지만 질문 종료 확인이 지연되고 있습니다. 중복 전송하지 말고 원래 질문창을 확인해 주세요.');
        const saved = readJsonSafe(file);
        writeJsonAtomic(file, { ...saved, result, observedAt: new Date().toISOString() });
        return result;
      }, { cleanupOwner });
    } catch {
      return failure(issued ? 'unknown' : 'unavailable', issued ? '답변 전송 후 연결이 끊겼습니다. 중복 전송하지 말고 원래 질문창을 확인해 주세요.' : '원래 질문창에 연결하지 못했습니다. 답변은 전송하지 않았습니다.');
    } finally { busy.delete(session.sessionId); }
  };
}
