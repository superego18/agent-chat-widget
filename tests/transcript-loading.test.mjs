import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {getBrowser,closeBrowser} from './helpers.mjs';
after(closeBrowser);
const source=fs.readFileSync(new URL('../assets/app-widget.js',import.meta.url),'utf8');

async function coldFixture(t, onHistory) {
 const context=await(await getBrowser()).newContext({viewport:{width:390,height:844}});
 t.after(()=>context.close());const page=await context.newPage();
 await page.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><body>Fixture</body>'});
  if(route.request().method()!=='GET')return route.fulfill({json:{}});
  if(u.pathname.endsWith('/transcript'))return onHistory(route,u.searchParams.get('session'));
  return route.fulfill({json:u.pathname.endsWith('/sessions')?{sessions:['active','other'].map(id=>({id,name:id,tool:'codex',status:{state:'idle'}}))}:u.pathname.endsWith('/chat')?{messages:[],delivered:{}}:u.pathname.endsWith('/drafts')?{drafts:[],trash:[]}: {}});
 });
 await page.goto('http://cold-history.test/');await page.clock.install();
 await page.evaluate(()=>{localStorage.setItem('__uifb_tab','active');localStorage.setItem('__uifb_open:app','1');});await page.addScriptTag({content:source});
 await page.getByRole('tab',{name:'active',exact:false}).waitFor();return page;
}
test('cold session discovery starts history immediately without waiting for the polling timer',async t=>{
 const page=await coldFixture(t,(route,id)=>route.fulfill({json:{items:[{id:'cold-'+id,from:'agent',session:id,text:'Cold answer '+id}]}}));
 await page.getByText('Cold answer active',{exact:true}).waitFor({timeout:2000});
});
test('a stalled background session never blocks a fresh poll of the selected history',async t=>{
 let activeReads=0;
 const page=await coldFixture(t,(route,id)=>{if(id==='other')return;activeReads++;return route.fulfill({json:{items:[{id:'active-answer',from:'agent',session:id,text:'Active answer'}]}});});
 await page.clock.runFor(3500);await page.getByText('Active answer',{exact:true}).waitFor();const before=activeReads;
 await page.clock.runFor(3500);assert(activeReads>before,'the selected request must not join a different stalled session');
});
test('unloaded history is described as loading rather than an empty conversation',async t=>{
 const page=await coldFixture(t,()=>{});
 assert.match(await page.locator('.empty').textContent(),/대화 기록을 불러오는 중/);
});
test('manual refresh does not wait for an unrelated stalled background transcript',async t=>{
 const page=await coldFixture(t,(route,id)=>id==='other'?undefined:route.fulfill({json:{items:[{id:'manual-'+id,from:'agent',session:id,text:'Manual '+id}]}}));
 await page.getByText('Manual active',{exact:true}).waitFor();await page.locator('#reload').click();
 await page.locator('#reload:not(.reloading)').waitFor({timeout:2000});
 assert.equal(await page.getByText('Manual active',{exact:true}).count(),1);
});
test('unchanged conditional history retains visible messages and sends the actual known version',async t=>{
 let conditional=0;
 const page=await coldFixture(t,(route,id)=>{const known=new URL(route.request().url()).searchParams.get('known');if(known){assert.equal(known,'version-'+id);conditional++;return route.fulfill({json:{version:known,unchanged:true}});}return route.fulfill({json:{version:'version-'+id,items:[{id:'conditional-'+id,from:'agent',session:id,text:'Retained '+id}]}});});
 await page.getByText('Retained active',{exact:true}).waitFor();
 const next=page.waitForRequest(r=>new URL(r.url()).searchParams.get('known')==='version-active');
 await page.clock.runFor(3500);await next;await page.waitForTimeout(100);
 assert(conditional>0);assert.equal(await page.getByText('Retained active',{exact:true}).count(),1);
});

test('agent history loads even when the shared chat response never finishes',async t=>{
 const context=await(await getBrowser()).newContext({viewport:{width:390,height:844}});
 t.after(()=>context.close());const page=await context.newPage();
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><body>Fixture</body>'});
  if(route.request().method()!=='GET')return route.fulfill({json:{}});
  if(url.pathname.endsWith('/chat'))return;
  const body=url.pathname.endsWith('/sessions')?{sessions:[{id:'active',name:'active',tool:'codex',status:{state:'idle'}}]}
   :url.pathname.endsWith('/transcript')?{items:[{id:'agent-independent',from:'agent',session:'active',text:'Independent agent history',at:'2026-11-05T00:00:00Z'}]}
   :url.pathname.endsWith('/drafts')?{drafts:[],trash:[]}:{};
  return route.fulfill({json:body});
 });
 await page.goto('http://history.test/');await page.clock.install();
 await page.evaluate(()=>{localStorage.setItem('__uifb_tab','active');localStorage.setItem('__uifb_open:app','1');});
 await page.addScriptTag({content:source});await page.getByRole('tab',{name:'active',exact:false}).waitFor();
 await page.clock.runFor(3500);
 await page.getByText('Independent agent history',{exact:false}).waitFor({timeout:2000});
});

test('slow active history appears without waiting for another session history',async t=>{
 const context=await(await getBrowser()).newContext({viewport:{width:390,height:844}});
 t.after(()=>context.close());const page=await context.newPage();let activeRoute;
 const sessions=['active','other'].map(id=>({id,name:id,tool:'codex',status:{state:'idle'}}));
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><body>Fixture</body>'});
  if(route.request().method()!=='GET')return route.fulfill({json:{}});
  if(url.pathname.endsWith('/sessions'))return route.fulfill({json:{sessions}});
  if(url.pathname.endsWith('/transcript')){if(url.searchParams.get('session')==='active')activeRoute=route;return;}
  return route.fulfill({json:url.pathname.endsWith('/chat')?{messages:[{id:1,from:'user',to:'active',text:'Owner message',at:'2026-11-05T00:00:00Z'}],delivered:{}}:url.pathname.endsWith('/drafts')?{drafts:[],trash:[]}: {}});
 });
 await page.goto('http://history.test/');await page.clock.install();
 await page.evaluate(()=>{localStorage.setItem('__uifb_tab','active');localStorage.setItem('__uifb_open:app','1');});
 await page.addScriptTag({content:source});
 await page.getByRole('tab',{name:'active',exact:false}).waitFor();
 await page.clock.runFor(3500);
 assert(activeRoute,'the active transcript request must have started');
 await page.clock.runFor(9000);
 await activeRoute.fulfill({json:{items:[{id:'agent-late',from:'agent',session:'active',text:'Delayed agent answer',at:'2026-11-05T00:00:01Z'}]}});
 await page.getByText('Delayed agent answer',{exact:false}).waitFor({timeout:2000});
 assert.equal(await page.locator('.msg[data-id="agent-late"]').count(),1);
});
