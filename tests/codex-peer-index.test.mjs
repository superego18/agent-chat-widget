import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createPeerSourceIndex} from '../scripts/codex-peer-index.mjs';
import {createEvidenceContext} from '../scripts/codex-orchestration.mjs';
import {readCodexHistory} from '../scripts/transcript-store.mjs';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'widget-peer-index-'));
  const index=createPeerSourceIndex();
  fs.mkdirSync(path.join(root,'sessions'));
  const source={sessionId:'source',tool:'codex',name:'Source',path:path.join(root,'source.jsonl')};
  const target={sessionId:'target',tool:'codex',name:'Target',path:path.join(root,'target.jsonl'),orca:{terminal:'term_target'}};
  for(const s of [source,target])fs.writeFileSync(path.join(root,'sessions',s.sessionId+'.json'),JSON.stringify(s));
  const now=Date.now(),at=n=>new Date(now+n).toISOString();
  const text='Actual synthetic peer report';
  const cmd=`& 'C:/Programs/Orca/orca.exe' terminal send --terminal term_target --text '${text}' --enter --json`;
  const call={timestamp:at(-1000),type:'response_item',payload:{type:'custom_tool_call',name:'exec',input:`text(await tools.exec_command(${JSON.stringify({cmd})}));`}};
  const receipt={timestamp:at(-500),type:'event_msg',payload:{type:'item_completed',started_at_ms:now-900,item:{type:'CommandExecution',command:['powershell','-Command',cmd],exit_code:0,aggregated_output:JSON.stringify({ok:true,result:{send:{accepted:true,handle:'term_target',prompt:{requestId:'synthetic-request'}}}})}}};
  const message=(id,value)=>({timestamp:at(0),type:'response_item',payload:{id,type:'message',role:'user',content:[{type:'input_text',text:value}]}});
  const write=records=>fs.writeFileSync(source.path,records.map(x=>typeof x==='string'?x:JSON.stringify(x)).join('\n')+'\n');
  const read=()=>readCodexHistory(root,target,Object.assign(createEvidenceContext(),{peerSources:index})).items;
  t.after(async()=>{await index.shutdown();fs.rmSync(root,{recursive:true,force:true});});
  fs.writeFileSync(target.path,JSON.stringify(message('incoming',text))+'\n');
  return {root,index,source,target,call,receipt,message,text,write,read,at};
}
async function ready(index,session) {
  for(let n=0;n<300;n++){const value=index.read(session);if(value.complete)return value;await new Promise(r=>setTimeout(r,10));}
  throw Error('Peer index did not complete');
}

test('large unrelated output cannot permanently hide a proven literal peer send; history and IDs stay intact',async t=>{
  const f=fixture(t),large={timestamp:f.at(-2000),type:'response_item',payload:{type:'function_call_output',output:'x'.repeat(1024*1024)}};
  f.write([large,f.call,f.receipt]);
  const original=fs.readFileSync(f.target.path);
  assert.equal(f.read()[0].from,'user','index warm-up is not positive proof');
  await ready(f.index,f.source);
  const item=f.read()[0];assert.equal(item.from,'peer');assert.equal(item.id,'xincoming');assert.equal(item.text,f.text);
  assert.equal(item.session,'source');assert.equal(item.to,'target');
  assert.deepEqual(fs.readFileSync(f.target.path),original);
  let opens=0;const open=fs.promises.open;
  t.mock.method(fs.promises,'open',(...args)=>{opens++;return open(...args);});
  for(let n=0;n<5;n++)assert.equal(f.index.read(f.source).complete,true);
  await new Promise(r=>setTimeout(r,20));assert.equal(opens,0,'unchanged source does not rescan');
});

test('failed receipts, mixed owner text, wrong destination and malformed records cannot gain peer styling',async t=>{
  const f=fixture(t);
  f.receipt.payload.item.exit_code=1;
  f.write([f.call,f.receipt]);await ready(f.index,f.source);assert.equal(f.read()[0].from,'user');
  f.receipt.payload.item.exit_code=0;
  f.write([f.call,f.receipt]);await ready(f.index,f.source);
  fs.writeFileSync(f.target.path,JSON.stringify(f.message('mixed',f.text+'\nOwner text'))+'\n');
  assert.equal(f.read().find(x=>x.id==='xmixed').from,'user');
  f.target.orca.terminal='term_other';fs.writeFileSync(path.join(f.root,'sessions','target.json'),JSON.stringify(f.target));
  fs.writeFileSync(f.target.path,JSON.stringify(f.message('wrong',f.text))+'\n');assert.equal(f.read().find(x=>x.id==='xwrong').from,'user');
  f.write(['not JSON',f.call,f.receipt]);
  for(let n=0;n<10;n++){assert.equal(f.index.read(f.source).complete,false);await new Promise(r=>setTimeout(r,10));}
});

test('index handles incremental append, valid unterminated records, replacement, truncate and close',async t=>{
  const f=fixture(t);f.write([f.call]);await ready(f.index,f.source);
  fs.appendFileSync(f.source.path,JSON.stringify(f.receipt));
  let value=await ready(f.index,f.source);assert.equal(value.rows.length,2);
  fs.appendFileSync(f.source.path,'\n');value=await ready(f.index,f.source);assert.equal(value.rows.length,2);
  fs.renameSync(f.source.path,f.source.path+'.old');f.write([]);
  value=await ready(f.index,f.source);assert.equal(value.rows.length,0);
  f.write([f.call,f.receipt]);await ready(f.index,f.source);
  fs.truncateSync(f.source.path,0);value=await ready(f.index,f.source);assert.equal(value.rows.length,0);
  f.write([f.call,f.receipt]);f.index.read(f.source);await f.index.shutdown();
  assert.equal(f.index.read(f.source).complete,false,'shutdown cannot start a new file reader');
});
