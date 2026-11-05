import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const digest = text => createHash('sha256').update(text).digest('hex');
const normalized = p => process.platform === 'win32' ? p.toLowerCase() : p;
const candidateCache = new Map(); // IDs, timestamps and hashes only; no message bodies.
function inside(project, file) {
  const actual = fs.realpathSync(file), relative = path.relative(project, actual);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw Error('Outside registered project');
  return actual;
}
function json(file) {
  if (fs.statSync(file).size > 64 * 1024) throw Error('Oversized source registration');
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

// Opt-in, read-only correlation with the existing continuation driver's durable
// pickup receipt. Text prefixes alone never establish automation provenance.
export function readContinuationOrigins(root, session, rows, version = '') {
  const matches = new Map();
  try {
    const project = fs.realpathSync(path.dirname(root));
    const sources = json(path.join(root, 'automation-sources.json')).sources;
    if (!Array.isArray(sources)) throw Error('No registered sources');
    const cacheKey = version && JSON.stringify([root, session.path, version]);
    let candidates = cacheKey && candidateCache.get(cacheKey);
    if (!candidates) {
      candidates = [];
      for (const { o } of rows) {
        const p = o.payload;
        if (o.type !== 'response_item' || p?.type !== 'message' || p.role !== 'user' || typeof p.id !== 'string') continue;
        const text = (p.content || []).filter(b => b.type === 'input_text').map(b => b.text).join('\n').trim();
        const marker = /^\[pipeline-continuation:([0-9a-f-]{36})\]\r?\n/.exec(text);
        const turn = p.internal_chat_message_metadata_passthrough?.turn_id;
        if (marker && typeof turn === 'string' && Number.isFinite(Date.parse(o.timestamp))) candidates.push({ id: p.id, cid: marker[1], turn, at: o.timestamp, hash: digest(text) });
      }
      if (candidates.length > 256) return { matches, key: 'candidate-limit' };
      if (cacheKey) {
        candidateCache.set(cacheKey, candidates);
        while (candidateCache.size > 16) candidateCache.delete(candidateCache.keys().next().value);
      }
    }
    if (!candidates.length) return { matches, key: 'none' };
    // Optional native SQLite support: older Node versions retain ordinary
    // unknown-origin rendering instead of launching a helper or installing one.
    const { DatabaseSync } = require('node:sqlite');
    for (const source of sources.slice(0, 4)) {
      if (source?.type !== 'pipeline-continuation' || typeof source.config !== 'string') continue;
      let db;
      try {
        const config = json(inside(project, path.resolve(project, source.config)));
        if (config.threadId !== session.sessionId || normalized(fs.realpathSync(config.projectRoot)) !== normalized(project)) continue;
        const file = inside(project, path.resolve(project, config.stateDirectory, 'state.sqlite'));
        db = new DatabaseSync(file, { readOnly: true, timeout: 100 });
        const query = db.prepare('SELECT body FROM continuation_intents WHERE id=?');
        for (const cid of [...new Set(candidates.map(c => c.cid))].slice(-64)) {
          const row = query.get(cid);
          if (!row) continue;
          const intent = JSON.parse(row.body), receipt = intent.receipt;
          if (intent.id !== cid || !['started', 'completed', 'failed'].includes(intent.state) ||
            !['started', 'completed', 'failed'].includes(receipt?.status) || receipt.cid !== cid || typeof receipt.turnId !== 'string' || !Number.isFinite(Date.parse(intent.at))) continue;
          const picked = candidates.filter(c => c.cid === cid && c.turn === receipt.turnId && Date.parse(c.at) >= Date.parse(intent.at));
          if (picked.length !== 1) continue;
          const input = picked[0];
          matches.set(input.id, { from: 'automation', automationKind: 'pipeline-continuation', automationId: cid,
            automationProvider: 'codex', automationTransport: 'app-server', automationTextSHA256: input.hash });
        }
      } catch {} // Missing, busy, malformed or unsupported evidence stays unknown.
      finally { db?.close(); }
    }
  } catch {}
  return { matches, key: digest(JSON.stringify([...matches])) };
}
