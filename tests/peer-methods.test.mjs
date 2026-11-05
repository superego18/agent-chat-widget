import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createChatHandler} from '../scripts/chat-handler.mjs';
import {A,B,makeDir,startServer,openWidget,getBrowser,closeBrowser} from './helpers.mjs';
after(closeBrowser);

test('actual SendMessage hooks retain their method when the receiving relay merges the same message',async()=>{
  const project=fs.mkdtempSync(path.join(os.tmpdir(),'widget-method-hook-')),root=path.join(project,'.ui-feedback');
  fs.mkdirSync(path.join(root,'sessions'),{recursive:true});
  const handler=createChatHandler({root});
  const server=http.createServer((req,res)=>{if(!handler.handle(req,res,new URL(req.url,'http://localhost'))){res.writeHead(404);res.end();}});
  const hook=fileURLToPath(new URL('../scripts/hook-relay.mjs',import.meta.url));
  const run=input=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[hook],{cwd:project,env:{...process.env,CMUX_SURFACE_ID:'synthetic-cmux-surface'},windowsHide:true,stdio:['pipe','pipe','pipe']});
    let stderr='';child.stdout.resume();child.stderr.on('data',b=>stderr+=b);
    child.once('error',reject);child.once('close',(code,signal)=>code===0&&!signal?resolve():reject(Error(`Hook close ${code}/${signal}: ${stderr}`)));
    child.stdin.end(JSON.stringify({...input,cwd:project}));
  });
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    for(const id of [A,B])fs.writeFileSync(path.join(root,'sessions',id+'.json'),JSON.stringify({sessionId:id,tool:'claude',name:id===A?'Source':'Target',port:server.address().port}));
    await run({session_id:A,hook_event_name:'PreToolUse',tool_name:'SendMessage',tool_input:{to:'target-peer',message:'Synthetic tool message'}});
    await run({session_id:B,hook_event_name:'UserPromptSubmit',prompt_text:'<cross-session-message from-name="source-peer">Synthetic tool message</cross-session-message>'});
    const messages=JSON.parse(fs.readFileSync(path.join(root,'chat.json'))).messages;
    assert.equal(messages.length,1);assert.equal(messages[0].peerMethod,'message-tool');assert.equal(messages[0].to,B);assert.ok(messages[0].readAt);
    assert.equal(messages[0].peerSourceTool,'claude');assert.equal(messages[0].peerTargetTool,'claude');
    assert.equal(messages[0].peerSourceHost,'cmux');assert.equal(messages[0].peerTargetHost,'cmux');
    await run({session_id:B,hook_event_name:'UserPromptSubmit',prompt_text:'<cross-session-message from-name="unknown-peer">Standalone relay message</cross-session-message>'});
    const relay=JSON.parse(fs.readFileSync(path.join(root,'chat.json'))).messages.at(-1);assert.equal(relay.peerMethod,'hook-relay');
    const unknown=handler.addChat({from:'peer',session:A,toName:'target-peer',text:'Unknown transport',peerMethod:'terminal'});
    assert.equal(unknown.peerMethod,undefined,'a generic peer API call cannot claim native terminal proof');
  }finally{await handler.shutdown();await new Promise(r=>server.close(r));fs.rmSync(project,{recursive:true,force:true});}
});

for(const width of [390,1440])test(`peer method labels remain distinct and fit the bubble at ${width}px`,async()=>{
  const methods=[['terminal','Orca · 직접 전달','codex','claude'],['mailbox','Orca · 수신함 알림','codex','codex'],['dispatch','Orca · 작업 배정','codex','codex'],['message-tool','Claude · SendMessage','claude','claude'],['hook-relay','경로 미확인 · Claude 훅 수신',undefined,'claude'],[undefined,'전달 경로 미확인',undefined,undefined]];
  const root=makeDir({messages:methods.map(([peerMethod,,peerSourceTool,peerTargetTool],i)=>({id:i+1,from:'peer',session:A,to:B,text:'Synthetic method '+i,at:new Date().toISOString(),...(peerMethod?{peerMethod}:{}),peerSourceTool,peerTargetTool,...(i===3?{peerSourceHost:'cmux',peerTargetHost:'cmux'}:{})}))});
  const registration=path.join(root,'sessions',A+'.json'),registered=JSON.parse(fs.readFileSync(registration));registered.cmux={surface:'fixture-surface'};fs.writeFileSync(registration,JSON.stringify(registered));
  const srv=await startServer(root),ctx=await (await getBrowser()).newContext({viewport:{width,height:900}});
  try{
    const {page,w}=await openWidget(srv,{ctx,tab:B});
    for(const [i,[,label,sourceTool,targetTool]] of methods.entries()){
      const bubble=page.locator(`.msg.peer[data-id="${i+1}"]`),tag=bubble.locator('.tag');
      assert.equal(await tag.textContent(),'세션끼리 · '+label);
      const toolName=tool=>({codex:'Codex',claude:'Claude'}[tool]||'도구 미확인')+(i===3?' · cmux 환경':'');
      const route=await bubble.locator('.route').textContent();
      assert.ok(route.includes('('+toolName(sourceTool)+') →')&&route.endsWith('('+toolName(targetTool)+')'),'route uses observed provider snapshots, not current registration');
      assert.ok(!(await tag.textContent()).includes('cmux'),'a cmux session registration alone cannot claim cmux message delivery');
      const bounds=await tag.evaluate(el=>({tag:el.getBoundingClientRect().width,bubble:el.parentElement.getBoundingClientRect().width}));
      assert.ok(bounds.tag<=bounds.bubble,'method label fits without horizontal overflow');
    }
    const file=path.join(root,'chat.json'),body=JSON.parse(fs.readFileSync(file));
    body.messages[5].peerMethod='mailbox';body.messages[5].peerSourceTool='codex';body.messages[5].peerTargetTool='claude';
    fs.writeFileSync(file,JSON.stringify(body));
    await page.waitForFunction(()=>[...document.querySelectorAll('*')].some(el=>el.shadowRoot?.querySelector('.msg[data-id="6"] .tag')?.textContent==='세션끼리 · Orca · 수신함 알림'),null,{timeout:8000});
    assert.equal((await w.msgs()).filter(m=>m.id==='6').length,1,'newly known method refreshes the existing bubble without duplication');
  }finally{await ctx.close();srv.stop();}
});
