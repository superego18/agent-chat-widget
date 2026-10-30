import fs from 'node:fs';
import path from 'node:path';

const cache = new Map();

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

export function readPeerSends(root, target) {
  const sends = new Map(), keys = [];
  let files;
  try { files = fs.readdirSync(path.join(root, 'sessions')).sort(); } catch { return { sends, key: '' }; }
  for (const file of files) {
    let session, stat;
    try {
      session = JSON.parse(fs.readFileSync(path.join(root, 'sessions', file), 'utf8'));
      if (session.tool !== 'codex' || session.sessionId === target.sessionId) continue;
      stat = fs.statSync(session.path);
    } catch { continue; }
    const key = `${session.sessionId}:${session.name}:${stat.size}:${stat.mtimeMs}`;
    keys.push(key);
    let entries = cache.get(session.path);
    if (entries?.key !== key) {
      const items = [];
      const records = fs.readFileSync(session.path, 'utf8').split('\n').map(line => { try { return JSON.parse(line); } catch { return null; } });
      const calls = records.flatMap((record, index) => record?.type === 'response_item' ? commands(record.payload || {}).map((cmd, commandIndex) => ({ cmd, index, commandIndex, at: Date.parse(record.timestamp) })) : []);
      for (const result of records.filter(Boolean).map(receipt).filter(Boolean).sort((a, b) => a.start - b.start)) {
        const call = calls.filter(c => c.cmd === result.cmd && !c.result && c.at <= result.start).at(-1);
        if (call) call.result = result;
      }
      for (const [index, record] of records.entries()) {
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
      entries = { key, items };
      cache.set(session.path, entries);
    }
    for (const item of entries.items) {
      if (item.terminal !== target.orca?.terminal && !(target.orca?.previousTerminals || []).some(b => b.terminal === item.terminal && Date.parse(item.at) <= Date.parse(b.until))) continue;
      const list = sends.get(item.text) || [];
      list.push(item);
      sends.set(item.text, list);
    }
  }
  return { sends, key: `${JSON.stringify(target.orca || {})}:${keys.join('|')}` };
}

// Cover the entire native input using ordered sends by one sender. Never discard owner-added text.
export function matchPeerInput(sends, text, at, used) {
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
