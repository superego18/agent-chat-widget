import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeDir, startServer, openWidget, closeBrowser, getBrowser, Widget } from './helpers.mjs';

after(closeBrowser);

async function fixture() {
  const srv = await startServer(makeDir());
  try {
    const opened = await openWidget(srv, { open: false });
    return { ...opened, close: async () => { await opened.ctx.close(); srv.stop(); } };
  } catch (error) { srv.stop(); throw error; }
}

async function sheet(page, style = 'left:0;right:0;top:104px;bottom:0') {
  await page.evaluate(css => {
    const modal = document.createElement('div');
    modal.id = 'app-sheet'; modal.role = 'dialog'; modal.setAttribute('aria-modal', 'true');
    modal.dataset.state = 'open';
    modal.style.cssText = `position:fixed;z-index:50;background:white;${css}`;
    modal.innerHTML = '<button id="app-close">Close fixture</button><textarea id="app-text">Unchanged fixture</textarea>';
    document.body.append(modal);
  }, style);
}

async function geometry(w) {
  return w.eval(r => {
    const rect = el => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
    return { launcher: rect(r.getElementById('btn')), refresh: rect(r.getElementById('rbtn')),
      sheet: document.getElementById('app-sheet') ? rect(document.getElementById('app-sheet')) : null };
  });
}

function outside(a, b) { return a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom; }
async function waitOutside(page) {
  await page.waitForFunction(() => {
    const r = [...document.querySelectorAll('*')].find(el => el.shadowRoot?.getElementById('btn')).shadowRoot;
    const modal = document.getElementById('app-sheet').getBoundingClientRect();
    return ['btn', 'rbtn'].every(id => { const b = r.getElementById(id).getBoundingClientRect();
      return b.right <= modal.left || b.left >= modal.right || b.bottom <= modal.top || b.top >= modal.bottom; });
  });
}

test('closed controls avoid a mobile sheet, preserve draft and restore on close', async () => {
  const { w, page, close } = await fixture();
  try {
    const normal = await geometry(w);
    await w.type('Unsent synthetic draft');
    await sheet(page); await waitOutside(page);
    const moved = await geometry(w);
    assert.ok(outside(moved.launcher, moved.sheet) && outside(moved.refresh, moved.sheet));
    assert.equal(moved.refresh.left, moved.launcher.left);
    assert.equal(moved.refresh.top, moved.launcher.bottom + 8);
    // Real DOM focus/click, rather than dispatching onclick directly.
    const launcher = page.locator('#btn');
    await launcher.focus(); await page.keyboard.press('Enter');
    assert.equal(await w.eval(r => r.getElementById('panel').hidden), false);
    assert.equal(await w.inputValue(), 'Unsent synthetic draft');
    assert.equal(await page.locator('#app-text').inputValue(), 'Unchanged fixture');
    await w.click('#close'); await waitOutside(page);
    await page.locator('#app-sheet').evaluate(el => el.remove());
    await page.waitForFunction(top => {
      const r = [...document.querySelectorAll('*')].find(el => el.shadowRoot?.getElementById('btn')).shadowRoot;
      return r.getElementById('btn').getBoundingClientRect().top === top;
    }, normal.launcher.top);
    assert.deepEqual((await geometry(w)).launcher, normal.launcher);
  } finally { await close(); }
});

test('resize, hidden/nonmodal dialogs and detached modal observers preserve ordinary placement', async () => {
  const { w, page, close } = await fixture();
  try {
    const normal = await geometry(w);
    await sheet(page); await waitOutside(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.locator('#app-sheet').evaluate(el => { el.style.top = '104px'; });
    await waitOutside(page);
    await page.locator('#app-sheet').evaluate(el => { el.hidden = true; });
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForFunction(() => {
      const r = [...document.querySelectorAll('*')].find(el => el.shadowRoot?.getElementById('btn')).shadowRoot;
      return !r.getElementById('btn').style.top;
    });
    assert.deepEqual((await geometry(w)).launcher, normal.launcher);
    await page.locator('#app-sheet').evaluate(el => { el.hidden = false; el.setAttribute('aria-modal', 'false'); });
    await w.idle(50);
    assert.deepEqual((await geometry(w)).launcher, normal.launcher);
    await page.locator('#app-sheet').evaluate(el => el.remove());
    await sheet(page, 'left:1080px;right:0;top:0;bottom:0');
    await page.setViewportSize({ width: 1440, height: 900 });
    await waitOutside(page);
    assert.equal((await geometry(w)).launcher.left, 20);
  } finally { await close(); }
});

test('viewport changes and page lifecycle reattach positioning without changing refresh behavior', async () => {
  const { w, page, close } = await fixture();
  try {
    await sheet(page); await waitOutside(page);
    const handler = await w.eval(r => r.getElementById('rbtn').onclick.toString());
    await page.evaluate(() => {
      window.dispatchEvent(new Event('pagehide'));
      document.getElementById('app-sheet').style.top = '120px';
      window.dispatchEvent(new Event('pageshow'));
      window.visualViewport?.dispatchEvent(new Event('resize'));
      window.visualViewport?.dispatchEvent(new Event('scroll'));
    });
    await waitOutside(page);
    assert.equal(await w.eval(r => r.getElementById('rbtn').onclick.toString()), handler);
    // This fixture has no Radix focus trap/inert behavior. Actual blog-modal and
    // real keyboard/safe-area checks remain required independent evidence.
  } finally { await close(); }
});

test('closed controls stay within an offset keyboard viewport when a free strip exists', async () => {
  const { w, page, close } = await fixture();
  try {
    await sheet(page, 'left:0;right:0;top:220px;bottom:0');
    await page.evaluate(() => {
      const viewport = new EventTarget();
      Object.assign(viewport, { offsetLeft: 0, offsetTop: 100, width: 390, height: 440 });
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
      // Rebind the synthetic viewport through the existing page lifecycle.
      window.dispatchEvent(new Event('pagehide'));
      window.dispatchEvent(new Event('pageshow'));
      viewport.dispatchEvent(new Event('resize'));
      viewport.dispatchEvent(new Event('scroll'));
    });
    await waitOutside(page);
    const bounds = await geometry(w);
    assert.ok(bounds.launcher.top >= 108 && bounds.refresh.bottom <= 532);
    assert.ok(outside(bounds.launcher, bounds.sheet) && outside(bounds.refresh, bounds.sheet));
  } finally { await close(); }
});
