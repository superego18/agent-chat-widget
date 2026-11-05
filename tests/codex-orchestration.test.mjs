import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readCodexHistory } from '../scripts/transcript-store.mjs';
import { matchOrchestrationInput, createEvidenceContext, readEvidenceRegistry, readEvidenceRecords,
  readOrchestrationEvidence, takeEvidenceReceipt, evidenceCacheSnapshot, EVIDENCE_LIMITS } from '../scripts/codex-orchestration.mjs';
import { readPeerSends } from '../scripts/codex-peers.mjs';
import { createPeerSourceIndex } from '../scripts/codex-peer-index.mjs';
import { A, B, makeDir, startServer, openWidget, closeBrowser } from './helpers.mjs';

test('literal PowerShell path and long history retain verified orchestration wake provenance', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'widget-orca-wake-'));
  fs.mkdirSync(path.join(root,'sessions'));
  const source={sessionId:'source',tool:'codex',name:'Source',path:path.join(root,'source.jsonl'),orca:{terminal:'term_source'}};
  const target={sessionId:'target',tool:'codex',name:'Target',path:path.join(root,'target.jsonl'),orca:{terminal:'term_target'}};
  for(const s of [source,target])fs.writeFileSync(path.join(root,'sessions',s.sessionId+'.json'),JSON.stringify(s));
  fs.writeFileSync(source.path,'');
  const at=new Date().toISOString(),text='You have 1 orchestration message. Run `orca orchestration check`.';
  const wake={timestamp:at,type:'response_item',payload:{id:'actual-wake',type:'message',role:'user',content:[{type:'input_text',text}]}};
  const done={timestamp:at,type:'event_msg',payload:{type:'item_completed',item:{type:'CommandExecution',command:['powershell','-Command',"& 'C:/Programs/Orca/orca.exe' orchestration check --terminal term_target --json"],exit_code:0,aggregated_output:JSON.stringify({ok:true,result:{deliveryId:'delivery_actual',count:1,messages:[{id:'msg_actual',from_handle:'term_source',to_handle:'term_target',created_at:at,body:'Private synthetic body must not be retained in provenance index'}]}})}}};
  const older=Array.from({length:18},(_,n)=>{const old=structuredClone(done);old.timestamp=new Date(Date.parse(at)-(3600-n)*1000).toISOString();const value=JSON.parse(old.payload.item.aggregated_output);value.result.deliveryId='old_delivery_'+n;old.payload.item.aggregated_output=JSON.stringify(value);return old;});
  fs.writeFileSync(target.path,[...older,{timestamp:at,type:'response_item',payload:{type:'function_call_output',output:'x'.repeat(1024*1024)}},wake,done].map(JSON.stringify).join('\n')+'\n');
  const original=fs.readFileSync(target.path),index=createPeerSourceIndex();
  t.after(async()=>{await index.shutdown();fs.rmSync(root,{recursive:true,force:true});});
  let item;
  for(let n=0;n<100;n++){
    item=readCodexHistory(root,target,Object.assign(createEvidenceContext(),{peerSources:index})).items.find(x=>x.id==='xactual-wake');
    if(item?.from==='peer')break;
    await new Promise(r=>setTimeout(r,10));
  }
  assert.equal(item.from,'peer');assert.equal(item.session,'source');assert.equal(item.to,'target');
  assert.equal(item.peerMethod,'mailbox');
  assert.equal(item.text,text);assert.deepEqual(fs.readFileSync(target.path),original);
  assert.equal(JSON.stringify(index.read(target).rows).includes('Private synthetic body'),false,'mailbox bodies are not cached as provenance');
});

