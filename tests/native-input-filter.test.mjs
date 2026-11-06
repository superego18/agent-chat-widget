import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readCodexHistory } from '../scripts/transcript-store.mjs';
import { adjustText, quoteLines } from '../scripts/chat-format.mjs';

const receipt = '11111111-1111-4111-8111-111111111111';
const at = '2026-10-31T00:00:01Z';
const environment = '<environment_context>\n  <cwd>/synthetic</cwd>\n  <shell>bash</shell>\n</environment_context>';
const instructions = '# AGENTS.md instructions for /synthetic\n\n<INSTRUCTIONS>\nSynthetic rules\n</INSTRUCTIONS>';
const metadata = (kind, type) => ({ content_item_kinds: [kind], content_item_metadata: [{ provenance: { type } }] });
const envelope = text => `[대화/피드백 · 앱 화면] [uifb-receipt:${receipt}] ${text}`;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-input-filter-'));
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('native-input-filter-')); fs.rmSync(root, { recursive: true, force: true }); });
  const session = { sessionId: 'target', agent: 'codex', tool: 'codex', path: path.join(root, 'rollout.jsonl') };
  fs.writeFileSync(session.path, '');
  const receive = (id, text, meta) => fs.appendFileSync(session.path, JSON.stringify({ type: 'response_item', timestamp: at, payload: {
    type: 'message', role: 'user', id, content: [{ type: 'input_text', text }], ...(meta ? { internal_chat_message_metadata_passthrough: meta } : {})
  } }) + '\n');
  const chat = messages => fs.writeFileSync(path.join(root, 'chat.json'), JSON.stringify({ messages }));
  return { root, session, receive, chat, read: () => readCodexHistory(root, session).items };
}

test('preserves genuine HTML, XML, instructions quotations and widget-like owner prose durably', t => {
  const f = fixture(t);
  const texts = ['<div>Owner HTML</div>', '<?xml version="1.0"?><note>Owner XML</note>',
    'Please explain the phrase AGENTS.md instructions in this quotation.', '[대화/피드백 안내] Owner question',
    '<system-reminder>Owner quoted markup</system-reminder>', instructions, environment];
  texts.forEach((text, i) => f.receive(String(i), text, metadata('user.text', 'user')));
  assert.deepEqual(f.read().map(x => x.text), texts);
  const ids = f.read().map(x => [x.id, x.refId]);
  fs.unlinkSync(f.session.path);
  assert.deepEqual(f.read().map(x => x.text), texts);
  assert.deepEqual(f.read().map(x => [x.id, x.refId]), ids);
});

test('suppresses only recognizable internal envelopes with verified internal metadata', t => {
  const f = fixture(t);
  f.receive('internal-agents', instructions, metadata('agents_md.instructions', 'agents_md'));
  f.receive('internal-environment', environment, metadata('environments.environment_context', 'harness'));
  f.receive('no-metadata', instructions);
  f.receive('no-metadata-env', environment);
  f.receive('wrong-envelope', '<div>Owner text</div>', metadata('environments.environment_context', 'harness'));
  f.receive('mixed-metadata', instructions, { content_item_kinds: ['agents_md.instructions', 'user.text'], content_item_metadata: [{ provenance: { type: 'agents_md' } }, { provenance: { type: 'user' } }] });
  assert.deepEqual(f.read().map(x => x.id), ['xno-metadata', 'xno-metadata-env', 'xwrong-envelope', 'xmixed-metadata']);
});

test('widget suppression requires exact receipt, destination and eligible timestamp in chat', t => {
  const f = fixture(t);
  f.receive('widget', envelope('Owner request'));
  const entry = { id: 7, from: 'user', to: 'target', context: 'app', text: 'Owner request', at: '2026-10-31T00:00:00Z', queue: { receipt } };
  for (const candidate of [{ ...entry, to: 'other' }, { ...entry, queue: { receipt: '22222222-2222-4222-8222-222222222222' } }, { ...entry, at: '2026-10-31T00:00:02Z' }, { ...entry, text: 'Different owner request' }]) {
    f.chat([candidate]);
    assert.equal(f.read()[0]?.text, envelope('Owner request'));
  }
  f.chat([entry]);
  assert.deepEqual(f.read(), [], 'the widget already represents this exact delivered input');
  f.chat([]);
  assert.equal(f.read()[0]?.id, 'xwidget', 'removing receipt evidence recovers native input from rollout');
});

test('unmatched, malformed and quoted receipt envelopes remain owner input', t => {
  const f = fixture(t);
  const texts = [envelope('Owner request'), envelope('Owner request').replace(receipt, 'invalid'), 'Owner quotation: ' + envelope('Owner request')];
  texts.forEach((text, i) => f.receive(String(i), text));
  assert.deepEqual(f.read().map(x => x.text), texts);
});

test('a represented envelope followed by a new owner question remains native input', t => {
  const f = fixture(t);
  f.chat([{ id: 7, from: 'user', to: 'target', context: 'app', text: 'Owner request', at, queue: { receipt } }]);
  f.receive('owner-suffix', envelope('Owner request') + '\nOwner question');
  assert.equal(f.read()[0]?.text, envelope('Owner request') + '\nOwner question');
});

