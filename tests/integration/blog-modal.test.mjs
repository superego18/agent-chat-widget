import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { closeBrowser, getBrowser, Widget } from '../helpers.mjs';
after(closeBrowser);

// The actual-modal cases deliberately fail without explicit, approved source
// pins. A skipped/role-only fixture must never be reported as modal acceptance.
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const modalCss = `
body{margin:0;font-family:system-ui}*{box-sizing:border-box}
[data-slot=sheet-overlay]{position:fixed;inset:0;background:#0004;z-index:50}
[data-slot=sheet-content]{position:fixed;display:flex;flex-direction:column;gap:16px;background:white;z-index:50;overflow-y:auto;padding:16px}
[data-slot=sheet-content][data-side=bottom]{left:0;right:0;bottom:0;max-height:88dvh}
[data-slot=sheet-content][data-side=right]{top:0;right:0;bottom:0;width:75%;max-width:576px}
[data-slot=sheet-close]{position:absolute;right:12px;top:12px}
textarea{min-height:64px;width:100%}button{min-height:32px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
body[data-constrained] #outer-sheet{inset:0;max-height:100dvh}
body[data-wrap] #outer-sheet{left:auto;right:0;width:170px;max-width:170px}
`;

function verifiedModalSource() {
  assert.ok(process.env.UIFB_BLOG_FIXTURE_ROOT && process.env.UIFB_MODAL_SOURCE_PINS,
    'Explicit UIFB_BLOG_FIXTURE_ROOT and UIFB_MODAL_SOURCE_PINS required; no source discovery');
  const blog = fs.realpathSync(process.env.UIFB_BLOG_FIXTURE_ROOT);
  const pins = JSON.parse(fs.readFileSync(process.env.UIFB_MODAL_SOURCE_PINS, 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(fs.realpathSync(pins.root), blog);
  assert.match(pins.expectedHead, /^[0-9a-f]{40}$/, 'Explicit immutable BLOG commit required');
  const head = execFileSync('git', ['-C', blog, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
  assert.equal(head, pins.expectedHead, 'Blog source moved: stop for repin before bundling');
  for (const row of pins.source) {
    const file = path.resolve(blog, row.path);
    assert.ok(file.startsWith(blog + path.sep));
    assert.equal(digest(fs.readFileSync(file)), row.workingSha256, row.path);
  }
  const sheetSource = path.join(blog, 'web/src/shared/ui/sheet.tsx');
  assert.ok(pins.source.some(row => path.resolve(blog, row.path) === sheetSource), 'Actual shared Sheet must be explicitly source-pinned');
  assert.ok(fs.readFileSync(sheetSource, 'utf8').includes('uifb:sheet-host-offer'),
    'STOP before bundle/browser: separately accepted BLOG Sheet v1 capability is not implemented/pinned; do not add a fixture-only offer or fake ARIA');
  for (const row of pins.dependencies) {
    const manifest = path.join(blog, 'web/node_modules', row.name, 'package.json');
    assert.equal(digest(fs.readFileSync(manifest)), row.manifestSha256, row.name);
    assert.equal(JSON.parse(fs.readFileSync(manifest)).version, row.version);
    assert.equal(digest(fs.readFileSync(row.entryPath)), row.entrySha256, row.entryPath);
  }
  return { blog, pins, head };
}

async function actualModalFixture(t, width = 390, height = 800, { refuseOffers = false } = {}) {
  const source = verifiedModalSource();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uifb-modal-'));
  t.after(() => {
    const owned = fs.realpathSync(dir), temp = fs.realpathSync(os.tmpdir());
    assert.ok(owned.startsWith(temp + path.sep) && path.basename(owned).startsWith('uifb-modal-'));
    fs.rmSync(owned, { recursive: true, force: true });
  });
  const entry = path.join(dir, 'modal.tsx');
  fs.writeFileSync(entry, `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PanelSheet } from ${JSON.stringify(path.join(source.blog, 'web/src/shared/components/PanelSheet.tsx'))};
import { Sheet, SheetContent, SheetTitle } from ${JSON.stringify(path.join(source.blog, 'web/src/shared/ui/sheet.tsx'))};
function Fixture(){
  const [open,setOpen]=useState(false),[nested,setNested]=useState(false),[nonmodal,setNonmodal]=useState(false),[nestedNonmodal,setNestedNonmodal]=useState(false);
  return <><button id="open-modal" onClick={()=>setOpen(true)}>Open actual Sheet</button>
    <button id="open-nonmodal" onClick={()=>setNonmodal(true)}>Open actual nonmodal Sheet</button>
    <Sheet open={nonmodal} modal={false} onOpenChange={setNonmodal}><SheetContent id="nonmodal-sheet"><SheetTitle>Nonmodal</SheetTitle>
      <button id="close-nonmodal" onClick={()=>setNonmodal(false)}>Close nonmodal</button></SheetContent></Sheet>
    <textarea id="app-draft" defaultValue="Unchanged app draft"/>
    <PanelSheet id="outer-sheet" open={open} onClose={()=>setOpen(false)} title="Outer" titleId="outer-title" desc="Actual Radix fixture">
      <textarea id="modal-draft" defaultValue="Modal draft"/>
      <button id="open-nested" onClick={()=>setNested(true)}>Open nested</button>
      <button id="open-nested-nonmodal" onClick={()=>setNestedNonmodal(true)}>Open nested nonmodal</button>
      <Sheet open={nestedNonmodal} modal={false} onOpenChange={setNestedNonmodal}><SheetContent id="nested-nonmodal-sheet"><SheetTitle>Nested nonmodal</SheetTitle>
        <button id="close-nested-nonmodal" onClick={()=>setNestedNonmodal(false)}>Close nested nonmodal</button></SheetContent></Sheet>
      <button id="detach-modal" onClick={()=>setOpen(false)}>Close outer</button>
      <div style={{height:240}}>Synthetic content</div>
      <PanelSheet id="nested-sheet" open={nested} onClose={()=>setNested(false)} title="Nested" titleId="nested-title" desc="Nested actual Radix">
        <textarea id="nested-draft" defaultValue="Nested draft"/>
      </PanelSheet>
    </PanelSheet></>;
}
createRoot(document.getElementById('fixture')).render(<Fixture/>);
`);
  const require = createRequire(path.join(source.blog, 'web/package.json'));
  const built = require('esbuild').buildSync({ entryPoints: [entry], bundle: true, write: false, metafile: true,
    absWorkingDir: path.join(source.blog, 'web'), nodePaths: [path.join(source.blog, 'web/node_modules')],
    alias: { '@': path.join(source.blog, 'web/src') }, platform: 'browser', format: 'iife', jsx: 'automatic' });
  const dependencies = fs.realpathSync(path.join(source.blog, 'web/node_modules'));
  const closure = Object.keys(built.metafile.inputs).map(input => {
    const file = fs.realpathSync(path.resolve(source.blog, 'web', input));
    assert.ok([source.blog, dependencies, dir].some(root => file.startsWith(root + path.sep)), `Unexpected fixture dependency ${file}`);
    return { file, sha256: digest(fs.readFileSync(file)) };
  });
  const widget = fs.readFileSync(new URL('../../assets/app-widget.js', import.meta.url));
  const browser = await getBrowser();
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: width < 768, isMobile: width < 768 });
  t.after(() => ctx.close());
  const page = await ctx.newPage(), errors = [], unexpected = [], writes = [];
  await page.addInitScript(({ refuseOffers }) => {
    window.__sheetOffers = [];
    document.addEventListener('uifb:sheet-host-offer', event => {
      window.__sheetOffers.push(event.detail);
      if (refuseOffers && ['attach', 'update'].includes(event.detail.phase)) {
        event.detail.respond({ owner: event.detail.owner, epoch: event.detail.epoch, accepted: false });
      }
    });
  }, { refuseOffers });
  const session = { id: 'modal-fixture', name: 'Synthetic modal session', tool: 'codex', status: { state: 'unknown' }, watch: { active: false, via: 'queue' } };
  const store = { compose: {}, seen: {}, prefs: {}, messages: [], drafts: [], trash: [] };
  // No server/provider is contacted: every request is fulfilled or rejected here.
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), post = request.method() !== 'GET';
    if (url.origin !== 'http://modal.test') { unexpected.push(url.origin); return route.abort(); }
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body:
      `<!doctype html><meta name="viewport" content="width=device-width"><style>${modalCss}</style><div id="fixture"></div><script src="/fixture.js"></script><script src="/widget.js"></script>` });
    if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: built.outputFiles[0].text });
    if (url.pathname === '/widget.js') return route.fulfill({ contentType: 'text/javascript', body: widget });
    if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204, body: '' });
    const key = url.pathname.replace('/__uifb/api/', '');
    const payload = post ? request.postDataJSON() : null;
    if (post) writes.push({ key, payload });
    if (post && !['compose', 'seen', 'prefs', 'diag'].includes(key)) {
      unexpected.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({ status: 403, json: { error: 'Fixture forbids provider/mutation endpoint' } });
    }
    if (post && key === 'compose') {
      assert.equal(payload.session, session.id);
      assert.equal(typeof payload.text, 'string');
      store.compose[session.id] = { text: payload.text };
    } else if (post && key !== 'diag') store[key] = { ...store[key], ...payload };
    const replies = { chat: { messages: store.messages, delivered: {} }, sessions: { sessions: [session] },
      drafts: { drafts: store.drafts, trash: store.trash }, compose: store.compose, seen: store.seen,
      prefs: store.prefs, transcript: { items: [] }, pages: { items: [] }, diag: { ok: true },
      'widget-version': { r: 'fixture' }, 'push-key': { publicKey: null } };
    if (!(key in replies)) { unexpected.push(`${request.method()} ${url.pathname}`); return route.fulfill({ status: 404, json: {} }); }
    return route.fulfill({ json: replies[key] });
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://modal.test/');
  await page.locator('#open-modal').waitFor();
  const w = new Widget(page);
  await page.locator('#btn').waitFor();
  await page.evaluate(() => {
    const host = [...document.querySelectorAll('*')].find(el => el.shadowRoot?.getElementById('btn'));
    window.__fixtureHost = host;
    window.__fixtureShadow = host.shadowRoot;
    window.__fixtureMount = { parent: host.parentNode, next: host.nextSibling, style: host.getAttribute('style') };
  });
  t.after(async () => {
    assert.deepEqual(errors, [], 'Actual modal fixture page errors');
    assert.deepEqual(unexpected, [], 'Unexpected HTTP/provider request; fixture is incomplete');
  });
  const evidence = async label => {
    if (!process.env.UIFB_MODAL_EVIDENCE_DIR) return;
    const output = path.resolve(process.env.UIFB_MODAL_EVIDENCE_DIR);
    const privateRoot = path.resolve(fileURLToPath(new URL('../../.local/overlay-controls/', import.meta.url)));
    assert.ok(output.startsWith(privateRoot + path.sep), 'Evidence must stay in the explicit owned widget private directory');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, `${label}.json`), JSON.stringify({ source: source.head, closure,
      cssSha256: digest(modalCss), widgetSha256: digest(widget), bundleSha256: digest(built.outputFiles[0].contents), writes, errors, unexpected }, null, 2));
    await page.screenshot({ path: path.join(output, `${label}.png`) });
  };
  return { page, w, writes, store, evidence };
}