test('accepted worker-start receipts prove the exact native task without separate task/show calls', () => {
  const source = { sessionId: 'source', name: 'Coordinator', orca: { terminal: 'term_source' } }, target = { sessionId: 'target', orca: { terminal: 'term_target' } };
  const text = "You are working inside Orca, a multi-agent IDE. You are a dispatched worker.\nYour coordinator's terminal handle is: term_source\nYour task ID is: task_one\n\norca orchestration send --from term_target --task-id task_one --dispatch-id ctx_one\n\n=== TASK ===\nDo the owner's scoped task.";
  const receipt = { session: source, cmd: "orca orchestration worker-start --terminal term_target --spec 'Do the owner''s scoped task.' --json", at: '2026-10-30T00:00:06Z', result: { taskId: 'task_one', dispatchId: 'ctx_one', stage: 'input_accepted', effects: [{ kind: 'dispatch_input', id: 'term_target', state: 'accepted' }] } };
  const match = (r = receipt, input = text) => matchOrchestrationInput({ sessions: [source, target], target, results: [r] }, input, '2026-10-30T00:00:05Z', new Set());
  assert.equal(match()[0]?.session, 'source');
  for (const result of [{ ...receipt.result, taskId: 'task_other' }, { ...receipt.result, dispatchId: 'ctx_other' }, { ...receipt.result, effects: [] }]) assert.deepEqual(match({ ...receipt, result }), []);
  assert.deepEqual(match(receipt, text + '\nOwner addition'), []);
  assert.deepEqual(match({ ...receipt, cmd: receipt.cmd.replace('term_target', 'term_wrong') }), []);
  const existing = { ...receipt, cmd: 'orca orchestration worker-start --terminal term_target --task task_one --json' };
  const task = { session: source, result: { task: { id: 'task_one', created_by_terminal_handle: 'term_source', spec: "Do the owner's scoped task." } } };
  assert.equal(matchOrchestrationInput({ sessions: [source, target], target, results: [existing, task] }, text, '2026-10-30T00:00:05Z', new Set())[0]?.session, 'source');
  assert.deepEqual(match(existing), [], 'existing-task start still needs the exact recorded task spec');
});

test('verified mailbox delivery labels unregistered and mixed senders without guessing a registered identity', () => {
  const target = { sessionId: 'target', orca: { terminal: 'term_target' } }, source = { sessionId: 'source', name: 'Source', orca: { terminal: 'term_source' } };
  const at = '2026-10-30T00:00:01Z';
  const messages = ['term_unregistered', 'dispatch:ctx_unregistered'].map((from_handle, i) => ({ id: `msg_${i}`, from_handle, to_handle: 'run:run_one', created_at: '2026-10-30T00:00:00Z' }));
  const receipt = { session: target, cmd: 'orca orchestration check --run run_one --json', at: '2026-10-30T00:00:02Z', result: { runId: 'run_one', deliveryId: 'delivery_one', messages } };
  const match = (r = receipt) => matchOrchestrationInput({ sessions: [source, target], target, results: [r] }, 'You have 2 orchestration messages. Run `orca orchestration check --run run_one`.', at, new Set());
  assert.equal(match().length, 2);
  assert.ok(match().every(m => !m.session && m.fromName));
  assert.deepEqual(match({ ...receipt, result: { ...receipt.result, messages: messages.map(m => ({ ...m, from_handle: '' })) } }), []);
  assert.deepEqual(match({ ...receipt, result: { ...receipt.result, dispatchId: 'ctx_unregistered' } }), [], 'current dispatch cannot be its own peer');
  assert.deepEqual(match({ ...receipt, result: { ...receipt.result, messages: messages.map(m => ({ ...m, from_handle: m.to_handle })) } }), [], 'a mailbox address cannot be its own peer');
});

test('compact mailbox receipts use real observation and sender identity without invented old fields', () => {
  const source={sessionId:'source',name:'Source',orca:{terminal:'term_source'}},target={sessionId:'target',orca:{terminal:'term_target'}};
  const text='You have 1 orchestration message. Run `orca orchestration check --run run_one`.';
  const at='2026-11-04T00:00:00Z';
  const receipt={session:target,cmd:"& 'C:/Programs/Orca/orca.exe' orchestration check --run run_one --json",at:'2026-11-04T00:00:05Z',result:{messages:[{id:'msg_compact',from:'term_source'}]}};
  const match=(r=receipt,input=text,used=new Set())=>matchOrchestrationInput({sessions:[source,target],target,results:[r]},input,at,used);
  assert.equal(match()[0].session,'source');assert.equal(match()[0].at,receipt.at);
  assert.deepEqual(match(receipt,'Owner comment\n'+text),[]);
  assert.deepEqual(match(receipt,text,new Set(['orca:msg_compact'])),[]);
  for(const cmd of [receipt.cmd.replace('run_one','run_other'),receipt.cmd+' --terminal term_foreign',receipt.cmd+" --terminal 'term_foreign'",receipt.cmd+' --terminal $foreign'])assert.deepEqual(match({...receipt,cmd}),[]);
  assert.deepEqual(match({...receipt,at:'2026-11-04T00:02:00Z'}),[]);
  assert.deepEqual(match({...receipt,result:{messages:[{id:'msg_compact',from:'term_target'}]}}),[]);
  assert.deepEqual(match({...receipt,result:{messages:[{id:'msg_compact'}]}}),[]);
  const unknown=match({...receipt,result:{messages:[{id:'msg_compact',from:'term_unregistered'}]}});
  assert.equal(unknown[0].session,undefined);assert.equal(unknown[0].fromName,'다른 세션');
  const pair={...receipt,result:{messages:[{id:'msg_one',from:'term_source'},{id:'msg_two',from:'term_source'}]}};
  assert.equal(match(pair,text+'\n\n'+text).length,2,'combined native wake input can be covered by the exact mailbox count');
  assert.deepEqual(match(pair,text+'\n\nOwner addition'),[]);
  assert.deepEqual(match(pair,text+'\n\n'+text.replace('run_one','run_other')),[]);
  assert.deepEqual(match({...pair,result:{messages:[pair.result.messages[0],pair.result.messages[0]]}},text+'\n\n'+text),[]);
});

