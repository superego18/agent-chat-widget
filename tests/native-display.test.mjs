import{test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import os from'node:os';import path from'node:path';import{createHash}from'node:crypto';
import{readCodexHistory}from'../scripts/transcript-store.mjs';import{quoteLines}from'../scripts/chat-format.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-display-')),session={sessionId:'target',tool:'codex',path:path.join(root,'native.jsonl')};fs.mkdirSync(path.join(root,'sessions'));fs.writeFileSync(path.join(root,'sessions','target.json'),JSON.stringify(session));fs.writeFileSync(session.path,'');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return{root,session,add(id,text,kinds=['user.text']){fs.appendFileSync(session.path,JSON.stringify({timestamp:'2026-11-05T00:00:00Z',type:'response_item',payload:{id,type:'message',role:'user',content:[{type:'input_text',text}],internal_chat_message_metadata_passthrough:{content_item_kinds:kinds}}})+'\n');},read(){return readCodexHistory(root,session).items;}};}
test('native internal context labels preserve text/IDs and exclude user goals, photos and quotations',t=>{
 const f=fixture(t),instructions='# AGENTS.md instructions for /fixture\n<INSTRUCTIONS>\nRules\n</INSTRUCTIONS>',environment='<environment_context>\n<cwd>/fixture</cwd>\n</environment_context>';
 f.add('goal','Internal progress context',['goal.internal_context']);f.add('agents',instructions,['agents_md.instructions']);f.add('env',environment,['environments.environment_context']);f.add('owner-goal','Owner goal',['user.goal']);f.add('photo','Owner photo',['user.text','user.image']);f.add('quote',instructions);f.add('mixed','Owner and internal',['goal.internal_context','user.text']);f.add('wrong-envelope','Owner prose',['environments.environment_context']);
 const before=fs.readFileSync(f.session.path),rows=f.read();assert.equal(rows.length,8);assert.deepEqual(rows.slice(0,3).map(m=>m.nativeDisplay?.kind),['goal-context','project-instructions','environment-context']);
 for(const m of rows){assert.equal(m.from,'user');assert.equal(m.context,'terminal');}for(const m of rows.slice(3))assert.equal(m.nativeDisplay,undefined);
 assert.deepEqual(fs.readFileSync(f.session.path),before);assert.equal(rows[0].text,'Internal progress context');
 assert.match(quoteLines({replyTo:rows[0].id},rows)[0],/사용자/,'display correction must not change the existing delivery wire format');
});
test('reviewed exact dispatch evidence projects only matching native IDs and hashes; revocation invalidates cached reads',t=>{
 const f=fixture(t),text="You are working inside Orca, a multi-agent IDE. You are a dispatched worker.\nYour coordinator's terminal handle is: term_source\nYour task ID is: task_one\norca orchestration send --from term_target --dispatch-id ctx_one\n=== TASK ===\nSynthetic task";
 f.add('dispatch',text);f.add('copy',text);
 const audit=path.join(f.root,'approved.json'),row={kind:'worker-dispatch',receiver:'target',id:'xdispatch',textSHA:sha(text),taskId:'task_one',dispatchId:'ctx_one',taskExists:true,dispatchExists:true,specMatches:true,taskJoin:true,creatorMatches:true,assigneeMatches:true};
 fs.writeFileSync(audit,JSON.stringify({rows:[row]}));const register=()=>fs.writeFileSync(path.join(f.root,'automation-sources.json'),JSON.stringify({sources:[{type:'reviewed-native-display',file:'approved.json',sha256:sha(fs.readFileSync(audit))}]}));register();
 assert.equal(f.read()[0].nativeDisplay?.kind,'orca-dispatch');assert.equal(f.read()[1].nativeDisplay,undefined,'same text at another input ID has no approval');
 fs.writeFileSync(path.join(f.root,'automation-sources.json'),'{"sources":[]}');assert.equal(f.read()[0].nativeDisplay,undefined,'source revocation must not leave a stale display classification');
 register();f.add('dispatch',text+'\nOwner addition');assert.equal(f.read().find(m=>m.id==='xdispatch').nativeDisplay,undefined,'changed text cannot reuse the review');
});
test('mismatched or altered review evidence never grants a display classification',t=>{
 const f=fixture(t);f.add('dispatch','Owner text');const audit=path.join(f.root,'approved.json');fs.writeFileSync(audit,JSON.stringify({rows:[{receiver:'target',id:'xdispatch',textSHA:sha('Owner text'),kind:'worker-dispatch',creatorMatches:false}]}));fs.writeFileSync(path.join(f.root,'automation-sources.json'),JSON.stringify({sources:[{type:'reviewed-native-display',file:'approved.json',sha256:sha(fs.readFileSync(audit))}]}));assert.equal(f.read()[0].nativeDisplay,undefined);fs.appendFileSync(audit,' ');assert.equal(f.read()[0].nativeDisplay,undefined);
});

test('owner-confirmed continuation labels require exact ID, text hash and complete marker; copied replies stay user',t=>{
 const f=fixture(t),text='[pipeline-continuation:owner-example]\nSynthetic coordination reminder',audit=path.join(f.root,'approved.json');
 f.add('reminder',text);f.add('reply',text);f.add('mixed','My reply\n'+text);
 const row={kind:'owner-confirmed-continuation',receiver:'target',id:'xreminder',textSHA:sha(text),continuationId:'owner-example',approvalReceipt:'11111111-1111-4111-8111-111111111111'};
 fs.writeFileSync(audit,JSON.stringify({rows:[row]}));const register=()=>fs.writeFileSync(path.join(f.root,'automation-sources.json'),JSON.stringify({sources:[{type:'reviewed-native-display',file:'approved.json',sha256:sha(fs.readFileSync(audit))}]}));register();
 const rows=f.read();assert.equal(rows[0].nativeDisplay?.kind,'pipeline-continuation');assert.equal(rows[0].from,'user');assert.equal(rows[0].text,text);assert.equal(rows[1].nativeDisplay,undefined);assert.equal(rows[2].nativeDisplay,undefined);
 row.approvalReceipt='';fs.writeFileSync(audit,JSON.stringify({rows:[row]}));register();assert.equal(f.read()[0].nativeDisplay,undefined);
});
