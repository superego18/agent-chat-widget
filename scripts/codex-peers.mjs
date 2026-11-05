import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEvidenceContext, readEvidenceRegistry, readEvidenceRecords, takeEvidenceReceipt } from './codex-orchestration.mjs';

export function nextOrcaBinding(previous, terminal, at) {
  if (!terminal || terminal === previous?.terminal) return previous;
  return { terminal, ...(previous?.terminal ? { previousTerminals: [...(previous.previousTerminals || []), { terminal: previous.terminal, until: at }] } : {}) };
}

// One supported, literal RPC-script shape. Never evaluate provider code or
// infer a sender from coordination-like prose. Unsupported scripts stay unknown.
export function rpcPeerScripts(record) {
  const item = record.type === 'event_msg' && record.payload?.type === 'item_completed' && record.payload.item;
  if (item?.type !== 'FileChange' || item.status !== 'completed') return [];
  return Object.entries(item.changes || {}).flatMap(([file, change]) => {
    const content = change?.content;
    if (change?.type !== 'add' || typeof content !== 'string' || content.length > 16384 || !path.isAbsolute(file) ||
      !content.includes('withCodexRpc(config.command,async call=>') || !/const cid\s*=\s*randomUUID\(\)/.test(content) ||
      !content.includes('clientUserMessageId:cid') || (content.match(/call\('turn\/steer'/g) || []).length !== 1) return [];
    const text = /input:\[\{type:'text',text:'([^'\\]*)'\}\]/.exec(content)?.[1];
    const receipt = /fs\.writeFileSync\(path\.join\(dir,'([\w.-]+\.json)'\),JSON\.stringify\(\{at:new Date\(\)\.toISOString\(\),cid,sameTurnOnly:true,receipt\}/.exec(content)?.[1];
    return text && receipt ? [{ file, text, receipt, at: record.timestamp }] : [];
  });
}

function rpcPeerSends(root, target, sender, records, nativeRows) {
  const scripts = records.flatMap(({ record }) => rpcPeerScripts(record)).slice(-16);
  if (!scripts.length) return [];
  const project = fs.realpathSync(path.dirname(root)), results = [];
  const canonical = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
  const inside = file => { const relative = path.relative(project, file); return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
  const hash = text => createHash('sha256').update(text.trim()).digest('hex');
  for (const script of scripts) {
    try {
      if (!inside(path.resolve(script.file))) continue;
      const file = fs.realpathSync(path.join(path.dirname(script.file), script.receipt));
      if (!inside(file) || fs.statSync(file).size > 16384) continue;
      const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!/^[0-9a-f-]{36}$/.test(receipt.cid || '') || receipt.sameTurnOnly !== true || typeof receipt.receipt?.turnId !== 'string' || !Number.isFinite(Date.parse(receipt.at))) continue;
      const executions = records.filter(({ record }) => {
        const p = record.payload, item = p?.item;
        if (record.type !== 'event_msg' || p?.type !== 'item_completed' || item?.type !== 'CommandExecution' || item.exit_code !== 0 || item.status !== 'completed' || !Array.isArray(item.command)) return false;
        const command = /^node\s+(?:'([^'\r\n]+)'|"([^"\r\n]+)"|([^\s'"`$]+))\s*$/.exec(item.command.at(-1));
        if (!command) return false;
        const cwd = item.cwd?.startsWith('file:') ? fileURLToPath(item.cwd) : item.cwd;
        if (!cwd || canonical(cwd) !== canonical(project) || canonical(path.resolve(cwd, command[1] || command[2] || command[3])) !== canonical(script.file)) return false;
        const start = p.started_at_ms;
        if (!Number.isFinite(start) || Date.parse(script.at) > start || Date.parse(receipt.at) < start || Date.parse(receipt.at) > Date.parse(record.timestamp)) return false;
        let output; try { output = JSON.parse(item.aggregated_output); } catch { return false; }
        return output?.turnId === receipt.receipt.turnId;
      });
      if (executions.length !== 1) continue;
      const accepted = nativeRows.filter(({ o }) => o.type === 'event_msg' && o.payload?.item?.type === 'UserMessage' &&
        o.payload.thread_id === target.sessionId && o.payload.turn_id === receipt.receipt.turnId && o.payload.item.client_id === receipt.cid && o.payload.item.textSHA256 === hash(script.text));
      if (accepted.length !== 1) continue;
      const inputs = nativeRows.filter(({ o }) => {
        const p = o.payload;
        return o.type === 'response_item' && p?.type === 'message' && p.role === 'user' && typeof p.id === 'string' &&
          p.internal_chat_message_metadata_passthrough?.turn_id === receipt.receipt.turnId &&
          Date.parse(o.timestamp) >= Date.parse(receipt.at) && Math.abs(Date.parse(o.timestamp) - Date.parse(accepted[0].o.timestamp)) <= 5000 &&
          hash((p.content || []).filter(c => c.type === 'input_text').map(c => c.text).join('\n')) === hash(script.text);
      });
      if (inputs.length !== 1) continue;
      results.push({ text: script.text.trim(), target: target.sessionId, nativeInputId: inputs[0].o.payload.id, accepted: true,
        method: 'app-server-steer', tool: sender.tool, id: `rpc:${sender.sessionId}:${receipt.cid}`, session: sender.sessionId, fromName: sender.name, at: executions[0].record.timestamp });
    } catch {} // Missing/replaced receipts and unsupported shapes never prove a send.
  }
  return results;
}

// A successful CLI receipt permits queued delivery; absent receipts keep the short legacy window.
function receipt(record) {
  const item = record.type === 'event_msg' && record.payload?.type === 'item_completed' && record.payload.item;
  const start = record.payload?.started_at_ms ?? item?.started_at_ms;
  if (item?.type !== 'CommandExecution' || !Array.isArray(item.command) || !Number.isFinite(start)) return null;
  let result;
  try { result = JSON.parse(item.aggregated_output); } catch {}
  const send = result?.ok === true && result.result?.send;
  return { cmd: item.command.at(-1), start, failed: item.exit_code !== 0 || result?.ok === false || send?.accepted === false,
    terminal: send?.handle, accepted: item.exit_code === 0 && send?.accepted === true && !!send.prompt?.requestId };
}

// Read literal commands only; never execute transcript code or infer a sender from a name prefix.
function commands(payload) {
  if (payload.type === 'function_call' && /(?:^|\.)exec_command$/.test(payload.name)) {
    try { return [JSON.parse(payload.arguments).cmd].filter(x => typeof x === 'string'); } catch { return []; }
  }
  if (payload.type !== 'custom_tool_call' || !/(?:^|\.)exec$/.test(payload.name)) return [];
  return [...String(payload.input).matchAll(/\bexec_command\(\s*\{\s*(?:"cmd"|cmd)\s*:\s*("(?:\\.|[^"\\])*")/g)]
    .flatMap(m => { try { return [JSON.parse(m[1])]; } catch { return []; } });
}

export function readPeerSends(root, target, context = createEvidenceContext(), nativeRows = []) {
  const sends = new Map(), registry = readEvidenceRegistry(root, context);
  sends.complete = registry.complete;
  for (const session of registry.sessions) {
    if (session.sessionId === target.sessionId) continue;
    const source = context.peerSources ? context.peerSources.read(session) : readEvidenceRecords(root, session, context);
    if (!source.complete) sends.complete = false;
    if (!source.complete) continue;
    const records = source.rows, items = rpcPeerSends(root, target, session, records, nativeRows);
    const calls = records.flatMap(({ record, index }) => record?.type === 'response_item' ? commands(record.payload || {}).map((cmd, commandIndex) => ({ cmd, index, commandIndex, at: Date.parse(record.timestamp) })) : []);
      for (const result of records.map(x => x.record).filter(Boolean).map(receipt).filter(Boolean).sort((a, b) => a.start - b.start)) {
        const call = calls.filter(c => c.cmd === result.cmd && !c.result && c.at <= result.start).at(-1);
        if (call) call.result = result;
      }
      for (const { index, record } of records) {
        if (!record) continue;
        if (record.type !== 'response_item' || !record.payload) continue;
        for (const [commandIndex, cmd] of commands(record.payload).entries()) {
          const result = calls.find(c => c.index === index && c.commandIndex === commandIndex)?.result;
          if (result?.failed) continue;
          const pattern = /(?:^|[;\r\n])\s*(?:&\s*)?(?:'[^'\r\n]*[\\/]orca(?:-dev|-ide)?\.(?:exe|cmd)'|"[^"\r\n]*[\\/]orca(?:-dev|-ide)?\.(?:exe|cmd)"|orca(?:-dev|-ide)?(?:\.(?:exe|cmd))?)\s+terminal\s+send\s+[^;\r\n]*?--text\s+('(?:[^']|'')*'|"(?:`.|[^"`])*")(?=\s)(?=[^;\r\n]*--enter\b)/g;
          for (const match of cmd.matchAll(pattern)) {
            const terminal = /--terminal\s+(term_[\w-]+)/.exec(match[0])?.[1];
            if (!terminal) continue;
            const literal = match[1];
            if (literal[0] === '"' && /[$\\]/.test(literal)) continue; // Expanded shell values need explicit transport metadata.
            const escapes = { '0': '\0', a: '\x07', b: '\b', e: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };
            const text = (literal[0] === "'" ? literal.slice(1, -1).replaceAll("''", "'") : literal.slice(1, -1).replace(/`(.)/g, (_, c) => escapes[c] ?? c)).trim();
            const accepted = result?.accepted === true && result.terminal === terminal;
            if (text) items.push({ text, terminal, accepted, method: 'terminal', tool: session.tool, id: `${session.sessionId}:${index}:${commandIndex}:${match.index}`, session: session.sessionId, fromName: session.name, at: record.timestamp });
          }
        }
      }
    for (const item of items) {
      if (item.target ? item.target !== target.sessionId : item.terminal !== target.orca?.terminal && !(target.orca?.previousTerminals || []).some(b => b.terminal === item.terminal && Date.parse(item.at) <= Date.parse(b.until))) continue;
      if (!takeEvidenceReceipt(context, source.key, item)) continue;
      const list = sends.get(item.text) || [];
      list.push(item); sends.set(item.text, list);
    }
  }
  return { sends, key: createHash('sha256').update(JSON.stringify([target.orca, [...sends], sends.complete])).digest('hex'), complete: sends.complete };
}
// Cover the entire native input using ordered sends by one sender. Never discard owner-added text.
export function matchPeerInput(sends, text, at, used, nativeId) {
  if (sends.complete === false) return [];
  const candidates = [...sends].map(([part, evidence]) => [part, evidence.filter(e => {
    const age = Date.parse(at) - Date.parse(e.at);
    return (!e.nativeInputId || e.nativeInputId === nativeId) && !used.has(e.id) && age >= 0 && age <= (e.accepted ? 86_400_000 : 60_000);
  })]).filter(([, evidence]) => evidence.length);
  const solutions = [];
  let remaining = 2000;
  function visit(offset, matched) {
    if (--remaining < 0 || solutions.length > 1) return;
    if (offset === text.length) { solutions.push(matched); return; }
    for (const [part, evidence] of candidates) {
      if (!text.startsWith(part, offset)) continue;
      const eligible = evidence.filter(e => !matched.some(m => m.id === e.id) && (!matched.length || (e.session === matched[0].session && Date.parse(e.at) >= Date.parse(matched.at(-1).at))));
      for (const sender of new Set(eligible.map(e => e.session))) {
        const item = eligible.find(e => e.session === sender);
        let end = offset + part.length;
        if (end < text.length) {
          const separator = /^\s+/.exec(text.slice(end));
          if (!separator) continue;
          end += separator[0].length;
        }
        visit(end, [...matched, item]);
      }
    }
  }
  visit(0, []);
  return remaining >= 0 && solutions.length === 1 ? solutions[0] : [];
}