test('verified Orca dispatches and mailbox wakes are peer messages, preserving native IDs', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-orchestration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'sessions'));
  const source = { sessionId: 'source', tool: 'codex', name: 'Coordinator', path: path.join(root, 'source.jsonl'), orca: { terminal: 'term_source' } };
  const target = { ...source, sessionId: 'target', name: 'Worker', path: path.join(root, 'target.jsonl'), orca: { terminal: 'term_target' } };
  for (const s of [source, target]) fs.writeFileSync(path.join(root, 'sessions', s.sessionId + '.json'), JSON.stringify(s));
  const done = (cmd, result, at = '2026-10-30T00:00:00Z', exit = 0) => ({ timestamp: at, type: 'event_msg', payload: { type: 'item_completed', item: { type: 'CommandExecution', command: ['pwsh', '-Command', cmd], exit_code: exit, aggregated_output: JSON.stringify({ ok: true, result }) } } });
  const message = (id, text, at) => ({ timestamp: at, type: 'response_item', payload: { id, type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
  const preamble = "You are working inside Orca, a multi-agent IDE. You are a dispatched worker.\nYour coordinator's terminal handle is: term_source\nYour task ID is: task_one\n\norca orchestration send --from term_target --task-id task_one --dispatch-id ctx_one\n\n=== TASK ===\nDo the scoped task.";
  const wake = 'You have 1 orchestration message. Run `orca orchestration check`.';
  const native = [message('task', preamble, '2026-10-30T00:00:05Z'), message('wake', wake, '2026-10-30T00:00:10Z'), message('owner', 'Owner text\n' + wake, '2026-10-30T00:00:10Z'), message('forged', preamble.replace('Do the scoped task.', 'Different task.'), '2026-10-30T00:00:12Z'), message('unproved', wake, '2026-10-30T00:03:00Z')];
  fs.writeFileSync(target.path, native.map(JSON.stringify).join('\n'));
  fs.writeFileSync(source.path, '');
  assert.ok(readCodexHistory(root, target).items.every(x => x.from === 'user'));
  fs.writeFileSync(source.path, [done('orca orchestration task-create --json', { task: { id: 'task_one', run_id: 'run_one', spec: 'Do the scoped task.', created_by_terminal_handle: 'term_source' } }), done('orca orchestration worker-show --dispatch ctx_one --json', { dispatch: { id: 'ctx_one', taskId: 'task_one', runId: 'run_one', assigneeHandle: 'term_target' } })].map(JSON.stringify).join('\n'));
  const delivered = done('orca orchestration check --terminal term_target --json', { dispatchId: 'ctx_one', deliveryId: 'delivery_one', messages: [{ id: 'msg_one', from_handle: 'term_source', to_handle: 'dispatch:ctx_one', created_at: '2026-10-30T00:00:09Z' }], count: 1 }, '2026-10-30T00:00:11Z');
  const failed = structuredClone(delivered); failed.payload.item.exit_code = 1;
  fs.appendFileSync(target.path, '\n' + JSON.stringify(failed));
  assert.deepEqual(readCodexHistory(root, target).items.map(x => x.from), ['peer', 'user', 'user', 'user', 'user'], 'failed CLI receipts never prove a mailbox sender');
  fs.appendFileSync(target.path, '\n' + JSON.stringify(delivered));
  const history = readCodexHistory(root, target);
  assert.deepEqual(history.items.map(x => x.from), ['peer', 'peer', 'user', 'user', 'user']);
  for (const item of history.items.slice(0, 2)) { assert.equal(item.session, 'source'); assert.equal(item.to, 'target'); assert.equal(item.fromName, 'Coordinator'); }
  assert.deepEqual(history.items.slice(0,2).map(x=>x.peerMethod),['dispatch','mailbox']);
  assert.deepEqual(history.items.map(x => x.id), ['xtask', 'xwake', 'xowner', 'xforged', 'xunproved']);
  assert.equal(history.items[0].text, preamble);
  const unchanged = fs.readFileSync(target.path, 'utf8');
  fs.writeFileSync(source.path, '');
  assert.equal(readCodexHistory(root, target).items[0].from, 'peer', 'verified classification is durable');
  assert.equal(fs.readFileSync(target.path, 'utf8'), unchanged, 'provider history is read-only');
});

test('mailbox provenance rejects invalid senders, wrong destinations, stale receipts and mixed owner input', () => {
  const source = { sessionId: 'source', name: 'Source', orca: { terminal: 'term_source' } }, target = { sessionId: 'target', orca: { terminal: 'term_target' } };
  const wake = 'You have 1 orchestration message. Run `orca orchestration check --run run_one`.';
  const message = { id: 'msg_one', from_handle: 'term_source', to_handle: 'run:run_one', created_at: '2026-10-30T00:00:00Z' };
  const receipt = { session: target, cmd: 'orca orchestration check --json', at: '2026-10-30T00:00:02Z', result: { deliveryId: 'delivery_one', runId: 'run_one', messages: [message] } };
  const evidence = r => ({ sessions: [source, target], target, results: [r] });
  const match = (r = receipt, text = wake, at = '2026-10-30T00:00:01Z', used = new Set()) => matchOrchestrationInput(evidence(r), text, at, used);
  assert.equal(match().length, 1);
  for (const patch of [{ from_handle: '' }, { to_handle: 'term_other' }, { created_at: '2026-10-30T00:00:03Z' }]) assert.deepEqual(match({ ...receipt, result: { ...receipt.result, messages: [{ ...message, ...patch }] } }), []);
  assert.deepEqual(match({ ...receipt, cmd: 'orca orchestration check --terminal term_other --json' }), []);
  assert.deepEqual(match(receipt, 'Owner text\n' + wake), []);
  assert.deepEqual(match({ ...receipt, at: '2026-10-30T00:02:00Z' }), []);
  assert.deepEqual(match(receipt, wake, undefined, new Set(['orca:msg_one'])), []);
  assert.deepEqual(match({ ...receipt, result: { ...receipt.result, messages: [message, { ...message, id: 'msg_two', from_handle: 'term_target' }] } }, wake.replace('1 orchestration message', '2 orchestration messages')), []);
});

test('a verified mailbox receipt recolors the existing native bubble in the mobile widget', async () => {
  const root = makeDir(), sessions = [A, B].map((id, i) => {
    const file = path.join(root, 'sessions', id + '.json'), s = JSON.parse(fs.readFileSync(file));
    Object.assign(s, { tool: 'codex', path: path.join(root, id + '.jsonl'), orca: { terminal: i ? 'term_target' : 'term_source' } });
    fs.writeFileSync(file, JSON.stringify(s)); fs.writeFileSync(s.path, ''); return s;
  });
  const notice = 'You have 1 orchestration message. Run `orca orchestration check --run run_one`.';
  const text = notice + '\n\n' + notice;
  fs.writeFileSync(sessions[1].path, JSON.stringify({ timestamp: '2026-10-30T00:00:01Z', type: 'response_item', payload: { id: 'wake', type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }));
  const srv = await startServer(root); let ctx;
  try {
    const opened = await openWidget(srv, { tab: B }); ctx = opened.ctx;
    const { w, page } = opened;
    assert.match((await w.msgs()).find(x => x.id === 'xwake').cls, /\buser\b/);
    fs.appendFileSync(sessions[1].path, '\n' + JSON.stringify({ timestamp: '2026-10-30T00:00:02Z', type: 'event_msg', payload: { type: 'item_completed', item: { type: 'CommandExecution', command: ['pwsh', '-Command', "& 'C:/Programs/Orca/orca.exe' orchestration check --run run_one --json"], exit_code: 0, aggregated_output: JSON.stringify({ ok: true, result: { messages: [{ id: 'msg_one', from: 'term_source' }, { id: 'msg_two', from: 'term_source' }] } }) } } }));
    await page.waitForFunction(() => [...document.querySelectorAll('*')].some(e => e.shadowRoot?.querySelector('.msg.peer.in[data-id="xwake"]')), null, { timeout: 8000 });
    const style = await w.eval(r => { const el = r.querySelector('.msg[data-id="xwake"]'); return { background: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderStyle, tag: el.querySelector('.tag').textContent }; });
    assert.equal(style.background, 'rgb(255, 247, 237)'); assert.equal(style.border, 'dashed'); assert.ok(style.tag.includes('세션끼리'));
    assert.ok(style.tag.includes('수신함 알림'));
    assert.equal((await w.msgs()).filter(x => x.id === 'xwake').length, 1);
  } finally { await ctx?.close(); await closeBrowser(); srv.stop(); }
});

function boundedFixture(t, count = 1) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-evidence-budget-'));
  fs.mkdirSync(path.join(root, 'sessions'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessions = Array.from({ length: count }, (_, i) => ({ sessionId: `bounded-${i}`, tool: 'codex', name: `Peer ${i}`,
    path: path.join(root, `${i}.jsonl`), orca: { terminal: `term_bounded${i}` } }));
  for (const s of sessions) {
    fs.writeFileSync(path.join(root, 'sessions', s.sessionId + '.json'), JSON.stringify(s));
    fs.writeFileSync(s.path, '');
  }
  return { root, sessions };
}
const commandRecord = (text = 'complete command') => ({ timestamp: '2026-01-01T00:00:00Z', type: 'response_item',
  payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: text }) } });

