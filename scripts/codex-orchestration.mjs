import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const cache = new Map();
const digest = value => createHash('sha256').update(value).digest('hex');
const bound = (s, handle, at) => handle && (s.orca?.terminal === handle || s.orca?.previousTerminals?.some(x => x.terminal === handle && Date.parse(at) <= Date.parse(x.until)));
export const EVIDENCE_LIMITS = Object.freeze({ registrations: 64, registrationBytes: 8192, registryBytes: 524288,
  changedSources: 4, sourceBytes: 262144, readBytes: 1048576, lineBytes: 65536,
  sourceEvents: 256, events: 512, sourceReceipts: 16, sourceReceiptBytes: 65536,
  receipts: 128, receiptBytes: 262144, cacheEntries: 32, cacheBytes: 2097152 });

// This context belongs to one reference request or monitor tick, not each target.
export function createEvidenceContext({ io = fs } = {}) {
  return { io, registrations: 0, registryBytes: 0, changedSources: 0, readBytes: 0, events: 0,
    receipts: 0, receiptBytes: 0, registries: new Map(), sources: new Map(), projections: new Map(), partial: new Set() };
}
export function readEvidenceRegistry(root, context) {
  const key = path.resolve(root);
  if (context.registries.has(key)) return context.registries.get(key);
  const io = context.io, sessions = [], files = [];
  let dir, complete = true;
  try {
    dir = io.opendirSync(path.join(root, 'sessions'));
    for (let file; (file = dir.readSync());) {
      if (!file.isFile()) { complete = false; continue; }
      if (files.length >= EVIDENCE_LIMITS.registrations - context.registrations) { complete = false; break; }
      files.push(file.name);
    }
    for (const file of files.sort()) {
      context.registrations++;
      let fd;
      try {
        fd = io.openSync(path.join(root, 'sessions', file), 'r');
        const before = io.fstatSync(fd);
        if (!before.isFile() || before.size > EVIDENCE_LIMITS.registrationBytes || context.registryBytes + before.size > EVIDENCE_LIMITS.registryBytes) { complete = false; continue; }
        const bytes = Buffer.alloc(before.size), count = io.readSync(fd, bytes, 0, bytes.length, 0);
        context.registryBytes += count;
        const after = io.fstatSync(fd);
        const named = io.statSync(path.join(root, 'sessions', file));
        if (count !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
          incarnation(before) !== incarnation(after) || incarnation(before) !== incarnation(named) || named.size !== before.size || named.mtimeMs !== before.mtimeMs) { complete = false; continue; }
        const session = JSON.parse(bytes.toString('utf8'));
        if (session.tool === 'codex') {
          if (typeof session.sessionId !== 'string' || typeof session.path !== 'string' || sessions.some(x => x.sessionId === session.sessionId)) complete = false;
          else sessions.push(session);
        }
      } catch { complete = false; }
      finally { if (fd !== undefined) { try { io.closeSync(fd); } catch { complete = false; } } }
    }
  } catch { complete = false; }
  finally { try { dir?.closeSync(); } catch { complete = false; } }
  const result = { sessions, complete };
  context.registries.set(key, result);
  if (!complete) context.partial.add('registry');
  return result;
}
const incarnation = stat => `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
const sourceKey = (root, session) => JSON.stringify([path.resolve(root), session.sessionId, path.resolve(session.path), session.name, session.orca]);
export const cachedEvidence = key => cache.get(key);
export function storeEvidence(key, entry) {
  cache.delete(key);
  let bytes = 0;
  for (let n = 0; n < 4; n++) {
    const next = Buffer.byteLength(JSON.stringify({ ...entry, bytes }));
    if (next === bytes) break;
    bytes = next;
  }
  if (bytes > EVIDENCE_LIMITS.cacheBytes) return;
  cache.set(key, { ...entry, bytes });
  while (cache.size > EVIDENCE_LIMITS.cacheEntries || [...cache.values()].reduce((n, x) => n + x.bytes, 0) > EVIDENCE_LIMITS.cacheBytes) cache.delete(cache.keys().next().value);
}
export function evidenceCacheSnapshot() {
  return { entries: cache.size, bytes: [...cache.values()].reduce((n, x) => n + x.bytes, 0) };
}

// Only command/receipt records are cached. Native conversation text is never shortened.
export function readEvidenceRecords(root, session, context) {
  const key = sourceKey(root, session), io = context.io;
  if (context.sources.has(key)) return context.sources.get(key);
  const unknown = () => { const result = { key, rows: [], complete: false }; context.partial.add(key); context.sources.set(key, result); return result; };
  let fd;
  try {
    const stat = io.statSync(session.path);
    fd = io.openSync(session.path, 'r');
    const opened = io.fstatSync(fd);
    if (!stat.isFile() || incarnation(stat) !== incarnation(opened) || stat.size !== opened.size || stat.mtimeMs !== opened.mtimeMs) return unknown();
    let entry = cache.get(key);
    const identity = incarnation(opened);
    if (entry?.identity !== identity || opened.size < entry.size || (opened.size === entry.size && opened.mtimeMs !== entry.mtime)) entry = null;
    if (entry && entry.offset === opened.size && (entry.gap || entry.invalidEOF)) return unknown();
    if (entry && entry.offset === opened.size && entry.complete) {
      if (context.events + entry.rows.length > EVIDENCE_LIMITS.events) return unknown();
      context.events += entry.rows.length;
      const result = { key, rows: entry.rows, complete: true };
      context.sources.set(key, result); return result;
    }
    if (context.changedSources >= EVIDENCE_LIMITS.changedSources || context.events >= EVIDENCE_LIMITS.events) return unknown();
    context.changedSources++;
    entry = entry ? { ...entry, rows: [...entry.rows] } : { identity, offset: 0, index: 0, tail: '', rows: [], gap: false, prefix: null };
    // A bounded prefix detects replacement/truncation even when a new file grows.
    const prefixSize = Math.min(opened.size, 4096, entry.prefixSize || 4096);
    const prefix = Buffer.alloc(prefixSize), prefixRead = io.readSync(fd, prefix, 0, prefix.length, 0);
    context.readBytes += prefixRead;
    const prefixHash = digest(prefix.subarray(0, prefixRead));
    if (entry.prefix && entry.prefix !== prefixHash) entry = { identity, offset: 0, index: 0, tail: '', rows: [], gap: false };
    entry.prefix = prefixHash; entry.prefixSize = prefixSize;
    const amount = Math.max(0, Math.min(opened.size - entry.offset, EVIDENCE_LIMITS.sourceBytes - prefixRead, EVIDENCE_LIMITS.readBytes - context.readBytes));
    const bytes = Buffer.alloc(amount), count = io.readSync(fd, bytes, 0, amount, entry.offset);
    context.readBytes += count;
    const tail = Buffer.from(entry.tail, 'base64'), buffer = Buffer.concat([tail, bytes.subarray(0, count)]);
    const startOffset = entry.offset - tail.length;
    let cursor = 0, processed = 0, stopped = false;
    const keep = (line, index) => {
      if (line.length > EVIDENCE_LIMITS.lineBytes) { entry.gap = true; return; }
      if (!line.length) return;
      let record; try { record = JSON.parse(line.toString('utf8')); } catch { entry.gap = true; return; }
      const command = record.type === 'event_msg' && record.payload?.type === 'item_completed' ||
        record.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(record.payload?.type);
      if (command) {
        entry.rows = entry.rows.filter(x => x.index !== index);
        entry.rows.push({ record, index });
        if (entry.rows.length > EVIDENCE_LIMITS.sourceEvents) entry.rows.shift();
      }
    };
    for (let end; (end = buffer.indexOf(10, cursor)) !== -1;) {
      if (processed >= EVIDENCE_LIMITS.sourceEvents || context.events >= EVIDENCE_LIMITS.events) { stopped = true; break; }
      if (entry.dropping) entry.dropping = false;
      else keep(buffer.subarray(cursor, end), entry.index);
      entry.index++;
      processed++; context.events++; cursor = end + 1;
    }
    if (stopped) { entry.offset = startOffset + cursor; entry.tail = ''; }
    else {
      entry.offset += count;
      const rest = buffer.subarray(cursor);
      if (entry.dropping || rest.length > EVIDENCE_LIMITS.lineBytes) {
        // Discard only oversized receipt-evidence bytes, keeping the absolute
        // physical-line checkpoint; this source stays incomplete, not proof.
        entry.tail = ''; entry.gap = true; entry.dropping = true;
      } else entry.tail = rest.toString('base64');
    }
    const after = io.fstatSync(fd), named = io.statSync(session.path);
    if (incarnation(after) !== identity || incarnation(named) !== identity || after.size !== opened.size || named.size !== opened.size || after.mtimeMs !== opened.mtimeMs || named.mtimeMs !== opened.mtimeMs) { cache.delete(key); return unknown(); }
    entry.size = opened.size; entry.mtime = opened.mtimeMs;
    entry.invalidEOF = false;
    entry.complete = !stopped && entry.offset === opened.size && !entry.gap;
    const last = Buffer.from(entry.tail, 'base64');
    if (entry.complete && last.length) {
      try { JSON.parse(last.toString('utf8')); }
      catch { entry.complete = false; entry.invalidEOF = true; }
      if (entry.complete && processed < EVIDENCE_LIMITS.sourceEvents && context.events < EVIDENCE_LIMITS.events) { keep(last, entry.index); context.events++; }
      else if (entry.complete) entry.complete = false;
    }
    storeEvidence(key, entry);
    const result = { key, rows: entry.complete ? entry.rows : [], complete: entry.complete };
    if (!entry.complete) context.partial.add(key);
    context.sources.set(key, result); return result;
  } catch { cache.delete(key); return unknown(); }
  finally { if (fd !== undefined) { try { io.closeSync(fd); } catch { context.partial.add(key); } } }
}
export function takeEvidenceReceipt(context, source, value) {
  const text = JSON.stringify(value), bytes = Buffer.byteLength(text), id = digest(text);
  let budget = context.projections.get(source);
  if (!budget) { budget = { ids: new Set(), count: 0, bytes: 0 }; context.projections.set(source, budget); }
  if (budget.ids.has(id)) return true;
  if (budget.count >= EVIDENCE_LIMITS.sourceReceipts || budget.bytes + bytes > EVIDENCE_LIMITS.sourceReceiptBytes ||
    context.receipts >= EVIDENCE_LIMITS.receipts || context.receiptBytes + bytes > EVIDENCE_LIMITS.receiptBytes) { context.partial.add(source); return false; }
  budget.ids.add(id); budget.count++; budget.bytes += bytes; context.receipts++; context.receiptBytes += bytes;
  return true;
}
function* documents(text) {
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (start === -1) {
      if (c !== '{' || i && text[i - 1] !== '\n') continue;
      start = i; depth = 1; quoted = false; escaped = false; continue;
    }
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { yield JSON.parse(text.slice(start, i + 1)); } catch {}
      start = -1;
    }
  }
}

function orchestrationCommand(cmd) {
  return typeof cmd === 'string' && /(?:^|[;\r\n])\s*(?:&\s*)?(?:'[^'\r\n]*[\\/]orca(?:-dev|-ide)?\.(?:exe|cmd)'|"[^"\r\n]*[\\/]orca(?:-dev|-ide)?\.(?:exe|cmd)"|orca(?:-dev|-ide)?(?:\.(?:exe|cmd))?)\s+orchestration\s+(?:check|task-create|worker-start|worker-show|dispatch|dispatch-show)\b/.test(cmd);
}
const fields = (value, keys) => Object.fromEntries(keys.filter(k => value?.[k] !== undefined).map(k => [k, value[k]]));
// Keep only fields used to prove transport identity; mailbox bodies are neither
// displayed as native input nor retained in the background provenance index.
export function projectOrchestrationRecord(record) {
  const item = record.type === 'event_msg' && record.payload?.type === 'item_completed' && record.payload.item;
  if (item?.type !== 'CommandExecution' || item.exit_code !== 0 || !Array.isArray(item.command) || !orchestrationCommand(item.command.at(-1))) return null;
  const receipts = [];
  for (const value of documents(item.aggregated_output || '')) {
    const r = value.ok === true && value.result;
    if (!r || typeof r !== 'object') continue;
    const result = fields(r, ['deliveryId', 'count', 'runId', 'dispatchId', 'taskId', 'stage']);
    if (Array.isArray(r.messages)) result.messages = r.messages.map(m => fields(m, ['id', 'from_handle', 'to_handle', 'created_at', 'from']));
    if (Array.isArray(r.effects)) result.effects = r.effects.map(e => fields(e, ['kind', 'id', 'state']));
    if (r.task) result.task = fields(r.task, ['id', 'run_id', 'spec', 'created_by_terminal_handle']);
    if (r.dispatch) result.dispatch = fields(r.dispatch, ['id', 'taskId', 'task_id', 'runId', 'assigneeHandle']);
    if (Object.keys(result).length) receipts.push({ ok: true, result });
  }
  if (!receipts.length) return null;
  return { timestamp: record.timestamp, type: 'event_msg', payload: { type: 'item_completed', item: {
    type: 'CommandExecution', command: item.command, exit_code: item.exit_code, aggregated_output: receipts.map(x => JSON.stringify(x)).join('\n'),
  } } };
}

export function readOrchestrationEvidence(root, target, context = createEvidenceContext()) {
  const registry = readEvidenceRegistry(root, context), results = [];
  let complete = registry.complete;
  for (const session of registry.sessions) {
    const source = context.peerSources ? context.peerSources.read(session) : readEvidenceRecords(root, session, context);
    if (!source.complete) { complete = false; continue; }
    // Spend the bounded receipt budget on current deliveries, not the first
    // historical checks in a long-lived session. Existing proven history stays.
    for (const { record } of [...source.rows].reverse()) {
      const item = record.type === 'event_msg' && record.payload?.type === 'item_completed' && record.payload.item;
      if (item?.type !== 'CommandExecution' || item.exit_code !== 0 || !Array.isArray(item.command)) continue;
      const cmd = item.command.at(-1);
      if (!orchestrationCommand(cmd)) continue;
      for (const value of documents(item.aggregated_output || '')) if (value.ok === true && value.result) {
        const receipt = { result: value.result, cmd, at: record.timestamp };
        if (takeEvidenceReceipt(context, source.key, receipt)) results.push({ ...receipt, session });
      }
    }
  }
  results.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { key: digest(JSON.stringify([results, complete])), sessions: registry.sessions, results, target, complete };
}
function literalOption(cmd, name, valuePattern) {
  return new RegExp(`--${name}\\s+(['"]?)(${valuePattern})\\1(?=\\s|$)`).exec(cmd)?.[2];
}
function mailboxWake(text) {
  const parts = text.split(/\r?\n[ \t]*\r?\n/).map(part => /^You have (\d+) orchestration messages?\. Run `orca orchestration check(?: --run (run_[\w-]+))?`\.$/.exec(part));
  if (parts.some(p => !p) || parts.some(p => p[2] !== parts[0][2])) return null;
  return { count: parts.reduce((n, p) => n + Number(p[1]), 0), run: parts[0][2] };
}
export function matchOrchestrationInput(evidence, text, at, used) {
  if (evidence.complete === false) return [];
  const { results, sessions, target } = evidence;
  const wrap = (session, id, time, method) => ({ id: `orca:${id}`, session: session.sessionId, fromName: session.name, tool: session.tool, at: time, method });
  const wake = mailboxWake(text);
  if (wake) {
    for (const receipt of results) {
      if (receipt.session.sessionId !== target.sessionId || !Array.isArray(receipt.result.messages) || !/\borchestration\s+check\b/.test(receipt.cmd)) continue;
      const age = Date.parse(receipt.at) - Date.parse(at), messages = receipt.result.messages;
      const run = receipt.result.runId || literalOption(receipt.cmd, 'run', 'run_[\\w-]+');
      if (age < 0 || age > 60_000 || messages.length !== wake.count || (wake.run && wake.run !== run)) continue;
      const terminal = literalOption(receipt.cmd, 'terminal', 'term_[\\w-]+');
      if (/--terminal\b/.test(receipt.cmd) && !terminal) continue;
      if (terminal && !bound(target, terminal, at)) continue;
      if (!receipt.result.deliveryId) {
        // Current Orca returns a compact mailbox projection. Its successful
        // check in this exact provider proves observation, not a send timestamp.
        // Never synthesize missing delivery IDs, destinations or creation times.
        if (!messages.length || messages.some(m => !/^msg_[\w-]+$/.test(m.id || '') ||
          !/^term_[\w-]+$/.test(m.from || '') || bound(target, m.from, at) || m.from === terminal)) continue;
        if (new Set(messages.map(m => m.id)).size !== messages.length) continue;
        const senders = messages.map(m => sessions.filter(s => s.sessionId !== target.sessionId && bound(s, m.from, at)));
        if (senders.some(s => s.length > 1)) continue;
        const sender = senders.every(s => s.length === 1 && s[0].sessionId === senders[0][0]?.sessionId) ? senders[0][0] : { name: '다른 세션' };
        const matched = messages.map(m => wrap(sender, m.id, receipt.at, 'mailbox'));
        if (matched.every(m => !used.has(m.id))) return matched;
        continue;
      }
      const senders = messages.map(m => {
        if (!m.id || Date.parse(m.created_at) > Date.parse(at) || !Number.isFinite(Date.parse(m.created_at))) return null;
        if (!bound(target, m.to_handle, at) && m.to_handle !== `dispatch:${receipt.result.dispatchId}` && m.to_handle !== `run:${receipt.result.runId}`) return null;
        if (bound(target, m.from_handle, m.created_at) || m.from_handle === m.to_handle || m.from_handle === `dispatch:${receipt.result.dispatchId}` || !/^(?:term_[\w-]+|dispatch:ctx_[\w-]+|run:run_[\w-]+)$/.test(m.from_handle || '')) return null;
        const matches = sessions.filter(s => s.sessionId !== target.sessionId && bound(s, m.from_handle, m.created_at));
        return matches.length === 1 ? matches[0] : matches.length === 0 ? { name: '다른 세션' } : null;
      });
      if (senders.some(s => !s)) continue;
      const sender = senders.every(s => s.sessionId && s.sessionId === senders[0].sessionId) ? senders[0] : { name: '다른 세션' };
      const matched = messages.map(m => wrap(sender, m.id, m.created_at, 'mailbox'));
      if (matched.every(m => !used.has(m.id))) return matched;
    }
  }
  const preamble = text.replace(/^You have \d+ orchestration messages?\. Run `orca orchestration check(?: --run run_[\w-]+)?`\.\n\n/, '');
  if (!preamble.startsWith('You are working inside Orca, a multi-agent IDE. You are a dispatched worker.\n')) return [];
  const coordinator = /^Your coordinator's terminal handle is: (term_[\w-]+)$/m.exec(preamble)?.[1];
  const taskId = /^Your task ID is: (task_[\w-]+)$/m.exec(preamble)?.[1];
  const dispatchId = /--dispatch-id\s+(ctx_[\w-]+)/.exec(preamble)?.[1];
  const spec = preamble.split('\n=== TASK ===\n')[1]?.trim();
  if (!coordinator || !taskId || !dispatchId || !spec) return [];
  for (const receipt of results) {
    const accepted = receipt.result;
    if (accepted.taskId === taskId && accepted.dispatchId === dispatchId && accepted.stage === 'input_accepted' && bound(receipt.session, coordinator, at)) {
      const age = Date.parse(at) - Date.parse(receipt.at);
      const terminal = /--terminal\s+(term_[\w-]+)/.exec(receipt.cmd)?.[1];
      // Only literal PowerShell single-quoted specs are supported; never evaluate shell variables or files.
      const literal = /\borchestration\s+worker-start\b/.test(receipt.cmd) && /--spec\s+'((?:[^']|'')*)'(?=\s|$)/.exec(receipt.cmd)?.[1];
      const taskSpec = results.find(r => r.session.sessionId === receipt.session.sessionId && r.result.task?.id === taskId && r.result.task.created_by_terminal_handle === coordinator)?.result.task.spec;
      const acceptedSpec = typeof literal === 'string' ? literal.replaceAll("''", "'") : taskSpec;
      if (age >= -60_000 && age <= 86_400_000 && typeof acceptedSpec === 'string' && acceptedSpec.trim() === spec && bound(target, terminal, at) && accepted.effects?.some(e => e.kind === 'dispatch_input' && e.id === terminal && e.state === 'accepted')) {
        const matched = wrap(receipt.session, dispatchId, receipt.at, 'dispatch');
        if (!used.has(matched.id)) return [matched];
      }
    }
    const task = receipt.result.task, age = Date.parse(at) - Date.parse(receipt.at);
    if (age < 0 || age > 86_400_000 || task?.id !== taskId || task.spec?.trim() !== spec || task.created_by_terminal_handle !== coordinator || !bound(receipt.session, coordinator, at)) continue;
    if (!results.some(r => r.session.sessionId === receipt.session.sessionId && r.result.dispatch?.id === dispatchId && (r.result.dispatch.taskId || r.result.dispatch.task_id) === taskId && r.result.dispatch.runId === task.run_id && bound(target, r.result.dispatch.assigneeHandle, at))) continue;
    const matched = wrap(receipt.session, dispatchId, receipt.at, 'dispatch');
    if (!used.has(matched.id)) return [matched];
  }
  return [];
}
