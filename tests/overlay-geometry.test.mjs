import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {getBrowser,closeBrowser} from './helpers.mjs';
after(closeBrowser);
const source=fs.readFileSync(new URL('../assets/app-widget.js',import.meta.url),'utf8');
for(const [context,width,expected] of [['workbench',390,true],['app',390,false],['workbench',1440,false]])test(`bounded overlay diagnostics ${context} ${width}`,async t=>{
 const ctx=await(await getBrowser()).newContext({viewport:{width,height:844}});t.after(()=>ctx.close());const page=await ctx.newPage(),records=[];
 await page.route('**/*',r=>{
  const p=new URL(r.request().url()).pathname;
  if(p==='/')return r.fulfill({contentType:'text/html',body:'<!doctype html><body>Private owner content</body>'});
  if(r.request().method()==='POST'){if(p.endsWith('/diag'))records.push(r.request().postDataJSON());return r.fulfill({json:{}});}
  return r.fulfill({json:p.endsWith('/sessions')?{sessions:[{id:'fixture',name:'Fixture',tool:'codex'}]}:p.endsWith('/chat')?{messages:[],delivered:{}}:p.endsWith('/drafts')?{drafts:[],trash:[]}:p.endsWith('/transcript')?{items:[]}: {}});
 });
 await page.goto('http://overlay.test/');await page.evaluate(c=>{window.__uifbConfig={context:c};localStorage.setItem('__uifb_open:'+c,'1');},context);await page.addScriptTag({content:source});await page.waitForTimeout(700);
 assert.equal(records.length>0,expected);
 if(expected){const r=records[0];assert.equal(r.kind,'mobile-overlay');assert.equal(r.covered,true);assert.equal(r.locks.open,true);assert.equal(r.locks.body,'hidden');assert.deepEqual(Object.keys(r).sort(),['covered','focused','kind','locks','panel','reason','scrollY','viewport']);assert(!JSON.stringify(r).includes('Private owner content'));await page.locator('#input').fill('PRIVATE INPUT');await page.setViewportSize({width,height:500});await page.waitForTimeout(400);assert(records.length<=1,'geometry events are rate-limited');assert(!JSON.stringify(records).includes('PRIVATE INPUT'));}
});
