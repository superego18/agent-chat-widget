import{test,after}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import{getBrowser,closeBrowser}from'./helpers.mjs';
after(closeBrowser);const source=fs.readFileSync(new URL('../assets/app-widget.js',import.meta.url),'utf8');
test('conditional chat keeps messages and renders a same-ID text change under a fresh version',async t=>{
 const ctx=await(await getBrowser()).newContext({viewport:{width:390,height:844}});t.after(()=>ctx.close());const page=await ctx.newPage();let version='one',text='First server answer',conditional=0;
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.pathname==='/')return r.fulfill({contentType:'text/html',body:'<!doctype html><body>Fixture'});if(r.request().method()!=='GET')return r.fulfill({json:{}});
 if(u.pathname.endsWith('/chat')){if(u.searchParams.get('known')===version){conditional++;return r.fulfill({json:{version,unchanged:true}});}return r.fulfill({json:{version,messages:[{id:1,from:'agent',session:'active',text,at:'2026-01-01T00:00:00Z'}],delivered:{}}});}
 return r.fulfill({json:u.pathname.endsWith('/sessions')?{sessions:[{id:'active',name:'Active',tool:'claude',status:{state:'idle'}}]}:u.pathname.endsWith('/transcript')?{items:[]}:u.pathname.endsWith('/drafts')?{drafts:[],trash:[]}: {}});});
 await page.goto('http://conditional-chat.test/');await page.clock.install();await page.evaluate(()=>{localStorage.setItem('__uifb_tab','active');localStorage.setItem('__uifb_open:app','1');});await page.addScriptTag({content:source});await page.getByText(text,{exact:true}).waitFor();
 const next=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/chat')&&new URL(r.url()).searchParams.get('known')==='one');await page.clock.runFor(3500);await next;await page.waitForTimeout(100);assert(conditional>0);assert.equal(await page.getByText(text,{exact:true}).count(),1);
 version='two';text='Changed server answer';await page.clock.runFor(3500);await page.getByText(text,{exact:true}).waitFor();assert.equal(await page.locator('.msg[data-id="1"]').count(),1);
});

test('incremental chat applies same-ID edits, additions, deletions and recovers a bad base immediately',async t=>{
 const ctx=await(await getBrowser()).newContext({viewport:{width:390,height:844}});t.after(()=>ctx.close());const page=await ctx.newPage();let stage=0,recovered=0;
 const row=(id,text)=>({id,from:'agent',session:'active',text,at:'2026-01-01T00:00:00Z'});
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.pathname==='/')return r.fulfill({contentType:'text/html',body:'<!doctype html><body>Fixture'});if(r.request().method()!=='GET')return r.fulfill({json:{}});
 if(u.pathname.endsWith('/chat')){
  const known=u.searchParams.get('known');
  if(!known){if(stage===3)recovered++;return r.fulfill({json:{version:'v'+stage,messages:[row(1,stage===3?'Recovered answer':'Initial answer')],delivered:{}}});}
  if(known==='v'+stage)return r.fulfill({json:{version:known,unchanged:true}});
  return r.fulfill({json:{delta:true,baseVersion:stage===3?'wrong':known,version:'v'+stage,messages:stage===1?[row(1,'Edited answer'),row(2,'Added answer')]:[],order:stage===1?[2,1]:[1],delivered:{}}});
 }
 return r.fulfill({json:u.pathname.endsWith('/sessions')?{sessions:[{id:'active',name:'Active',tool:'claude',status:{state:'idle'}}]}:u.pathname.endsWith('/transcript')?{items:[]}:u.pathname.endsWith('/drafts')?{drafts:[],trash:[]}: {}});});
 await page.goto('http://delta-chat.test/');await page.clock.install();await page.evaluate(()=>{localStorage.setItem('__uifb_tab','active');localStorage.setItem('__uifb_open:app','1');});await page.addScriptTag({content:source});await page.getByText('Initial answer',{exact:true}).waitFor();
 stage=1;await page.clock.runFor(3500);await page.getByText('Edited answer',{exact:true}).waitFor();await page.getByText('Added answer',{exact:true}).waitFor();assert.equal(await page.locator('.msg[data-id="1"]').count(),1);
 stage=2;await page.clock.runFor(3500);await page.waitForTimeout(100);assert.equal(await page.locator('.msg[data-id="2"]').count(),0);assert.equal(await page.getByText('Edited answer',{exact:true}).count(),1);
 stage=3;await page.clock.runFor(3500);await page.getByText('Recovered answer',{exact:true}).waitFor();assert.equal(recovered,1);
});
