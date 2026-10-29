import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readJsonSafe, writeJsonAtomic } from './chat-format.mjs';

const cache = new Map();
const fileOf = (root, id) => path.join(root, 'transcript-history', `${id}.json`);
const historyOf = file => { const data = readJsonSafe(file); return Array.isArray(data?.items) ? data : { items: [] }; };
export const readStoredHistory = (root, id) => historyOf(fileOf(root, id));

// The widget owns a durable copy of displayed native messages, independent of the provider's rollout.
export function readCodexHistory(root, session) {
  const file = fileOf(root, session.sessionId);
  const saved = historyOf(file);
  let stat;
  try { stat = fs.statSync(session.path); } catch { return saved; }
  const key = `${session.path}:${stat.size}:${stat.mtimeMs}:${fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0}`;
  if (cache.get(file)?.key === key) return cache.get(file).data;
  const items = new Map(saved.items.map(item => [item.id, item]));
  let source;
  try { source = fs.readFileSync(session.path, 'utf8'); } catch { return saved; }
  for (const line of source.split('\n')) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const p = o.payload;
    if (o.type !== 'response_item' || p?.type !== 'message' || !['user', 'assistant'].includes(p.role)) continue;
    const text = (p.content || []).filter(b => ['input_text', 'output_text'].includes(b.type)).map(b => b.text).join('\n')
      .replace(/<system-reminder[^>]*>[\s\S]*?<\/system-reminder>/g, '')
      .replace(/<(local-command-[a-z]+|command-[a-z]+)>[\s\S]*?<\/\1>/g, '').trim();
    if (!text || (p.role === 'user' && (text.startsWith('<') || text.startsWith('[대화/피드백') || text.includes('AGENTS.md instructions')))) continue;
    const id = `x${p.id || createHash('sha256').update(session.sessionId + ':' + line).digest('hex')}`;
    items.set(id, { id, from: p.role === 'user' ? 'user' : 'agent', session: session.sessionId,
      context: 'terminal', agent: session.agent, text, at: o.timestamp,
      ...(p.phase === 'commentary' ? { interim: true } : {}) });
  }
  const data = { items: [...items.values()].sort((a, b) => String(a.at).localeCompare(String(b.at))) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (JSON.stringify(data) !== JSON.stringify(saved)) writeJsonAtomic(file, data);
  cache.set(file, { key: `${session.path}:${stat.size}:${stat.mtimeMs}:${fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0}`, data });
  return data;
}

export function carryTranscriptHistory(root, oldSession, newId) {
  const old = oldSession.tool === 'codex' ? readCodexHistory(root, oldSession) : readJsonSafe(fileOf(root, oldSession.sessionId));
  if (!old?.items?.length) return;
  const file = fileOf(root, newId);
  const current = historyOf(file);
  const items = new Map(old.items.map(item => [item.id, { ...item, session: newId }]));
  for (const item of current.items) items.set(item.id, item);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, { items: [...items.values()] });
}
