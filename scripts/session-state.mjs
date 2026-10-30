import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeJsonAtomic } from './chat-format.mjs';

const files = ['chat.json', 'drafts.json', 'prefs.json', 'compose.json', 'seen.json', 'delivered.json', 'peers.json', 'side-groups.json'];
const identity = new Set(['to', 'session', 'tab']);
const opaque = new Set(['text', 'where', 'draft', 'quote', 'replyQuote', 'queue']);

// Run with the review server stopped: its in-memory readers can otherwise overwrite a migration.
export function replaceSessionState(root, replacements) {
  if (!replacements.length) return null;
  const ids = new Map(replacements.map(({ from, to }) => [from, to]));
  const merge = (old, current) => {
    if (Array.isArray(old) && Array.isArray(current)) return [...new Set([...old, ...current])];
    if (old && current && typeof old === 'object' && typeof current === 'object') return { ...old, ...current };
    return current;
  };
  function rewrite(value, field = '') {
    if (typeof value === 'string') return (identity.has(field) || field === 'peers.json') ? ids.get(value) || value : value;
    if (Array.isArray(value)) return value.map(x => rewrite(x, field));
    if (!value || typeof value !== 'object') return value;
    const out = {};
    // Current-session preferences win on a collision; old-only settings survive.
    for (const [key, item] of Object.entries(value).sort(([a], [b]) => Number(ids.has(b)) - Number(ids.has(a)))) {
      const target = ids.get(key) || key;
      const next = opaque.has(key) ? item : rewrite(item, field === 'peers.json' ? field : key);
      out[target] = Object.hasOwn(out, target) ? merge(out[target], next) : next;
    }
    return out;
  }
  // Parse every file before any write. A malformed store must not cause a partial migration.
  const historyDir = path.join(root, 'transcript-history');
  const histories = fs.existsSync(historyDir) ? fs.readdirSync(historyDir).filter(file => file.endsWith('.json')).map(file => path.join('transcript-history', file)) : [];
  const changes = [...files, ...histories].filter(file => fs.existsSync(path.join(root, file))).map(file => {
    const before = fs.readFileSync(path.join(root, file), 'utf8');
    const data = rewrite(JSON.parse(before), file);
    return { file, before, data };
  }).filter(({ before, data }) => JSON.stringify(JSON.parse(before)) !== JSON.stringify(data));
  if (!changes.length) return null;
  const ownerFile = path.join(root, 'ux-prototype-owner.json');
  if (fs.existsSync(ownerFile)) {
    const owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
    let alive = false;
    try { process.kill(owner.pid, 0); alive = true; } catch {}
    if (alive) throw new Error('Stop the owned review runtime before replacing a session; restart it after registration.');
  }
  const backup = path.join(root, 'session-migrations', `${Date.now()}-${randomUUID()}`);
  fs.mkdirSync(backup, { recursive: true });
  for (const { file, before } of changes) {
    fs.mkdirSync(path.dirname(path.join(backup, file)), { recursive: true });
    fs.writeFileSync(path.join(backup, file), before);
  }
  if (fs.existsSync(path.join(root, 'sessions'))) fs.cpSync(path.join(root, 'sessions'), path.join(backup, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify({ replacements, files: changes.map(x => x.file) }, null, 2));
  for (const { file, data } of changes) writeJsonAtomic(path.join(root, file), data);
  return backup;
}
