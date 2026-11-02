import { createHash } from 'node:crypto';
import { createEvidenceContext, readEvidenceRegistry, readEvidenceRecords, takeEvidenceReceipt } from './codex-orchestration.mjs';

export function nextOrcaBinding(previous, terminal, at) {
  if (!terminal || terminal === previous?.terminal) return previous;
  return { terminal, ...(previous?.terminal ? { previousTerminals: [...(previous.previousTerminals || []), { terminal: previous.terminal, until: at }] } : {}) };
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

export function readPeerSends(root, target, context = createEvidenceContext()) {
  const sends = new Map(), registry = readEvidenceRegistry(root, context);
  sends.complete = registry.complete;
  for (const session of registry.sessions) {
    if (session.sessionId === target.sessionId) continue;
    const source = readEvidenceRecords(root, session, context);
    if (!source.complete) continue;
    const items = [], records = source.rows;
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
          const pattern = /(?:^|[;\r\n])\s*(?:&\s*)?(?:"[^"\r\n]*[\\/]orca(?:-dev|-ide)?\.(?:exe|cmd)"|orca(?:-dev|-ide)?(?:\.(?:exe|cmd))?)\s+terminal\s+send\s+[^;\r\n]*?--text\s+('(?:[^']|'')*'|"(?:`.|[^"`])*")(?=\s)(?=[^;\r\n]*--enter\b)/g;
          for (const match of cmd.matchAll(pattern)) {
            const terminal = /--terminal\s+(term_[\w-]+)/.exec(match[0])?.[1];
            if (!terminal) continue;
            const literal = match[1];
            if (literal[0] === '"' && /[$\\]/.test(literal)) continue; // Expanded shell values need explicit transport metadata.
            const escapes = { '0': '\0', a: '\x07', b: '\b', e: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };
            const text = (literal[0] === "'" ? literal.slice(1, -1).replaceAll("''", "'") : literal.slice(1, -1).replace(/`(.)/g, (_, c) => escapes[c] ?? c)).trim();
            const accepted = result?.accepted === true && result.terminal === terminal;
            if (text) items.push({ text, terminal, accepted, id: `${session.sessionId}:${index}:${commandIndex}:${match.index}`, session: session.sessionId, fromName: session.name, at: record.timestamp });
          }
        }
      }
    for (const item of items) {
      if (item.terminal !== target.orca?.terminal && !(target.orca?.previousTerminals || []).some(b => b.terminal === item.terminal && Date.parse(item.at) <= Date.parse(b.until))) continue;
      if (!takeEvidenceReceipt(context, source.key, item)) continue;
      const list = sends.get(item.text) || [];
      list.push(item); sends.set(item.text, list);
    }
  }
  return { sends, key: createHash('sha256').update(JSON.stringify([target.orca, [...sends], registry.complete])).digest('hex'), complete: registry.complete };
}
// Cover the entire native input using ordered sends by one sender. Never discard owner-added text.
export function matchPeerInput(sends, text, at, used) {
  if (sends.complete === false) return [];
  const candidates = [...sends].map(([part, evidence]) => [part, evidence.filter(e => {
    const age = Date.parse(at) - Date.parse(e.at);
    return !used.has(e.id) && age >= 0 && age <= (e.accepted ? 86_400_000 : 60_000);
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
