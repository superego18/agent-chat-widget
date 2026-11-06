import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { adjustText, quoteLines, readJsonSafe, writeJsonAtomic } from './chat-format.mjs';
import { readPeerSends, matchPeerInput } from './codex-peers.mjs';
import { readOrchestrationEvidence, matchOrchestrationInput, createEvidenceContext } from './codex-orchestration.mjs';
import { questionCalls, nativeQuestionEntries, codexQuestionReply } from './question-messages.mjs';
import { readContinuationOrigins } from './continuation-origin.mjs';
import { nativeDisplaySource, projectReviewedDisplay } from './native-display.mjs';

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
    if (Array.isArray(m.attachments) && m.attachments.length && m.attachments.every(a => typeof a?.localPath === 'string' && a.localPath.length)) {
      const images = m.attachments.map((a, i) => `<image name=[Image #${i + 1}] path="${a.localPath}">\n</image>`).join('\n');
      inputs.get(m.queue.receipt).push({ text: text + '\n' + images, at: m.at });
    }
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
const displayedHistories = new Map();
let nativeRevision = 0;
const identity = stat => `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
function messageRecord(line, questions) {
  if (/"type"\s*:\s*"UserMessage"/.test(line)) {
    try {
      const o = JSON.parse(line), p = o.payload, item = p?.item;
      if (o.type === 'event_msg' && p?.type === 'item_completed' && item?.type === 'UserMessage' && typeof item.client_id === 'string' && Array.isArray(item.content)) {
        const text = item.content.filter(c => c.type === 'text' && typeof c.text === 'string').map(c => c.text).join('\n').trim();
        return { line: '', o: { timestamp: o.timestamp, type: o.type, payload: { type: p.type, thread_id: p.thread_id, turn_id: p.turn_id,
          item: { type: item.type, client_id: item.client_id, textSHA256: createHash('sha256').update(text).digest('hex') } } } };
      }
    } catch {}
  }
  const knownAnswer = [...line.matchAll(/"tool_use_id"\s*:\s*"([^"\\]+)"/g)].some(m => questions.has(m[1])) ||
    /"type"\s*:\s*"function_call_output"/.test(line) && [...line.matchAll(/"call_id"\s*:\s*"([^"\\]+)"/g)].some(m => questions.has(m[1]));
  if (!/"type"\s*:\s*"message"|"name"\s*:\s*"(?:functions\.)?(?:request_user_input(?:_async)?|AskUserQuestion)"/.test(line) && !knownAnswer) return null;
  try {
    const o = JSON.parse(line);
    const calls = questionCalls(o);
    for (const call of calls) questions.add(call.id);
    return o.type === 'response_item' && (o.payload?.type === 'message' && ['user', 'assistant'].includes(o.payload.role) || o.payload?.type === 'function_call_output' && questions.has(o.payload.call_id)) || calls.length ||
      o.type === 'user' && o.message?.content?.some?.(b => b.type === 'tool_result' && questions.has(b.tool_use_id)) ? { line, o } : null;
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
    if (!entry) entry = { identity: identity(stat), size: 0, tail: Buffer.alloc(0), rows: [], bytes: 0, revision: ++nativeRevision };
    const bytes = range(entry.size, stat.size - entry.size);
    const buffer = Buffer.concat([entry.tail, bytes]);
    const rows = [...entry.rows], questions = new Set(entry.questions || []);
    let cursor = 0, retained = entry.bytes, revision = entry.revision;
    for (let end; (end = buffer.indexOf(10, cursor)) !== -1;) {
      const row = messageRecord(buffer.subarray(cursor, end).toString('utf8'), questions);
      if (row) { rows.push(row); retained += end - cursor; revision = ++nativeRevision; }
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
      rows, questions, tail: Buffer.from(tail), bytes: retained, revision });
    while (nativeMessages.size > 16 || [...nativeMessages.values()].reduce((n, x) => n + x.bytes + x.tail.length, 0) > 64 * 1024 * 1024) nativeMessages.delete(nativeMessages.keys().next().value);
    // A valid final JSON line need not have a newline yet. Reparse it on append
    // so split UTF-8 and partial JSON never become permanently lost or duplicated.
    const last = messageRecord(tail.toString('utf8'), new Set(questions));
    return { rows: last ? [...rows, last] : rows,
      key: `${revision}:${last ? createHash('sha256').update(last.line).digest('hex') : ''}` };
  } catch (error) { nativeMessages.delete(key); throw error; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

// The widget owns a durable copy of displayed native messages, independent of the provider's rollout.
export function readCodexHistory(root, session, context = createEvidenceContext()) {
  const display = data => projectReviewedDisplay(root, session, data);
  const file = fileOf(root, session.sessionId);
  const saved = historyOf(file);
  try { fs.statSync(session.path); } catch { return display(shortReferences(root, saved)); }
  let source;
  try { source = readNativeMessages(session.path); } catch { return display(shortReferences(root, saved)); }
  // Receipt-source faults cannot bypass the healthy current transcript/fallback.
  let peers, orchestration;
  try { peers = readPeerSends(root, session, context, source.rows); }
  catch { peers = { sends: new Map(), key: 'peer-incomplete' }; }
  try { orchestration = readOrchestrationEvidence(root, session, context); }
  catch { orchestration = { sessions: [], results: [], target: session, key: 'native-incomplete', complete: false }; }
  const inputs = widgetInputs(root, session);
  const chatKey = createHash('sha256').update(JSON.stringify([...inputs])).digest('hex');
  const cacheKey = 'history:' + path.resolve(file);
  const origins = readContinuationOrigins(root, session, source.rows, source.key);
  const key = `${session.path}:${source.key}:${modifiedAt(file)}:${peers.key}:${orchestration.key}:${chatKey}:${origins.key}`;
  if (displayedHistories.get(cacheKey)?.key === key) return display(displayedHistories.get(cacheKey).data);
  const items = new Map(saved.items.map(item => [item.id, item]));
  const questions = nativeQuestionEntries(source.rows, session);
  for (const item of questions.items) items.set(item.id, item);
  const usedSends = new Set(saved.items.flatMap(item => [item.peerSend, ...(item.peerSends || [])]).filter(Boolean));
  for (const { line, o } of source.rows) {
    const p = o.payload;
    if (o.type !== 'response_item' || p?.type !== 'message' || !['user', 'assistant'].includes(p.role)) continue;
    const raw = (p.content || []).filter(b => ['input_text', 'output_text'].includes(b.type)).map(b => b.text).join('\n');
    const text = (p.role === 'user' ? codexQuestionReply(raw.trim(), questions.calls, o.timestamp) || raw : raw
      .replace(/<system-reminder[^>]*>[\s\S]*?<\/system-reminder>/g, '')
      .replace(/<(local-command-[a-z]+|command-[a-z]+)>[\s\S]*?<\/\1>/g, '')).trim();
    if (!text) continue;
    const id = `x${p.id || createHash('sha256').update(session.sessionId + ':' + line).digest('hex')}`;
    if (p.role === 'user' && (internalInput(p, text) || representedWidgetInput(inputs, text, o.timestamp))) {
      items.delete(id);
      continue;
    }
    const prior = items.get(id);
    const previous = prior?.peerMethod === 'app-server-steer' && prior.text !== text ? undefined : prior;
    const origin = origins.matches.get(p.id);
    const textHash = origin || previous?.from === 'automation' ? createHash('sha256').update(text).digest('hex') : null;
    const automation = previous?.from === 'peer' || previous?.from === 'automation' && previous.automationTextSHA256 !== textHash ? null
      : origin || (previous?.from === 'automation' && previous.automationTextSHA256 === textHash ? {
        from: 'automation', automationKind: previous.automationKind, automationId: previous.automationId,
        automationProvider: previous.automationProvider, automationTransport: previous.automationTransport, automationTextSHA256: textHash,
      } : null);
    if (previous?.peerSend) usedSends.add(previous.peerSend);
    for (const send of previous?.peerSends || []) usedSends.add(send);
    let matched = !automation && p.role === 'user' && previous?.from !== 'peer' ? matchPeerInput(peers.sends, text, o.timestamp, usedSends, p.id) : [];
    if (!automation && !matched.length && p.role === 'user' && previous?.from !== 'peer') matched = matchOrchestrationInput(orchestration, text, o.timestamp, usedSends);
    let method = previous?.peerMethod;
    let sourceTool = previous?.peerSourceTool, targetTool = previous?.peerTargetTool;
    if (previous?.from === 'peer' && (!method || !sourceTool || !targetTool)) {
      // Recheck only this exact bubble's already-consumed proof IDs. This adds
      // a transport label, never reuses its receipt to classify another input.
      const ownIds = new Set([previous.peerSend, ...(previous.peerSends || [])].filter(Boolean));
      if (ownIds.size) {
        const reserved = new Set(usedSends);
        for (const proof of ownIds) reserved.delete(proof);
        let evidence = matchPeerInput(peers.sends, text, o.timestamp, reserved, p.id);
        if (!evidence.length) evidence = matchOrchestrationInput(orchestration, text, o.timestamp, reserved);
        if (evidence.length === ownIds.size && evidence.every(x => ownIds.has(x.id))) {
          method = evidence.every(x => x.method === evidence[0].method) ? evidence[0].method : undefined;
          if (evidence.every(x => x.tool === evidence[0].tool)) sourceTool = evidence[0].tool;
          targetTool = session.tool;
        }
      }
    }
    if (matched.length) {
      method = matched.every(x => x.method === matched[0].method) ? matched[0].method : undefined;
      sourceTool = matched.every(x => x.tool === matched[0].tool) ? matched[0].tool : undefined;
      targetTool = session.tool;
    }
    const sender = matched[0];
    const peer = previous?.from === 'peer' ? { from: 'peer', session: previous.session, to: previous.to, fromName: previous.fromName, peerSend: previous.peerSend, ...(previous.peerSends ? { peerSends: previous.peerSends } : {}) }
      : sender ? { from: 'peer', session: sender.session, to: session.sessionId, fromName: sender.fromName, peerSend: sender.id, peerSends: matched.map(x => x.id) } : {};
    if (peer.from === 'peer' && method) peer.peerMethod = method;
    if (peer.from === 'peer' && sourceTool) peer.peerSourceTool = sourceTool;
    if (peer.from === 'peer' && targetTool) peer.peerTargetTool = targetTool;
    if (peer.peerSend) usedSends.add(peer.peerSend);
    for (const send of peer.peerSends || []) usedSends.add(send);
    const nativeDisplay = !peer.from && !automation ? nativeDisplaySource(p, text) : undefined;
    items.set(id, { id, from: p.role === 'user' ? 'user' : 'agent', session: session.sessionId,
      context: 'terminal', agent: session.agent, text, at: o.timestamp,
      ...peer, ...automation,
      ...(nativeDisplay ? { nativeDisplay } : {}),
      ...(p.phase === 'commentary' ? { interim: true } : {}) });
  }
  const data = shortReferences(root, { items: [...items.values()].sort((a, b) => String(a.at).localeCompare(String(b.at))) });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (JSON.stringify(data) !== JSON.stringify(saved)) writeJsonAtomic(file, data);
  // Full conversation history must not evict the small native receipt cache.
  const bytes = Buffer.byteLength(JSON.stringify(data));
  displayedHistories.delete(cacheKey);
  if (bytes <= 16 * 1024 * 1024) displayedHistories.set(cacheKey, { key: `${session.path}:${source.key}:${modifiedAt(file)}:${peers.key}:${orchestration.key}:${chatKey}:${origins.key}`, data, bytes });
  while (displayedHistories.size > 16 || [...displayedHistories.values()].reduce((n, x) => n + x.bytes, 0) > 16 * 1024 * 1024) displayedHistories.delete(displayedHistories.keys().next().value);
  return display(data);
}

// Claude's ordinary conversation still comes from hooks. Read only native
// question-tool records here, including questions asked before this server ran.
export function readClaudeQuestionHistory(root, session) {
  const file = fileOf(root, session.sessionId), saved = historyOf(file);
  let source;
  try { source = readNativeMessages(session.path); } catch { return shortReferences(root, saved); }
  const items = new Map(saved.items.map(item => [item.id, item]));
  for (const item of nativeQuestionEntries(source.rows, session).items) items.set(item.id, item);
  const data = shortReferences(root, { items: [...items.values()].sort((a, b) => String(a.at).localeCompare(String(b.at))) });
  if (JSON.stringify(data) !== JSON.stringify(saved)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeJsonAtomic(file, data);
  }
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