test('one context bounds registrations, aggregate changed reads/events and repeated targets', t => {
  const f = boundedFixture(t, 6), context = createEvidenceContext();
  for (const s of f.sessions) fs.writeFileSync(s.path, Array.from({ length: 1000 }, () => JSON.stringify(commandRecord())).join('\n'));
  for (const target of f.sessions) {
    readPeerSends(f.root, target, context); readOrchestrationEvidence(f.root, target, context);
  }
  const before = { bytes: context.readBytes, events: context.events, changed: context.changedSources };
  readPeerSends(f.root, f.sessions[0], context); readOrchestrationEvidence(f.root, f.sessions[0], context);
  assert.deepEqual({ bytes: context.readBytes, events: context.events, changed: context.changedSources }, before);
  assert.ok(context.readBytes <= EVIDENCE_LIMITS.readBytes);
  assert.ok(context.events <= EVIDENCE_LIMITS.events);
  assert.ok(context.changedSources <= EVIDENCE_LIMITS.changedSources);
  assert.ok(context.partial.size, 'cold incomplete prefixes are not positive proof');
  const many = boundedFixture(t, 65), registryContext = createEvidenceContext();
  assert.equal(readEvidenceRegistry(many.root, registryContext).complete, false);
  assert.equal(registryContext.registrations, 64);
  assert.ok(registryContext.registryBytes <= 512 * 1024);
});

