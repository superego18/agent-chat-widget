import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webkit } from 'playwright-core';
import { A, B, makeDir, startServer, openWidget, getBrowser, closeBrowser } from './helpers.mjs';
after(closeBrowser);

for (const width of [390, 1440]) {
  test(`small chips occupy their painted width and partial replacement is atomic (${width}px)`, async () => {
    const srv = await startServer(makeDir({ messages: [{ id: 12, from: 'agent', session: A, text: '같은 원문', at: new Date().toISOString() }] }));
    const ctx = await (await getBrowser()).newContext({ viewport: { width, height: 844 }, isMobile: width === 390, hasTouch: width === 390 });
    try {
      const { w, page } = await openWidget(srv, { ctx });
      await w.clickText('답장', '.msg[data-id="12"]');
      const box = await w.eval(r => { const m = r.querySelector('#inback mark'), s = m.querySelector('span'); return { slot: m.getBoundingClientRect().width, paint: s.getBoundingClientRect().width, font: parseFloat(getComputedStyle(s).fontSize) }; });
      assert.ok(Math.abs(box.font - (width === 390 ? 12.48 : 10.14)) < 0.01);
      assert.ok(Math.abs(box.slot - box.paint) < 1, 'small text has no hidden outer slot');
      await w.eval(r => { const i = r.getElementById('input'); i.focus(); i.setSelectionRange(1, 3); });
      await page.keyboard.insertText('새');
      assert.equal(await w.inputValue(), '새 ', 'a partial marker selection replaces the entire chip');
      assert.equal(await w.eval(r => r.getElementById('reply').hidden), true);
      await page.keyboard.press('Control+z');
      assert.match(await w.inputValue(), /^↩12「/);
      assert.equal(await w.eval(r => r.getElementById('reply').hidden), false, 'undo restores the reference');
    } finally { await ctx.close(); srv.stop(); }
  });

  test(`wrapped chips and text use the same native editable layout (${width}px)`, async () => {
    const srv = await startServer(makeDir({ messages: [{ id: 12, from: 'agent', session: A, text: '같은 원문', at: new Date().toISOString() }] }));
    const ctx = await (await getBrowser()).newContext({ viewport: { width, height: 844 } });
    try {
      const { w, page } = await openWidget(srv, { ctx });
      for (const prefix of ['WWWWWWWW ', 'WWWWWWWWW ', 'WWWWWWWWWW ']) {
        await w.type(prefix);
        await w.eval(r => { const i = r.getElementById('input'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
        await w.clickText('답장', '.msg[data-id="12"]');
        await page.keyboard.insertText('XYZ');
        const actual = await w.eval(r => {
          const i = r.getElementById('input'); i.setSelectionRange(i.value.length - 3, i.value.length - 3);
          if (!i.isContentEditable) return { shared: false };
          const selection = r.getSelection ? r.getSelection() : getSelection();
          const caret = selection.getRangeAt(0).getBoundingClientRect();
          const walk = document.createTreeWalker(i, NodeFilter.SHOW_TEXT); let n;
          while ((n = walk.nextNode())) if (n.data.includes('XYZ')) { const a = n.data.indexOf('XYZ'), range = document.createRange(); range.setStart(n, a); range.setEnd(n, a + 1); const text = range.getBoundingClientRect(); return { shared: true, dx: caret.left - text.left, dy: caret.top - text.top }; }
          return { shared: true, dx: Infinity, dy: Infinity };
        });
        assert.equal(actual.shared, true, 'chips and text share the real editing surface');
        assert.ok(Math.abs(actual.dx) < 1 && Math.abs(actual.dy) < 1, JSON.stringify(actual));
      }
    } finally { await ctx.close(); srv.stop(); }
  });

  test(`composition, plain-text paste, newlines and quoted-chip undo keep their meaning (${width}px)`, async () => {
    const srv = await startServer(makeDir({ messages: [{ id: 12, from: 'agent', session: A, text: 'Selected original words', at: new Date().toISOString() }] }));
    const ctx = await (await getBrowser()).newContext({ viewport: { width, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
    try {
      const { w, page } = await openWidget(srv, { ctx });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await w.clickText('답장', '.msg[data-id="12"]');
      const initial = await w.inputValue();
      await w.idle(600);
      await page.addInitScript(() => { const state = JSON.parse(localStorage.getItem('__uifb_reply')); if (state?.refs?.[0]) { state.refs[0].quote = 'original'; localStorage.setItem('__uifb_reply', JSON.stringify(state)); } });
      await page.reload(); await w.idle(1200);
      await w.eval(r => { const i = r.getElementById('input'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 });
      await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
      await cdp.send('Input.insertText', { text: '한글🙂' });
      assert.equal(await w.inputValue(), initial + '한글🙂'); await cdp.detach();
      const pasted = '<img src=x onerror=alert(1)>\n붙여넣기🙂';
      await page.evaluate(text => navigator.clipboard.writeText(text), pasted);
      await page.keyboard.press('Control+v');
      assert.equal(await w.inputValue(), initial + '한글🙂' + pasted);
      assert.equal(await w.eval(r => r.getElementById('input').querySelector('img')), null, 'pasted HTML remains plain text');
      await w.type(initial);
      await w.eval(r => { const i = r.getElementById('input'); i.focus(); const end = i.value.indexOf('」') + 1; i.setSelectionRange(end, end); });
      await page.keyboard.press('Backspace'); await page.keyboard.press('Control+z');
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('__uifb_reply')));
      assert.equal(saved?.refs[0]?.quote, 'original', 'undo retains the partial quotation, not only its message ID');
      await w.type('first'); await w.eval(r => { const i = r.getElementById('input'); i.focus(); i.setSelectionRange(5, 5); });
      await page.keyboard.press('Shift+Enter'); await page.keyboard.insertText('second');
      assert.equal(await w.inputValue(), 'first\nsecond');
      assert.deepEqual(errors, [], 'native editing handlers do not throw');
    } finally { await ctx.close(); srv.stop(); }
  });
}

test('WebKit shadow selection inserts chips at the actual caret and replaces selections', { skip: !fs.existsSync(webkit.executablePath()) && 'Install optional WebKit: node node_modules/playwright-core/cli.js install webkit' }, async () => {
  const srv = await startServer(makeDir({ messages: [{ id: 12, from: 'agent', session: A, text: 'Original message', at: new Date().toISOString() }] }));
  const browser = await webkit.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const { w, page } = await openWidget(srv, { ctx });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await w.type('abcdef');
    await w.eval(r => {
      const i = r.getElementById('input'); i.focus();
      document.getSelection().setBaseAndExtent(i.firstChild, 2, i.firstChild, 2);
    });
    assert.equal(await w.eval(r => r.getElementById('input').selectionStart), 2, 'reads the real selection, not a cached offset');
    await w.clickText('답장', '.msg[data-id="12"]');
    assert.equal(await w.inputValue(), 'ab ↩12「Ori…」 cdef');
    assert.equal(await w.eval(r => { const m = r.querySelector('#input mark'); return m.contentEditable === 'false' && !!m.querySelector('span'); }), true, 'WebKit HTML normalization cannot make the chip editable');
    await w.eval(r => { const i = r.getElementById('input'); i.focus(); i.setSelectionRange(4, 7); });
    await page.keyboard.insertText('새');
    assert.equal(await w.inputValue(), 'ab 새 cdef');
    await page.keyboard.press('Control+z');
    assert.equal(await w.inputValue(), 'ab ↩12「Ori…」 cdef', 'WebKit native undo restores the atomic chip');
    await w.type('one'); await w.eval(r => { const i = r.getElementById('input'); i.focus(); i.setSelectionRange(3, 3); });
    await page.keyboard.press('Shift+Enter'); await page.keyboard.insertText('two');
    assert.equal(await w.inputValue(), 'one\ntwo');
    await w.eval(r => {
      const i = r.getElementById('input'), command = document.execCommand;
      try { document.execCommand = () => false; i.replaceText(1, 2, 'X'); } finally { document.execCommand = command; }
    });
    assert.equal(await w.inputValue(), 'oXe\ntwo', 'command fallback modifies only the actual editor range');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); await browser.close(); srv.stop(); }
});

test('switching roles or clearing the composer cannot undo another role or accepted draft into place', async () => {
  const srv = await startServer(makeDir());
  try {
    await srv.api('/api/compose', { session: B, text: 'Other role draft' });
    const { w, page, ctx } = await openWidget(srv);
    try {
      await w.eval(r => r.getElementById('input').focus());
      await page.keyboard.type('Original role typing');
      await w.eval(r => r.querySelectorAll('#tabs button[role="tab"]')[1].click());
      await w.idle(600);
      assert.equal(await w.inputValue(), 'Other role draft');
      await w.eval(r => r.getElementById('input').focus());
      await page.keyboard.press('Control+z');
      assert.equal(await w.inputValue(), 'Other role draft', 'undo does not cross a role/draft boundary');
      await w.click('#clr');
      await page.keyboard.press('Control+z');
      assert.equal(await w.inputValue(), '', 'a programmatic clear ends the previous editing history');
    } finally { await ctx.close(); }
  } finally { srv.stop(); }
});

for (const engine of ['chrome', 'webkit']) {
  test(`partial chip DOM selections copy, cut and paste the canonical native reference (${engine})`, { skip: engine === 'webkit' && !fs.existsSync(webkit.executablePath()) }, async () => {
    const root = makeDir(), native = root + '/native.jsonl';
    fs.writeFileSync(native, JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { id: 'clipboard-source', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Clipboard source' }] } }));
    const registration = root + '/sessions/' + B + '.json'; fs.writeFileSync(registration, JSON.stringify({ ...JSON.parse(fs.readFileSync(registration, 'utf8')), tool: 'codex', path: native }));
    const srv = await startServer(root), browser = engine === 'webkit' ? await webkit.launch({ headless: true }) : await getBrowser();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const { w, page } = await openWidget(srv, { ctx, tab: B });
      await w.clickText('답장', '.msg[data-id="xclipboard-source"]');
      const initial = await w.inputValue(), token = initial.trim();
      await page.keyboard.insertText('tail');
      const copied = await w.eval(r => {
        const i = r.getElementById('input'), label = i.querySelector('mark span').firstChild; i.focus();
        const s = r.getSelection ? r.getSelection() : getSelection(); s.setBaseAndExtent(label, 1, label, 3);
        const data = new DataTransfer(); i.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
        return { text: data.getData('text/plain'), start: i.selectionStart, end: i.selectionEnd };
      });
      assert.deepEqual(copied, { text: token, start: 0, end: token.length }, 'a partial native-label selection represents the whole original reference');
      const cut = await w.eval(r => {
        const i = r.getElementById('input'), label = i.querySelector('mark span').firstChild, tail = i.lastChild; i.focus();
        const s = r.getSelection ? r.getSelection() : getSelection(); s.setBaseAndExtent(label, 1, tail, 1);
        // WebKit can clamp a selection beginning in readonly text to that chip alone.
        let selected; try { selected = s.getComposedRanges({ shadowRoots: [r] })[0]; } catch { selected = s.getComposedRanges(r)[0]; }
        const nativeRange = document.createRange(); nativeRange.setStart(selected.startContainer, selected.startOffset); nativeRange.setEnd(selected.endContainer, selected.endOffset);
        const selectedSpace = nativeRange.toString().endsWith(' ');
        const data = new DataTransfer(); i.dispatchEvent(new ClipboardEvent('cut', { bubbles: true, cancelable: true, clipboardData: data }));
        return { text: data.getData('text/plain'), value: i.value, selectedSpace };
      });
      assert.deepEqual({ text: cut.text, value: cut.value }, { text: token + (cut.selectedSpace ? ' ' : ''), value: (cut.selectedSpace ? '' : ' ') + 'tail' });
      await w.eval((r, text) => { const i = r.getElementById('input'), data = new DataTransfer(); i.setSelectionRange(0, 0); data.setData('text/plain', text); i.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); }, cut.text);
      assert.equal(await w.inputValue(), initial + 'tail');
      assert.equal(await w.eval(r => r.querySelectorAll('#input mark[contenteditable="false"]').length), 1);
    } finally { await ctx.close(); if (engine === 'webkit') await browser.close(); srv.stop(); }
  });
}
