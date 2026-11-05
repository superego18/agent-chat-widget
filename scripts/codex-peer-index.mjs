import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectOrchestrationRecord } from './codex-orchestration.mjs';
import { rpcPeerScripts } from './codex-peers.mjs';

const identity = s => `${s.dev}:${s.ino}:${s.birthtimeMs}`;
const stamp = s => `${identity(s)}:${s.size}:${s.mtimeMs}`;
const LINE_LIMIT = 4 * 1024 * 1024, CACHE_LIMIT = 2 * 1024 * 1024;

// Long rollouts contain large tool output, not just transport receipts. Build a
// peer-only index asynchronously; never turn a skipped/partial record
// into positive provenance. No provider process or transcript writes are used.
export function createPeerSourceIndex() {
  const entries = new Map(), jobs = new Map();
  let closed = false;
  async function update(file, previous) {
    let fd;
    try {
      fd = await fs.promises.open(file, 'r');
      const st = await fd.stat();
      const range = async (start, length) => {
        const b = Buffer.alloc(length); let count = 0;
        while (count < length) { const {bytesRead} = await fd.read(b, count, length-count, start+count); if (!bytesRead) break; count += bytesRead; }
        return b.subarray(0,count);
      };
      let old = previous;
      if (old && (identity(st) !== old.identity || st.size < old.size || st.size === old.size && st.mtimeMs !== old.mtime ||
        !(await range(0,old.prefix.length)).equals(old.prefix) ||
        !(await range(old.size-old.suffix.length,old.suffix.length)).equals(old.suffix))) old = null;
      const rows = [...(old?.rows || [])];
      const rpcScripts = new Set(rows.flatMap(({ record }) => rpcPeerScripts(record)).map(s => path.resolve(s.file)));
      let index = old?.index || 0, pending = old?.pending || Buffer.alloc(0);
      const keep = bytes => {
        const rowIndex = index++;
        if (!bytes.length) return;
        const record = JSON.parse(bytes.toString('utf8'));
        if (!Number.isFinite(Date.parse(record.timestamp))) throw Error('Unknown native timestamp');
        const p=record.payload;
        const scripts = rpcPeerScripts(record);
        if (scripts.length) {
          for (const s of scripts) rpcScripts.add(path.resolve(s.file));
          rows.push({ index: rowIndex, record });
          return;
        }
        // Filter by the native envelope, not by quoted content in messages.
        if (record.type==='response_item' && ['function_call','custom_tool_call'].includes(p?.type) ||
          record.type==='event_msg' && p?.type==='item_completed' && p.item?.type==='CommandExecution') {
          const projected = projectOrchestrationRecord(record);
          if (projected) rows.push({index:rowIndex,record:projected});
          else if (bytes.includes(Buffer.from('terminal send')) || bytes.includes(Buffer.from('terminal\\nsend'))) rows.push({index:rowIndex,record});
          else if (p?.item?.type === 'CommandExecution') {
            try {
              const command = /^node\s+(?:'([^'\r\n]+)'|"([^"\r\n]+)"|([^\s'"`$]+))\s*$/.exec(p.item.command?.at(-1) || '');
              const cwd = p.item.cwd?.startsWith('file:') ? fileURLToPath(p.item.cwd) : p.item.cwd;
              if (command && cwd && rpcScripts.has(path.resolve(cwd, command[1] || command[2] || command[3]))) rows.push({ index: rowIndex, record });
            } catch {} // Invalid command/cwd is not a supported RPC-script receipt.
          }
        }
      };
      for (let offset=old?.size || 0; offset<st.size;) {
        if (closed) throw Error('Peer index closing');
        const bytes=await range(offset,Math.min(64*1024,st.size-offset));
        if (!bytes.length) throw Error('Short peer source read');
        offset+=bytes.length;
        const buffer=Buffer.concat([pending,bytes]); let start=0;
        for(let end;(end=buffer.indexOf(10,start))!==-1;) {
          if(end-start>LINE_LIMIT) throw Error('Peer source record exceeds memory bound');
          keep(buffer.subarray(start,end));start=end+1;
        }
        pending=Buffer.from(buffer.subarray(start));
        if(pending.length>LINE_LIMIT)throw Error('Peer source record exceeds memory bound');
      }
      const prefix=await range(0,Math.min(st.size,4096));
      const suffix=await range(Math.max(0,st.size-4096),Math.min(st.size,4096));
      const after=await fd.stat(),named=await fs.promises.stat(file);
      if([after,named].some(s=>identity(s)!==identity(st)||s.size<st.size||s.size===st.size&&s.mtimeMs!==st.mtimeMs))throw Error('Peer source changed during read');
      // An unfinished record is not proof. Reparse it after its next append.
      let finalRows=rows;
      if(pending.length) {
        try {JSON.parse(pending.toString('utf8'));}catch {throw Error('Incomplete peer source record');}
        const length=rows.length, committedIndex=index;
        keep(pending);finalRows=rows.slice();rows.length=length;index=committedIndex;
      }
      const bytes=Buffer.byteLength(JSON.stringify(finalRows));
      if(bytes>CACHE_LIMIT||finalRows.length>2048)throw Error('Peer receipt projection exceeds memory bound');
      entries.delete(file);
      entries.set(file,{key:stamp(st),identity:identity(st),size:st.size,mtime:st.mtimeMs,prefix,suffix,pending,index,rows:[...rows],finalRows,bytes});
      while(entries.size>32||[...entries.values()].reduce((n,e)=>n+e.bytes+e.pending.length,0)>8*1024*1024)entries.delete(entries.keys().next().value);
    } catch {entries.delete(file);}
    finally {try{await fd?.close();}catch{entries.delete(file);}}
  }
  return {
    read(session) {
      const file=path.resolve(session.path);
      let st;try{st=fs.statSync(file);}catch{return {key:file,rows:[],complete:false};}
      const entry=entries.get(file);
      if(entry?.key===stamp(st))return {key:entry.key,rows:entry.finalRows,complete:true};
      if(!closed&&!jobs.has(file)&&jobs.size<2) {
        const job=update(file,entry).finally(()=>jobs.delete(file));jobs.set(file,job);
      }
      return {key:file,rows:[],complete:false};
    },
    async shutdown() {closed=true;await Promise.all([...jobs.values()]);entries.clear();},
  };
}