async function assertDock(page, id = 'outer-sheet') {
  await page.waitForFunction(id => window.__fixtureHost?.parentElement?.id === id, id);
  assert.equal(await page.evaluate(id => document.getElementById(id).firstChild === window.__fixtureHost, id), true);
  assert.equal(await page.evaluate(() => window.__fixtureHost.dataset.uifbModalError ?? null), null, 'Stop experiment: modal access/geometry unsupported');
}

test('actual Radix representative: dock preserves host, pointer access and draft without provider writes', async t => {
  const { page, w, evidence } = await actualModalFixture(t);
  try {
    await page.locator('#open-modal').click(); await assertDock(page);
    await page.locator('#btn').click();
    await page.locator('#input').click();
    await page.locator('#input').fill('Unsent widget draft');
    assert.equal(await w.inputValue(), 'Unsent widget draft');
    assert.equal(await page.locator('#modal-draft').inputValue(), 'Modal draft');
    assert.equal(await page.evaluate(() => document.activeElement === window.__fixtureHost), true, 'Actual FocusScope must allow shadow input');
    assert.equal(await page.locator('#input').evaluate(el => {
      const b = el.getBoundingClientRect();
      return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === window.__fixtureHost;
    }), true, 'Stop experiment: open panel is clipped or pointer-obstructed');
    await w.click('#close');
    await evidence('representative390');
  } catch (error) { await evidence('representative390-failure'); throw error; }
});