test('incremental cold scans keep absolute line IDs and invalidate same-size rewrite/rotation', t => {
  const f = boundedFixture(t), session = f.sessions[0];
  const native = JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [] } });
  const send = commandRecord("orca terminal send --terminal term_target --text 'exact peer' --enter");
  fs.writeFileSync(session.path, [...Array(700).fill(native), JSON.stringify(send)].join('\n'));
  let source;
  for (let n = 0; n < 8; n++) {
    source = readEvidenceRecords(f.root, session, createEvidenceContext());
    if (source.complete) break;
  }
  assert.equal(source.complete, true);
  assert.equal(source.rows.find(x => x.record.payload?.type === 'function_call').index, 700);
  fs.appendFileSync(session.path, '\n' + JSON.stringify(commandRecord('second')));
  source = readEvidenceRecords(f.root, session, createEvidenceContext());
  assert.deepEqual(source.rows.map(x => x.index), [700, 701]);
  fs.renameSync(session.path, session.path + '.old');
  fs.writeFileSync(session.path, JSON.stringify(commandRecord('replacement')));
  source = readEvidenceRecords(f.root, session, createEvidenceContext());
  assert.equal(source.rows[0].index, 0); assert.equal(source.rows.length, 1);
  assert.equal(source.rows[0].record.payload.arguments, JSON.stringify({ cmd: 'replacement' }));
});

