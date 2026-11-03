import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { adjustText, quoteLines, readJsonSafe, writeJsonAtomic } from './chat-format.mjs';
import { readPeerSends, matchPeerInput } from './codex-peers.mjs';
import { readOrchestrationEvidence, matchOrchestrationInput, createEvidenceContext, cachedEvidence, storeEvidence } from './codex-orchestration.mjs';

const modifiedAt = file => { try { return fs.statSync(file).mtimeMs; } catch { return 0; } };
const fileOf = (root, id) => path.join(root, 'transcript-history', `${id}.json`);
const historyOf = file => { const data = readJsonSafe(file); return Array.isArray(data?.items) ? data : { items: [] }; };
function internalInput(payload, text) {
  const meta = payload.internal_chat_message_metadata_passthrough;
  const kinds = meta?.content_item_kinds;
  const origins = meta?.content_item_metadata;
  // Native metadata proves the origin; a quoted envelope alone does not.
  if (!Array.isArray(kinds) || !kinds.length || !kinds.every(k => ['agents_md.instructions', 'environments.environment_context'].includes(k)) ||
      !Array.isArray(origins) || origins.length !== kinds.length || !origins.every((m, i) => m?.provenance?.type === (kinds[i] === 'agents_md.instructions' ? 'agents_md' : 'harness'))) return false;
  return /^<environment_context>[\s\S]*<\/environment_context>$/.test(text) ||
    /^# AGENTS\.md instructions(?: for [^\r\n]+)?\r?\n\s*<INSTRUCTIONS>[\s\S]*<\/INSTRUCTIONS>(?:\s*<environment_context>[\s\S]*<\/environment_context>)?$/.test(text);
}
function widgetInputs(root, session) {
  const chat = readJsonSafe(path.join(root, 'chat.json'));
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  const entries = messages.filter(m => m.from === 'user' && m.to === session.sessionId && typeof m.text === 'string' &&
    /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/.test(m.queue?.receipt || '') && Number.isFinite(Date.parse(m.at)));
  const refs = m => m.quotes?.length ? m.quotes : m.replyTo ? [{ id: m.replyTo }] : [];
  const originals = [...messages];
  if (entries.some(m => refs(m).some(q => !originals.some(x => x.id === q.id)))) {
    // Read durable reference evidence only; never poll other providers to identify a quote.
    const directory = path.join(root, 'transcript-history');
    let files = [];
    try { files = fs.readdirSync(directory).filter(f => f.endsWith('.json')); } catch {}
    for (const file of files) originals.push(...historyOf(path.join(directory, file)).items);
  }
  const inputs = new Map();
  for (const m of entries) {
    // Missing original identity makes the generated quote uncertain: keep the native input.
    if (refs(m).some(q => !originals.some(x => x.id === q.id))) continue;
    const src = (m.context === 'app' ? '앱 화면' : '비교 페이지') + (m.device === 'mobile' ? ' · 모바일' : m.device === 'desktop' ? ' · 데스크톱' : '');
    const quotes = quoteLines(m, originals);
    const w = m.where;
    const where = w?.url || w?.selector
      ? `\n위치: ${w.url || ''}${w.selector ? ' · ' + w.selector : ''}${w.component ? ' · 컴포넌트 ' + w.component : ''}${w.text ? ' · "' + w.text + '"' : ''}${adjustText(w) ? '\n' + adjustText(w) : ''}` : '';
    const text = `[대화/피드백 · ${src}${m.round ? ` · ${m.round}차` : ''}] [uifb-receipt:${m.queue.receipt}] ${m.text}${quotes.length ? '\n' + quotes.join('\n') : ''}${where}`;
    if (!inputs.has(m.queue.receipt)) inputs.set(m.queue.receipt, []);
    inputs.get(m.queue.receipt).push({ text, at: m.at });
  }
  return inputs;
}
function representedWidgetInput(inputs, text, at) {
  const receipt = /^\[대화\/피드백 · [^\]\r\n]*\] \[uifb-receipt:([0-9a-fA-F-]{36})\] /.exec(text)?.[1];
  return receipt && inputs.get(receipt)?.some(m => text === m.text && Date.parse(at) >= Date.parse(m.at));
}
function shortReferences(root, history) {
  const file = path.join(root, 'native-reference-ids.json');
  const stored = readJsonSafe(file);
  const aliases = stored?.ids ? stored : { nextId: 1, ids: {} };
  let changed = false;
  const items = history.items.map(item => {
    if (typeof item.id !== 'string' || !item.id.startsWith('x')) return item;
    if (!aliases.ids[item.id]) { aliases.ids[item.id] = aliases.nextId++; changed = true; }
    return { ...item, refId: `xq${aliases.ids[item.id]}` };
  });
  if (changed) writeJsonAtomic(file, aliases);
  return { ...history, items };
}
export const readStoredHistory = (root, id) => shortReferences(root, historyOf(fileOf(root, id)));