test('actual Radix nested, detach and original sibling/style restoration', async t => {
  const { page, evidence } = await actualModalFixture(t);
  await page.locator('#open-modal').click(); await assertDock(page);
  await page.locator('#open-nested').click(); await assertDock(page, 'nested-sheet');
  await page.locator('#nested-sheet [data-slot="sheet-close"]').click(); await assertDock(page);
  await page.locator('#detach-modal').click();
  await page.waitForFunction(() => window.__fixtureHost.parentNode === window.__fixtureMount.parent);
  assert.equal(await page.evaluate(() => window.__fixtureHost.getAttribute('style') === window.__fixtureMount.style), true);
  assert.equal(await page.evaluate(() => window.__fixtureHost.nextSibling === window.__fixtureMount.next), true);
  await page.locator('#open-modal').click(); await assertDock(page);
  await evidence('nested-restore390');
});

test('actual Radix constrained wrapping, keyboard, Escape and desktop access', async t => {
  const { page, w, evidence } = await actualModalFixture(t, 1440, 900);
  await page.locator('#open-modal').click(); await assertDock(page);
  await page.locator('#modal-draft').fill('App selection preserved');
  await page.locator('#modal-draft').evaluate(el => el.setSelectionRange(4, 13));
  await page.locator('#btn').focus(); await page.keyboard.press('Enter');
  await page.locator('#input').fill('Draft survives modal moves');
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => window.__fixtureHost.shadowRoot.activeElement !== null), true, 'Stop: shadow Tab traversal unsupported');
  await w.click('#close');
  await page.setViewportSize({ width: 390, height: 440 });
  await page.evaluate(() => document.body.setAttribute('data-constrained', ''));
  await assertDock(page);
  const bounds = await page.locator('#btn').boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 440);
  await page.evaluate(() => document.body.setAttribute('data-wrap', ''));
  await assertDock(page);
  assert.equal(await page.locator('#modal-draft').inputValue(), 'App selection preserved');
  assert.equal(await page.locator('#modal-draft').evaluate(el => el.selectionStart), 4);
  await evidence('constrained-keyboard');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fixtureHost.parentNode === window.__fixtureMount.parent);
});

