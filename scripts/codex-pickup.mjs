import fs from 'node:fs';

const TAIL_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 16;
const cache = new Map();
// QUEUE_PREFIX's first bracket must be immediately followed by the receipt marker.
const PICKUP = /^\[\uB300\uD654\/\uD53C\uB4DC\uBC31 \u00B7 [^\]\r\n]*\]\s*\[uifb-receipt:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]/;

function readReceipts(file) {
  let fd;
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return new Map();
    const previous = cache.get(file);
    if (previous?.size === st.size && previous.mtimeMs === st.mtimeMs) return previous.receipts;
    const len = Math.min(st.size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fd = fs.openSync(file, 'r');
    const count = fs.readSync(fd, buf, 0, len, st.size - len);
    const lines = buf.subarray(0, count).toString('utf8').split('\n');
    if (len < st.size) lines.shift(); // The tail may start inside a JSON record.
    const receipts = new Map();
    for (const line of lines) {
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      const p = record?.payload;
      if (record?.type !== 'response_item' || p?.type !== 'message' || p.role !== 'user' || !Array.isArray(p.content)) continue;
      const text = p.content.filter((b) => b?.type === 'input_text' && typeof b.text === 'string').map((b) => b.text).join('\n');
      const receipt = PICKUP.exec(text)?.[1];
      const at = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN;
      if (!receipt || !Number.isFinite(at)) continue;
      if (!receipts.has(receipt)) receipts.set(receipt, []);
      receipts.get(receipt).push(at);
    }
    cache.delete(file);
    cache.set(file, { size: st.size, mtimeMs: st.mtimeMs, receipts });
    if (cache.size > MAX_FILES) cache.delete(cache.keys().next().value);
    return receipts;
  } catch {
    cache.delete(file);
    return new Map();
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// Return { [messageId]: ISO timestamp } from explicit native user input only.
// Receipt equality is case-sensitive; no trimming, tag stripping or reply inference.
export function readQueuePickups(session, messages) {
  if (typeof session?.path !== 'string' || !session.path || typeof session.sessionId !== 'string' || !session.sessionId) return {};
  const pending = messages.filter((m) => m?.id != null && m.to === session.sessionId && typeof m.queue?.receipt === 'string' && typeof m.at === 'string');
  if (!pending.length) return {};
  const receipts = readReceipts(session.path);
  const pickups = new Map();
  for (const message of pending) {
    const sentAt = Date.parse(message.at);
    let first = Infinity;
    for (const at of receipts.get(message.queue.receipt) || []) {
      if (at >= sentAt && at < first) first = at;
    }
    if (Number.isFinite(first)) pickups.set(message.id, new Date(first).toISOString());
  }
  return Object.fromEntries(pickups);
}
