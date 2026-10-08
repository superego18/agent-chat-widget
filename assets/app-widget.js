// 대화/피드백 위젯. 앱 화면(app-proxy.mjs 가 HTML 응답에 넣음)과 리뷰 페이지(review-template.html 이 불러옴)가 같은 이 파일을 쓴다.
// 페이지 스타일과 섞이지 않게 Shadow DOM 안에 그린다. 메시지는 리뷰 대화 기록(chat.json)에 쌓인다.
// 리뷰 페이지는 불러오기 전에 window.__uifbConfig = { context: 'review', round, label, pick: false } 를 둔다.
(() => {
  if (window.__uifb) return;
  window.__uifb = true;
  const CFG = { context: 'app', label: '앱 화면', pick: true, round: null, ...(window.__uifbConfig || {}) };

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
  .grip { position: absolute; right: 0; top: 0; width: 18px; height: 18px; cursor: nesw-resize; z-index: 2; touch-action: none; }
  .grip::after { content: ''; position: absolute; right: 4px; top: 4px; width: 8px; height: 8px; border-right: 2px solid rgba(0,0,0,.25); border-top: 2px solid rgba(0,0,0,.25); border-radius: 0 3px 0 0; }
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
  form { display: flex; gap: 6px; padding: 8px 10px 10px; align-items: flex-end; }
  textarea { flex: 1; min-width: 0; resize: none; height: 40px; max-height: 110px; font-size: 13px; padding: 8px 9px; border-radius: 7px; border: 1px solid rgba(0,0,0,.15); background: #f6f5f1; color: #1c1b18; }
  form textarea { resize: vertical; height: 80px; max-height: 50vh; }
  form button { height: 40px; flex-shrink: 0; border: 0; border-radius: 7px; padding: 0 12px; background: #1c1b18; color: #fff; font-weight: 600; font-size: 13px; cursor: pointer; }
  .drafts { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; background: #f6f5f1; }
  .drafts[hidden], .msgs[hidden], form[hidden], .chipbtn[hidden] { display: none; }
  .draft { background: #fff; border-radius: 9px; box-shadow: 0 0 0 1px rgba(0,0,0,.1); padding: 8px 9px; display: grid; gap: 6px; }
  .draft .top { display: flex; gap: 7px; align-items: flex-start; }
  .draft input[type=checkbox] { margin-top: 6px; flex-shrink: 0; }
  .draft textarea { height: auto; min-height: 36px; background: #fff; }
  .draft .meta { font-size: 11px; color: #8f8c84; display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; }
  .draft .loc.same { color: #15803d; } .draft .loc.changed { color: #b45309; } .draft .loc.other { color: #5a5852; }
  .draft .acts { display: flex; flex-wrap: wrap; gap: 4px; }
  .draft .acts button, .draft .acts select { font-size: 11px; padding: 3px 7px; border-radius: 6px; border: 1px solid rgba(0,0,0,.12); background: #fff; color: #5a5852; cursor: pointer; }
  .draft .acts .send1 { background: #1c1b18; color: #fff; border-color: transparent; }
  .dfoot { display: flex; gap: 8px; align-items: center; padding: 8px 10px 10px; font-size: 12px; color: #5a5852; border-top: 1px solid rgba(0,0,0,.08); }
  .dfoot[hidden] { display: none; }
  .dfoot button { margin-left: auto; border: 0; border-radius: 7px; padding: 8px 12px; background: #1c1b18; color: #fff; font-weight: 600; font-size: 13px; cursor: pointer; }
  .dfoot button:disabled { opacity: .4; cursor: default; }
  form .later { background: #fff; color: #1c1b18; box-shadow: inset 0 0 0 1px rgba(0,0,0,.15); }
  .off { display: none !important; }
  .hint { position: fixed; left: 50%; top: 16px; transform: translateX(-50%); background: #1c1b18; color: #fff; font-size: 13px; padding: 8px 12px; border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,.25); }
  .hint[hidden] { display: none; }
  .box { position: fixed; pointer-events: none; outline: 2px solid #4f46e5; background: rgba(79,70,229,.08); border-radius: 3px; }
  .box[hidden] { display: none; }
</style>
<div class="peek" id="peek" hidden role="status"></div>
<button class="btn" id="btn" type="button" aria-expanded="false">대화/피드백<span class="badge" id="badge" hidden></span></button>
<section class="panel" id="panel" hidden aria-label="대화/피드백">
  <div class="grip" id="grip" title="끌어서 크기 조절" aria-hidden="true"></div>
  <header><b id="heading">대화/피드백</b><div class="row tabs" id="tabs" role="tablist" aria-label="세션"></div><p id="mode" class="off"></p></header>
  <div class="msgs" id="msgs" aria-live="polite"></div>
  <div class="drafts" id="drafts" hidden></div>
  <div class="dfoot" id="dfoot" hidden><label><input type="checkbox" id="dall"> 전체</label><button type="button" id="dsend" disabled>선택한 것 보내기</button></div>
  <div class="row" id="composeRow"><button class="chipbtn" type="button" id="draftsBtn" aria-pressed="false">보관함</button><button class="chipbtn" type="button" id="pick" style="margin-left:auto">위치 찍기</button></div>
  <div class="where" id="where" hidden><span id="whereText"></span><button type="button" id="whereClear" aria-label="위치 지우기">×</button></div>
  <form id="form"><textarea id="input" placeholder="질문이나 요청 · Enter 보내기" aria-label="메시지"></textarea><button type="button" class="later" id="later" title="보내지 않고 보관함에 담아 두기">나중에</button><button type="submit">보내기</button></form>
</section>
<div class="hint" id="hint" hidden>의견을 남길 곳을 누르세요 · Esc 취소</div>
<div class="box" id="box" hidden></div>`;

  const $ = (s) => root.getElementById(s);
  $('heading').textContent = `대화/피드백 · ${CFG.label}`;
  if (!CFG.pick) $('pick').classList.add('off'); // 리뷰 페이지는 이미지 핀으로 위치를 남긴다
  let messages = [];
  let sessions = [];
  const transcripts = {};
  let activeTab = null;
  try { activeTab = localStorage.getItem('__uifb_tab'); } catch {}
  let where = null;
  // 세션마다 마지막으로 읽은 시각. 탭을 열고 맨 아래까지 봐야 그 세션이 읽음으로 바뀐다.
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem('__uifb_seen') || '{}'); } catch {}
  if (!seen || typeof seen !== 'object' || Array.isArray(seen)) seen = {}; // 예전 버전은 숫자로 저장했다
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
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    const prevTop = box.scrollTop;
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
      d.dataset.at = String(m.at);
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
    } else if (nearBottom) {
      box.scrollTop = box.scrollHeight;
    } else {
      box.scrollTop = prevTop; // 다시 그려도 읽던 위치를 유지한다
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
    markSeenVisible();
    updateBadges();
    updateDraftsBtn();
    if (showDrafts && !$('drafts').contains(root.activeElement)) renderDrafts(); // 고치는 중인 글은 다시 그리지 않는다
  }

  function updateBadges() {
    const unread = timeline('all').filter(isUnread).length;
    $('badge').hidden = unread === 0;
    $('badge').textContent = String(unread);
    const base = document.title.replace(/^\(\d+\) /, '');
    document.title = (unread ? `(${unread}) ` : '') + base;
  }

  // 화면에 끝까지 보인(또는 지나간) 답을 읽음으로 바꾼다. 지금 탭의 세션만 바뀌고 다른 세션의 안 읽음은 그대로다.
  function markSeenVisible() {
    const box = $('msgs');
    if ($('panel').hidden || document.hidden || !sessionById(activeTab)) return;
    const limit = box.getBoundingClientRect().bottom + 4;
    let at = seen[activeTab] || '';
    for (const el of box.querySelectorAll('.msg.unread')) {
      if (el.getBoundingClientRect().bottom > limit) continue;
      el.classList.remove('unread');
      if (el.dataset.at > at) at = el.dataset.at;
    }
    if (at === (seen[activeTab] || '')) return;
    seen[activeTab] = at;
    saveSeen();
    if (!box.querySelector('.msg.unread')) box.querySelectorAll('.newline').forEach((el) => el.remove());
    renderTabs();
    updateBadges();
  }
  $('msgs').addEventListener('scroll', markSeenVisible);
  document.addEventListener('visibilitychange', markSeenVisible);

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
      const [c, ss, dd] = await Promise.all([
        fetch('/__uifb/api/chat').then((r) => r.json()),
        fetch('/__uifb/api/sessions').then((r) => r.json()),
        fetch('/__uifb/api/drafts').then((r) => r.json()),
      ]);
      messages = c.messages || [];
      const dk = JSON.stringify(dd.drafts || []);
      if (dk !== draftsKey) {
        draftsKey = dk;
        drafts = dd.drafts || [];
        if (showDrafts && !$('drafts').contains(root.activeElement)) renderDrafts();
      }
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
    if (open) { autoGrow($('input')); $('input').focus(); }
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
      if (pickFor) {
        draftsApi({ action: 'update', id: pickFor, where });
        where = null;
      } else {
        $('whereText').textContent = '위치: ' + (where.text || where.selector);
        $('where').hidden = false;
      }
    }
    const repicked = pickFor;
    pickFor = null;
    stopPick();
    if (!repicked) $('input').focus();
  }
  function onKey(e) { if (e.key === 'Escape') { pickFor = null; stopPick(); } }
  function startPick() {
    $('panel').hidden = true;
    $('hint').hidden = false;
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onPick, true);
    document.addEventListener('keydown', onKey, true);
  }
  $('pick').onclick = () => startPick();
  $('whereClear').onclick = () => { where = null; $('where').hidden = true; };

  $('form').onsubmit = async (e) => {
    e.preventDefault();
    const text = $('input').value.trim();
    if (!text) return;
    $('input').value = '';
    autoGrow($('input'));
    if (!sessionById(activeTab)) return;
    const body = { from: 'user', text, to: activeTab, context: CFG.context, round: CFG.round, ...(CFG.pick ? { where: where || { url: location.pathname + location.search } } : {}) };
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
  // 입력칸: 글이 길어지면 자동으로 늘어나고(화면 절반까지), 오른쪽 아래 모서리를 끌어 직접 키우거나 줄일 수도 있다.
  // 입력칸은 대화 창 높이의 40%까지만 커진다. 커진 만큼 대화 목록이 줄어들 뿐 겹치지 않고, 아래 끝을 보던 중이면 계속 아래 끝을 보여 준다.
  const inputMax = () => Math.round($('panel').getBoundingClientRect().height * 0.4) || 200;
  // 직접 끌어 정한 높이는 기억해서 다음에도 그 높이로 시작하고, 글을 비우면 그 높이로 돌아간다(기본 80px).
  let inputBase = null;
  try { inputBase = Number(localStorage.getItem('__uifb_inputH')) || null; } catch {}
  function autoGrow(el) {
    const max = inputMax();
    el.style.maxHeight = max + 'px';
    if (!el.value) { el.style.height = inputBase ? Math.min(inputBase, max) + 'px' : ''; return; }
    if (el.scrollHeight > el.clientHeight) el.style.height = Math.min(el.scrollHeight + 2, max) + 'px';
  }
  $('input').addEventListener('input', () => autoGrow($('input')));
  $('input').addEventListener('pointerdown', () => {
    const el = $('input');
    el.style.maxHeight = inputMax() + 'px';
    const before = el.offsetHeight;
    addEventListener('pointerup', () => {
      if (el.offsetHeight === before) return;
      inputBase = el.offsetHeight;
      try { localStorage.setItem('__uifb_inputH', String(inputBase)); } catch {}
    }, { once: true });
  });
  {
    let gap = 0;
    $('msgs').addEventListener('scroll', () => { const b = $('msgs'); gap = b.scrollHeight - b.scrollTop - b.clientHeight; });
    new ResizeObserver(() => { const b = $('msgs'); if (gap < 40) b.scrollTop = b.scrollHeight; }).observe($('msgs'));
  }
  $('input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('form').requestSubmit(); }
  });

  // ── 보관함: 나중에 보낼 메시지를 세션별로 모았다가 골라서 보낸다(리뷰 서버 drafts.json, 리뷰 페이지와 같은 보관함) ──
  let drafts = [];
  let draftsKey = '';
  let showDrafts = false;
  let pickFor = null;
  const checked = new Set();
  const draftsApi = async (body) => {
    const r = await fetch('/__uifb/api/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await poll();
    return r.json();
  };
  const mine = () => drafts.filter((d) => d.to === activeTab);

  function updateDraftsBtn() {
    const n = mine().length;
    $('draftsBtn').textContent = showDrafts ? '대화로 돌아가기' : n ? `보관함 ${n}` : '보관함';
    $('draftsBtn').setAttribute('aria-pressed', String(showDrafts));
  }

  // 저장한 위치가 지금 화면에서도 그대로인지. 같은 화면이 아니면 판단하지 않는다.
  function locOf(w) {
    if (!w?.selector) return null;
    if (w.url !== location.pathname + location.search) return { k: 'other', label: `다른 화면 · ${w.url}` };
    let el = null;
    try { el = document.querySelector(w.selector); } catch {}
    const now = el ? (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 80) : '';
    if (!el || (w.text && now !== w.text)) return { k: 'changed', label: '화면이 바뀜 · 다시 찍기 권장' };
    return { k: 'same', label: '위치 그대로', el };
  }

  function flash(el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => {
      const r = el.getBoundingClientRect();
      Object.assign($('box').style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
      $('box').hidden = false;
      setTimeout(() => { $('box').hidden = true; }, 1600);
    }, 350);
  }

  function renderDrafts() {
    const box = $('drafts');
    box.textContent = '';
    const list = mine();
    for (const id of [...checked]) if (!list.some((d) => d.id === id)) checked.delete(id);
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = '보관함이 비어 있습니다.\n글을 쓰고 "나중에"를 누르면 여기에 담깁니다.';
      box.append(p);
    }
    for (const d of list) {
      const card = document.createElement('div');
      card.className = 'draft';
      const top = document.createElement('div');
      top.className = 'top';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = checked.has(d.id);
      cb.setAttribute('aria-label', '보낼 항목으로 고르기');
      cb.onchange = () => { cb.checked ? checked.add(d.id) : checked.delete(d.id); updateFoot(); };
      const ta = document.createElement('textarea');
      ta.value = d.text;
      ta.rows = Math.min(5, d.text.split('\n').length + 1);
      ta.setAttribute('aria-label', '보관한 메시지');
      ta.onchange = () => { if (ta.value.trim()) draftsApi({ action: 'update', id: d.id, text: ta.value }); };
      top.append(cb, ta);
      const meta = document.createElement('div');
      meta.className = 'meta';
      const when = document.createElement('span');
      when.textContent = new Date(d.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + (d.round ? ` · ${d.round}차 리뷰` : '');
      meta.append(when);
      const loc = locOf(d.where);
      if (loc) {
        const l = document.createElement('span');
        l.className = 'loc ' + loc.k;
        l.textContent = loc.label;
        meta.append(l);
      }
      const acts = document.createElement('div');
      acts.className = 'acts';
      const btn = (label, fn, cls) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (cls) b.className = cls; b.onclick = fn; acts.append(b); };
      btn('이것만 보내기', () => sendDrafts([d.id]), 'send1');
      if (loc?.el) btn('위치 보기', () => flash(loc.el));
      if (d.where?.selector) btn('다시 찍기', () => { pickFor = d.id; startPick(); });
      if (sessions.length > 1) {
        const sel = document.createElement('select');
        sel.setAttribute('aria-label', '받을 세션 바꾸기');
        for (const x of sessions) { const o = document.createElement('option'); o.value = x.id; o.textContent = x.id === d.to ? `${x.name}에게` : `${x.name}(으)로 옮기기`; sel.append(o); }
        sel.value = d.to;
        sel.onchange = () => draftsApi({ action: 'update', id: d.id, to: sel.value });
        acts.append(sel);
      }
      btn('지우기', () => draftsApi({ action: 'delete', ids: [d.id] }));
      card.append(top, meta, acts);
      box.append(card);
    }
    updateFoot();
  }

  function updateFoot() {
    const n = mine().filter((d) => checked.has(d.id)).length;
    $('dsend').disabled = n === 0;
    $('dsend').textContent = n > 1 ? `선택한 ${n}개 한 번에 보내기` : '선택한 것 보내기';
    $('dall').checked = n > 0 && n === mine().length;
  }

  async function sendDrafts(ids) {
    await draftsApi({ action: 'send', ids, combine: true });
    ids.forEach((id) => checked.delete(id));
    if (!mine().length) setDraftsView(false);
    else renderDrafts();
  }

  function setDraftsView(on) {
    showDrafts = on;
    $('msgs').hidden = on;
    $('drafts').hidden = !on;
    $('dfoot').hidden = !on;
    $('form').hidden = on;
    $('pick').hidden = on;
    $('where').hidden = on || !where;
    updateDraftsBtn();
    if (on) renderDrafts();
    else { scrollToUnread = true; render(); }
  }
  $('draftsBtn').onclick = () => setDraftsView(!showDrafts);
  $('dall').onchange = () => { mine().forEach((d) => ($('dall').checked ? checked.add(d.id) : checked.delete(d.id))); renderDrafts(); };
  $('dsend').onclick = () => sendDrafts(mine().filter((d) => checked.has(d.id)).map((d) => d.id));

  $('later').onclick = async () => {
    const text = $('input').value.trim();
    if (!text || !sessionById(activeTab)) return;
    $('input').value = '';
    autoGrow($('input'));
    try {
      await draftsApi({ action: 'add', to: activeTab, text, context: CFG.context, round: CFG.round, ...(CFG.pick ? { where: where || { url: location.pathname + location.search } } : {}) });
      where = null;
      $('where').hidden = true;
      updateDraftsBtn();
    } catch {
      $('input').value = text;
    }
  };

  // 오른쪽 위 손잡이를 끌어 창 크기를 바꾼다(창은 왼쪽 아래에 붙어 있다). 크기는 이 브라우저에 기억한다.
  function applySize(sz) {
    if (!sz) return;
    const w = Math.min(Math.max(300, sz.w), innerWidth - 32);
    const h = Math.min(Math.max(320, sz.h), innerHeight - 140);
    $('panel').style.width = w + 'px';
    $('panel').style.height = h + 'px';
  }
  let size = null;
  try { size = JSON.parse(localStorage.getItem('__uifb_size') || 'null'); } catch {}
  applySize(size);
  addEventListener('resize', () => applySize(size));
  $('grip').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const r = $('panel').getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
    $('grip').setPointerCapture(e.pointerId);
    const move = (ev) => { size = { w: start.w + (ev.clientX - start.x), h: start.h - (ev.clientY - start.y) }; applySize(size); };
    const up = () => {
      $('grip').removeEventListener('pointermove', move);
      try { localStorage.setItem('__uifb_size', JSON.stringify(size)); } catch {}
    };
    $('grip').addEventListener('pointermove', move);
    $('grip').addEventListener('pointerup', up, { once: true });
  });
  $('grip').addEventListener('dblclick', () => { size = null; $('panel').style.width = ''; $('panel').style.height = ''; try { localStorage.removeItem('__uifb_size'); } catch {} });

  poll();
  setInterval(poll, 3000);
})();
