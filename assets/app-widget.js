// 실제 앱 화면에 붙는 피드백 위젯. app-proxy.mjs 가 HTML 응답에 넣는다.
// 앱 스타일과 섞이지 않게 Shadow DOM 안에 그린다. 메시지는 리뷰 대화 기록(chat.json)에 쌓인다.
(() => {
  if (window.__uifb) return;
  window.__uifb = true;

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:auto;z-index:2147483647;';
  document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
  .btn { position: fixed; left: 16px; bottom: 72px; padding: 10px 14px; border-radius: 999px; border: 0; background: #1c1b18; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.25); display: flex; gap: 6px; align-items: center; }
  .btn .badge { min-width: 18px; height: 18px; border-radius: 9px; background: #4f46e5; font-size: 11px; line-height: 18px; text-align: center; padding: 0 5px; }
  .panel { position: fixed; left: 16px; bottom: 124px; width: min(360px, calc(100vw - 32px)); height: min(520px, calc(100vh - 160px)); background: #fff; color: #1c1b18; border-radius: 12px; box-shadow: 0 0 0 1px rgba(0,0,0,.1), 0 12px 32px rgba(0,0,0,.2); display: flex; flex-direction: column; overflow: hidden; }
  .panel[hidden] { display: none; }
  header { padding: 10px 12px; border-bottom: 1px solid rgba(0,0,0,.1); }
  header b { font-size: 14px; }
  header p { margin: 2px 0 0; font-size: 12px; line-height: 1.4; }
  header p.on { color: #15803d; } header p.off { color: #b45309; }
  .msgs { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 6px; background: #f6f5f1; }
  .msg { max-width: 88%; padding: 7px 10px; border-radius: 10px; font-size: 13px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
  .msg.user { align-self: flex-end; background: #4f46e5; color: #fff; }
  .msg.agent { align-self: flex-start; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.1); }
  .msg code { font-family: ui-monospace, monospace; font-size: 12px; background: rgba(127,127,127,.15); padding: 0 4px; border-radius: 4px; }
  .msg small { display: block; font-size: 10px; opacity: .7; margin-top: 2px; }
  .tag { display: inline-block; font-size: 10px; font-weight: 600; padding: 0 5px; border-radius: 4px; margin-right: 5px; background: rgba(0,0,0,.08); }
  .msg.user .tag { background: rgba(255,255,255,.22); }
  .empty { margin: auto; text-align: center; font-size: 12px; color: #8f8c84; line-height: 1.6; white-space: pre-line; }
  .tabs { padding: 6px 0 2px !important; }
  .tabs .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 4px; vertical-align: 1px; }
  .tabs .dot.on { background: #15803d; } .tabs .dot.off { background: #8f8c84; }
  .row { display: flex; gap: 4px; align-items: center; padding: 8px 10px 0; font-size: 12px; color: #8f8c84; flex-wrap: wrap; }
  .chipbtn { font-size: 12px; padding: 4px 9px; border-radius: 999px; border: 1px solid rgba(0,0,0,.12); background: #fff; color: #5a5852; cursor: pointer; }
  .chipbtn[aria-pressed="true"] { background: #1c1b18; color: #fff; border-color: transparent; }
  .where { margin: 6px 10px 0; font-size: 12px; background: #eef0ff; color: #3730a3; border-radius: 6px; padding: 5px 8px; display: flex; gap: 6px; align-items: center; }
  .where[hidden] { display: none; }
  .where span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .where button { border: 0; background: none; color: inherit; cursor: pointer; font-size: 12px; }
  form { display: flex; gap: 6px; padding: 8px 10px 10px; }
  textarea { flex: 1; min-width: 0; resize: none; height: 40px; max-height: 110px; font-size: 13px; padding: 8px 9px; border-radius: 7px; border: 1px solid rgba(0,0,0,.15); background: #f6f5f1; color: #1c1b18; }
  form button { flex-shrink: 0; border: 0; border-radius: 7px; padding: 0 12px; background: #1c1b18; color: #fff; font-weight: 600; font-size: 13px; cursor: pointer; }
  .hint { position: fixed; left: 50%; top: 16px; transform: translateX(-50%); background: #1c1b18; color: #fff; font-size: 13px; padding: 8px 12px; border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,.25); }
  .hint[hidden] { display: none; }
  .box { position: fixed; pointer-events: none; outline: 2px solid #4f46e5; background: rgba(79,70,229,.08); border-radius: 3px; }
  .box[hidden] { display: none; }
</style>
<button class="btn" id="btn" type="button" aria-expanded="false">피드백<span class="badge" id="badge" hidden></span></button>
<section class="panel" id="panel" hidden aria-label="피드백">
  <header><b>피드백 · 앱 화면</b><div class="row tabs" id="tabs" role="tablist" aria-label="세션"></div><p id="mode" class="off"></p></header>
  <div class="msgs" id="msgs" aria-live="polite"></div>
  <div class="row"><button class="chipbtn" type="button" id="pick" style="margin-left:auto">위치 찍기</button></div>
  <div class="where" id="where" hidden><span id="whereText"></span><button type="button" id="whereClear" aria-label="위치 지우기">×</button></div>
  <form id="form"><textarea id="input" placeholder="질문이나 요청 · Enter 보내기" aria-label="메시지"></textarea><button type="submit">보내기</button></form>
</section>
<div class="hint" id="hint" hidden>의견을 남길 곳을 누르세요 · Esc 취소</div>
<div class="box" id="box" hidden></div>`;

  const $ = (s) => root.getElementById(s);
  let messages = [];
  let sessions = [];
  const transcripts = {};
  let activeTab = null;
  try { activeTab = localStorage.getItem('__uifb_tab'); } catch {}
  let where = null;
  let seen = '';
  try { seen = localStorage.getItem('__uifb_seenAt') || ''; } catch {}
  const sessionById = (id) => sessions.find((x) => x.id === id);
  const nameOf = (id) => sessionById(id)?.name || '세션';
  const ownerOf = (m) => m.to || m.session || null;

  function mdLite(text) {
    const esc = text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    return esc
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/^#{1,6}\s+(.+)$/gm, '<strong>$1</strong>');
  }

  function selectorOf(el) {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.body && parts.length < 5; n = n.parentElement) {
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      let p = n.tagName.toLowerCase();
      const cls = [...n.classList].filter((c) => !c.includes(':') && c.length < 30).slice(0, 2);
      if (cls.length) p += '.' + cls.map((c) => CSS.escape(c)).join('.');
      const sibs = n.parentElement ? [...n.parentElement.children].filter((s) => s.tagName === n.tagName) : [];
      if (sibs.length > 1) p += `:nth-of-type(${sibs.indexOf(n) + 1})`;
      parts.unshift(p);
    }
    return parts.join(' > ');
  }

  function timeline(tab) {
    return [...messages, ...Object.values(transcripts).flat()]
      .filter((m) => tab === 'all' || ownerOf(m) === tab)
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }

  function renderTabs() {
    const box = $('tabs');
    box.textContent = '';
    const tabs = [...sessions.map((x) => ({ id: x.id, label: x.name, live: x.watch?.active })), { id: 'all', label: '전체' }];
    if (!tabs.some((t) => t.id === activeTab)) activeTab = (sessions.find((x) => x.name === '작업 세션') || sessions[0] || { id: 'all' }).id;
    for (const t of tabs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chipbtn';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-pressed', String(t.id === activeTab));
      if (t.id !== 'all') {
        const dot = document.createElement('span');
        dot.className = 'dot ' + (t.live ? 'on' : 'off');
        b.append(dot);
      }
      b.append(t.label);
      b.onclick = () => { activeTab = t.id; try { localStorage.setItem('__uifb_tab', activeTab); } catch {} render(); };
      box.append(b);
    }
  }

  function render() {
    renderTabs();
    const box = $('msgs');
    box.textContent = '';
    const items = timeline(activeTab);
    if (!items.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = sessions.length
        ? '앱을 쓰다가 생긴 질문이나 요청을 보내세요.\n"위치 찍기"로 화면의 한 곳을 함께 보낼 수 있습니다.'
        : '등록된 세션이 없습니다.\n작업 세션이 자기 세션을 등록하면 대화할 수 있습니다.';
      box.append(p);
    }
    for (const m of items.slice(-80)) {
      const d = document.createElement('div');
      d.className = 'msg ' + m.from;
      const tag = document.createElement('span');
      tag.className = 'tag';
      const src = m.context === 'terminal' ? '터미널' : m.context === 'app' ? '앱' : m.context === 'reply' ? '답장' : '리뷰';
      tag.textContent = activeTab === 'all' && ownerOf(m) ? `${nameOf(ownerOf(m))} · ${src}` : src;
      const small = document.createElement('small');
      small.textContent = (m.from === 'agent' ? (m.agent || nameOf(m.session)) + ' · ' : '') +
        new Date(m.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) +
        (m.where?.url ? ' · ' + m.where.url : '');
      const body = document.createElement('span');
      body.innerHTML = mdLite(m.text);
      d.append(tag, body, small);
      box.append(d);
    }
    const last = items[items.length - 1];
    if (last && last.from === 'user' && last.context !== 'terminal') {
      const w = document.createElement('p');
      w.className = 'empty';
      w.style.margin = '0';
      const s = sessionById(ownerOf(last));
      w.textContent = s?.watch?.active ? `${s.name}이(가) 읽고 답하는 중…` : `자동으로 전달되지 않습니다. ${s ? s.name : '그 세션'} 터미널에 "대화 확인해"라고 보내 주세요.`;
      box.append(w);
    }
    box.scrollTop = box.scrollHeight;
    const target = activeTab === 'all' ? null : sessionById(activeTab);
    $('mode').className = target?.watch?.active ? 'on' : 'off';
    $('mode').textContent = !target
      ? '모든 세션의 대화를 함께 봅니다. 보내려면 세션 탭을 고르세요.'
      : target.watch?.active
        ? `${target.name}에게 보냅니다. 바로 전달됩니다.`
        : `${target.name}에게 보냅니다. 지금은 자동으로 읽지 않으니 그 세션 터미널에 "대화 확인해"라고 알려 주세요.`;
    $('input').disabled = !target;
    $('input').placeholder = target ? `${target.name}에게 질문이나 요청 · Enter 보내기` : '보낼 세션 탭을 고르세요';
    const all = timeline('all');
    const lastAll = all[all.length - 1];
    const open = !$('panel').hidden;
    if (!seen || open) { seen = lastAll ? String(lastAll.at) : '0'; try { localStorage.setItem('__uifb_seenAt', seen); } catch {} }
    const unread = all.filter((m) => m.from === 'agent' && String(m.at) > seen).length;
    $('badge').hidden = unread === 0;
    $('badge').textContent = String(unread);
  }

  let key = '';
  async function poll() {
    try {
      const [c, ss] = await Promise.all([
        fetch('/__uifb/api/chat').then((r) => r.json()),
        fetch('/__uifb/api/sessions').then((r) => r.json()),
      ]);
      messages = c.messages || [];
      sessions = ss.sessions || [];
      for (const x of sessions.filter((x) => x.tool === 'codex')) {
        transcripts[x.id] = (await fetch('/__uifb/api/transcript?session=' + encodeURIComponent(x.id)).then((r) => r.json())).items || [];
      }
      const all = timeline('all');
      const k = all.length + ':' + (all[all.length - 1]?.id || '') + ':' + sessions.map((x) => x.id + (x.watch?.active ? 1 : 0)).join(',');
      if (k !== key) { key = k; render(); }
    } catch {}
  }

  $('btn').onclick = () => {
    const open = $('panel').hidden;
    $('panel').hidden = !open;
    $('btn').setAttribute('aria-expanded', String(open));
    render();
    if (open) $('input').focus();
  };

  function stopPick() {
    $('hint').hidden = true;
    $('box').hidden = true;
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onPick, true);
    document.removeEventListener('keydown', onKey, true);
    $('panel').hidden = false;
  }
  function onMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === host) return;
    const r = el.getBoundingClientRect();
    Object.assign($('box').style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    $('box').hidden = false;
  }
  function onPick(e) {
    if (e.composedPath().includes(host)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el) {
      const r = el.getBoundingClientRect();
      where = {
        url: location.pathname + location.search,
        selector: selectorOf(el),
        text: (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 80),
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        viewport: { w: innerWidth, h: innerHeight },
      };
      $('whereText').textContent = '위치: ' + (where.text || where.selector);
      $('where').hidden = false;
    }
    stopPick();
    $('input').focus();
  }
  function onKey(e) { if (e.key === 'Escape') stopPick(); }
  $('pick').onclick = () => {
    $('panel').hidden = true;
    $('hint').hidden = false;
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onPick, true);
    document.addEventListener('keydown', onKey, true);
  };
  $('whereClear').onclick = () => { where = null; $('where').hidden = true; };

  $('form').onsubmit = async (e) => {
    e.preventDefault();
    const text = $('input').value.trim();
    if (!text) return;
    $('input').value = '';
    if (!activeTab || activeTab === 'all') return;
    const body = { from: 'user', text, to: activeTab, context: 'app', where: where || { url: location.pathname + location.search } };
    try {
      await fetch('/__uifb/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      where = null;
      $('where').hidden = true;
      await poll();
      render();
    } catch {
      $('input').value = text;
    }
  };
  $('input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('form').requestSubmit(); }
  });

  poll();
  setInterval(poll, 3000);
})();