test('matches the entire generated quote and location input using durable originals only', t => {
  const f = fixture(t);
  const original = { id: 'xpeer', from: 'peer', text: 'Original peer answer', session: 'source', to: 'target' };
  fs.mkdirSync(path.join(f.root, 'transcript-history'));
  fs.writeFileSync(path.join(f.root, 'transcript-history', 'source.json'), JSON.stringify({ items: [original] }));
  const where = { url: '/page', selector: '#title', component: 'Heading', text: 'Before', adjust: { text: { from: 'Before', to: 'After' } } };
  const entry = { id: 7, from: 'user', to: 'target', context: 'app', text: 'Owner request', at, queue: { receipt }, replyTo: 'xpeer', where };
  f.chat([entry]);
  const text = envelope(entry.text) + '\n' + quoteLines(entry, [original]).join('\n') + '\n위치: /page · #title · 컴포넌트 Heading · "Before"\n' + adjustText(where);
  f.receive('exact', text);
  f.receive('suffix', text + '\nOwner question');
  assert.deepEqual(f.read().map(x => x.id), ['xsuffix']);
  fs.unlinkSync(path.join(f.root, 'transcript-history', 'source.json'));
  assert.deepEqual(f.read().map(x => x.id).sort(), ['xexact', 'xsuffix'], 'missing original proof conservatively preserves both');
});

test('unrelated chat changes and queue status do not invalidate the native history cache', t => {
  const f = fixture(t);
  f.receive('owner', 'Owner message');
  const entry = { id: 7, from: 'user', to: 'target', context: 'app', text: 'Owner request', at, queue: { receipt, state: 'pending' } };
  f.chat([entry]);
  const before = f.read();
  f.chat([{ ...entry, queue: { receipt, state: 'accepted' } }, { id: 8, from: 'agent', text: 'Agent response' }, { ...entry, id: 9, to: 'other', text: 'Another session request' }]);
  assert.equal(f.read(), before);
});

const imageMarkup = paths => paths.map((file, index) => `<image name=[Image #${index + 1}] path="${file}">\n</image>`).join('\n');
const imageEntry = paths => ({id: 7, from: 'user', to: 'target', context: 'app', text: 'Synthetic photo question', at,
  queue: {receipt}, attachments: paths.map(localPath => ({localPath}))});

for (const paths of [['C:\\synthetic\\first.jpg', 'C:\\synthetic\\second.jpg'], ['/synthetic/photo.jpg']]) test(`photo echo with ${paths.length} known attachment paths is represented once`, t => {
  const f = fixture(t), entry = imageEntry(paths);
  f.chat([entry]);
  const text = envelope(entry.text) + '\n' + imageMarkup(paths);
  f.receive('photo', text);
  const original = fs.readFileSync(f.session.path), chatBytes = fs.readFileSync(path.join(f.root, 'chat.json'));
  assert.deepEqual(f.read(), [], 'the attachment-bearing chat bubble already represents this exact native input');
  assert.deepEqual(fs.readFileSync(f.session.path), original);
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'chat.json')), chatBytes);
});

test('photo-like owner text is retained without exact body, receipt, ordered paths and complete image markup', t => {
  const paths = ['/synthetic/photo.jpg'], entry = imageEntry(paths);
  const exact = envelope(entry.text) + '\n' + imageMarkup(paths);
  const variants = [exact + '\nNew owner question', exact.replace('/synthetic/photo.jpg', '/synthetic/other.jpg'),
    exact.replace('Image #1', 'Image #2'), exact.replace('\n</image>', '\nOwner text</image>'),
    exact.replace('Synthetic photo question', 'Different body'), exact.replace(receipt, '22222222-2222-4222-8222-222222222222')];
  for (const text of variants) {
    const f = fixture(t); f.chat([entry]); f.receive('owner', text);
    assert.equal(f.read()[0]?.text, text);
  }
  for (const change of [{attachments: []}, {to: 'other'}, {at: '2026-10-31T00:00:02Z'}]) {
    const f = fixture(t); f.chat([{...entry, ...change}]); f.receive('owner', exact);
    assert.equal(f.read()[0]?.text, exact);
  }
  const f = fixture(t), twoPaths = ['/synthetic/first.jpg', '/synthetic/second.jpg'];
  const reversed = envelope(entry.text) + '\n' + imageMarkup([...twoPaths].reverse());
  f.chat([imageEntry(twoPaths)]); f.receive('reordered', reversed);
  assert.equal(f.read()[0]?.text, reversed);
});

test('an old stored photo echo is hidden on proof arrival and recovered if that proof is removed', t => {
  const paths = ['/synthetic/photo.jpg'], entry = imageEntry(paths), f = fixture(t);
  const text = envelope(entry.text) + '\n' + imageMarkup(paths);
  f.receive('stored-photo', text);
  assert.equal(f.read()[0]?.text, text);
  f.chat([entry]); assert.deepEqual(f.read(), []);
  f.chat([]); assert.equal(f.read()[0]?.text, text);
});
