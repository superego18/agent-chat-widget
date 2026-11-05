import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const reviewedCache = new Map(), projected = new WeakMap();
const empty = () => ({ key: 'none', matches: new Map() });
export function nativeDisplaySource(payload, text) {
  const meta = payload.internal_chat_message_metadata_passthrough, kinds = meta?.content_item_kinds, origins = meta?.content_item_metadata;
  if (payload.role !== 'user' || !Array.isArray(kinds) || !kinds.length || (origins !== undefined && (!Array.isArray(origins) || origins.length !== kinds.length || origins.some(x => x?.provenance?.type === 'user')))) return;
  let kind;
  if (kinds.every(k => k === 'goal.internal_context')) kind = 'goal-context';
  else if (kinds.every(k => ['agents_md.instructions', 'environments.environment_context'].includes(k)) && kinds.includes('agents_md.instructions') && /^# AGENTS\.md instructions(?: for [^\r\n]+)?\r?\n\s*<INSTRUCTIONS>[\s\S]*<\/INSTRUCTIONS>(?:\s*<environment_context>[\s\S]*<\/environment_context>)?$/.test(text)) kind = 'project-instructions';
  else if (kinds.every(k => k === 'environments.environment_context') && /^<environment_context>[\s\S]*<\/environment_context>$/.test(text)) kind = 'environment-context';
  if (kind) return { kind, provider: 'codex', evidence: 'native-input-kind' };
}
function smallFile(file, limit) {
  if (!fs.statSync(file).isFile() || fs.statSync(file).size > limit) throw Error('Oversized display source');
  const bytes = fs.readFileSync(file); if (bytes.length > limit) throw Error('Oversized display source'); return bytes;
}
function readReviewed(root) {
  try {
    const actualRoot = fs.realpathSync(root), registry = smallFile(path.join(root, 'automation-sources.json'), 65536);
    const sources = JSON.parse(registry.toString('utf8').replace(/^\uFEFF/, '')).sources;
    const selected = Array.isArray(sources) && sources.filter(s => s?.type === 'reviewed-native-display');
    if (!selected || selected.length !== 1) return empty();
    const source = selected[0]; if (typeof source.file !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256 || '')) return empty();
    const file = fs.realpathSync(path.resolve(root, source.file)), relative = path.relative(actualRoot, file);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return empty();
    const stat = fs.statSync(file), key = [digest(registry), file, stat.dev, stat.ino, stat.birthtimeMs, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
    if (reviewedCache.get(actualRoot)?.key === key) return reviewedCache.get(actualRoot);
    const bytes = smallFile(file, 262144); if (digest(bytes) !== source.sha256) return empty();
    const rows = JSON.parse(bytes.toString('utf8')).rows; if (!Array.isArray(rows) || rows.length > 512) return empty();
    const matches = new Map(), duplicates = new Set();
    for (const row of rows) {
      if (typeof row?.receiver !== 'string' || !/^x[\w-]+$/.test(row.id || '') || !/^[a-f0-9]{64}$/.test(row.textSHA || '')) continue;
      const dispatch = row.kind === 'worker-dispatch' && ['taskExists', 'dispatchExists', 'specMatches', 'taskJoin', 'creatorMatches', 'assigneeMatches'].every(k => row[k] === true) && /^task_[\w-]+$/.test(row.taskId || '') && /^ctx_[\w-]+$/.test(row.dispatchId || '');
      const continuation = row.kind === 'owner-confirmed-continuation' && /^[\w-]{1,200}$/.test(row.continuationId || '') && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(row.approvalReceipt || '');
      if (!dispatch && !continuation) continue;
      const id = row.receiver + ':' + row.id;
      if (matches.has(id)) { matches.delete(id); duplicates.add(id); } else if (!duplicates.has(id)) matches.set(id, { textSHA: row.textSHA, ...(dispatch ? { taskId: row.taskId, dispatchId: row.dispatchId } : { continuationId: row.continuationId }) });
    }
    const result = { key, matches }; reviewedCache.set(actualRoot, result);
    while (reviewedCache.size > 4) reviewedCache.delete(reviewedCache.keys().next().value);
    return result;
  } catch { return empty(); }
}
// Display-only projection of explicitly approved, pinned audit evidence. No live
// Orca database calls and no change to sender, permission or saved source records.
export function projectReviewedDisplay(root, session, data) {
  const reviewed = readReviewed(root), key = session.sessionId + ':' + reviewed.key;
  if (projected.get(data)?.key === key) return projected.get(data).data;
  let changed = false;
  const items = data.items.map(message => {
    const proof = reviewed.matches.get(session.sessionId + ':' + message.id);
    if (!proof || message.from !== 'user' || message.context !== 'terminal' || message.nativeDisplay || digest(message.text) !== proof.textSHA) return message;
    if (!message.text.startsWith(proof.continuationId ? `[pipeline-continuation:${proof.continuationId}]\n` : 'You are working inside Orca, a multi-agent IDE. You are a dispatched worker.\n')) return message;
    changed = true; return { ...message, nativeDisplay: { provider: 'codex', ...(proof.continuationId ? { kind: 'pipeline-continuation', evidence: 'owner-confirmed-exact-input' } : { kind: 'orca-dispatch', evidence: 'reviewed-task-dispatch', taskId: proof.taskId, dispatchId: proof.dispatchId }) } };
  });
  const result = changed ? { ...data, items } : data; projected.set(data, { key, data: result }); return result;
}
