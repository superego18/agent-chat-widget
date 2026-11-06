import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {chromium, webkit} from 'playwright-core';
import {createChatHandler} from '../scripts/chat-handler.mjs';

for (const [engine,width,theme] of [['chromium',390,'light'],['chromium',390,'dark'],['chromium',1440,'light'],['webkit',390,'light']]) {
 test(`work requests are scoped to the selected conversation: ${engine} ${width} ${theme}`,async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'widget-work-session-')),at=new Date().toISOString();
  fs.mkdirSync(path.join(root,'sessions'));
  const names=['첫 대화','두 번째 대화','빈 대화'];
  for(let i=0;i<3;i++) fs.writeFileSync(path.join(root,'sessions',`synthetic-${i}.json`),JSON.stringify({sessionId:`synthetic-${i}`,tool:'claude',name:names[i]}));
  const entry=(id,to,state,answer)=>({id,to,text:`합성 요청 ${id}`,at,work:{actor:to,state,revision:answer?3:2,startedAt:at,updatedAt:at,note:'합성 확인 내용',...(answer?{answer:{decision:'approved',text:'기존 답변',at}}:{})}});
  const linked=entry(7,'synthetic-0','review',true),correction=entry(8,'synthetic-0','working');
  correction.work.reviewRequired=true;correction.work.answer={decision:'changes',text:'수정해 주세요',at};
  const drafts=[entry(1,'synthetic-0','review'),entry(2,'synthetic-0','review',true),entry(3,'synthetic-0','working'),entry(4,'synthetic-0','done'),entry(5,'synthetic-1','review'),entry(6,'synthetic-1','review'),linked,correction];
  fs.writeFileSync(path.join(root,'drafts.json'),JSON.stringify({nextId:9,trash:[],drafts}));
  const handler=createChatHandler({root});
  const server=http.createServer((req,res)=>{
   const url=new URL(req.url,'http://fixture.invalid');
   if(url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><meta name="viewport" content="width=device-width"><main>합성 화면</main><script src="/__uifb/widget.js"></script>');return;}
   if(url.pathname.startsWith('/__uifb/api/'))url.pathname=url.pathname.slice('/__uifb'.length);
   if(!handler.handle(req,res,url)){res.writeHead(404);res.end();}
  });
  let browser;
  try{
   await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
   const base='http://127.0.0.1:'+server.address().port;
   linked.work.reviewTarget={kind:'development-workbench',item:'linked-item',url:base+'/?item=linked-item',version:'connected-version'};
   fs.writeFileSync(path.join(root,'drafts.json'),JSON.stringify({nextId:9,trash:[],drafts}));
   const original=fs.readFileSync(path.join(root,'drafts.json'));
   browser=await(engine==='webkit'?webkit.launch({headless:true}):chromium.launch({channel:'chrome',headless:true}));
   const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme});page.setDefaultTimeout(8000);
   const errors=[];page.on('pageerror',e=>errors.push({name:e.name,message:e.message}));
   await page.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
   await page.addInitScript(()=>{localStorage.setItem('__uifb_tab','synthetic-0');localStorage.setItem('__uifb_open:app','1');});
   await page.goto(base);await page.locator('#panel').waitFor({state:'visible'});await page.locator('#workBtn').filter({hasText:/\d/}).waitFor();await page.locator('#workBtn').click();
   const ids=()=>page.locator('#wlist [data-work-open]').evaluateAll(rows=>rows.map(x=>x.dataset.workOpen));
   assert.deepEqual(await ids(),['1','2','8','7','3','4'],'no other session requests in the compact list');
   assert.deepEqual(await page.locator('[data-work-group="attention"] [data-work-open]').evaluateAll(rows=>rows.map(x=>x.dataset.workOpen)),['1','2','8'],'unanswered, answered pending and requested correction remain the main obligations');
   for(const key of ['workbench','progress','done'])assert.equal(await page.locator(`[data-work-group="${key}"]`).getAttribute('open'),null);
   assert.match(await page.locator('[data-work-open="8"]').innerText(),/담당 처리 대기/);
   assert.equal(await page.locator('#workBtn').innerText(),'진행·확인 1');
   assert.match(await page.locator('#wtitle').innerText(),/첫 대화/);
   assert.match(await page.locator('[data-work-open="1"]').innerText(),/확인 필요/);
   assert.match(await page.locator('[data-work-open="2"]').innerText(),/답변 저장됨/);
   await page.locator('[data-work-group="workbench"] > summary').focus();await page.keyboard.press('Enter');await page.keyboard.press('Tab');
   assert.equal(await page.locator('[data-work-open="7"]').evaluate(el=>el.getRootNode().activeElement===el),true);
   await page.keyboard.press('Enter');
   const linkedCard=page.locator('[data-work-id="7"]');
   assert.equal(await linkedCard.getByRole('button',{name:'확인했어요',exact:true}).count(),0);
   assert.equal(await linkedCard.getByRole('textbox').count(),0);
   assert.match(await linkedCard.innerText(),/연결할 때 확인한 결과/);
   assert.match(await linkedCard.innerText(),/기존 답변/);
   const link=linkedCard.getByRole('link',{name:'현황판에서 확인',exact:true});
   assert.equal(await link.getAttribute('href'),base+'/?item=linked-item');
   await link.focus();const popupPromise=page.waitForEvent('popup');await page.keyboard.press('Enter');const popup=await popupPromise;await popup.waitForURL(url=>url.origin===base&&url.searchParams.get('item')==='linked-item');await popup.waitForLoadState('domcontentloaded');assert.equal(new URL(popup.url()).searchParams.get('item'),'linked-item');await popup.close();
   await page.getByRole('button',{name:'← 전체 요청',exact:true}).click();
   await page.locator('[data-work-open="1"]').click();
   await page.getByRole('textbox',{name:'요청 1 확인 의견'}).fill('첫 대화 의견 보존');
   await page.getByRole('tab',{name:names[1],exact:true}).click();
   assert.equal(await page.locator('#wlist [data-work-id]').count(),0,'changing sessions removes old detail immediately');
   assert.deepEqual(await ids(),['5','6']);
   assert.equal(await page.locator('#workBtn').innerText(),'진행·확인 2');
   assert.match(await page.locator('#wtitle').innerText(),/두 번째 대화/);
   await page.locator('[data-work-open="5"]').click();
   await page.getByRole('textbox',{name:'요청 5 확인 의견'}).fill('두 번째 대화 의견 보존');
   await page.getByRole('tab',{name:names[2],exact:true}).click();
   assert.deepEqual(await ids(),[]);assert.equal(await page.locator('#workBtn').innerText(),'진행·확인');
   assert.match(await page.locator('#wlist').innerText(),/빈 대화.*진행·확인할 요청/);
   await page.getByRole('tab',{name:names[0],exact:true}).click();await page.locator('[data-work-open="1"]').click();
   assert.equal(await page.getByRole('textbox',{name:'요청 1 확인 의견'}).inputValue(),'첫 대화 의견 보존');
   await page.getByRole('tab',{name:names[1],exact:true}).click();await page.locator('[data-work-open="5"]').click();
   assert.equal(await page.getByRole('textbox',{name:'요청 5 확인 의견'}).inputValue(),'두 번째 대화 의견 보존');
   await page.getByRole('button',{name:'확인했어요',exact:true}).click();
   await page.getByText('확인됨 · 담당 세션의 마무리 대기',{exact:false}).waitFor();
   assert.equal(await page.locator('#workBtn').innerText(),'진행·확인 1');
   const chat=JSON.parse(fs.readFileSync(path.join(root,'chat.json'),'utf8'));
   assert.equal(chat.messages.length,1);assert.equal(chat.messages[0].to,'synthetic-1');
   const saved=JSON.parse(fs.readFileSync(path.join(root,'drafts.json'),'utf8'));
   assert.deepEqual(saved.drafts.filter(x=>x.to==='synthetic-0'),drafts.filter(x=>x.to==='synthetic-0'),'other session records stay unchanged');
   assert.notDeepEqual(fs.readFileSync(path.join(root,'drafts.json')),original,'the intentional synthetic answer was actually stored');
   await page.getByRole('button',{name:'← 전체 요청',exact:true}).click();
   assert.deepEqual(await ids(),['5','6']);
   assert.equal(await page.locator('#wsheet').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
   assert.deepEqual(errors,[]);
   if(process.env.UIFB_WORK_CAPTURE_DIR){fs.mkdirSync(process.env.UIFB_WORK_CAPTURE_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.UIFB_WORK_CAPTURE_DIR,`session-${engine}-${width}-${theme}.png`)});}
  }finally{
   await browser?.close();await handler.shutdown();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});
  }
 });
}
