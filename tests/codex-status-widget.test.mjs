import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { createChatHandler } from '../scripts/chat-handler.mjs';

test('390px interject controls follow real long-turn status, completion, abort and unknown', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-status-mobile-'));
  const file = path.join(root, 'rollout.jsonl'), id = 'synthetic-mobile';
  const row = type => JSON.stringify({timestamp:new Date().toISOString(),type:'event_msg',payload:{type}})+'\n';
  fs.mkdirSync(path.join(root, 'sessions'));
  fs.writeFileSync(path.join(root, 'sessions', id+'.json'), JSON.stringify({sessionId:id,tool:'codex',path:file,name:'시험 세션'}));
  fs.writeFileSync(file, row('task_started')+JSON.stringify({type:'response_item',payload:{type:'function_call_output',output:'x'.repeat(600*1024)}})+'\n');
  fs.writeFileSync(path.join(root,'chat.json'),JSON.stringify({messages:[{id:1,from:'user',to:id,text:'Synthetic pending message',at:new Date().toISOString(),queue:{state:'accepted',receipt:'11111111-1111-4111-8111-111111111111'}}]}));
  const handler = createChatHandler({root, readControl: async () => [id]});
  const server = http.createServer((req,res)=>{
    const url=new URL(req.url,'http://fixture');
    if(url.pathname==='/') {res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><meta name="viewport" content="width=device-width"><body><script src="/__uifb/widget.js"></script></body>');return;}
    if(url.pathname.startsWith('/__uifb/api/'))url.pathname=url.pathname.slice('/__uifb'.length);
    if(!handler.handle(req,res,url)){res.writeHead(404);res.end();}
  });
  let browser;
  try {
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const base='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'chrome',headless:true});
    const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const page=await ctx.newPage();page.setDefaultTimeout(12000);
    await page.addInitScript(id=>{localStorage.setItem('__uifb_tab',id);localStorage.setItem('__uifb_open:app','1');},id);
    await page.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
    await page.goto(base);
    await page.locator('#now').waitFor({state:'visible'});
    assert.equal(await page.locator('.msg[data-id="1"]').getByRole('button',{name:'끼워넣기',exact:true}).isVisible(),true);
    const api=await fetch(base+'/__uifb/api/sessions').then(r=>r.json());
    assert.equal(api.sessions[0].status.state,'working');assert.equal(api.sessions[0].watch.steer,true);
    const bounds=await page.locator('#now').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390);
    fs.appendFileSync(file,row('task_complete'));
    await page.locator('#now').waitFor({state:'hidden'});
    await page.waitForFunction(()=>![...document.querySelectorAll('*')].find(e=>e.shadowRoot?.getElementById('panel'))?.shadowRoot.querySelector('.msg[data-id="1"] .interject'));
    assert.equal(await page.locator('.msg[data-id="1"]').getByRole('button',{name:'끼워넣기',exact:true}).count(),0);
    fs.appendFileSync(file,row('task_started'));await page.locator('#now').waitFor({state:'visible'});
    fs.appendFileSync(file,row('turn_aborted'));await page.locator('#now').waitFor({state:'hidden'});
    fs.writeFileSync(file,row('unrecognized'));
    await page.waitForTimeout(2500);
    assert.equal((await fetch(base+'/__uifb/api/sessions').then(r=>r.json())).sessions[0].status.state,'unknown');
    assert.equal(await page.locator('#now').isHidden(),true);
  } finally {
    await browser?.close();await handler.shutdown();await new Promise(r=>server.close(r));
    fs.rmSync(root,{recursive:true,force:true});
  }
});
