import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readCodexHistory, carryTranscriptHistory, readStoredHistory } from '../scripts/transcript-store.mjs';
import { replaceSessionState } from '../scripts/session-state.mjs';
import { A, B, makeDir, startServer, openWidget, getBrowser, closeBrowser } from './helpers.mjs';

after(closeBrowser);

test('received Orca messages use peer styling only with a registered sender command', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-codex-peer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'sessions'));
  const source = { sessionId: 'source', tool: 'codex', name: 'Source', agent: 'Codex', path: path.join(root, 'source.jsonl') };
  const target = { ...source, sessionId: 'target', name: 'Target', path: path.join(root, 'target.jsonl'), orca: { terminal: 'term_target' } };
  for (const s of [source, target]) fs.writeFileSync(path.join(root, 'sessions', s.sessionId + '.json'), JSON.stringify(s));
  const text = "[Source] Here's the result: 한글\nsecond line";
  const message = (id, value) => ({ timestamp: '2026-10-30T00:00:01Z', type: 'response_item', payload: { id, type: 'message', role: 'user', content: [{ type: 'input_text', text: value }] } });
  const received = [message('received', text), message('owner', '[Source] owner wrote this'), message('repeat', text), message('wrong-target', 'OK'), message('second-command', 'Second'), { ...message('old-send', 'Late'), timestamp: '2026-11-30T00:00:00Z' }];
  fs.writeFileSync(target.path, received.map(JSON.stringify).join('\n'));
  fs.writeFileSync(source.path, '');
  assert.equal(readCodexHistory(root, target).items[0].from, 'user', 'a name prefix alone is not peer evidence');
  const command = `& "C:\\Programs\\Orca\\orca.exe" terminal send --terminal term_target --text '${text.replaceAll("'", "''")}' --enter --json`;
  const second = "orca terminal send --terminal term_target --text 'Second' --enter --json";
  const sent = { timestamp: '2026-10-30T00:00:00Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: `text(await tools.exec_command(${JSON.stringify({ cmd: command })}));text(await tools.exec_command(${JSON.stringify({ cmd: second })}));` } };
  const wrongTarget = { ...sent, payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: "orca terminal send --terminal term_other --text 'OK' --enter --json" }) } };
  const oldSend = { ...wrongTarget, payload: { ...wrongTarget.payload, arguments: JSON.stringify({ cmd: "orca terminal send --terminal term_target --text 'Late' --enter --json" }) } };
  fs.writeFileSync(source.path, [sent, wrongTarget, oldSend].map(JSON.stringify).join('\n'));
  const history = readCodexHistory(root, target);
  assert.deepEqual(history.items.map(x => x.from), ['peer', 'user', 'user', 'user', 'peer', 'user']);
  assert.equal(history.items[0].session, source.sessionId);
  assert.equal(history.items[0].to, target.sessionId);
  assert.equal(history.items[0].fromName, 'Source');
  assert.equal(history.items[0].id, 'xreceived', 'classification preserves message IDs');
  assert.equal(history.items[0].text, text);
  assert.equal(fs.readFileSync(target.path, 'utf8'), received.map(JSON.stringify).join('\n'), 'native history stays read-only');
  fs.unlinkSync(source.path);
  assert.equal(readCodexHistory(root, target).items[0].from, 'peer', 'verified provenance survives source deletion');
  replaceSessionState(root, [{ from: source.sessionId, to: 'new-source' }]);
  assert.equal(readStoredHistory(root, target.sessionId).items[0].session, 'new-source', 'replacing the sender updates peer histories stored by the recipient');
  carryTranscriptHistory(root, target, 'replacement');
  const migrated = readStoredHistory(root, 'replacement').items[0];
  assert.equal(migrated.session, 'new-source', 'replacing the receiving session preserves its peer sender');
  assert.equal(migrated.to, 'replacement');
});

for (const width of [390, 1440]) {
  test(`Codex peer evidence changes an existing bubble to amber in both tabs (${width}px)`, async () => {
    const root = makeDir();
    const sessions = [A, B].map(id => {
      const s = JSON.parse(fs.readFileSync(path.join(root, 'sessions', id + '.json')));
      s.tool = 'codex';
      s.path = path.join(root, id + '.jsonl');
      s.orca = { terminal: id === B ? 'term_target' : 'term_source' };
      fs.writeFileSync(path.join(root, 'sessions', id + '.json'), JSON.stringify(s));
      return s;
    });
    const text = 'Peer message';
    fs.writeFileSync(sessions[0].path, '');
    fs.writeFileSync(sessions[1].path, JSON.stringify({ timestamp: '2026-10-30T00:00:01Z', type: 'response_item', payload: { type: 'message', id: 'incoming', role: 'user', content: [{ type: 'input_text', text }] } }));
    const srv = await startServer(root);
    const ctx = await (await getBrowser()).newContext({ viewport: { width, height: 900 } });
    try {
      const { page, w } = await openWidget(srv, { ctx, tab: B });
      assert.match((await w.msgs())[0].cls, /\buser\b/);
      fs.writeFileSync(sessions[0].path, JSON.stringify({ timestamp: '2026-10-30T00:00:00Z', type: 'response_item', payload: { type: 'function_call', name: 'functions.exec_command', arguments: JSON.stringify({ cmd: `orca terminal send --terminal term_target --text '${text}' --enter --json` }) } }));
      await page.waitForFunction(() => [...document.querySelectorAll('*')].some(e => e.shadowRoot?.querySelector('.msg.peer.in')), null, { timeout: 8000 });
      const style = await w.eval(r => { const el = r.querySelector('.msg.peer.in'); return { background: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderStyle, tag: el.querySelector('.tag').textContent }; });
      assert.equal(style.background, 'rgb(255, 247, 237)');
      assert.equal(style.border, 'dashed');
      assert.ok(style.tag.includes('세션끼리'));
      await w.click('#tabs button[role="tab"]:first-child');
      await page.waitForFunction(() => [...document.querySelectorAll('*')].some(e => e.shadowRoot?.querySelector('.msg.peer.out')));
      assert.equal((await w.msgs()).filter(x => x.text === text).length, 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    } finally { await ctx.close(); srv.stop(); }
  });
}
