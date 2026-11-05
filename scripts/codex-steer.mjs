import { withCodexRpc } from './codex-rpc.mjs';

export async function steerCodex(command, threadId, text, options = {}) {
  let submitted = false;
  const outcome = (state, diagnostic) => ({ ok: false, state, mode: 'steer', error: 'steer_failed', diagnostic });
  if (!command || typeof WebSocket !== 'function') return outcome('failed', 'steer_unavailable');
  try {
    return await withCodexRpc(command, async call => {
      let cursor, found = false;
      do {
        const loaded = await call('thread/loaded/list', cursor ? { cursor } : {});
        if (loaded.data?.includes(threadId)) { found = true; break; }
        cursor = loaded.nextCursor;
      } while (cursor);
      if (!found) return outcome('failed', 'thread_not_loaded');
      const turns = await call('thread/turns/list', { threadId, limit: 1, sortDirection: 'desc', itemsView: 'summary' });
      const turn = turns.data?.[0];
      if (!turn?.id || turn.status !== 'inProgress') return outcome('failed', 'no_active_turn');
      submitted = true;
      const result = await call('turn/steer', { threadId, expectedTurnId: turn.id, ...(options.clientUserMessageId ? { clientUserMessageId: options.clientUserMessageId } : {}), input: [{ type: 'text', text }, ...(options.imagePaths || []).map(path => ({ type: 'localImage', path }))] });
      return result?.turnId === turn.id ? { ok: true, state: 'accepted', mode: 'steer', turnId: turn.id } : outcome('unknown', 'unexpected_turn');
    }, options);
  } catch (error) {
    return outcome(submitted && !error.rpc ? 'unknown' : 'failed', error.rpc ? 'steer_rejected' : 'connection_lost');
  }
}

export async function queueCodexImages(command, threadId, text, options) {
  let submitted = false;
  try {
    return await withCodexRpc(command, async call => {
      submitted = true;
      const result = await call('thread/queue/add', { threadId, clientUserMessageId: options.clientUserMessageId,
        input: [{ type: 'text', text }, ...options.imagePaths.map(path => ({ type: 'localImage', path }))] });
      return result?.queuedSubmission?.id ? { ok: true, state: 'accepted', queuedSubmissionId: result.queuedSubmission.id } : { ok: false, state: 'unknown' };
    }, options);
  } catch (error) { return { ok: false, state: submitted && !error.rpc ? 'unknown' : 'failed' }; }
}
