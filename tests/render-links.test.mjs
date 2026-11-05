import{test,after}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import{getBrowser,closeBrowser}from'./helpers.mjs';
after(closeBrowser);
const source=fs.readFileSync(new URL('../assets/app-widget.js',import.meta.url),'utf8');
const at=n=>`2026-01-01T00:00:${String(n).padStart(2,'0')}Z`;
const user=(id,extra={})=>({id,from:'user',to:'active',text:'Question '+id,at:at(id),...extra});
const answer=(id,re)=>({id,from:'agent',session:'active',text:'Answer '+id,at:at(id),re});
async function graph(t,code){
 const ctx=await(await getBrowser()).newContext({viewport:{width:390,height:844}});t.after(()=>ctx.close());const page=await ctx.newPage();
 const state={messages:[user(1),answer(2,[1]),user(3),answer(4,[3]),answer(5,[1,3]),user(6,{replyTo:2}),user(7),answer(8,[7]),{id:9,from:'peer',session:'active',to:'other',text:'Peer request',at:at(9)},{id:10,from:'peer',session:'other',to:'active',text:'Peer response',at:at(10)}]};
 await page.route('**/*',r=>{const p=new URL(r.request().url()).pathname;if(p==='/')return r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width"><body>Fixture'});if(r.request().method()!=='GET')return r.fulfill({json:{}});return r.fulfill({json:p.endsWith('/sessions')?{sessions:[{id:'active',name:'Active',tool:'claude',status:{state:'idle'}}]}:p.endsWith('/chat')?{messages:state.messages,delivered:{_at:Object.fromEntries(state.messages.map(m=>[m.id,m.at]))}}:p.endsWith('/drafts')?{drafts:[],trash:[]}:p.endsWith('/transcript')?{items:[]}: {}});});
 await page.goto('http://render-links.test/');await page.clock.install();await page.evaluate(()=>{localStorage.setItem('__uifb_tab','active');localStorage.setItem('__uifb_open:app','1');});await page.addScriptTag({content:code});await page.locator('.msg[data-id="8"]').waitFor();
 assert.ok(await page.locator('.links path').count()>0,'all supported link kinds must render, including peer links');
 assert.equal(await page.locator('.links path.reply').count(),1);
 const before=await page.locator('.links path').evaluateAll(es=>es.map(e=>({d:e.getAttribute('d'),reply:e.classList.contains('reply')})));
 state.messages=[...state.messages,user(11,{replyTo:4})];await page.clock.runFor(3500);await page.locator('.msg[data-id="11"]').waitFor();
 assert.equal(await page.locator('.links path').count(),before.length+1);assert.equal(await page.locator('.links path.reply').count(),2);
 assert.match(await page.locator('.msg[data-id="11"] .quote').textContent(),/Answer 4/);
 return before;
}
test('transitive answer grouping, separate replies and fresh reference lookup survive each render',async t=>{
 const current=await graph(t,source);
 if(process.env.UIFB_WIDGET_BASELINE)assert.deepEqual(current,await graph(t,fs.readFileSync(process.env.UIFB_WIDGET_BASELINE,'utf8')),'optimized SVG paths must match the baseline exactly');
});
