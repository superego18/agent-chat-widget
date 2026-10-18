import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createChatHandler } from '../scripts/chat-handler.mjs';

test('side process preserves settings paths and UTF-8 stdin without a shell profile', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-side-test-'));
  const originalPath = process.env.PATH;
  t.after(() => {
    process.env.PATH = originalPath;
    assert.equal(path.dirname(temp), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith('widget-side-test-'));
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const root = path.join(temp, 'review files 한글');
  const bin = path.join(temp, 'fake bin');
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  fs.mkdirSync(bin);
  const session = 'synthetic-side-thread';
  fs.writeFileSync(path.join(root, 'sessions', `${session}.json`), JSON.stringify({ sessionId: session, tool: 'claude', name: 'Test session' }));
  const windows = process.platform === 'win32';
  fs.writeFileSync(path.join(bin, windows ? 'claude.cjs' : 'claude'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const settings = JSON.parse(fs.readFileSync(args[args.indexOf('--settings') + 1], 'utf8'));
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (b) => prompt += b).on('end', () => console.log(JSON.stringify({ session_id: 'synthetic-fork', result: JSON.stringify({ args, settings, prompt }) })));
`, { mode: 0o755 });
  if (windows) fs.writeFileSync(path.join(bin, 'claude.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0claude.cjs" %*\r\n`);
  // Exclude installed agent CLIs: only the synthetic executable may be resolved.
  process.env.PATH = [bin, path.dirname(process.execPath), ...(windows ? [path.join(process.env.SystemRoot, 'System32')] : [])].join(path.delimiter);
  t.mock.method(fs, 'watch', () => ({}));
  const chat = createChatHandler({ root });
  const req = new EventEmitter();
  req.method = 'POST';
  const question = 'Synthetic question: 한글 "quotes" & $literal';
  let response;
  const res = { writeHead(status) { assert.equal(status, 200); }, end(body) { response = JSON.parse(body); } };
  assert.equal(chat.handle(req, res, new URL('http://test.invalid/api/side')), true);
  req.emit('data', JSON.stringify({ session, from: 'user', text: question, cid: 'side-question' }));
  req.emit('end');
  assert.equal(response.to, undefined);
  let messages;
  for (let i = 0; i < 100; i++) {
    messages = JSON.parse(fs.readFileSync(path.join(root, 'chat.json'), 'utf8')).messages;
    if (messages.length > 1) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(messages.length, 2, 'The isolated CLI must finish exactly one reply');
  const result = JSON.parse(messages[1].text);
  assert.deepEqual(result.settings, { disableAllHooks: true });
  assert.equal(result.args[result.args.indexOf('--settings') + 1], path.join(root, 'side-settings.json'));
  assert.ok(result.prompt.includes(question));
  assert.deepEqual(messages[1].re, [response.id]);
});

test('side spawn error followed by close creates only one failure reply', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-side-test-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('widget-side-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, 'sessions'));
  fs.writeFileSync(path.join(root, 'sessions', 'synthetic.json'), JSON.stringify({ sessionId: 'synthetic', tool: 'claude' }));
  t.mock.method(fs, 'watch', () => ({}));
  const spawnMock = t.mock.method(childProcess, 'spawn', () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    process.nextTick(() => {
      child.emit('error', new Error('Synthetic spawn failure'));
      child.emit('close', -1);
    });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { spawnMock.mock.restore(); syncBuiltinESMExports(); });
  const chat = createChatHandler({ root });
  const req = new EventEmitter();
  req.method = 'POST';
  chat.handle(req, { writeHead() {}, end() {} }, new URL('http://test.invalid/api/side'));
  req.emit('data', JSON.stringify({ session: 'synthetic', from: 'user', text: 'Synthetic question' }));
  req.emit('end');
  await new Promise((resolve) => setImmediate(resolve));
  const messages = JSON.parse(fs.readFileSync(path.join(root, 'chat.json'), 'utf8')).messages;
  assert.equal(messages.length, 2);
  assert.equal(messages[1].from, 'agent');
  assert.match(messages[1].text, /Synthetic spawn failure/);
  assert.deepEqual(messages[1].re, [messages[0].id]);
});
