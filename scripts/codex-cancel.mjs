import { withCodexRpc } from './codex-rpc.mjs';

const prefix = /^\[\uB300\uD654\/\uD53C\uB4DC\uBC31 \u00B7 [^\]\r\n]*\]\s*\[uifb-receipt:([0-9a-fA-F-]{36})\](?:\s|$)/;

// Delete only a uniquely identified queued input. Missing is never proof of cancellation.
export async function cancelCodexQueued(command, threadId, receipt, options = {}) {
  let deleting = false;
  if (!/^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/.test(receipt || '')) return { ok: false, state: 'not_pending' };
  try {
    return await withCodexRpc(command, async call => {
      const matches = [];
      let cursor;
      do {
        const page = await call('thread/queue/list', { threadId, limit: 100, ...(cursor ? { cursor } : {}) });
        for (const item of page.data || []) {
          const text = (item.input || []).filter(i => i.type === 'text').map(i => i.text).join('\n');
          if (prefix.exec(text)?.[1] === receipt) matches.push(item);
        }
        cursor = page.nextCursor;
      } while (cursor);
      if (matches.length !== 1 || !matches[0].id) return { ok: false, state: 'not_pending' };
      deleting = true;
      const result = await call('thread/queue/delete', { threadId, queuedSubmissionId: matches[0].id });
      return result.deleted === true ? { ok: true, queuedSubmissionId: matches[0].id } : { ok: false, state: 'not_pending' };
    }, options);
  } catch (error) {
    return { ok: false, state: deleting && !error.rpc ? 'unknown' : 'failed' };
  }
}
