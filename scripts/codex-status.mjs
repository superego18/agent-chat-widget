import fs from 'node:fs';
import path from 'node:path';

const identity = st => `${st.dev}:${st.ino}:${st.birthtimeMs}`;
function toolLabel(name = '') {
  if (/^(exec|exec_command|shell|local_shell)$/.test(name)) return '명령 실행 중';
  if (name === 'apply_patch') return '파일 수정 중';
  if (name === 'read_file') return '파일 읽는 중';
  if (name.startsWith('mcp__')) return `${name.split('__')[1]} 도구 사용 중`;
  return name ? `${name} 사용 중` : '생각하는 중';
}
function reduce(state, line) {
  let o;
  try { o = JSON.parse(line); } catch { return state; }
  const p = o.payload;
  if (o.type === 'event_msg') {
    if (p?.type === 'task_started') return { state: 'working', detail: toolLabel(), startedAt: o.timestamp };
    if (p?.type === 'task_complete') return { state: 'idle', last: p.last_agent_message || '' };
    if (p?.type === 'turn_aborted') return { state: 'idle' };
  }
  if (state.state === 'working' && o.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(p?.type)) return { ...state, detail: toolLabel(String(p.name || '')) };
  return state;
}

// Keep only reduced lifecycle state and an unfinished JSONL record. Cold reads
// walk the complete file once; normal polls read appended bytes, not its history.
export function createCodexStatusReader() {
  const entries = new Map();
  return file => {
    const key = path.resolve(file);
    let fd;
    try {
      fd = fs.openSync(file, 'r');
      const st = fs.fstatSync(fd);
      const range = (start, length) => {
        const b = Buffer.alloc(length);
        let n = 0;
        while (n < length) { const count = fs.readSync(fd, b, n, length - n, start + n); if (!count) break; n += count; }
        return b.subarray(0, n);
      };
      let entry = entries.get(key);
      if (entry && (entry.identity !== identity(st) || st.size < entry.size ||
        st.size === entry.size && st.mtimeMs !== entry.mtime ||
        !range(0, entry.prefix.length).equals(entry.prefix) ||
        !range(entry.size - entry.suffix.length, entry.suffix.length).equals(entry.suffix))) entry = null;
      entry ||= { size: 0, pending: Buffer.alloc(0), state: { state: 'unknown' } };
      let state = entry.state, parts = [entry.pending], length = entry.pending.length;
      for (let offset = entry.size; offset < st.size;) {
        const bytes = range(offset, Math.min(64 * 1024, st.size - offset));
        if (!bytes.length) throw Error('Short native status read');
        offset += bytes.length;
        let start = 0;
        for (let end; (end = bytes.indexOf(10, start)) !== -1;) {
          parts.push(bytes.subarray(start, end)); length += end - start;
          state = reduce(state, Buffer.concat(parts, length).toString('utf8'));
          parts = []; length = 0; start = end + 1;
        }
        if (start < bytes.length) { parts.push(bytes.subarray(start)); length += bytes.length - start; }
      }
      const pending = Buffer.concat(parts, length);
      const prefix = range(0, Math.min(st.size, 4096));
      const suffix = range(Math.max(0, st.size - 4096), Math.min(st.size, 4096));
      const after = fs.fstatSync(fd), named = fs.statSync(file);
      if ([after, named].some(s => identity(s) !== identity(st) || s.size < st.size || s.size === st.size && s.mtimeMs !== st.mtimeMs)) throw Error('Native status source changed during read');
      entries.delete(key);
      entries.set(key, { identity: identity(st), size: st.size, mtime: st.mtimeMs, prefix, suffix, pending, state });
      while (entries.size > 64) entries.delete(entries.keys().next().value);
      // Accept complete JSON without a final newline, but never commit a partial
      // record: append reparses it from the preceding complete state (UTF-8 safe).
      return { ...reduce(state, pending.toString('utf8')), at: st.mtime.toISOString() };
    } catch { entries.delete(key); return null; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  };
}