// Keep conversation records apart from the small, lossy receipt-evidence cache.
// Codex appends tool output far more often than it appends displayed messages.
const nativeMessages = new Map();
const identity = stat => `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
function messageRecord(line) {
  if (!/"type"\s*:\s*"message"/.test(line)) return null;
  try {
    const o = JSON.parse(line);
    return o.type === 'response_item' && o.payload?.type === 'message' && ['user', 'assistant'].includes(o.payload.role) ? { line, o } : null;
  } catch { return null; }
}
function readNativeMessages(file) {
  const key = path.resolve(file);
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const stat = fs.fstatSync(fd);
    const range = (start, length) => {
      const bytes = Buffer.alloc(length);
      let count = 0;
      while (count < length) {
        const n = fs.readSync(fd, bytes, count, length - count, start + count);
        if (!n) break;
        count += n;
      }
      return bytes.subarray(0, count);
    };
    let entry = nativeMessages.get(key);
    if (entry && (entry.identity !== identity(stat) || stat.size < entry.size ||
      stat.size === entry.size && stat.mtimeMs !== entry.mtime ||
      !range(0, entry.prefix.length).equals(entry.prefix) ||
      !range(entry.size - entry.suffix.length, entry.suffix.length).equals(entry.suffix))) entry = null;
    if (!entry) entry = { identity: identity(stat), size: 0, tail: Buffer.alloc(0), rows: [], bytes: 0 };
    const bytes = range(entry.size, stat.size - entry.size);
    const buffer = Buffer.concat([entry.tail, bytes]);
    const rows = [...entry.rows];
    let cursor = 0, retained = entry.bytes;
    for (let end; (end = buffer.indexOf(10, cursor)) !== -1;) {
      const row = messageRecord(buffer.subarray(cursor, end).toString('utf8'));
      if (row) { rows.push(row); retained += end - cursor; }
      cursor = end + 1;
    }
    const tail = buffer.subarray(cursor);
    const prefix = entry.prefix?.length === 4096 ? entry.prefix : range(0, Math.min(stat.size, 4096));
    const suffix = range(Math.max(0, stat.size - 4096), Math.min(stat.size, 4096));
    const after = fs.fstatSync(fd), named = fs.statSync(file);
    // An active provider may append while we read. Accept the captured prefix;
    // the next poll reads the growth. Replacement/shrink/rewrite still reset.
    if ([after, named].some(s => identity(s) !== identity(stat) || s.size < stat.size ||
      s.size === stat.size && s.mtimeMs !== stat.mtimeMs)) throw new Error('Native transcript changed during read');
    nativeMessages.delete(key);
    nativeMessages.set(key, { identity: identity(stat), size: stat.size, mtime: stat.mtimeMs, prefix, suffix,
      rows, tail: Buffer.from(tail), bytes: retained });
    while (nativeMessages.size > 16 || [...nativeMessages.values()].reduce((n, x) => n + x.bytes + x.tail.length, 0) > 64 * 1024 * 1024) nativeMessages.delete(nativeMessages.keys().next().value);
    // A valid final JSON line need not have a newline yet. Reparse it on append
    // so split UTF-8 and partial JSON never become permanently lost or duplicated.
    const last = messageRecord(tail.toString('utf8'));
    return last ? [...rows, last] : rows;
  } catch (error) { nativeMessages.delete(key); throw error; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

// The widget owns a durable copy of displayed native messages, independent of the provider's rollout.
export function readCodexHistory(root, session, context = createEvidenceContext()) {
  const file = fileOf(root, session.sessionId);
  const saved = historyOf(file);
  let stat;
  try { stat = fs.statSync(session.path); } catch { return shortReferences(root, saved); }
  // Receipt-source faults cannot bypass the healthy current transcript/fallback.
  let peers, orchestration;
  try { peers = readPeerSends(root, session, context); }
  catch { peers = { sends: new Map(), key: 'peer-incomplete' }; }
  try { orchestration = readOrchestrationEvidence(root, session, context); }
  catch { orchestration = { sessions: [], results: [], target: session, key: 'native-incomplete', complete: false }; }
  const inputs = widgetInputs(root, session);
  const chatKey = createHash('sha256').update(JSON.stringify([...inputs])).digest('hex');
  const key = `${session.path}:${stat.size}:${stat.mtimeMs}:${modifiedAt(file)}:${peers.key}:${orchestration.key}:${chatKey}`;
  const cacheKey = 'history:' + path.resolve(file);
  if (cachedEvidence(cacheKey)?.key === key) return cachedEvidence(cacheKey).data;
  const items = new Map(saved.items.map(item => [item.id, item]));
  let source;
  try { source = readNativeMessages(session.path); } catch { return shortReferences(root, saved); }
  const usedSends = new Set(saved.items.flatMap(item => [item.peerSend, ...(item.peerSends || [])]).filter(Boolean));
  for (const { line, o } of source) {
    const p = o.payload;
    if (o.type !== 'response_item' || p?.type !== 'message' || !['user', 'assistant'].includes(p.role)) continue;
    const raw = (p.content || []).filter(b => ['input_text', 'output_text'].includes(b.type)).map(b => b.text).join('\n');
    const text = (p.role === 'user' ? raw : raw
      .replace(/<system-reminder[^>]*>[\s\S]*?<\/system-reminder>/g, '')
      .replace(/<(local-command-[a-z]+|command-[a-z]+)>[\s\S]*?<\/\1>/g, '')).trim();
    if (!text) continue;
    const id = `x${p.id || createHash('sha256').update(session.sessionId + ':' + line).digest('hex')}`;
    if (p.role === 'user' && (internalInput(p, text) || representedWidgetInput(inputs, text, o.timestamp))) {
      items.delete(id);
      continue;
    }
    const previous = items.get(id);
    if (previous?.peerSend) usedSends.add(previous.peerSend);
    for (const send of previous?.peerSends || []) usedSends.add(send);
    let matched = p.role === 'user' && previous?.from !== 'peer' ? matchPeerInput(peers.sends, text, o.timestamp, usedSends) : [];
    if (!matched.length && p.role === 'user' && previous?.from !== 'peer') matched = matchOrchestrationInput(orchestration, text, o.timestamp, usedSends);
    const sender = matched[0];
    const peer = previous?.from === 'peer' ? { from: 'peer', session: previous.session, to: previous.to, fromName: previous.fromName, peerSend: previous.peerSend, ...(previous.peerSends ? { peerSends: previous.peerSends } : {}) }
      : sender ? { from: 'peer', session: sender.session, to: session.sessionId, fromName: sender.fromName, peerSend: sender.id, peerSends: matched.map(x => x.id) } : {};
    if (peer.peerSend) usedSends.add(peer.peerSend);
    for (const send of peer.peerSends || []) usedSends.add(send);
    items.set(id, { id, from: p.role === 'user' ? 'user' : 'agent', session: session.sessionId,
      context: 'terminal', agent: session.agent, text, at: o.timestamp,
      ...peer,
      ...(p.phase === 'commentary' ? { interim: true } : {}) });
  }
  const data = shortReferences(root, { items: [...items.values()].sort((a, b) => String(a.at).localeCompare(String(b.at))) });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (JSON.stringify(data) !== JSON.stringify(saved)) writeJsonAtomic(file, data);
  storeEvidence(cacheKey, { key: `${session.path}:${stat.size}:${stat.mtimeMs}:${modifiedAt(file)}:${peers.key}:${orchestration.key}:${chatKey}`, data });
  return data;
}

export function carryTranscriptHistory(root, oldSession, newId) {
  const old = oldSession.tool === 'codex' ? readCodexHistory(root, oldSession) : readJsonSafe(fileOf(root, oldSession.sessionId));
  if (!old?.items?.length) return;
  const file = fileOf(root, newId);
  const current = historyOf(file);
  const items = new Map(old.items.map(item => [item.id, { ...item,
    session: item.session === oldSession.sessionId ? newId : item.session,
    ...(item.to === oldSession.sessionId ? { to: newId } : {}) }]));
  for (const item of current.items) items.set(item.id, item);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, { items: [...items.values()] });
}
