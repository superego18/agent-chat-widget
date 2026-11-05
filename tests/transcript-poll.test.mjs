import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import zlib from 'node:zlib';
import {createChatHandler} from '../scripts/chat-handler.mjs';
test('full transcript is compressed; unchanged versions send no repeated items; updates remain complete',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'transcript-poll-')),native=path.join(root,'native.jsonl');
 fs.mkdirSync(path.join(root,'sessions'));fs.writeFileSync(path.join(root,'sessions','synthetic.json'),JSON.stringify({sessionId:'synthetic',tool:'codex',path:native}));
 const write=text=>fs.writeFileSync(native,JSON.stringify({timestamp:'2026-11-05T00:00:00Z',type:'response_item',payload:{id:'fixed',type:'message',role:'assistant',content:[{type:'output_text',text}]}})+'\n');
 write('Synthetic history '.repeat(10000));const handler=createChatHandler({root});t.after(async()=>{await handler.shutdown();fs.rmSync(root,{recursive:true,force:true});});
 const get=(known='',encoding='gzip')=>{let body,status,headers;handler.handle({method:'GET',headers:{'accept-encoding':encoding}},{writeHead(s,h){status=s;headers=h;},end(b){body=b;}},new URL('http://fixture/api/transcript?session=synthetic&known='+known));const wire=Buffer.from(body);return{status,headers,wire,data:JSON.parse(headers['Content-Encoding']==='gzip'?zlib.gunzipSync(wire):wire)};};
 const first=get();assert.equal(first.headers['Content-Encoding'],'gzip');assert(first.wire.length<10000);assert.equal(first.data.items[0].text,'Synthetic history '.repeat(10000).trim());assert.match(first.data.version,/^[a-f0-9]{64}$/);
 const same=get(first.data.version);assert.equal(same.data.unchanged,true);assert.equal(same.data.items,undefined);assert(same.wire.length<200);
 const plain=get('','gzip;q=0');assert.equal(plain.headers['Content-Encoding'],undefined);assert.deepEqual(plain.data,first.data);
 write('Changed full history '.repeat(10000));const changed=get(first.data.version);assert.notEqual(changed.data.version,first.data.version);assert.equal(changed.data.items[0].text,'Changed full history '.repeat(10000).trim());
 const unknown=get('not-a-version');assert.deepEqual(unknown.data,changed.data,'unrecognized versions receive complete history');
});

test('opt-in transcript and chat polling return changed rows only, with full recovery after server restart',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'delta-poll-')),native=path.join(root,'native.jsonl');fs.mkdirSync(path.join(root,'sessions'));fs.writeFileSync(path.join(root,'sessions','synthetic.json'),JSON.stringify({sessionId:'synthetic',tool:'codex',path:native}));
 const event=(id,text)=>JSON.stringify({timestamp:'2026-11-05T00:00:00Z',type:'response_item',payload:{id,type:'message',role:'assistant',content:[{type:'output_text',text}]}})+'\n';
 fs.writeFileSync(native,event('old','Large retained history '.repeat(10000)));fs.writeFileSync(path.join(root,'chat.json'),JSON.stringify({messages:[{id:1,text:'Large retained chat '.repeat(10000)}]}));
 let handler=createChatHandler({root});t.after(async()=>{await handler.shutdown();fs.rmSync(root,{recursive:true,force:true});});
 const get=(endpoint,known='',opt=true)=>{let body,headers;handler.handle({method:'GET',headers:{'accept-encoding':'gzip'}},{writeHead(s,h){headers=h;},end(b){body=b;}},new URL('http://fixture'+endpoint+(endpoint.includes('?')?'&':'?')+(opt?'delta=1&':'')+'known='+known));return JSON.parse(headers['Content-Encoding']==='gzip'?zlib.gunzipSync(Buffer.from(body)):body);};
 const first=get('/api/transcript?session=synthetic'),chat=get('/api/chat');
 fs.appendFileSync(native,event('new','New answer'));fs.writeFileSync(path.join(root,'chat.json'),JSON.stringify({messages:[{id:1,text:'Large retained chat '.repeat(10000)},{id:2,text:'New question'}]}));
 const update=get('/api/transcript?session=synthetic',first.version),chatUpdate=get('/api/chat',chat.version);
 assert.equal(update.delta,true);assert.equal(update.baseVersion,first.version);assert.equal(update.items.length,1);assert.equal(update.items[0].text,'New answer');assert.equal(update.order.length,2);assert.equal(chatUpdate.delta,true);assert.deepEqual(chatUpdate.messages,[{id:2,text:'New question'}]);
 assert.equal(get('/api/transcript?session=synthetic',first.version,false).items.length,2,'old clients retain complete response');
 assert.equal(get('/api/chat',chatUpdate.version).unchanged,true);
 await handler.shutdown();handler=createChatHandler({root});const recovered=get('/api/chat',chatUpdate.version);assert.equal(recovered.unchanged,true);const unknown=get('/api/chat',chat.version);assert.equal(unknown.delta,undefined);assert.equal(unknown.messages.length,2);
});