test('actual Radix refresh uses only mocked compose and preserves the unsent draft', async t => {
  const { page, w, store, evidence } = await actualModalFixture(t);
  await page.locator('#open-modal').click(); await assertDock(page);
  await page.locator('#btn').click();
  await page.locator('#input').fill('Draft across mocked refresh');
  await w.click('#close');
  await Promise.all([page.waitForNavigation(), page.locator('#rbtn').click()]);
  await page.locator('#btn').click();
  await page.waitForFunction(() => [...document.querySelectorAll('*')].some(el =>
    el.shadowRoot?.getElementById('input')?.value === 'Draft across mocked refresh'));
  assert.equal(store.messages.length, 0);
  await evidence('refresh-mock390');
});


test('actual Radix v1 nonmodal and nested noneligible owners never acquire the host', async t => {
  const { page, evidence } = await actualModalFixture(t);
  await page.locator('#open-nonmodal').click();
  assert.equal(await page.evaluate(() => window.__fixtureHost.parentNode === window.__fixtureMount.parent), true);
  assert.equal(await page.evaluate(() => window.__sheetOffers.some(x => x.content.id === 'nonmodal-sheet' && x.modal === false)), true,
    'real source Root modal=false must reach the actual capability, not fixture ARIA');
  await page.locator('#close-nonmodal').click();
  await page.locator('#open-modal').click(); await assertDock(page);
  await page.locator('#open-nested-nonmodal').click();
  assert.equal(await page.evaluate(() => window.__fixtureHost.parentNode.id === 'nested-nonmodal-sheet'), false);
  assert.equal(await page.evaluate(() => window.__fixtureHost.isConnected && window.__fixtureHost.shadowRoot === window.__fixtureShadow), true);
  await evidence('actual-nonmodal-negative390');
});

test('actual Radix v1 first-response refusal undoes only the attempted same-host move', async t => {
  const { page, evidence } = await actualModalFixture(t, 390, 800, { refuseOffers: true });
  await page.locator('#open-modal').click();
  assert.equal(await page.evaluate(() => window.__fixtureHost.parentNode === window.__fixtureMount.parent), true);
  assert.equal(await page.evaluate(() => window.__fixtureHost.getAttribute('style') === window.__fixtureMount.style), true);
  assert.equal(await page.evaluate(() => window.__fixtureHost.dataset.uifbModalDock), undefined);
  assert.equal(await page.evaluate(() => window.__fixtureHost.dataset.uifbModalError), 'offer-not-acknowledged');
  await evidence('actual-refused-offer390');
});

test('actual Radix v1 stale release cannot retire a reopened owner epoch', async t => {
  const { page, evidence } = await actualModalFixture(t);
  await page.locator('#open-modal').click(); await assertDock(page);
  await page.evaluate(() => { window.__oldSheetOffer = window.__sheetOffers.find(x => x.phase === 'attach' && x.content.id === 'outer-sheet'); });
  await page.locator('#outer-sheet [data-slot="sheet-close"]').click();
  await page.locator('#open-modal').click(); await assertDock(page);
  const state = await page.evaluate(() => {
    const current = window.__sheetOffers.filter(x => x.phase === 'attach' && x.content.id === 'outer-sheet').at(-1);
    const old = window.__oldSheetOffer, host = window.__fixtureHost;
    if (!old || old.owner !== current.owner || old.epoch === current.epoch) throw new Error('Source epoch/Root identity contract failed');
    let accepted;
    current.content.dispatchEvent(new CustomEvent('uifb:sheet-host-offer', { bubbles: true, composed: true, cancelable: false,
      detail: { ...current, phase: 'release', epoch: old.epoch, respond(reply) { accepted = reply.accepted; return true; } } }));
    return { accepted, sameParent: host.parentNode === current.content, lateReply: old.respond({ owner: old.owner, epoch: old.epoch, accepted: true }) };
  });
  assert.deepEqual(state, { accepted: false, sameParent: true, lateReply: false });
  await evidence('actual-stale-epoch390');
});
