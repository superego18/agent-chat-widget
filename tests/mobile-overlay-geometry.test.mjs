import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {getBrowser,closeBrowser} from './helpers.mjs';
after(closeBrowser);
const source=fs.readFileSync(new URL('../assets/app-widget.js',import.meta.url),'utf8');
async function fixture(t,{width=390,context='workbench'}={}) {
  const ctx=await(await getBrowser()).newContext({viewport:{width,height:844},hasTouch:true,isMobile:true});
  t.after(()=>ctx.close());const page=await ctx.newPage(), diagnostics=[];
  await page.route('**/*',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    if(path==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width"><body><div style="height:2000px">Background fixture</div>'});
    if(path.endsWith('/diag'))diagnostics.push(req.postDataJSON());
    return route.fulfill({json:path.endsWith('/sessions')?{sessions:[{id:'fixture',name:'Fixture',tool:'codex',status:{state:'idle'}}]}:path.endsWith('/chat')?{messages:[],delivered:{}}:path.endsWith('/drafts')?{drafts:[],trash:[]}: {}});
  });
  await page.goto('http://geometry.test/');await page.clock.install();
  await page.evaluate(context=>{
    window.__uifbConfig={context};
    const vv=new EventTarget();Object.assign(vv,{offsetTop:0,offsetLeft:0,width:390,height:400,scale:1});
    Object.defineProperty(window,'visualViewport',{value:vv,configurable:true});
  },context);
  await page.addScriptTag({content:source});await page.locator('#btn').click();
  await page.getByRole('tab',{name:'Fixture',exact:false}).waitFor();
  return {page,diagnostics};
}
test('mobile panel covers updated visual viewport on page restoration without a resize notification',async t=>{
  const {page}=await fixture(t);
  await page.evaluate(()=>{Object.assign(visualViewport,{height:600,offsetTop:40});dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
  const r=await page.locator('#panel').evaluate(p=>{const r=p.getBoundingClientRect();return{top:r.top,bottom:r.bottom};});
  assert.equal(r.top,40);assert.equal(r.bottom,640,'restoration must not leave the background exposed below a stale panel');
});
test('mobile workbench diagnostics are bounded geometry only and stop while closed',async t=>{
  const {page,diagnostics}=await fixture(t);
  await page.locator('#input').fill('PRIVATE fixture input must never be logged');
  await page.clock.runFor(6000);
  for(let n=0;n<20;n++){await page.evaluate(()=>visualViewport.dispatchEvent(new Event('scroll')));await page.clock.runFor(5100);}
  assert(diagnostics.length>0);assert(diagnostics.length<=20);
  assert(diagnostics.every(d=>d.kind==='mobile-overlay'));
  assert(!JSON.stringify(diagnostics).includes('PRIVATE'));
  const keys=['kind','reason','panel','viewport','scrollY','locks','focused','covered'];
  for(const d of diagnostics)assert.deepEqual(Object.keys(d).sort(),keys.sort());
  await page.locator('#close').click();const count=diagnostics.length;
  await page.evaluate(()=>visualViewport.dispatchEvent(new Event('resize')));await page.clock.runFor(6000);
  assert.equal(diagnostics.length,count);
});
for(const options of [{width:1440},{context:'app'}])test(`geometry diagnostics exclude ${JSON.stringify(options)}`,async t=>{
  const {page,diagnostics}=await fixture(t,options);await page.clock.runFor(6000);assert.equal(diagnostics.length,0);
});