test('projected cache obeys both limits; oversized/partial records never yield suffix proof', t => {
  const f = boundedFixture(t, 25);
  for (const session of f.sessions) {
    fs.writeFileSync(session.path, Array.from({ length: 3 }, () => JSON.stringify(commandRecord('x'.repeat(58000)))).join('\n'));
    const context = createEvidenceContext(); readEvidenceRecords(f.root, session, context);
    assert.ok(context.readBytes <= EVIDENCE_LIMITS.sourceBytes);
    assert.ok(evidenceCacheSnapshot().bytes <= 2 * 1024 * 1024);
    assert.ok(evidenceCacheSnapshot().entries <= 32);
  }
  fs.writeFileSync(f.sessions[0].path, 'x'.repeat(400000) + '\n' + JSON.stringify(commandRecord('not suffix proof')));
  let result;
  for (let n = 0; n < 3; n++) result = readEvidenceRecords(f.root, f.sessions[0], createEvidenceContext());
  assert.equal(result.complete, false); assert.deepEqual(result.rows, []);
});

test('receipt budgets are shared across consumers and never admit a truncated value', () => {
  const context = createEvidenceContext();
  for (let n = 0; n < 16; n++) assert.equal(takeEvidenceReceipt(context, 'one', { id: n }), true);
  assert.equal(takeEvidenceReceipt(context, 'one', { id: 16 }), false);
  assert.equal(takeEvidenceReceipt(context, 'one', { id: 0 }), true, 'same exact projection is counted once');
  assert.equal(takeEvidenceReceipt(context, 'two', { text: 'x'.repeat(65536) }), false);
  for (let source = 0; source < 16; source++) for (let n = 0; n < 16; n++) takeEvidenceReceipt(context, `source-${source}`, { source, n, text: 'x'.repeat(2500) });
  assert.ok(context.receipts <= 128); assert.ok(context.receiptBytes <= 256 * 1024);
});

test('peer stat-success/read-failure cannot discard healthy current history or create pickup', t => {
  const f = boundedFixture(t, 2), [target, peer] = f.sessions;
  const record = (id, role, text) => ({ timestamp: '2026-01-01T00:00:01Z', type: 'response_item',
    payload: { type: 'message', id, role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
  const exact = 'Original full native text ' + 'y'.repeat(70000);
  fs.writeFileSync(target.path, [record('old', 'user', 'kept peer text'), record('new', 'assistant', exact)].map(JSON.stringify).join('\n'));
  fs.writeFileSync(peer.path, JSON.stringify(commandRecord("orca terminal send --terminal term_bounded0 --text 'kept peer text' --enter")));
  fs.mkdirSync(path.join(f.root, 'transcript-history'));
  fs.writeFileSync(path.join(f.root, 'transcript-history', target.sessionId + '.json'), JSON.stringify({ items: [
    { id: 'xold', from: 'peer', session: peer.sessionId, to: target.sessionId, peerSend: 'already-proven-id', text: 'kept peer text', at: '2026-01-01T00:00:01Z' },
  ] }));
  const inode = fs.statSync(peer.path).ino; let failedReads = 0;
  const io = { ...fs, readSync(fd, ...args) {
    if (fs.fstatSync(fd).ino === inode) { failedReads++; throw Object.assign(new Error('synthetic read race'), { code: 'EACCES' }); }
    return fs.readSync(fd, ...args);
  } };
  const context = createEvidenceContext({ io }), before = fs.readFileSync(target.path, 'utf8');
  const result = readCodexHistory(f.root, target, context);
  assert.ok(failedReads > 0); assert.ok(context.partial.size);
  assert.equal(result.items.find(x => x.id === 'xold').from, 'peer');
  assert.equal(result.items.find(x => x.id === 'xold').peerSend, 'already-proven-id');
  assert.equal(result.items.find(x => x.id === 'xnew').text, exact);
  assert.equal(fs.readFileSync(target.path, 'utf8'), before);
});
