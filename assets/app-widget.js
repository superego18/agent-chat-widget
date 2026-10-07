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
  .tabs .dot.busy { background: #4f46e5; animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .3; } }
  .typing { align-self: flex-start; display: flex; gap: 7px; align-items: center; font-size: 12px; color: #5a5852; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.1); border-radius: 10px; padding: 6px 10px; max-width: 88%; }
  .typing.permission { color: #b45309; }
  .typing .dots { display: inline-flex; gap: 3px; }
  .typing .dots i { width: 5px; height: 5px; border-radius: 50%; background: #8f8c84; animation: blink 1.2s infinite; }
  .typing .dots i:nth-child(2) { animation-delay: .2s; } .typing .dots i:nth-child(3) { animation-delay: .4s; }
  @keyframes blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
  .tbadge { display: inline-block; min-width: 15px; height: 15px; border-radius: 8px; background: #4f46e5; color: #fff; font-size: 10px; line-height: 15px; text-align: center; padding: 0 4px; margin-left: 4px; font-weight: 600; }
  .newline { align-self: stretch; text-align: center; font-size: 11px; font-weight: 600; color: #4f46e5; margin: 4px 0; }
  .msg.agent.unread { box-shadow: 0 0 0 1px rgba(0,0,0,.1), -3px 0 0 #4f46e5; }
  .peek { position: fixed; left: 16px; bottom: 124px; max-width: min(300px, calc(100vw - 32px)); background: #fff; color: #1c1b18; border-radius: 10px; box-shadow: 0 0 0 1px rgba(0,0,0,.1), 0 8px 24px rgba(0,0,0,.2); padding: 9px 11px; font-size: 13px; line-height: 1.45; cursor: pointer; }
  .peek[hidden] { display: none; }
  .peek b { display: block; font-size: 12px; color: #4f46e5; margin-bottom: 2px; }
  @media (prefers-reduced-motion: reduce) { .tabs .dot.busy, .typing .dots i { animation: none; } }
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
<div class="peek" id="peek" hidden role="status"></div>
<button class="btn" id="btn" type="button" aria-expanded="false">대화/피드백<span class="badge" id="badge" hidden></span></button>
<section class="panel" id="panel" hidden aria-label="대화/피드백">
  <header><b>대화/피드백 · 앱 화면</b><div class="row tabs" id="tabs" role="tablist" aria-label="세션"></div><p id="mode" class="off"></p></header>
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
  // 세션마다 마지막으로 읽은 시각. 탭을 열고 맨 아래까지 봐야 그 세션이 읽음으로 바뀐다.
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem('__uifb_seen') || '{}'); } catch {}
  const saveSeen = () => { try { localStorage.setItem('__uifb_seen', JSON.stringify(seen)); } catch {} };
  let scrollToUnread = true;
  const sessionById = (id) => sessions.find((x) => x.id === id);
  const nameOf = (id) => sessionById(id)?.name || '세션';
  const ownerOf = (m) => m.to || m.session || null;
  const isUnread = (m) => m.from === 'agent' && !!m.session && String(m.at) > (seen[m.session] || '');

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
    const tabs = sessions.map((x) => ({ id: x.id, label: x.name, live: x.watch?.active }));
    if (!tabs.some((t) => t.id === activeTab)) activeTab = (sessions.find((x) => x.name === '작업 세션') || sessions[0] || {}).id || null;
    for (const t of tabs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chipbtn';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-pressed', String(t.id === activeTab));
      {
        const st = sessionById(t.id)?.status?.state;
        const dot = document.createElement('span');
        dot.className = 'dot ' + (st === 'working' || st === 'permission' ? 'busy' : t.live ? 'on' : 'off');
        b.append(dot);
      }
      b.append(t.label);
      const n = timeline(t.id).filter(isUnread).length;
      if (n) {
        const nb = document.createElement('span');
        nb.className = 'tbadge';
        nb.textContent = String(n);
        b.append(nb);
      }
      b.onclick = () => { activeTab = t.id; scrollToUnread = true; try { localStorage.setItem('__uifb_tab', activeTab); } catch {} render(); };
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
    const shown = items.slice(-120);
    const firstUnread = shown.findIndex(isUnread);
    let newLine = null;
    for (const [i, m] of shown.entries()) {
      if (i === firstUnread) {
        newLine = document.createElement('p');
        newLine.className = 'newline';
        newLine.textContent = '여기부터 새 메시지';
        box.append(newLine);
      }
      const d = document.createElement('div');
      d.className = 'msg ' + m.from + (isUnread(m) ? ' unread' : '');
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
    const st = sessionById(activeTab)?.status;
    if (st && (st.state === 'working' || st.state === 'permission')) {
      const ty = document.createElement('div');
      ty.className = 'typing' + (st.state === 'permission' ? ' permission' : '');
      const dots = document.createElement('span');
      dots.className = 'dots';
      dots.innerHTML = '<i></i><i></i><i></i>';
      const label = document.createElement('span');
      label.textContent = st.state === 'permission' ? st.detail || '터미널에서 승인을 기다리는 중' : `작업 중 · ${st.detail || '생각하는 중'}`;
      ty.append(dots, label);
      box.append(ty);
    } else if (last && last.from === 'user' && last.context !== 'terminal') {
      const w = document.createElement('p');
      w.className = 'empty';
      w.style.margin = '0';
      const s = sessionById(ownerOf(last));
      w.textContent = s?.watch?.active ? `${s.name}이(가) 읽고 답하는 중…` : `자동으로 전달되지 않습니다. ${s ? s.name : '그 세션'} 터미널에 "대화 확인해"라고 보내 주세요.`;
      box.append(w);
    }
    if (scrollToUnread && !$('panel').hidden) {
      box.scrollTop = newLine ? Math.max(0, newLine.offsetTop - 8) : box.scrollHeight;
      scrollToUnread = false;
    } else if (box.scrollHeight - box.scrollTop - box.clientHeight < 80) {
      box.scrollTop = box.scrollHeight;
    }
    const target = sessionById(activeTab);
    $('mode').className = target?.watch?.active ? 'on' : 'off';
    $('mode').textContent = !target
      ? '등록된 세션이 없습니다.'
      : target.watch?.handling
        ? `${target.name}이(가) 메시지를 처리하는 중입니다. 지금 보내도 처리가 끝나면 바로 받습니다.`
        : target.watch?.active
        ? `${target.name}에게 보냅니다. 바로 전달됩니다.`
        : `${target.name}에게 보냅니다. 지금은 자동으로 읽지 않으니 그 세션 터미널에 "대화 확인해"라고 알려 주세요.`;
    $('input').disabled = !target;
    $('input').placeholder = target ? `${target.name}에게 질문이나 요청 · Enter 보내기` : '등록된 세션이 없습니다';
    markReadIfAtBottom();
    updateBadges();
  }

  function updateBadges() {
    const unread = timeline('all').filter(isUnread).length;
    $('badge').hidden = unread === 0;
    $('badge').textContent = String(unread);
    const base = document.title.replace(/^\(\d+\) /, '');
    document.title = (unread ? `(${unread}) ` : '') + base;
  }

  // 지금 탭을 맨 아래까지 봤으면 그 세션만 읽음으로 바꾼다.
  function markReadIfAtBottom() {
    const box = $('msgs');
    if ($('panel').hidden || !sessionById(activeTab)) return;
    if (box.scrollHeight - box.scrollTop - box.clientHeight > 40) return;
    const items = timeline(activeTab);
    const last = items[items.length - 1];
    if (last && String(last.at) > (seen[activeTab] || '')) {
      seen[activeTab] = String(last.at);
      saveSeen();
      renderTabs();
      updateBadges();
    }
  }
  $('msgs').addEventListener('scroll', markReadIfAtBottom);

  // 창이 닫혀 있을 때 새 답이 오면 버튼 위에 5초 동안 미리보기를 띄운다. 누르면 그 세션 탭으로 연다.
  let peekedAt = '';
  let peekTimer = null;
  function peekNew() {
    const all = timeline('all');
    if (!peekedAt) { peekedAt = all.length ? String(all[all.length - 1].at) : '0'; return; }
    const fresh = all.filter((m) => m.from === 'agent' && String(m.at) > peekedAt);
    if (all.length) peekedAt = String(all[all.length - 1].at);
    if (!fresh.length || !$('panel').hidden) return;
    const m = fresh[fresh.length - 1];
    const peek = $('peek');
    peek.textContent = '';
    const who = document.createElement('b');
    who.textContent = nameOf(m.session);
    peek.append(who, m.text.replace(/\s+/g, ' ').slice(0, 90) + (m.text.length > 90 ? '…' : ''));
    peek.hidden = false;
    peek.onclick = () => {
      peek.hidden = true;
      if (m.session) activeTab = m.session;
      scrollToUnread = true;
      if ($('panel').hidden) $('btn').click();
      else render();
    };
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => { peek.hidden = true; }, 5000);
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
      let changedSeen = false;
      for (const x of sessions) {
        if (seen[x.id] === undefined) {
          const it = timeline(x.id);
          seen[x.id] = it.length ? String(it[it.length - 1].at) : '0';
          changedSeen = true;
        }
      }
      if (changedSeen) saveSeen();
      const all = timeline('all');
      const k = all.length + ':' + (all[all.length - 1]?.id || '') + ':' + sessions.map((x) => x.id + (x.watch?.active ? 1 : 0) + (x.watch?.handling ? 'h' : '') + (x.status?.state || '') + (x.status?.detail || '')).join(',');
      if (k !== key) { key = k; render(); }
      else updateBadges(); // 앱이 탭 제목을 다시 써도 개수가 유지되게
      peekNew();
    } catch {}
  }

  $('btn').onclick = () => {
    const open = $('panel').hidden;
    if (open) scrollToUnread = true;
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
    if (!sessionById(activeTab)) return;
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
