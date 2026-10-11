// 대화/피드백 위젯. 앱 화면(app-proxy.mjs 가 HTML 응답에 넣음)과 리뷰 페이지(review-template.html 이 불러옴)가 같은 이 파일을 쓴다.
// 페이지 스타일과 섞이지 않게 Shadow DOM 안에 그린다. 메시지는 리뷰 대화 기록(chat.json)에 쌓인다.
// 리뷰 페이지는 불러오기 전에 window.__uifbConfig = { context: 'review', round, label } 를 둔다. pick: false 면 위치 찍기를 숨긴다.
(() => {
  if (window.__uifb) return;
  window.__uifb = true;
  // 지금 주소(접속 키 k 는 빼고). 위치 기록에 키가 남지 않게 한다.
  const here = () => { const u = new URL(location.href); u.searchParams.delete('k'); return u.pathname + u.search; };
  // 터치 화면(폰·태블릿)에서는 창을 열 때 입력칸에 자동으로 들어가지 않는다(키보드가 바로 올라와 대화를 가린다).
  const touchScreen = () => matchMedia('(pointer: coarse)').matches;
  // 메시지를 보낸 화면 구분. 창 크기·입력칸과 같은 기준(폭 768px)이다.
  const deviceNow = () => (innerWidth < 768 ? 'mobile' : 'desktop');
  const CFG = { context: 'app', label: '앱 화면', pick: true, round: null, ...(window.__uifbConfig || {}) };

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:auto;z-index:2147483647;';
  document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
  .btn { position: fixed; left: 20px; bottom: 112px; padding: 10px 14px; border-radius: 999px; border: 0; background: #1c1b18; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.25); display: flex; gap: 6px; align-items: center; }
  /* 세션이 작업 중이면 버튼에 움직이는 점 세 개(승인 대기면 주황). 안 읽은 개수 배지와 따로 보인다. */
  .btn .work { display: inline-flex; gap: 2px; align-items: center; padding: 0 2px; }
  .btn .work[hidden] { display: none; }
  .btn .work i { width: 4px; height: 4px; border-radius: 50%; background: #a5b4fc; animation: blink 1.2s infinite; }
  .btn .work i:nth-child(2) { animation-delay: .2s; } .btn .work i:nth-child(3) { animation-delay: .4s; }
  .btn .work.permission i { background: #fbbf24; }
  /* Next.js 개발 도구 단추(왼쪽 20px·바닥 20px, 36px)와 크기·왼쪽 끝을 맞춘다 */
  .rbtn { position: fixed; width: 36px; height: 36px; border-radius: 50%; border: 0; background: #fff; color: #1c1b18; font-size: 16px; cursor: pointer; box-shadow: 0 0 0 1px rgba(0,0,0,.1), 0 4px 12px rgba(0,0,0,.18); }
  .btn[aria-expanded="true"] + .rbtn { display: none; }
  .ri { display: inline-block; }
  .reloading { pointer-events: none; background: #eef2ff !important; color: #4f46e5 !important; }
  .reloading .ri { animation: rspin .7s linear infinite; }
  @keyframes rspin { to { transform: rotate(360deg); } }
  .btn .badge { min-width: 18px; height: 18px; border-radius: 9px; background: #4f46e5; font-size: 11px; line-height: 18px; text-align: center; padding: 0 5px; }
  .panel { position: fixed; left: 16px; bottom: 164px; width: min(360px, calc(100vw - 32px)); height: min(520px, calc(100vh - 200px)); background: #fff; color: #1c1b18; border-radius: 12px; box-shadow: 0 0 0 1px rgba(0,0,0,.1), 0 12px 32px rgba(0,0,0,.2); display: flex; flex-direction: column; overflow: hidden; }
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
  .msg a { color: inherit; text-decoration: underline; word-break: break-all; }
  .msg code { font-family: ui-monospace, monospace; font-size: 12px; background: rgba(127,127,127,.15); padding: 0 4px; border-radius: 4px; }
  .msg small { display: block; font-size: 10px; opacity: .7; margin-top: 2px; }
  /* 답장: 메시지마다 작은 "답장" 버튼(마우스가 있으면 올렸을 때만), 답장 메시지 위에는 원문 인용. */
  .msg .rp { font: inherit; font-size: 10px; color: inherit; background: none; border: 0; padding: 0 0 0 6px; cursor: pointer; text-decoration: underline; opacity: .8; }
  @media (hover: hover) { .msg .rp { opacity: 0; } .msg:hover .rp, .msg .rp:focus-visible { opacity: .8; } }
  .msg.editing { width: 88%; }
  .msg .edit { display: block; width: 100%; box-sizing: border-box; min-height: 64px; resize: vertical; font: inherit; color: #1c1b18; background: #fff; border: 0; border-radius: 6px; padding: 6px 8px; margin-top: 2px; }
  .msg .editbar { display: flex; gap: 6px; justify-content: flex-end; margin-top: 6px; }
  .msg .editbar button { font: inherit; font-size: 12px; font-weight: 600; height: 30px; padding: 0 12px; border-radius: 6px; border: 0; cursor: pointer; background: rgba(255,255,255,.22); color: inherit; }
  .msg .editbar .go { background: #fff; color: #4f46e5; }
  /* 보내기 취소한 메시지: 흐리게, 글에 줄을 긋는다. */
  .msg.user.cancelled { background: #e7e5e0; color: #6b6860; box-shadow: none; }
  .msg.user.cancelled > .mbody { text-decoration: line-through; } /* 글에만 긋는다(다시 보내기의 취소·다시 보내기 버튼 줄은 빼고) */
  .msg.user.cancelled .tag { background: rgba(0,0,0,.08); }
  .holdhead { align-self: flex-end; border: 0; background: none; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600; color: #4f46e5; padding: 2px 4px; }
  .msg.user.hold { max-width: 100%; }
  .msg.user.hold .hacts { flex-wrap: wrap; gap: 5px; }
  .msg.user.hold .hacts button { padding: 4px 8px; }
  .msg.user.hold.editing { width: 100%; }
  .msg.user.hold .hacts .brk { flex-basis: 100%; height: 0; }
  .msg.user.hold .hacts .now { background: #b45309; color: #fff; } /* 입력칸의 끼워넣기와 같은 주황(보내기와 구분) */
  .msg.user.hold .hacts .save { background: #fff; color: #4f46e5; box-shadow: inset 0 0 0 1.5px #4f46e5; }
  .msg.user.hold { background: #fff; color: #3730a3; box-shadow: none; border: 1.5px dashed #a5b4fc; }
  .msg.user.hold .tag { background: #e0e7ff; }
  .msg.user.hold .hacts { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
  .msg.user.hold .hacts button { font: inherit; font-size: 12px; font-weight: 600; border: 0; border-radius: 6px; padding: 4px 10px; cursor: pointer; background: #f1f1ef; color: #5a5852; }
  .msg.user.hold .hacts .go { background: #4f46e5; color: #fff; }
  .msg.user.hold.got { animation: got .7s ease-out; }
  .msg .dh { display: block; font-size: 11px; opacity: .85; margin-bottom: 4px; }
  .msg .ditem { display: block; }
  .msg .ditem + .ditem { margin-top: 8px; }
  .msg .meta { display: flex; margin-top: 4px; min-width: 0; }
  .msg .meta span { font-size: 10.5px; line-height: 1.35; padding: 1px 6px; border-radius: 5px; background: rgba(255,255,255,.2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .msg.user.held .meta span, .msg.user.cancelled .meta span { background: rgba(79,70,229,.1); }
  .msg .editdraft { display: block; }
  .msg .editdraft .meta { margin: 3px 0 8px; }
  .msg.flashing { animation: flashm 2s ease-out; }
  @keyframes flashm { 0%, 70% { outline: 3px solid #f59e0b; outline-offset: 2px; } 100% { outline: 3px solid transparent; outline-offset: 2px; } }
  /* 답 잇는 선: 대화 목록 오른쪽 가장자리를 따라, 질문(내 메시지)과 그에 대한 답을 꺾쇠 모양 선으로 잇는다. */
  .msgs { position: relative; padding-right: 18px; padding-left: 18px; }
  .links { position: absolute; top: 0; left: 0; pointer-events: none; overflow: visible; }
  .links { z-index: 0; }
  .msgs > .msg { position: relative; z-index: 1; } /* 선 끝이 말풍선 뒤로 들어가게 말풍선을 선 위에 둔다 */
  .links path { fill: url(#uifbLinkGrad) #a5b4fc; opacity: .3; transition: opacity .2s; }
  .links path.on { opacity: .9; }
  .links path.reply { fill: url(#uifbReplyGrad) #fbbf24; } /* 골라서 답장한 연결은 주황(인용 노란 음영과 같은 계열) */
  .links path.new { animation: linkin .6s ease-out; }
  @keyframes linkin { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .links path.new { animation: none; } }
  .msg .quote { display: block; font-size: 11px; line-height: 1.35; margin: 0 0 4px; padding: 3px 7px; border-left: 3px solid currentColor; border-radius: 4px; background: rgba(127,127,127,.14); opacity: .9; }
  .msg .quote.part { background: rgba(253,230,138,.55); color: #78350f; border-left-color: #f59e0b; opacity: 1; }
  .msg .quote .qt { overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; white-space: pre-wrap; }
  .msg .quote.open .qt { display: block; -webkit-line-clamp: unset; }
  .msg .quote .qbar { display: flex; gap: 10px; justify-content: flex-end; margin-top: 2px; }
  .msg .quote .qbar button { font: inherit; font-size: 10.5px; font-weight: 600; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; }
  .msg .quote .qbar button[hidden] { display: none; }
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
  /* 세션이 아직 안 읽은 메시지: 맨 아래에 붙잡혀 떠 있다가, 읽히면 대화 흐름으로 떨어진다. */
  .msg.user.held { background: #eef0ff; color: #3730a3; box-shadow: inset 0 0 0 1.5px rgba(79,70,229,.45); animation: hold 1.6s ease-in-out infinite; }
  .msg.user.held .tag { background: rgba(79,70,229,.12); }
  .msg.user.drop { animation: drop .45s cubic-bezier(.3,1.4,.5,1); }
  @keyframes hold { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
  @keyframes drop { from { transform: translateY(-16px); opacity: .55; } to { transform: none; opacity: 1; } }
  /* 세션끼리 주고받은 메시지: 사람이 쓴 글이 아니라는 게 한눈에 보이게 점선 테두리·다른 색으로 둔다. 받은 세션 탭에서는 오른쪽, 보낸 세션 탭에서는 왼쪽(그 세션이 말한 쪽). */
  .msg.peer { align-self: flex-start; background: #fff7ed; color: #431407; box-shadow: none; border: 1.5px dashed #f59e0b; }
  .msg.peer.in { align-self: flex-end; }
  .msg.peer .tag { background: #fed7aa; color: #9a3412; }
  .msg.peer .route { display: block; font-size: 11px; font-weight: 600; color: #c2410c; margin-bottom: 3px; }
  .tabs .flow { display: inline-block; align-self: center; font-weight: 700; color: #d97706; animation: flow .9s ease-in-out infinite; }
  .tabs .flow.back { animation-name: flowback; }
  @keyframes flow { 0%, 100% { transform: translateX(-3px); opacity: .5; } 50% { transform: translateX(3px); opacity: 1; } }
  @keyframes flowback { 0%, 100% { transform: translateX(3px); opacity: .5; } 50% { transform: translateX(-3px); opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .msg.user.held, .msg.user.drop, .tabs .flow { animation: none; } }
  .typing.stale { color: #b45309; }
  .msg.agent.unread { box-shadow: 0 0 0 1px rgba(0,0,0,.1), -3px 0 0 #4f46e5; }
  .peek { position: fixed; left: 16px; bottom: 164px; max-width: min(300px, calc(100vw - 32px)); background: #fff; color: #1c1b18; border-radius: 10px; box-shadow: 0 0 0 1px rgba(0,0,0,.1), 0 8px 24px rgba(0,0,0,.2); padding: 9px 11px; font-size: 13px; line-height: 1.45; cursor: pointer; }
  .peek[hidden] { display: none; }
  .peek b { display: block; font-size: 12px; color: #4f46e5; margin-bottom: 2px; }
  @media (prefers-reduced-motion: reduce) { .tabs .dot.busy, .typing .dots i { animation: none; } }
  .notif { float: right; margin-right: 6px; border: 0; background: #f6f5f1; border-radius: 6px; padding: 4px 10px; font-size: 13px; color: #5a5852; cursor: pointer; }
  .notif.on { background: #eef0ff; color: #3730a3; }
  .nset { position: absolute; right: 10px; top: 44px; z-index: 5; width: 250px; background: #fff; border-radius: 12px; box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 10px 28px rgba(0,0,0,.2); padding: 10px 12px; font-size: 13px; color: #1c1b18; }
  .nset[hidden] { display: none; }
  .nset b { display: block; font-size: 12px; color: #8f8c84; margin: 2px 0 6px; }
  .nset label { display: flex; gap: 8px; align-items: center; padding: 4px 0; cursor: pointer; }
  .nset hr { border: 0; border-top: 1px solid rgba(0,0,0,.08); margin: 6px 0; }
  .nset .nbtns { display: flex; gap: 6px; justify-content: flex-end; margin-top: 8px; }
  .nset .nbtns button { font: inherit; font-size: 12px; border: 0; border-radius: 6px; padding: 5px 10px; cursor: pointer; background: #f1f1ef; color: #5a5852; }
  .close { display: none; float: right; border: 0; background: #f6f5f1; border-radius: 6px; padding: 4px 10px; font-size: 13px; color: #1c1b18; cursor: pointer; }
  /* 모바일(768px 미만): 앱 위에 떠 있는 작은 창 대신 화면을 채우는 창으로 연다. 크기 조절 손잡이는 쓰지 않는다. */
  @media (max-width: 767px) {
    .panel { left: 0 !important; right: 0; top: 0; bottom: 0 !important; width: 100% !important; height: 100% !important; height: 100dvh !important; border-radius: 0; box-shadow: none; padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); }
    .btn[aria-expanded="true"], .peek, .grip { display: none !important; }
    .close { display: inline-block; }
    header { padding: 10px 12px 8px; }
    .msgs, .drafts { padding: 10px 10px 14px; }
    .msgs { padding-right: 18px; padding-left: 18px; }
    .msg { font-size: 15px; max-width: 92%; }
    /* iPhone 은 16px 보다 작은 입력칸을 누르면 화면을 확대하므로, 모든 입력칸·선택칸을 16px 로 둔다(아래 일반 규칙보다 앞에 있어 !important) */
    textarea, input, select { font-size: 16px !important; }
    .cats .newlb { width: 110px; }
  }
  .row { display: flex; gap: 4px; align-items: center; padding: 8px 10px 0; font-size: 12px; color: #8f8c84; flex-wrap: wrap; }
  .chipbtn { font-size: 12px; padding: 4px 9px; border-radius: 999px; border: 1px solid rgba(0,0,0,.12); background: #fff; color: #5a5852; cursor: pointer; }
  .chipbtn[aria-pressed="true"] { background: #1c1b18; color: #fff; border-color: transparent; }
  #replyText { flex: 1; min-width: 0; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
  /* 일부만 인용: 메시지 글을 고르면 "고른 부분에 답장" 버튼이 뜨고, 답장할 부분은 원문에 노란 음영으로 표시된다. */
  .selreply { position: fixed; z-index: 2147483647; transform: translateX(-50%); font: inherit; font-size: 13px; font-weight: 600; padding: 7px 14px; border-radius: 999px; border: 0; background: #1c1b18; color: #fff; box-shadow: 0 6px 18px rgba(0,0,0,.25); cursor: pointer; }
  .selreply[hidden] { display: none; }
  .selreply { display: flex; padding: 0; overflow: hidden; }
  .selreply button { font: inherit; color: inherit; background: none; border: 0; padding: 7px 14px; cursor: pointer; }
  .selreply button + button { border-left: 1px solid #c7c9f5; }
  /* 글을 고르면 뜨는 답장·참고: 보관함에서 보냈을 때 뜨는 알림(.toast)과 같은 연보라 */
  .selreply { background: #eef0ff !important; color: #3730a3 !important; box-shadow: 0 0 0 1px #c7c9f5, 0 3px 10px rgba(55,48,163,.15) !important; }
  /* 참고(답장 아님): 회색 점선 인용, 원문과 잇는 선 없음 */
  .msg .quote.ref { background: rgba(127,127,127,.08); color: inherit; border-left: 0; outline: 1.5px dashed rgba(127,127,127,.55); outline-offset: -1.5px; opacity: .9; }
  #reply.ref { background: #f1f1ef; color: #44403c; outline: 1.5px dashed #a8a29e; outline-offset: -1.5px; }
  ::highlight(uifbq) { background-color: #fde68a; color: #1c1b18; }
  .where { margin: 6px 10px 0; font-size: 12px; background: #eef0ff; color: #3730a3; border-radius: 6px; padding: 5px 8px; display: flex; gap: 6px; align-items: center; }
  .where[hidden] { display: none; }
  .where span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .where button { border: 0; background: none; color: inherit; cursor: pointer; font-size: 12px; }
  form { display: flex; gap: 6px; padding: 8px 10px 10px; align-items: flex-end; }
  textarea { flex: 1; min-width: 0; resize: none; height: 40px; max-height: 110px; font-size: 13px; padding: 8px 9px; border-radius: 7px; border: 1px solid rgba(0,0,0,.15); background: #f6f5f1; color: #1c1b18; }
  form textarea { resize: vertical; height: 80px; max-height: 50vh; }
  form button { height: 40px; flex-shrink: 0; border: 0; border-radius: 7px; padding: 0 12px; background: #1c1b18; color: #fff; font-weight: 600; font-size: 13px; cursor: pointer; }
  /* 보관함: 대화 목록을 바꾸지 않고 입력칸 위로 올라오는 시트(드롭업). 대화와 입력칸은 그대로 보인다. */
  .dsheet { position: absolute; left: 0; right: 0; z-index: 3; max-height: 62%; display: flex; flex-direction: column; background: #f6f5f1; border-top: 1px solid rgba(0,0,0,.12); border-radius: 12px 12px 0 0; box-shadow: 0 -10px 24px rgba(0,0,0,.14); animation: sheetup .16s ease-out; }
  .dsheet[hidden] { display: none; }
  .cats { display: contents; }
  /* 분류 칩 한 줄: 짧게 누르면 "나중에" 담을 분류(진한 색), 꾹 누르면 그 분류 보관함 열기(▾). 누르는 동안 칩이 차오른다. */
  .cats .cat { position: relative; overflow: hidden; font-size: 11px; padding: 3px 8px; border-radius: 999px; border: 1px solid #c7c9f5; background: #eef0ff; color: #3730a3; cursor: pointer; white-space: nowrap; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; transition: transform .12s; }
  .cats .cat[aria-pressed="true"] { background: #4f46e5; color: #fff; border-color: transparent; }
  .cats .cat.open { box-shadow: 0 0 0 2px #fff, 0 0 0 3px #4f46e5; }
  .cats .cat .fill { position: absolute; inset: 0; background: rgba(79,70,229,.35); transform-origin: left; transform: scaleX(0); pointer-events: none; }
  .cats .cat.pressing { transform: scale(.95); }
  .cats .cat.pressing .fill { transform: scaleX(1); transition: transform .5s linear; }
  .cats .cat.pop { animation: catpop .25s; }
  @keyframes catpop { 50% { transform: scale(1.12); } }
  .cats .addcat { border-style: dashed; border-color: rgba(0,0,0,.2); background: #fff; color: #5a5852; }
  .cats .newlb { width: 84px; font-size: 11px; padding: 3px 8px; border-radius: 999px; border: 1px dashed rgba(0,0,0,.2); background: #fff; color: #5a5852; }
  .dsheet .dhead { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px 0; font-size: 12px; font-weight: 600; color: #3730a3; }
  .dsheet .dhead button { border: 0; background: none; font-size: 12px; color: #5a5852; cursor: pointer; padding: 2px 4px; }
  @keyframes sheetup { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .dsheet { animation: none; } }
  .drafts { flex: 1; min-height: 0; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
  .drafts[hidden], .msgs[hidden], form[hidden], .chipbtn[hidden] { display: none; }
  .draft { background: #fff; border-radius: 9px; box-shadow: 0 0 0 1px rgba(0,0,0,.1); padding: 8px 9px; display: grid; gap: 6px; }
  .draft .top { display: flex; gap: 7px; align-items: flex-start; }
  .draft input[type=checkbox] { margin-top: 6px; flex-shrink: 0; }
  .draft textarea { height: auto; min-height: 36px; max-height: none; overflow: hidden; background: #fff; line-height: 1.45; } /* 줄 높이를 정해 두어야 4줄 높이를 정확히 잰다 */
  .draft .meta { font-size: 11px; color: #8f8c84; display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; }
  .draft .loc.same { color: #15803d; } .draft .loc.changed { color: #b45309; } .draft .loc.other { color: #5a5852; }
  .draft .acts { display: flex; flex-wrap: wrap; gap: 4px; }
  .draft .acts button, .draft .acts select { font-size: 11px; padding: 3px 7px; border-radius: 6px; border: 1px solid rgba(0,0,0,.12); background: #fff; color: #5a5852; cursor: pointer; }
  .draft .acts .send1 { background: #1c1b18; color: #fff; border-color: transparent; }
  /* 맨 아래로: 위쪽 기록을 보고 있을 때만 대화 목록 오른쪽 아래에 뜬다. */
  .tobottom { position: fixed; z-index: 2147483646; width: 38px; height: 38px; border-radius: 50%; border: 0; background: #fff; color: #1c1b18; font-size: 18px; font-weight: 700; box-shadow: 0 0 0 1px rgba(0,0,0,.12), 0 4px 12px rgba(0,0,0,.18); cursor: pointer; }
  .tobottom[hidden] { display: none; }
  .tobottom.new { background: #4f46e5; color: #fff; box-shadow: 0 0 0 3px rgba(79,70,229,.25), 0 4px 12px rgba(55,48,163,.35); }
  .tobottom.new::after { content: attr(data-n); position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px; padding: 0 4px; box-sizing: border-box; border-radius: 9px; background: #ef4444; color: #fff; font-size: 11px; line-height: 18px; font-weight: 700; }
  .toast { position: fixed; z-index: 2147483647; transform: translateX(-50%); display: flex; gap: 8px; align-items: center; max-width: min(280px, calc(100vw - 32px)); white-space: nowrap; font-size: 11.5px; line-height: 1.3; padding: 5px 11px; border-radius: 999px; background: #eef0ff; color: #3730a3; box-shadow: 0 0 0 1px #c7c9f5, 0 3px 10px rgba(55,48,163,.15); animation: toastin .18s ease-out; }
  .toast > span { overflow: hidden; text-overflow: ellipsis; }
  @keyframes toastin { from { opacity: 0; transform: translate(-50%, 6px); } }
  .toast[hidden] { display: none; }
  .reloadcover { position: fixed; inset: 0; z-index: 2147483647; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px; text-align: center; background: rgba(238,240,255,.88); color: #3730a3; font-size: 14px; font-weight: 600; backdrop-filter: blur(2px); }
  .reloadcover[hidden] { display: none; }
  .reloadcover .ri { font-size: 30px; font-weight: 400; animation: rspin .8s linear infinite; }
  .toast button { flex-shrink: 0; font: inherit; font-weight: 700; color: #4f46e5; background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; }
  .dgroup.trash { opacity: .9; }
  .dgroup.only > header { justify-content: flex-end; }
  .draft .dmore { display: block; margin: 2px 0 0 auto; font: inherit; font-size: 11px; font-weight: 600; color: #4f46e5; background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; }
  .draft .dmore[hidden] { display: none; }
  .draft.moved { animation: moved 1.8s ease-out; }
  @keyframes moved { 0%, 60% { box-shadow: 0 0 0 2px #4f46e5; } 100% { box-shadow: 0 0 0 2px transparent; } }
  .gone { display: grid; grid-template-columns: auto 1fr auto; gap: 6px; align-items: center; padding: 6px 2px; border-top: 1px solid rgba(0,0,0,.06); font-size: 12px; }
  .gone .gwhat { font-size: 10.5px; font-weight: 600; padding: 1px 6px; border-radius: 5px; white-space: nowrap; }
  .gone .gwhat.sent { background: #dcfce7; color: #166534; }
  .gone .gwhat.deleted { background: #fee2e2; color: #991b1b; }
  .gone .gtext { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #5a5852; cursor: pointer; }
  .gone .gtext.open { white-space: pre-wrap; overflow: visible; color: #1c1b18; }
  .gone { align-items: start; }
  .gone button { font: inherit; font-size: 11px; padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(0,0,0,.15); background: #fff; cursor: pointer; }
  .dfoot { display: flex; gap: 8px; align-items: center; padding: 8px 10px 10px; font-size: 12px; color: #5a5852; border-top: 1px solid rgba(0,0,0,.08); }
  .dfoot[hidden] { display: none; }
  .dfoot button { margin-left: auto; border: 0; border-radius: 7px; padding: 8px 12px; background: #1c1b18; color: #fff; font-weight: 600; font-size: 13px; cursor: pointer; }
  .dfoot button:disabled { opacity: .4; cursor: default; }
  .dgroup { display: grid; gap: 6px; }
  .dgroup > header { display: flex; gap: 6px; align-items: center; padding: 0; border: 0; font-size: 12px; font-weight: 600; color: #3730a3; }
  .dgroup > header .fold { border: 0; background: none; cursor: pointer; font: inherit; color: inherit; padding: 0; }
  .dgroup > header .n { font-weight: 400; color: #8f8c84; }
  .dgroup > header .gsend { margin-left: auto; font-size: 11px; padding: 3px 8px; border-radius: 6px; border: 0; background: #1c1b18; color: #fff; cursor: pointer; }
  .dgroup.folded .draft { display: none; }
  /* 입력칸 지우기: 글이 있을 때만 입력칸 오른쪽 위에 보인다. */
  .inwrap { position: relative; flex: 1; min-width: 0; display: flex; }
  form .clr { position: absolute; top: 5px; right: 5px; width: 24px; height: 24px; padding: 0; border-radius: 12px; background: rgba(0,0,0,.08); color: #5a5852; font-size: 14px; font-weight: 400; line-height: 24px; }
  form .clr[hidden] { display: none; }
  .inwrap textarea { padding-right: 32px; }
  form .now { background: #b45309; padding: 0 9px; }
  form .now[hidden] { display: none; }
  .msg.user .tag.now { background: #fde68a; color: #78350f; }
  .fly { position: fixed; z-index: 2147483647; pointer-events: none; padding: 5px 9px; border-radius: 10px; background: #4f46e5; color: #fff; font-size: 12px; white-space: nowrap; max-width: 200px; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 6px 18px rgba(0,0,0,.25); transform-origin: center; }
  #draftsBtn.got { animation: got .7s ease-out; }
  @keyframes got { 0% { transform: scale(1); } 30% { transform: scale(1.18); background: #4f46e5; color: #fff; } 100% { transform: scale(1); } }
  @media (prefers-reduced-motion: reduce) { #draftsBtn.got { animation: gotc 1s; } @keyframes gotc { 0%, 60% { background: #4f46e5; color: #fff; } } }
  /* 오른쪽 단추는 두 줄로 묶는다: [보내기 / 끼워넣기] [보류하기 / 보관함 담기] */
  form .bcol { display: flex; flex-direction: column; gap: 4px; flex-shrink: 0; align-self: stretch; justify-content: flex-end; }
  button.busy { pointer-events: none; color: transparent !important; position: relative; }
  button.busy::before { content: none !important; }
  /* 새로고침 단추와 같은 ↻ 가 돈다 */
  button.busy::after { content: '↻'; position: absolute; left: 50%; top: 50%; width: 1em; height: 1em; margin: -.5em 0 0 -.5em; line-height: 1em; text-align: center; font-size: 15px; font-weight: 400; color: var(--spt, #4f46e5); animation: rspin .7s linear infinite; }
  form button[type="submit"].busy, form .now.busy, .hacts .go.busy, .hacts .now.busy { --spt: #fff; }
  form .bcol button { height: 38px; padding: 0 10px; font-size: 12.5px; }
  /* 단추 칸은 입력칸이 길어져도 늘지 않고 아래에 붙는다. 끼워넣기가 없으면 보내기가 두 칸(보류+보관함) 높이를 채운다 */
  form .bcol { align-self: flex-end; }
  form .bcol button[type="submit"] { flex: none; height: 38px; }
  form .bcol button[type="submit"]:has(+ .now[hidden]) { height: 80px; }
  form .later { background: #fff; color: #1c1b18; box-shadow: inset 0 0 0 1px rgba(0,0,0,.15); }
  /* 보류 = 대화창 맨 아래 점선 말풍선과 같은 남색 점선, 보관함 = 보관함 창과 같은 베이지 상자 */
  form #later, .msg.user.hold .hacts .tohold { background: #fff; color: #3730a3; box-shadow: none; border: 1.5px dashed #818cf8; }
  form #stash, .msg.user.hold .hacts .tostash { background: #ece9e1; color: #57534e; box-shadow: inset 0 0 0 1px #d6d3cb, inset 0 -3px 0 #d6d3cb; }
  form #later::before, form #stash::before, .msg.user.hold .hacts .tostash::before { margin-right: 3px; }
  form #stash::before, .msg.user.hold .hacts .tostash::before { content: '▤'; }
  .off { display: none !important; }
  .hint { position: fixed; left: 50%; top: 16px; transform: translateX(-50%); background: #1c1b18; color: #fff; font-size: 13px; padding: 8px 12px; border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,.25); }
  .hint[hidden] { display: none; }
  .hint { display: flex; gap: 10px; align-items: center; white-space: nowrap; }
  .seg { display: flex; background: rgba(255,255,255,.14); border-radius: 7px; padding: 2px; }
  .seg button { border: 0; background: none; color: #fff; font: inherit; font-size: 12px; padding: 4px 9px; border-radius: 5px; cursor: pointer; }
  .seg button[aria-pressed="true"] { background: #fff; color: #1c1b18; font-weight: 600; }
  .hcancel { border: 0; background: none; color: #c7c4bc; font: inherit; font-size: 12px; cursor: pointer; padding: 4px 2px; }
  .hint.bottom { top: auto; bottom: 16px; }
  @media (max-width: 767px) { .panel.picking { height: calc(100dvh - 64px) !important; } }
  .box { position: fixed; pointer-events: none; outline: 2px solid #4f46e5; background: rgba(79,70,229,.08); border-radius: 3px; }
  .box[hidden] { display: none; }
</style>
<div class="peek" id="peek" hidden role="status"></div>
<button class="btn" id="btn" type="button" aria-expanded="false">대화/피드백<span class="work" id="work" hidden><i></i><i></i><i></i></span><span class="badge" id="badge" hidden></span></button><button class="rbtn" id="rbtn" type="button" title="화면 새로고침" aria-label="화면 새로고침"><span class="ri">↻</span></button>
<section class="panel" id="panel" hidden aria-label="대화/피드백">
  <div class="grip" id="grip" title="끌어서 크기 조절" aria-hidden="true"></div>
  <header><button class="close" id="close" type="button">닫기</button><button class="notif" id="reload" type="button" title="새로고침"><span class="ri">↻</span></button><button class="notif" id="notif" type="button" title="알림 켜기·설정">🔕 알림</button>
  <div class="nset" id="nset" hidden role="dialog" aria-label="알림 설정"></div><b id="heading">대화/피드백</b><div class="row tabs" id="tabs" role="tablist" aria-label="세션"></div><p id="mode" class="off"></p></header>
  <div class="msgs" id="msgs" aria-live="polite"></div>
  <div class="dsheet" id="dsheet" hidden role="dialog" aria-label="보관함"><div class="dhead"><span id="dtitle">보관함</span><button type="button" id="dclose" aria-label="보관함 닫기">닫기 ▾</button></div><div class="drafts" id="drafts"></div>
  <div class="dfoot" id="dfoot"><label><input type="checkbox" id="dall"> 전체</label><button type="button" id="dsend" disabled>선택한 것 보내기</button></div></div>
  <div class="row" id="composeRow"><button class="chipbtn" type="button" id="draftsBtn" aria-pressed="false" aria-label="보관함 전체">전체</button><span class="cats" id="cats"></span><button class="chipbtn" type="button" id="pick" style="margin-left:auto">위치 찍기</button></div>
  <div class="where" id="reply" hidden><span id="replyText"></span><button type="button" id="replyClear" aria-label="답장 취소">×</button></div>
  <span class="selreply" id="selReply" hidden><button type="button" id="selR">↩ 답장</button><button type="button" id="selF">📎 참고</button></span>
  <div class="toast" id="toast" hidden role="status"></div>
  <div class="reloadcover" id="reloadCover" hidden role="status"><b class="ri">↻</b><span></span></div>
  <button type="button" class="tobottom" id="toBottom" hidden aria-label="맨 아래로">↓</button>
  <div class="where" id="where" hidden><span id="whereText"></span><button type="button" id="whereClear" aria-label="위치 지우기">×</button></div>
  <form id="form"><span class="inwrap"><textarea id="input" placeholder="질문이나 요청 · Enter 보내기" aria-label="메시지"></textarea><button type="button" class="clr" id="clr" aria-label="입력칸 비우기" title="입력칸 비우기" hidden>×</button></span><span class="bcol"><button type="submit">보내기</button><button type="button" class="now" id="now" title="하던 일이 끝나길 기다리지 않고, 세션이 다음 단계로 넘어갈 때 바로 읽게 보내기" hidden>끼워넣기</button></span><span class="bcol"><button type="button" class="later" id="later" title="대화창 맨 아래에 잠깐 보류(보내기를 누를 때까지 안 보냄)">보류</button><button type="button" class="later" id="stash" title="보관함에 담아 두고 나중에 분류해서 보내기">보관함</button></span></form>
</section>
<div class="hint" id="hint" hidden><span>찍을 곳을 누르세요</span><span class="seg" role="group" aria-label="찍을 화면"><button type="button" data-t="app" aria-pressed="true">앱 화면</button><button type="button" data-t="widget" aria-pressed="false">대화창</button></span><button type="button" class="hcancel" id="pickCancel">취소</button></div>
<div class="box" id="box" hidden></div>`;

  const $ = (s) => root.getElementById(s);
  $('heading').textContent = `대화/피드백 · ${CFG.label}`;
  if (!CFG.pick) $('pick').classList.add('off');
  let messages = [];
  const sentTexts = new Map(); // 보낸 글 → 보낸 시각(입력칸에 다시 채우지 않게)
  // 단추를 누르면 서버가 받을 때까지 그 단추를 돌린다. 8초 넘게 답이 없으면 다시 누를 수 있게 풀고,
  // 같은 글을 다시 보내도 같은 cid 를 붙여 서버가 한 번만 받는다(먼저 보낸 것이 늦게 도착해도 두 번 생기지 않게).
  const cids = new Map(); // 종류+글 → cid
  const cidFor = (kind, text) => { const k = kind + '\n' + text; if (!cids.has(k)) cids.set(k, kind + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)); return cids.get(k); };
  const doneCid = (kind, text) => cids.delete(kind + '\n' + text);
  async function withBusy(btn, fn) {
    if (!btn || btn.classList.contains('busy')) return;
    btn.classList.add('busy');
    const t = setTimeout(() => btn.classList.remove('busy'), 8000);
    try { return await fn(); } catch { toast('처리하지 못했어요. 다시 눌러 주세요'); } finally { clearTimeout(t); btn.classList.remove('busy'); }
  }
  let sessions = [];
  const transcripts = {};
  let activeTab = null;
  try { activeTab = localStorage.getItem('__uifb_tab'); } catch {}
  let where = null;
  let prefsReady = false; // 서버 설정(prefs)을 한 번이라도 받았는지
  let replyTo = null; // 답장할 메시지 번호
  let editing = null; // 말풍선 안에서 고치는 중인 내 메시지 { id, text }
  let holdEdit = null; // 고치는 중인 보류 { id, text }
  let editEl = null;
  let editStartAt = 0;
  async function resend(m) {
    const draft = m.draft && editing?.items ? { label: m.draft.label, items: m.draft.items.map((it, i) => ({ ...it, text: (editing.items[i] || '').trim() })).filter((it) => it.text) } : null;
    const text = draft ? draft.items.map((it) => it.text).join('\n') : (editing?.text || '').trim();
    if (!text) return;
    const body = { from: 'user', text, ...(draft ? { draft } : {}), to: m.to, context: m.context, round: m.round, device: deviceNow(), resendOf: m.id, cid: cidFor('resend:' + m.id, text), ...(m.replyTo ? { replyTo: m.replyTo, ...(m.replyQuote ? { replyQuote: m.replyQuote } : {}), ...(m.refer ? { refer: true } : {}) } : {}), ...(m.where ? { where: m.where } : {}) };
    const r = await fetch('/__uifb/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('resend');
    doneCid('resend:' + m.id, text);
    editing = null;
    await poll();
    render();
  }
  const WIDGET_PREFIX = '대화창 › '; // 대화창 안을 찍은 위치의 선택자 앞에 붙인다
  // 세션마다 마지막으로 읽은 시각. 탭을 열고 맨 아래까지 봐야 그 세션이 읽음으로 바뀐다.
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem('__uifb_seen') || '{}'); } catch {}
  if (!seen || typeof seen !== 'object' || Array.isArray(seen)) seen = {}; // 예전 버전은 숫자로 저장했다
  // 읽음 상태는 리뷰 서버(seen.json)에 두어 앱 화면과 리뷰 페이지가 함께 쓴다. 브라우저 저장소는 서버가 꺼졌을 때의 예비다.
  const saveSeen = (ids) => {
    try { localStorage.setItem('__uifb_seen', JSON.stringify(seen)); } catch {}
    const up = Object.fromEntries((ids || Object.keys(seen)).map((id) => [id, seen[id]]));
    fetch('/__uifb/api/seen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(up) }).catch(() => {});
  };
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
      .replace(/^#{1,6}\s+(.+)$/gm, '<strong>$1</strong>')
      // 주소는 누르면 새 탭으로 열리게 한다(끝의 문장부호는 주소에서 뺀다).
      .replace(/https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
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

  const quoteOf = (m) => `${m.from === 'user' ? '나' : m.from === 'peer' ? (m.session ? nameOf(m.session) : m.fromName || '다른 세션') : m.agent || nameOf(m.session)}: ${m.text.replace(/\s+/g, ' ').slice(0, 80)}`;
  // 일부만 인용: 메시지 글의 일부를 길게 눌러(또는 끌어) 고른 뒤 그 메시지의 "답장"을 누르면 고른 부분만 인용한다.
  // 버튼을 누르는 순간 선택이 풀리기도 해서, 마지막으로 고른 글을 잠시 기억해 둔다.
  let replyQuote = null;
  let refMode = false; // true 면 답장이 아니라 참고로만 붙인다
  let lastSel = null;
  const plain = (t) => String(t).replace(/[`*]/g, '').replace(/\s+/g, ' ').trim();
  // 마지막으로 누른 곳(꾹 눌러 글을 고를 때 그 자리). Safari는 shadow DOM 안 선택의 위치·노드를 알려 주지 않아(본문 노드 대신 BODY, 크기 0) 누른 곳으로 판단한다.
  let lastPress = null;
  root.addEventListener('pointerdown', (e) => { lastPress = { el: e.composedPath()[0], at: Date.now() }; }, true);
  let selFrom; // 이번 선택이 시작된 메시지 본문 번호(본문 밖이면 null). 선택이 이어지는 동안(손잡이로 넓힐 때) 유지한다
  document.addEventListener('selectionchange', () => {
    let t = '';
    let bodyId = null;
    try {
      const sel = (root.getSelection && root.getSelection()) || getSelection();
      t = sel?.toString() || '';
      // 고른 곳이 메시지 본문(.mbody)일 때만 답장·참고 대상으로 본다. 메타·꼬리표·빈 곳을 꾹 눌러 생긴 선택은 넘긴다.
      if (!t) selFrom = undefined;
      else {
        const an = sel.anchorNode;
        const rc = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
        if (an && root.contains(an)) {
          selFrom = (an.nodeType === 3 ? an.parentElement : an)?.closest?.('.mbody')?.closest('.msg')?.dataset.id || null;
        } else if (rc && (rc.width || rc.height)) {
          const hit = root.elementFromPoint(rc.left + Math.min(rc.width / 2, 4), rc.top + rc.height / 2);
          selFrom = hit?.closest?.('.mbody')?.closest('.msg')?.dataset.id || null;
        } else if (selFrom === undefined) {
          const press = lastPress && Date.now() - lastPress.at < 3000 ? lastPress.el : null;
          const el = press?.nodeType === 3 ? press.parentElement : press;
          selFrom = el?.closest?.('.mbody')?.closest('.msg')?.dataset.id || null;
        }
        if (!selFrom) t = '';
        bodyId = selFrom;
      }
    } catch {}
    t = plain(t);
    if (t) lastSel = { text: t.slice(0, 500), at: Date.now(), id: bodyId };
  });
  let replyMsg = null;
  const openQuotes = new Set(); // 펼친 인용(메시지 번호)
  function showReplyText() {
    const m = replyMsg;
    if (!m) return;
    $('reply').classList.toggle('ref', refMode);
    $('replyText').textContent = (refMode ? '📎 참고 · ' : '↩ 답장 · ') + (replyQuote ? `${quoteOf(m).split(':')[0]}의 일부: "${replyQuote}"` : quoteOf(m));
  }
  // 메시지 본문에서 인용한 부분의 범위를 찾는다(공백은 하나로 본다). 못 찾으면 null.
  function quoteRange(bodyEl, quote) {
    const walker = document.createTreeWalker(bodyEl, NodeFilter.SHOW_TEXT);
    let acc = '';
    const map = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      for (let i = 0; i < n.data.length; i++) {
        const c = /\s/.test(n.data[i]) ? ' ' : n.data[i];
        if (c === ' ' && (acc.endsWith(' ') || !acc)) continue;
        acc += c;
        map.push([n, i]);
      }
    }
    const at = acc.indexOf(quote);
    if (at < 0) return null;
    const r = document.createRange();
    const [sn, so] = map[at];
    const [en, eo] = map[at + quote.length - 1];
    r.setStart(sn, so);
    r.setEnd(en, eo + 1);
    return r;
  }
  // 노란 음영(CSS Custom Highlight). 지원하지 않는 브라우저에서는 조용히 넘어간다.
  function markQuote(id, quote) {
    try {
      if (!window.CSS?.highlights) return;
      const el = id && quote ? $('msgs').querySelector(`.msg[data-id="${id}"] .mbody`) : null;
      const r = el && quoteRange(el, quote);
      if (r) CSS.highlights.set('uifbq', new Highlight(r));
      else CSS.highlights.delete('uifbq');
    } catch {}
  }
  // 글을 고르면(이 탭의 메시지 안 글일 때만) 입력칸 위에 "고른 부분에 답장" 버튼을 띄운다.
  const msgOfSel = (t) => (t ? timeline(activeTab).filter((m) => typeof m.id === 'number' && !isHeld(m)).reverse().find((m) => plain(m.draft ? m.draft.items.map((it) => it.text).join(' ') : m.text).includes(t)) : null);
  document.addEventListener('selectionchange', () => {
    const m = lastSel && Date.now() - lastSel.at < 300 ? (lastSel.id ? messages.find((x) => String(x.id) === lastSel.id) : msgOfSel(lastSel.text)) : null;
    const b = $('selReply');
    if (!m) { if (!b.matches(':hover')) setTimeout(() => { if (!lastSel || Date.now() - lastSel.at > 300) b.hidden = true; }, 400); return; }
    const p = $('panel').getBoundingClientRect();
    const c = $('composeRow').getBoundingClientRect();
    b.style.left = p.left + p.width / 2 + 'px';
    b.style.top = c.top - 46 + 'px';
    b.hidden = false;
    const pick = (ref) => {
      const keep = lastSel;
      // 글 선택을 먼저 풀고 입력칸에 초점을 준다(선택을 나중에 풀면 폰에서 입력칸 초점과 키보드가 사라진다).
      try { ((root.getSelection && root.getSelection()) || getSelection())?.removeAllRanges(); } catch {}
      b.hidden = true;
      setReply(m, ref);
      if (!replyQuote && keep) { replyQuote = keep.text; showReplyText(); markQuote(m.id, replyQuote); }
      $('input').focus();
    };
    $('selR').onclick = () => pick(false);
    $('selF').onclick = () => pick(true);
  });
  function setReply(m, ref = false) {
    replyTo = m ? m.id : null;
    refMode = !!m && ref;
    replyMsg = m || null;
    const body = m ? plain(m.draft ? m.draft.items.map((it) => it.text).join(' ') : m.text) : '';
    replyQuote = m && lastSel && Date.now() - lastSel.at < 60_000 && lastSel.text !== body && body.includes(lastSel.text) ? lastSel.text : null;
    lastSel = null;
    $('reply').hidden = !m;
    markQuote(replyTo, replyQuote);
    if (m) { showReplyText(); $('input').focus(); }
  }

  // 보관함에서 보낸 메시지: 사용자가 쓴 글과, 서버가 덧붙인 정보(위치·저장 시각·커밋·담은 화면)를 나눠 보인다.
  const shortAt = (iso) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  // 덧붙인 정보는 폰에서도 한 줄로 보이게 짧게 이어 붙인다(넘치면 끝을 … 로 줄임). 전체는 title 로 볼 수 있다.
  const compactAt = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  function draftMeta(it) {
    const parts = [];
    if (it.where?.url || it.where?.selector) parts.push('📍 ' + (it.where.url || '') + (it.where.text ? ` "${it.where.text}"` : ''));
    if (it.at) parts.push(compactAt(it.at) + ' 담음');
    if (it.round) parts.push(`${it.round}차`);
    if (it.device) parts.push(it.device === 'mobile' ? '모바일' : '데스크톱');
    if (it.commit) parts.push(it.commit);
    return parts;
  }
  function metaEl(it) {
    const meta = document.createElement('span');
    meta.className = 'meta';
    const x = document.createElement('span');
    x.textContent = draftMeta(it).join(' · ');
    x.title = x.textContent;
    meta.append(x);
    return meta;
  }
  function renderDraftBody(body, draft) {
    body.textContent = '';
    if (draft.items.length > 1) {
      const h = document.createElement('span');
      h.className = 'dh';
      h.textContent = `보관함에서 모아 보낸 ${draft.items.length}개`;
      body.append(h);
    }
    draft.items.forEach((it, i) => {
      const item = document.createElement('span');
      item.className = 'ditem';
      const t = document.createElement('span');
      t.innerHTML = (draft.items.length > 1 ? `${i + 1}. ` : '') + mdLite(it.text);
      item.append(t, metaEl(it));
      body.append(item);
    });
  }

  // 답 잇기: 대화 순서(세션이 읽은 시각 기준)대로 보며, 세션이 읽은 사용자 메시지들 다음에 나온 그 세션의 답(이어지는 여러 답 포함)을
  // 그 메시지들에 대한 답으로 본다. 세션이 무엇에 답했는지 따로 적지 않으므로 읽은 순서로 짐작한 연결이다.
  function answerLinks(items) {
    const ans = new Map();
    const by = new Map();
    const link = (a, us) => { if (!us.length) return; ans.set(a, us); for (const u of us) by.set(u, [...(by.get(u) || []), a]); };
    // 묻는 쪽: 내 메시지(세션이 읽은 것)와, 다른 세션이 이 세션에 보낸 메시지. 답하는 쪽: 이 세션의 답과, 이 세션이 다른 세션에 보낸 메시지.
    const isQ = (m) => (m.from === 'user' && !m.cancelled && !isHeld(m)) || (m.from === 'peer' && m.to === activeTab && m.session !== activeTab);
    const isA = (m) => m.from === 'agent' || (m.from === 'peer' && m.session === activeTab);
    const shown = new Set(items.filter(isQ).map((m) => m.id));
    // 세션이 답 맨 앞에 <re 번호>로 무엇에 답했는지 적었으면(re) 그대로 잇는다. 적은 답이 있는 묶음에서는 적지 않은 답(중간 안내 등)을 잇지 않는다.
    // 적은 것이 없는 묶음만 순서로 짐작한다: 세션이 읽은 메시지들 다음에 나온 그 세션의 답(이어지는 여러 답 포함)을 그 메시지들에 대한 답으로 본다.
    let pending = [];
    let run = [];
    const flush = () => {
      if (!run.length) return;
      if (run.some((a) => a.re?.length)) {
        // 표시가 있는 답은 표시대로. 표시 없는 답은 표시로 아무도 답하지 않은 나머지 메시지에 대한 답으로 본다(예: 다른 세션 메시지에 표시 없이 답한 경우).
        const named = new Set(run.flatMap((a) => a.re || []));
        const rest = pending.filter((u) => !named.has(u));
        for (const a of run) link(a.id, a.re?.length ? a.re.filter((u) => shown.has(u)) : rest);
      }
      else for (const a of run) link(a.id, pending);
      if (run.length) pending = [];
      run = [];
    };
    for (const m of items) {
      if (isA(m)) run.push(m);
      else if (shown.has(m.id)) { flush(); pending.push(m.id); }
    }
    flush();
    return { ans, by };
  }
  // 질문과 답을 오른쪽 가장자리의 꺾쇠 선으로 잇는다. 묶음이 겹치면 선을 한 칸씩 안쪽으로 옮긴다.
  let lastLinks = null;
  let linkFocus = null; // 누른 메시지 번호. 그 메시지의 연결만 진하게 보인다
  // 평소엔 모든 연결선을 아주 옅게 깔고, 메시지를 누르면 그 메시지의 연결만 굵고 진하게 바꾼다(다시 누르거나 빈 곳을 누르면 원래대로).
  $('msgs').addEventListener('click', (e) => {
    if (e.target.closest('button, a, textarea, input, select, .quote')) return;
    const m = e.target.closest('.msg');
    const id = m ? Number(m.dataset.id) : null;
    linkFocus = id && id !== linkFocus ? id : null;
    if (lastLinks) drawLinks(lastLinks);
  });
  let drawnLinks = new Set(); // 이미 그린 연결(질문 번호). 새 연결만 그려지는 움직임을 준다
  // 질문과 그 답들을 대화 목록 오른쪽 가장자리의 꺾쇠 선으로 잇는다. 질문 쪽은 굵고 답 쪽으로 갈수록 가늘어진다.
  // 가늘어지는 선은 경로를 따라 점을 찍고 양옆으로 폭만큼 벌린 윤곽을 채운 도형 하나로 그린다(연결마다 요소 하나라 가볍다).
  // 묶음이 겹치면 한 칸씩 안쪽으로 비켜 그린다. 새로 생긴 연결은 서서히 나타난다.
  function drawLinks(links) {
    lastLinks = links;
    const box = $('msgs');
    box.querySelector('.links')?.remove();
    if (!box.clientWidth) return; // 대화창이 닫혀 있으면 크기가 없어 그리지 않는다(열 때 다시 그린다)
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'links');
    svg.setAttribute('width', String(box.clientWidth));
    svg.setAttribute('height', String(box.scrollHeight));
    svg.innerHTML = '<defs><linearGradient id="uifbLinkGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#818cf8"/><stop offset="1" stop-color="#c084fc"/></linearGradient>'
      + '<linearGradient id="uifbReplyGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f59e0b"/><stop offset="1" stop-color="#fbbf24"/></linearGradient></defs>';
    box.prepend(svg);
    const byId = new Map([...box.querySelectorAll('.msg[data-id]')].map((e) => [Number(e.dataset.id), e]));
    const pos = (id) => {
      const el = byId.get(id);
      if (!el || el.classList.contains('held')) return null;
      return { y: el.offsetTop + Math.min(16, el.offsetHeight / 2), left: el.offsetLeft, right: el.offsetLeft + el.offsetWidth };
    };
    // 선 모양은 직선과 둥근 모서리(2차 곡선)뿐이라, 브라우저에 경로 길이를 묻지 않고 직접 점을 찍는다(폰에서도 가볍게).
    // segs: [[x, y], ['Q', cx, cy, x, y], [x, y], ...] → 점 목록
    const pointsOf = (segs) => {
      const pts = [];
      for (const sgm of segs) {
        if (sgm[0] !== 'Q') { pts.push({ x: sgm[0], y: sgm[1] }); continue; }
        const [, cx, cy, x, y] = sgm;
        const p0 = pts[pts.length - 1];
        for (let i = 1; i <= 6; i++) { const t = i / 6; const u = 1 - t; pts.push({ x: u * u * p0.x + 2 * u * t * cx + t * t * x, y: u * u * p0.y + 2 * u * t * cy + t * t * y }); }
      }
      return pts;
    };
    // 점 목록을 따라 굵기 w0 → w1 로 가늘어지는 채운 도형의 윤곽(굵기는 지나온 길이에 비례)
    const taper = (segs, w0, w1) => {
      const pts = pointsOf(segs);
      const acc = [0];
      for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
      const L = acc[acc.length - 1] || 1;
      const left = [];
      const right = [];
      pts.forEach((p, i) => {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const h = (w0 + ((w1 - w0) * acc[i]) / L) / 2;
        left.push(`${(p.x - (dy / len) * h).toFixed(1)} ${(p.y + (dx / len) * h).toFixed(1)}`);
        right.push(`${(p.x + (dy / len) * h).toFixed(1)} ${(p.y - (dx / len) * h).toFixed(1)}`);
      });
      return `M ${left.join(' L ')} L ${right.reverse().join(' L ')} Z`;
    };
    const R = 8;
    const lanes = { right: [], left: [] }; // 오른쪽·왼쪽 가장자리마다 따로 줄을 나눈다
    const drawn = new Set();
    // 잇는 쌍: 질문 → 그에 대한 답들(남보라), 원문 → 그 원문에 단 답장(주황). 위에서부터 차례로 그려 겹치면 안쪽 줄로 비킨다.
    // 선은 받는 쪽 가장자리에 둔다: 내 메시지에서 세션 답으로 가는 연결은 왼쪽(세션 답 쪽), 세션 답에 단 내 답장 연결은 오른쪽(내 쪽).
    const sideOf = (id) => { const m = messages.find((x) => x.id === id); return m?.from === 'user' || (m?.from === 'peer' && m.to === activeTab) ? 'left' : 'right'; };
    const pairs = [...links.by].map(([from, tos]) => ({ from, tos, kind: 'answer' }));
    for (const m of messages) if (m.replyTo && !m.refer && m.from === 'user' && (m.to === activeTab || m.session === activeTab)) pairs.push({ from: m.replyTo, tos: [m.id], kind: 'reply' });
    // 같은 답(또는 같은 원문)으로 모이는 연결은 한 줄기로 합친다: 같은 종류끼리 보내는 쪽이나 받는 쪽 메시지를 하나라도 함께 쓰면 한 묶음.
    const groups = [];
    for (const p of pairs) {
      const ids = new Set([p.from, ...p.tos]);
      const hit = groups.filter((g) => g.kind === p.kind && [...ids].some((id) => g.ids.has(id)));
      const g = hit[0] || { kind: p.kind, froms: new Set(), tos: new Set(), ids: new Set() };
      for (const o of hit.slice(1)) { o.froms.forEach((x) => g.froms.add(x)); o.tos.forEach((x) => g.tos.add(x)); o.ids.forEach((x) => g.ids.add(x)); groups.splice(groups.indexOf(o), 1); }
      g.froms.add(p.from);
      p.tos.forEach((x) => g.tos.add(x));
      ids.forEach((x) => g.ids.add(x));
      if (!hit[0]) groups.push(g);
    }
    const placed = groups.map((g) => {
      const qs = [...g.froms].map((id) => ({ id, p: pos(id) })).filter((x) => x.p).sort((a, b) => a.p.y - b.p.y);
      const ends = [...g.tos].filter((id) => !g.froms.has(id)).map(pos).filter(Boolean).sort((a, b) => a.y - b.y);
      return { ...g, qs, ends };
    }).filter((g) => g.qs.length && g.ends.length && g.ends[g.ends.length - 1].y > g.qs[0].p.y).sort((a, b) => a.qs[0].p.y - b.qs[0].p.y);
    for (const { kind, froms, tos, qs, ends } of placed) {
      const u = qs[0].id;
      const q = qs[0].p;
      const side = sideOf(u);
      const on = linkFocus != null && (froms.has(linkFocus) || tos.has(linkFocus)); // 누른 메시지의 연결만 굵고 진하게
      const [w0, w1, w2] = on ? [5, 1, 3] : [1.6, 0.8, 1.2];
      const last = ends[ends.length - 1];
      const bottom = Math.max(q.y, last.y);
      const ln = lanes[side];
      let lane = ln.findIndex((end) => end < Math.min(q.y, ends[0].y) - 2);
      if (lane < 0) lane = ln.length;
      ln[lane] = bottom;
      const r = Math.min(R, (bottom - q.y) / 2);
      const shape = document.createElementNS(NS, 'path');
      // 보낸 말풍선 → 그쪽 가장자리 기둥 → 마지막 받는 말풍선(둥근 모서리), 그 사이로 갈라지는 가지.
      // 같은 줄기에 합쳐진 다른 보낸 말풍선은 기둥으로 들어오는 가지로 잇는다.
      // 양 끝은 말풍선 뒤로 10px 들어가게 그려, 선이 말풍선 테두리에서 자연스럽게 나오고 들어가 보이게 한다(잘린 끝이 안 보임).
      const R1 = side === 'right';
      const x = R1 ? box.clientWidth - 8 - lane * 6 : 8 + lane * 6;
      const edge = (p) => (R1 ? p.right - 10 : p.left + 10);
      const k = R1 ? -r : r; // 모서리가 기둥 안쪽으로 휘는 방향
      let d = taper([[edge(q), q.y], [x + k, q.y], ['Q', x, q.y, x, q.y + r], [x, bottom - r], ['Q', x, bottom, x + k, bottom], [edge(last), bottom]], w0, w1);
      for (const e of ends.slice(0, -1)) d += ' ' + taper([[x, e.y - r], ['Q', x, e.y, x + k, e.y], [edge(e), e.y]], w2, w1);
      for (const o of qs.slice(1)) if (o.p.y < bottom) d += ' ' + taper([[edge(o.p), o.p.y], [x + k, o.p.y], ['Q', x, o.p.y, x, o.p.y + r]], w0 * 0.8, w2);
      shape.setAttribute('d', d);
      if (kind === 'reply') shape.classList.add('reply');
      if (on) shape.classList.add('on');
      const key = kind + [...froms].join(',') + ':' + ends.length;
      if (drawnLinks.size > 0 && !drawnLinks.has(key)) shape.classList.add('new');
      drawn.add(key);
      svg.append(shape);
    }
    drawnLinks = drawn;
  }
  // 크기가 바뀌면(보관함 열고 닫기, 창 크기 조절) 한 화면에 한 번만 다시 그린다.
  let linkRaf = 0;
  new ResizeObserver(() => { if (lastLinks && !linkRaf) linkRaf = requestAnimationFrame(() => { linkRaf = 0; drawLinks(lastLinks); }); }).observe($('msgs'));

  function timeline(tab) {
    return [...messages, ...Object.values(transcripts).flat()]
      .filter((m) => tab === 'all' || ownerOf(m) === tab || (m.from === 'peer' && m.session === tab))
      .sort((a, b) => orderAt(a).localeCompare(orderAt(b)));
  }
  // 세션에게 보낸 메시지는 보낸 시각이 아니라 세션이 받아 간 시각에 놓는다. 아직 안 받아 갔으면 맨 아래에 둔다.
  // 세션이 받아 갔는지: 감시 명령이 넘긴 마지막 번호까지, 또는 끼워넣기로 따로 넘긴 것(_at).
  // 받아 간 번호(_at)로 본다. _at 이 생기기 전의 하루 넘은 메시지만 마지막 번호로 본다(scripts/chat-format.mjs 의 wasDelivered 와 같다).
  const got = (m) => !!delivered._at?.[m.id] || (m.id <= (delivered[m.to] || 0) && Date.now() - Date.parse(m.at) > 86_400_000);
  const isHeld = (m) => m.from === 'user' && m.context !== 'terminal' && !!m.to && !m.cancelled && !got(m);
  let wasHeld = new Set();
  function orderAt(m) {
    if (m.from !== 'user' || m.context === 'terminal' || !m.to) return String(m.at);
    if (isHeld(m)) return '\uffff' + m.at;
    return String(delivered._read?.[m.id] || delivered._at?.[m.id] || m.at);
  }

  // 세션끼리 메시지를 보내는 중(보낸 쪽 상태가 SendMessage 사용 중)인 [보낸 세션, 받는 세션] 쌍.
  function flows() {
    return sessions.filter((x) => x.status?.state === 'working' && x.status.peerTo && x.status.peerTo !== x.id).map((x) => [x.id, x.status.peerTo]);
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
      b.onclick = () => { tabSetAt = Date.now(); switchTab(t.id); savePrefs({ tab: t.id }); };
      box.append(b);
    }
    // 이웃한 두 탭 사이에 보내는 방향으로 움직이는 화살표를 넣는다. 이웃하지 않으면 보낸 탭 뒤에 "→ 받는 세션"을 붙인다.
    const btns = [...box.children];
    for (const [a, b] of flows()) {
      const ia = tabs.findIndex((t) => t.id === a);
      const ib = tabs.findIndex((t) => t.id === b);
      if (ia < 0 || ib < 0) continue;
      const f = document.createElement('span');
      f.className = 'flow' + (ib < ia ? ' back' : '');
      f.title = `${nameOf(a)} → ${nameOf(b)} 메시지 보내는 중`;
      if (Math.abs(ia - ib) === 1) { f.textContent = ib > ia ? '→' : '←'; btns[Math.min(ia, ib)].after(f); }
      else { f.textContent = '→ ' + nameOf(b); btns[ia].after(f); }
    }
  }

  let lastTab = null;
  // 작업 중 표시의 글. 상태가 5분 넘게 그대로면 멈췄을 수 있다(긴 명령이거나, 답이 대화창으로 안 넘어왔거나). 사용자가 알 수 있게 적는다.
  function fillTyping(ty, st) {
    const label = ty.querySelector('.tylabel');
    label.textContent = st.state === 'permission' ? st.detail || '터미널에서 승인을 기다리는 중' : `작업 중 · ${st.detail || '생각하는 중'}`;
    const still = Math.floor((Date.now() - Date.parse(st.at)) / 60_000);
    ty.classList.toggle('stale', st.state === 'working' && still >= 5);
    if (st.state === 'working' && still >= 5) label.textContent += ` · ${still}분째 그대로예요. 답이 안 오면 터미널을 확인해 주세요`;
  }
  function updateTyping() {
    const ty = $('msgs').querySelector('.typing');
    const st = sessionById(activeTab)?.status;
    if (ty && st && (st.state === 'working' || st.state === 'permission')) fillTyping(ty, st);
  }

  function render() {
    renderTabs();
    const box = $('msgs');
    const gapBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
    const nearBottom = gapBottom < 80;
    const rendered = new Set([...box.querySelectorAll('.msg')].map((el) => el.dataset.id));
    const renderedTab = lastTab;
    lastTab = activeTab;
    const prevTop = box.scrollTop;
    // 보던 위치는 화면 맨 위에 걸린 메시지를 기준으로 기억한다(위쪽 내용 높이가 바뀌어도 그 메시지가 같은 자리에 오게).
    const boxTop = box.getBoundingClientRect().top;
    const anchorEl = [...box.querySelectorAll('.msg[data-id]')].find((el) => el.getBoundingClientRect().bottom > boxTop + 1);
    const anchorId = anchorEl?.dataset.id, anchorOff = anchorEl ? anchorEl.getBoundingClientRect().top - boxTop : 0;
    const keepPlace = () => {
      const el = anchorId && renderedTab === activeTab ? box.querySelector(`.msg[data-id="${CSS.escape(anchorId)}"]`) : null;
      box.scrollTop = el ? box.scrollTop + (el.getBoundingClientRect().top - box.getBoundingClientRect().top) - anchorOff : prevTop;
    };
    box.textContent = '';
    const items = timeline(activeTab);
    if (!items.length && !holds().length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = sessions.length
        ? '앱을 쓰다가 생긴 질문이나 요청을 보내세요.\n"위치 찍기"로 화면의 한 곳을 함께 보낼 수 있습니다.'
        : '등록된 세션이 없습니다.\n작업 세션이 자기 세션을 등록하면 대화할 수 있습니다.';
      box.append(p);
    }
    const shown = items.slice(-120);
    const links = activeTab === 'all' ? { ans: new Map(), by: new Map() } : answerLinks(items); // 여러 세션을 함께 보는 탭에서는 잇지 않는다
    const firstUnread = shown.findIndex(isUnread);
    let newLine = null;
    const heldEls = [];
    const nowHeld = new Set();
    for (const [i, m] of shown.entries()) {
      if (i === firstUnread) {
        newLine = document.createElement('p');
        newLine.className = 'newline';
        newLine.textContent = '여기부터 새 메시지';
        box.append(newLine);
      }
      const d = document.createElement('div');
      d.className = 'msg ' + m.from + (isUnread(m) ? ' unread' : '') + (m.from === 'peer' && activeTab !== 'all' ? (m.session === activeTab ? ' out' : ' in') : '');
      d.dataset.id = String(m.id);
      d.dataset.at = String(m.at);
      const tag = document.createElement('span');
      tag.className = 'tag';
      const src = m.from === 'peer' ? '세션끼리' : (m.context === 'terminal' ? '터미널' : m.context === 'app' ? '앱' : m.context === 'reply' ? '답장' : '비교 페이지') + (m.device ? ' · ' + (m.device === 'mobile' ? '모바일' : '데스크톱') : '');
      tag.textContent = activeTab === 'all' && ownerOf(m) && m.from !== 'peer' ? `${nameOf(ownerOf(m))} · ${src}` : src;
      const small = document.createElement('small');
      small.textContent = (m.from === 'agent' ? (m.agent || nameOf(m.session)) + ' · ' : '') +
        new Date(m.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) +
        (m.where?.url && !m.draft ? ' · ' + m.where.url : '') + readMark(m);
      const body = document.createElement('span');
      body.className = 'mbody';
      if (m.draft) renderDraftBody(body, m.draft);
      else body.innerHTML = mdLite(m.text);
      if (m.from === 'peer') {
        const route = document.createElement('span');
        route.className = 'route';
        route.textContent = `${m.session ? nameOf(m.session) : m.fromName || '다른 세션'} → ${m.to ? nameOf(m.to) : m.toName || '다른 세션'}`;
        small.textContent = new Date(m.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + (m.readAt ? ' · 받음' : '');
        d.append(tag, route, body, small);
      } else d.append(tag, body, small);
      const orig = m.replyTo && messages.find((x) => x.id === m.replyTo);
      if (orig) {
        // 인용: 길면 4줄로 줄여 보이고 "펼치기"로 전체를 본다. "원문으로"는 원래 메시지로 가서 인용한 부분을 칠한다.
        const q = document.createElement('span');
        // 골라서 답장(일부)은 노란 바탕에 "고른 부분", 메시지 전체에 답장은 회색 바탕에 "전체에 답장"으로 나눠 보인다.
        q.className = 'quote ' + (m.refer ? 'ref' : m.replyQuote ? 'part' : 'whole') + (openQuotes.has(m.id) ? ' open' : '');
        const who = quoteOf(orig).split(':')[0];
        const origText = orig.draft ? orig.draft.items.map((it) => it.text).join(' / ') : orig.text;
        const full = m.refer ? (m.replyQuote ? `📎 참고 · ${who}의 일부: "${m.replyQuote}"` : `📎 참고 · ${who}: ${origText}`) : m.replyQuote ? `↩ ${who}의 고른 부분: "${m.replyQuote}"` : `↩ ${who}에게 전체 답장: ${origText}`;
        const qt = document.createElement('span');
        qt.className = 'qt';
        qt.textContent = full;
        const bar = document.createElement('span');
        bar.className = 'qbar';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.textContent = openQuotes.has(m.id) ? '접기' : '펼치기';
        toggle.hidden = true;
        toggle.onclick = () => { openQuotes.has(m.id) ? openQuotes.delete(m.id) : openQuotes.add(m.id); render(); };
        const go = document.createElement('button');
        go.type = 'button';
        go.textContent = '원문으로';
        go.onclick = () => {
          const el = box.querySelector(`.msg[data-id="${m.replyTo}"]`);
          if (!el) return;
          // 화면 고정 상자(flash)는 스크롤하면 다른 메시지 위에 남으므로, 메시지 자체를 잠시 테두리로 강조한다.
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          el.classList.remove('flashing');
          void el.offsetWidth;
          el.classList.add('flashing');
          setTimeout(() => el.classList.remove('flashing'), 2000);
          if (m.replyQuote) { markQuote(m.replyTo, m.replyQuote); setTimeout(() => markQuote(replyTo, replyQuote), 2500); }
        };
        bar.append(toggle, go);
        q.append(qt, bar);
        // 그려진 뒤 잘렸는지 보고, 잘렸거나 펼친 상태일 때만 "펼치기/접기"를 보인다.
        requestAnimationFrame(() => { toggle.hidden = !(openQuotes.has(m.id) || qt.scrollHeight > qt.clientHeight + 1); });
        body.before(q);
      }
      if (typeof m.id === 'number' && !isHeld(m)) {
        const rp = document.createElement('button');
        rp.type = 'button';
        rp.className = 'rp';
        rp.textContent = '답장';
        rp.onclick = () => setReply(m);
        small.append(rp);
        const rf = document.createElement('button');
        rf.type = 'button';
        rf.className = 'rp';
        rf.textContent = '참고';
        rf.title = '답장이 아니라 참고하라고 이 메시지를 붙이기';
        rf.onclick = () => setReply(m, true);
        small.append(rf);
      }
      // 내가 보낸 글은 그 말풍선 안에서 고쳐 다시 보낸다(안 읽힌 글도). 새 메시지에는 "다시 보냄"이 붙는다.
      if (typeof m.id === 'number' && m.from === 'user' && m.context !== 'terminal') {
        if (m.draft) tag.textContent += ` · 보관함 › ${m.draft.label}`;
        if (m.resendOf) tag.textContent += ' · 다시 보냄';
        if (m.cancelled) {
          d.classList.add('cancelled');
          // 취소한 글을 보류로 돌려 다시 다듬어 보낼 수 있게 한다(한 번 돌린 글은 "보류로 옮김"으로만 표시).
          if (drafts.some((x) => x.fromMsg === m.id) || trash.some((x) => x.fromMsg === m.id)) tag.textContent += ' · 보류로 옮김';
          else if (m.to) {
            const bk = document.createElement('button');
            bk.type = 'button';
            bk.className = 'rp';
            bk.textContent = '보류로';
            bk.onclick = () => withBusy(bk, async () => {
              const text = m.draft ? m.draft.items.map((it) => it.text).join('\n') : m.text;
              await draftsApi({ action: 'add', hold: true, fromMsg: m.id, cid: 'tohold-' + m.id, to: m.to, text, context: m.context, round: m.round, device: m.device, ...(m.where ? { where: m.where } : {}) });
              toast('✓ 보류로 옮김');
              render();
            });
            small.append(bk);
          }
        }
        // 아직 안 받아 간 메시지는 끼워넣기로 바꾸거나(세션이 작업 중일 때) 끼워넣기를 되돌릴 수 있다.
        const tgt = sessionById(m.to);
        if (isHeld(m) && tgt && tgt.tool !== 'codex' && (m.interject || ['working', 'permission'].includes(tgt.status?.state))) {
          const ij = document.createElement('button');
          ij.type = 'button';
          ij.className = 'rp';
          ij.textContent = m.interject ? '끼워넣기 취소' : '끼워넣기';
          ij.onclick = () => withBusy(ij, async () => {
            const r = await fetch('/__uifb/api/chat-interject', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.id, on: !m.interject }) }).catch(() => null);
            if (r && !r.ok) alert((await r.json().catch(() => ({}))).error || '바꾸지 못했습니다.');
            await poll();
            render();
          });
          small.append(ij);
        }
        // 세션이 아직 안 받아 간 메시지는 보내기를 취소할 수 있다.
        if (isHeld(m) && sessionById(m.to)?.tool !== 'codex') {
          const cx = document.createElement('button');
          cx.type = 'button';
          cx.className = 'rp';
          cx.textContent = '보내기 취소';
          cx.onclick = () => withBusy(cx, async () => {
            const r = await fetch('/__uifb/api/chat-cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.id }) }).catch(() => null);
            if (r && !r.ok) alert((await r.json().catch(() => ({}))).error || '취소하지 못했습니다.');
            await poll();
            render();
          });
          small.append(cx);
        }
        if (m.interject) { tag.textContent += ' · 끼워넣기'; tag.classList.add('now'); }
        if (editing?.id === m.id) {
          d.classList.add('editing');
          // 보관함 메시지는 항목마다 글만 고친다(위치 같은 덧붙인 정보는 그대로 따라간다).
          let ta;
          if (m.draft) {
            ta = document.createElement('span');
            ta.className = 'editdraft';
            m.draft.items.forEach((it, i) => {
              const one = document.createElement('textarea');
              one.className = 'edit';
              one.value = editing.items[i];
              one.setAttribute('aria-label', `고쳐서 다시 보낼 글 ${i + 1}`);
              one.oninput = () => { editing.items[i] = one.value; };
              ta.append(one, metaEl(it));
            });
          } else {
            ta = document.createElement('textarea');
            ta.className = 'edit';
            ta.value = editing.text;
            ta.setAttribute('aria-label', '고쳐서 다시 보낼 글');
            ta.oninput = () => { editing.text = ta.value; };
          }
          const bar = document.createElement('span');
          bar.className = 'editbar';
          const cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.textContent = '취소';
          cancel.onclick = () => { editing = null; render(); };
          const go = document.createElement('button');
          go.type = 'button';
          go.className = 'go';
          go.textContent = '다시 보내기';
          go.onclick = () => { window.__uifbDiag?.(); withBusy(go, () => resend(m)); };
          bar.append(cancel, go);
          body.replaceWith(ta);
          small.after(bar);
          editEl = ta.matches('textarea') ? ta : ta.querySelector('textarea');
        } else {
          const again = document.createElement('button');
          again.type = 'button';
          again.className = 'rp';
          again.textContent = '다시 보내기';
          again.onclick = () => { editing = m.draft ? { id: m.id, items: m.draft.items.map((it) => it.text) } : { id: m.id, text: m.text }; editStartAt = Date.now(); window.__uifbDiag?.(); render(); editEl?.focus(); };
          small.append(again);
        }
      }
      if (isHeld(m)) { d.classList.add('held'); nowHeld.add(m.id); heldEls.push(d); continue; }
      if (wasHeld.has(m.id)) d.classList.add('drop');
      box.append(d);
    }
    wasHeld = nowHeld;
    const last = items.filter((m) => m.from !== 'peer' && !m.cancelled).at(-1);
    const st = sessionById(activeTab)?.status;
    if (st && (st.state === 'working' || st.state === 'permission')) {
      const ty = document.createElement('div');
      ty.className = 'typing' + (st.state === 'permission' ? ' permission' : '');
      const dots = document.createElement('span');
      dots.className = 'dots';
      dots.innerHTML = '<i></i><i></i><i></i>';
      const label = document.createElement('span');
      label.className = 'tylabel';
      ty.append(dots, label);
      fillTyping(ty, st);
      box.append(ty);
    } else if (last && last.from === 'user' && last.context !== 'terminal') {
      const w = document.createElement('p');
      w.className = 'empty';
      w.style.margin = '0';
      const s = sessionById(ownerOf(last));
      w.textContent = got(last) ? `${s ? s.name : '세션'}이(가) 읽고 답하는 중…` : s?.watch?.active ? `${s.name}에게 전달하는 중…` : `자동으로 전달되지 않습니다. ${s ? s.name : '그 세션'} 터미널에 "대화 확인해"라고 보내 주세요.`;
      box.append(w);
    }
    box.append(...heldEls); // 작업 중 표시보다도 아래에 둔다
    // 보류: 아직 보내지 않은 글. 점선 말풍선으로 맨 아래에 쌓이고, 보내기를 누를 때까지 세션에 가지 않는다.
    const hs = holds();
    if (hs.length) {
      // 보류가 쌓이면 대화를 가리므로 접을 수 있게 한다(접힘은 세션마다 기억).
      const hh = document.createElement('button');
      hh.type = 'button';
      hh.className = 'holdhead';
      hh.textContent = (folded.has(HOLD_FOLD) ? '▸ ' : '▾ ') + `보류 ${hs.length}개` + (folded.has(HOLD_FOLD) ? ' · 펼치기' : '');
      hh.onclick = () => { folded.has(HOLD_FOLD) ? folded.delete(HOLD_FOLD) : folded.add(HOLD_FOLD); foldSetAt = Date.now(); saveFold(); render(); };
      box.append(hh);
    }
    for (const d of folded.has(HOLD_FOLD) ? [] : hs) {
      const h = document.createElement('div');
      h.className = 'msg user hold';
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = '보류 · 아직 안 보냄';
      let t = document.createElement('span');
      t.className = 'mbody';
      t.innerHTML = mdLite(d.text);
      const sm = document.createElement('small');
      sm.textContent = shortAt(d.at) + ' · 보내기를 누를 때까지 세션에 가지 않음';
      // 고치는 중에도 다른 단추를 그대로 둔다. 보관함으로·끼워넣기·보내기는 고친 글을 먼저 저장한 뒤 한다.
      const ed = holdEdit?.id === d.id;
      let body = t;
      if (ed) {
        body = document.createElement('textarea');
        body.className = 'edit';
        body.value = holdEdit.text;
        body.setAttribute('aria-label', '보류 글 고치기');
        body.oninput = () => { holdEdit.text = body.value; };
        h.classList.add('editing');
        editEl = body;
      }
      const saveEdit = async () => {
        if (!ed) return true;
        const v = holdEdit.text.trim();
        if (!v) return false;
        holdEdit = null;
        if (v !== d.text) await draftsApi({ action: 'update', id: d.id, text: v });
        return true;
      };
      const acts = document.createElement('span');
      acts.className = 'hacts';
      const mk = (label, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (cls) b.className = cls; b.onclick = () => withBusy(b, fn); acts.append(b); };
      if (ed) {
        mk('수정 취소', '', () => { holdEdit = null; render(); });
        mk('저장', 'save', async () => { if (await saveEdit()) render(); });
        acts.append(Object.assign(document.createElement('i'), { className: 'brk' })); // 고치기 단추와 나머지 단추를 두 줄로 나눈다
      } else mk('수정', '', () => { holdEdit = { id: d.id, text: d.text }; editStartAt = Date.now(); window.__uifbDiag?.(); render(); editEl?.focus(); });
      mk('지우기', '', async () => { if (ed) holdEdit = null; await draftsApi({ action: 'delete', ids: [d.id] }); toast('지움', async () => { await draftsApi({ action: 'restore', ids: [d.id] }); render(); }); render(); });
      mk('보관함', 'tostash', async () => { if (!(await saveEdit())) return; await draftsApi({ action: 'update', id: d.id, hold: false }); toast('✓ 보관함으로 옮김', { label: `${d.label || '미분류'} 열기`, fn: () => openSheet(d.label || '') }); render(); });
      // 세션이 작업 중이면(Claude 세션) 지금 하던 일에 끼워 넣어 보낼 수도 있다.
      const tgt = sessionById(d.to);
      if (tgt && tgt.tool !== 'codex' && ['working', 'permission'].includes(tgt.status?.state)) {
        mk('끼워넣기', 'now', async () => { if (!(await saveEdit())) return; await draftsApi({ action: 'send', ids: [d.id], plain: true, interject: true, device: deviceNow() }); render(); for (let i = 1; i <= 8; i++) setTimeout(poll, i * 500); });
      }
      mk('보내기', 'go', async () => { if (!(await saveEdit())) return; await draftsApi({ action: 'send', ids: [d.id], plain: true, device: deviceNow() }); render(); for (let i = 1; i <= 8; i++) setTimeout(poll, i * 500); });
      t = body;
      h.append(tag, t, sm, acts);
      box.append(h);
    }
    drawLinks(links);
    if (scrollToUnread && !$('panel').hidden) {
      // 안 읽은 답이 있으면 그 처음으로, 없으면 지난번(다른 화면 포함) 보던 메시지로, 그것도 없으면 맨 아래로.
      const pos = prefs.pos?.[activeTab];
      const [posId, posOff] = (pos || '').split('@');
      const anchor = !newLine && posId && posId !== 'bottom' ? box.querySelector(`.msg[data-id="${CSS.escape(posId)}"]`) : null;
      // offsetTop 은 창 기준이라 머리말 높이만큼 어긋난다. 목록 기준 위치로 바꿔 계산한다.
      const topOf = (el) => el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
      box.scrollTop = newLine ? Math.max(0, topOf(newLine) - 8) : anchor ? Math.max(0, topOf(anchor) - (posOff === undefined ? 8 : Number(posOff) || 0)) : box.scrollHeight;
      scrollToUnread = false;
    } else if (nearBottom) {
      // 새 답이 왔으면 그 답의 처음이 보이게 둔다(긴 답이면 끝부터 보이지 않게). 짧으면 어차피 맨 아래까지 내려간다.
      const fresh = [...box.querySelectorAll('.msg.agent, .msg.peer')].find((el) => renderedTab === activeTab && rendered.size > 0 && !rendered.has(el.dataset.id));
      if (fresh) box.scrollTop = fresh.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 8;
      else if (gapBottom < 8 && !editing && !holdEdit) box.scrollTop = box.scrollHeight;
      else { box.scrollTop = prevTop; keepPlace(); } // 맨 아래 근처에서 읽던 중이면 맨 아래로 끌어내리지 않는다
    } else {
      box.scrollTop = prevTop;
      keepPlace(); // 다시 그려도 읽던 메시지가 같은 자리에 있게
    }
    markQuote(replyTo, replyQuote); // 다시 그리면 범위가 사라지므로 음영을 다시 칠한다
    placeToBottom();
    const target = sessionById(activeTab);
    // 세션이 일하는 중이고 Claude 세션(중계 훅이 끼워 넣음)일 때만 "끼워넣기"를 보인다.
    $('now').hidden = !(target && target.tool !== 'codex' && ['working', 'permission'].includes(target.status?.state));
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
    // 보관함은 담긴 글이나 세션 목록이 바뀔 때만 다시 그린다(작업 상태가 바뀔 때마다 새로 그리면 버벅이고 스크롤이 맨 위로 돌아간다).
    const dk = draftsKey + '|' + sessions.map((x) => x.id).join();
    if (showDrafts && dk !== draftsRenderedKey && !$('drafts').contains(root.activeElement)) renderDrafts(); // 고치는 중인 글은 다시 그리지 않는다
  }

  function updateBadges() {
    const states = sessions.map((x) => x.status?.state);
    const busy = states.some((st) => st === 'working' || st === 'permission');
    $('work').hidden = !busy;
    $('work').classList.toggle('permission', states.includes('permission'));
    $('work').title = busy ? (states.includes('permission') ? '세션이 터미널에서 승인을 기다리는 중' : '세션이 작업 중') : '';
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
    saveSeen([activeTab]);
    if (!box.querySelector('.msg.unread')) box.querySelectorAll('.newline').forEach((el) => el.remove());
    renderTabs();
    updateBadges();
  }
  $('msgs').addEventListener('scroll', markSeenVisible);
  function placeToBottom() {
    const b = $('msgs');
    const far = b.scrollHeight - b.scrollTop - b.clientHeight > 200;
    const btn = $('toBottom');
    btn.hidden = !far || $('panel').hidden || showDrafts;
    if (btn.hidden) return;
    const r = b.getBoundingClientRect();
    // 아래쪽(화면 밖)에 안 읽은 새 답이 있으면 남색으로 바꾸고 개수를 붙인다.
    const below = [...b.querySelectorAll('.msg.unread')].filter((el) => el.getBoundingClientRect().top > r.bottom - 4).length;
    btn.classList.toggle('new', below > 0);
    btn.dataset.n = below > 9 ? '9+' : String(below);
    btn.setAttribute('aria-label', below ? `맨 아래로 · 새 답 ${below}개` : '맨 아래로');
    btn.style.left = r.right - 50 + 'px';
    btn.style.top = r.bottom - 50 + 'px';
  }
  $('msgs').addEventListener('scroll', placeToBottom);
  new ResizeObserver(placeToBottom).observe($('msgs'));
  $('toBottom').onclick = () => { const b = $('msgs'); b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }); };
  // 보고 있던 위치(맨 위에 보이는 메시지)를 세션마다 기억한다. 스크롤을 멈추고 0.8초 뒤에 저장한다.
  let posT = null;
  $('msgs').addEventListener('scroll', () => {
    clearTimeout(posT);
    posT = setTimeout(() => {
      const box = $('msgs');
      if ($('panel').hidden || !activeTab) return;
      let id = 'bottom';
      if (box.scrollHeight - box.scrollTop - box.clientHeight > 40) {
        const top = box.getBoundingClientRect().top;
        const first = [...box.querySelectorAll('.msg')].find((el) => el.getBoundingClientRect().bottom > top + 4);
        // 메시지 번호와 그 메시지가 화면 맨 위에서 얼마나 위/아래에 있었는지 함께 저장한다(새로고침해도 같은 자리로).
        if (first) id = first.dataset.id + '@' + Math.round(first.getBoundingClientRect().top - top);
      }
      if (prefs.pos?.[activeTab] !== id) { prefs.pos = { ...(prefs.pos || {}), [activeTab]: id }; savePrefs({ pos: { session: activeTab, id } }); }
    }, 800);
  });
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
  let statusKey = '';
  let seenKey = '';
  // 읽음이 바뀌었을 때: 안 읽음 표시와 탭·버튼 개수만 고친다.
  function refreshUnread() {
    const byId = new Map(messages.map((m) => [String(m.id), m]));
    for (const el of $('msgs').querySelectorAll('.msg.unread')) { const m = byId.get(el.dataset.id); if (m && !isUnread(m)) el.classList.remove('unread'); }
    renderTabs();
    updateBadges();
    placeToBottom();
  }
  async function poll() {
    try {
      const [c, ss, dd, sv, pf, cp] = await Promise.all([
        fetch('/__uifb/api/chat').then((r) => r.json()),
        fetch('/__uifb/api/sessions').then((r) => r.json()),
        fetch('/__uifb/api/drafts').then((r) => r.json()),
        fetch('/__uifb/api/seen').then((r) => r.json()).catch(() => ({})),
        fetch('/__uifb/api/prefs').then((r) => r.json()).catch(() => null),
        fetch('/__uifb/api/compose').then((r) => r.json()).catch(() => null),
      ]);
      if (cp) { composed = cp; loadCompose(false); }
      if (pf && (!prefsReady || JSON.stringify(pf) !== JSON.stringify(prefs))) applyPrefs(pf);
      else if (!pf && !prefsReady) applyPrefs({});
      // 다른 화면에서 읽은 것을 가져온다(더 나중 시각만).
      let seenFromServer = false;
      for (const [id, at] of Object.entries(sv || {})) {
        if (typeof at === 'string' && (!seen[id] || at > seen[id])) { seen[id] = at; seenFromServer = true; }
      }
      messages = c.messages || [];
      delivered = c.delivered || {};
      const dk = JSON.stringify(dd.drafts || []) + JSON.stringify(dd.trash || []);
      if (dk !== draftsKey) {
        draftsKey = dk;
        drafts = dd.drafts || [];
        trash = dd.trash || [];
        if (showDrafts && !$('drafts').contains(root.activeElement)) renderDrafts();
      }
      sessions = ss.sessions || [];
      for (const x of sessions.filter((x) => x.tool === 'codex')) {
        transcripts[x.id] = (await fetch('/__uifb/api/transcript?session=' + encodeURIComponent(x.id)).then((r) => r.json())).items || [];
      }
      const fresh = [];
      for (const x of sessions) {
        if (seen[x.id] === undefined) {
          const it = timeline(x.id);
          seen[x.id] = it.length ? String(it[it.length - 1].at) : '0';
          fresh.push(x.id);
        }
      }
      if (fresh.length) saveSeen(fresh);
      if (seenFromServer) { try { localStorage.setItem('__uifb_seen', JSON.stringify(seen)); } catch {} }
      const all = timeline('all');
      const k = JSON.stringify(delivered) + ':' + drafts.filter((d) => d.hold || d.fromMsg).map((d) => d.id + d.to + (d.hold ? 'h' : '') + d.text.length).join() + ':' + trash.filter((d) => d.fromMsg).length + ':' + (holdEdit?.id || '') + ':' + folded.has(HOLD_FOLD) + ':' + JSON.stringify(flows()) + ':' + messages.filter((m) => m.from === 'peer' || m.cancelled || m.interject).map((m) => m.id + (m.to || '') + (m.readAt ? 'r' : '') + (m.cancelled ? 'c' : '') + (m.interject ? 'i' : '')).join() + ':' + all.length + ':' + (all[all.length - 1]?.id || '') + ':' + sessions.map((x) => x.id + (x.watch?.active ? 1 : 0) + (x.watch?.handling ? 'h' : '') + (x.status?.state || '')).join(',');
      // 작업 중 표시의 글(지금 하는 일, "N분째")만 바뀐 것은 그 줄만 고친다. 도구를 쓸 때마다 대화창 전체를 다시 그리면 폰에서 버벅인다.
      const sk = sessions.map((x) => (x.status?.detail || '') + (x.status?.state === 'working' ? Math.floor((Date.now() - Date.parse(x.status.at)) / 60_000) : '')).join(',');
      // 말풍선에서 고치는 중에는 다시 그리지 않는다(입력칸이 새로 만들어지면 키보드가 닫힌다).
      // 읽음(seen)만 바뀐 것은 다시 그리지 않고 표시만 고친다(스크롤하며 읽을 때마다 전체를 다시 그리면 화면이 얼고 스크롤이 튄다).
      const seenK = JSON.stringify(seen);
      if (k !== key && !((editing || holdEdit) && root.activeElement?.classList?.contains('edit'))) { key = k; statusKey = sk; seenKey = seenK; render(); }
      else {
        if (seenK !== seenKey) { seenKey = seenK; refreshUnread(); }
        if (sk !== statusKey) { statusKey = sk; updateTyping(); }
        updateBadges(); // 앱이 탭 제목을 다시 써도 개수가 유지되게
      }
      peekNew();
    } catch {}
  }

  $('btn').onclick = () => {
    const open = $('panel').hidden;
    if (open) scrollToUnread = true;
    $('panel').hidden = !open;
    $('btn').setAttribute('aria-expanded', String(open));
    try { localStorage.setItem('__uifb_open', open ? '1' : '0'); } catch {}
    // 대화창이 열려 있는 동안 앱의 개발 도구 단추(Next.js 의 nextjs-portal)가 모바일에서 대화창을 가리므로 숨긴다. 닫으면 다시 보인다.
    document.documentElement.toggleAttribute('data-uifb-open', open);
    if (!document.getElementById('__uifb_hide_devtools')) {
      const st = document.createElement('style');
      st.id = '__uifb_hide_devtools';
      // 모바일에선 뒤의 앱 화면도 굴러가지 않게 묶는다(키보드가 올라올 때 창이 끌려 올라가며 앱이 비치지 않게).
      st.textContent = 'html[data-uifb-open] nextjs-portal{display:none!important}@media (max-width:767px){html[data-uifb-open],html[data-uifb-open] body{overflow:hidden!important;overscroll-behavior:none!important}}';
      document.head.append(st);
    }
    fitPanel();
    render();
    if (open) { autoGrow($('input')); if (!touchScreen()) $('input').focus(); }
  };
  // 모바일 키보드가 올라오면 iOS는 화면 전체를 밀어 올려 대화창 아래로 앱이 비친다. 보이는 영역(visualViewport)에 창을 맞춘다.
  function fitPanel() {
    const vv = window.visualViewport, p = $('panel');
    if (!vv || p.hidden || innerWidth > 767 || p.classList.contains('picking')) { p.style.removeProperty('top'); p.style.removeProperty('height'); return; }
    p.style.setProperty('top', vv.offsetTop + 'px', 'important');
    p.style.setProperty('height', vv.height + 'px', 'important');
  }
  window.visualViewport?.addEventListener('resize', fitPanel);
  window.visualViewport?.addEventListener('scroll', fitPanel);

  // 찍을 화면: 'app'(대화창을 숨기고 앱을 찍음) 또는 'widget'(대화창만 보이고 그 안을 찍음). 한 번에 하나만 보인다.
  let pickTarget = 'app';
  function setPickTarget(t) {
    pickTarget = t;
    $('panel').hidden = t === 'app';
    $('hint').classList.toggle('bottom', t === 'widget'); // 대화창 머리를 가리지 않게 아래로
    $('panel').classList.toggle('picking', t === 'widget'); // 폰: 안내줄 자리만큼 대화창을 줄여 입력칸을 가리지 않게
    $('box').hidden = true;
    root.querySelectorAll('.seg [data-t]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.t === t)));
  }
  root.querySelectorAll('.seg [data-t]').forEach((b) => { b.onclick = () => setPickTarget(b.dataset.t); });
  // 대화창을 찍는 동안에는 대화창 버튼·칩이 눌리지 않게 한다(안내줄은 제외).
  function blockWidget(e) {
    if (pickTarget !== 'widget') return;
    const path = e.composedPath();
    if (!path.includes(host) || path.includes($('hint'))) return;
    e.stopPropagation();
    if (e.type === 'mousedown') e.preventDefault();
  }
  function pickedEl(e) {
    const path = e.composedPath();
    if (path.includes($('hint'))) return null;
    if (pickTarget === 'widget') return path.includes(host) && path[0]?.nodeType === 1 ? path[0] : null;
    return path.includes(host) ? null : document.elementFromPoint(e.clientX, e.clientY);
  }
  function stopPick() {
    $('hint').hidden = true;
    $('box').hidden = true;
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onPick, true);
    document.removeEventListener('keydown', onKey, true);
    for (const t of ['pointerdown', 'mousedown']) document.removeEventListener(t, blockWidget, true);
    setPickTarget('app');
    $('panel').hidden = false;
  }
  function onMove(e) {
    const el = pickTarget === 'widget' ? root.elementFromPoint(e.clientX, e.clientY) : document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === host || (pickTarget === 'widget' && $('hint').contains(el))) { $('box').hidden = true; return; }
    const r = el.getBoundingClientRect();
    Object.assign($('box').style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    $('box').hidden = false;
  }
  function onPick(e) {
    if (e.composedPath().includes($('hint'))) return;
    if (pickTarget === 'app' && e.composedPath().includes(host)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = pickedEl(e);
    if (el) {
      const r = el.getBoundingClientRect();
      where = {
        url: here(),
        selector: (pickTarget === 'widget' ? WIDGET_PREFIX : '') + selectorOf(el),
        text: (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 80),
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        viewport: { w: innerWidth, h: innerHeight },
      };
      if (pickFor) {
        draftsApi({ action: 'update', id: pickFor, where });
        where = null;
      } else {
        $('whereText').textContent = '위치: ' + (pickTarget === 'widget' ? '대화창 › ' : '') + (where.text || where.selector.replace(WIDGET_PREFIX, ''));
        $('where').hidden = false;
      }
    }
    const repicked = pickFor;
    pickFor = null;
    stopPick();
    if (!repicked && !touchScreen()) $('input').focus();
  }
  function onKey(e) { if (e.key === 'Escape') { pickFor = null; stopPick(); } }
  $('pickCancel').onclick = () => { pickFor = null; stopPick(); };
  function startPick() {
    setPickTarget('app');
    $('hint').hidden = false;
    for (const t of ['pointerdown', 'mousedown']) document.addEventListener(t, blockWidget, true);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onPick, true);
    document.addEventListener('keydown', onKey, true);
  }
  $('pick').onclick = () => startPick();
  $('whereClear').onclick = () => { where = null; $('where').hidden = true; };
  $('replyClear').onclick = () => setReply(null);

  let interjectNext = false;
  $('now').onclick = () => { interjectNext = true; $('form').requestSubmit(); };
  $('form').onsubmit = async (e) => {
    e.preventDefault();
    const interject = interjectNext;
    interjectNext = false;
    const text = $('input').value.trim();
    if (!text || !sessionById(activeTab)) return;
    const kind = 'chat:' + activeTab;
    const body = { from: 'user', text, cid: cidFor(kind, text), to: activeTab, context: CFG.context, round: CFG.round, device: deviceNow(), ...(interject ? { interject: true } : {}), ...(replyTo ? { replyTo, ...(replyQuote ? { replyQuote } : {}), ...(refMode ? { refer: true } : {}) } : {}), ...(CFG.pick ? { where: where || { url: here() } } : {}) };
    // 서버가 받은 뒤에 입력칸을 비운다. 못 보내면 글은 입력칸에 남고, 단추를 다시 누르면 된다.
    await withBusy(interject ? $('now') : $('form').querySelector('button[type="submit"]'), async () => {
      try {
        const r = await fetch('/__uifb/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error('send');
        doneCid(kind, text);
        sentTexts.set(text, Date.now());
        if ($('input').value.trim() === text) { $('input').value = ''; autoGrow($('input')); clearTimeout(composeT); composeT = null; saveCompose(activeTab, ''); }
        where = null;
        $('where').hidden = true;
        setReply(null);
        await poll();
        // 세션이 쉬는 중이면 감시 명령이 1초 안에 받아 간다. 3초마다 확인하면 그동안 "안 읽음"으로 보여서, 보낸 직후 몇 초는 자주 확인한다.
        for (let i = 1; i <= 8; i++) setTimeout(poll, i * 500);
        render();
      } catch {
        toast('보내지 못했어요. 글은 입력칸에 남겨 뒀어요');
      }
    });
  };
  // 입력칸: 글이 길어지면 자동으로 늘어나고(화면 절반까지), 오른쪽 아래 모서리를 끌어 직접 키우거나 줄일 수도 있다.
  // 입력칸은 대화 창 높이의 40%까지만 커진다. 커진 만큼 대화 목록이 줄어들 뿐 겹치지 않고, 아래 끝을 보던 중이면 계속 아래 끝을 보여 준다.
  const inputMax = () => Math.round($('panel').getBoundingClientRect().height * 0.4) || 200;
  // 직접 끌어 정한 높이는 기억해서 다음에도 그 높이로 시작하고, 글을 비우면 그 높이로 돌아간다(기본 80px).
  let inputBase = null;
  function autoGrow(el) {
    const max = inputMax();
    el.style.maxHeight = max + 'px';
    if (!el.value) { el.style.height = inputBase ? Math.min(inputBase, max) + 'px' : ''; return; }
    if (el.scrollHeight > el.clientHeight) el.style.height = Math.min(el.scrollHeight + 2, max) + 'px';
  }
  $('input').addEventListener('input', () => autoGrow($('input')));
  // 진단(임시): 고치기를 시작한 뒤 3초 동안의 터치·클릭·초점 순서를 모아 서버(.ui-feedback/diag.jsonl)에 남긴다.
  // 폰에서 "다시 보내기"를 누르면 아래 입력칸으로 초점이 가는 원인을 보려는 것이다. 원인을 찾으면 지운다.
  {
    const evs = [];
    const desc = (t) => (t && t.nodeType === 1 ? t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') + (t.className && typeof t.className === 'string' ? '.' + t.className.trim().replace(/\s+/g, '.') : '') + (t.tagName === 'BUTTON' ? '[' + t.textContent.trim().slice(0, 12) + ']' : '') : String(t));
    const rec = (e) => {
      const t = e.composedPath ? e.composedPath()[0] : e.target;
      const p = e.changedTouches?.[0] || e;
      evs.push({ t: Math.round(performance.now()), type: e.type, el: desc(t), x: Math.round(p.clientX ?? -1), y: Math.round(p.clientY ?? -1), active: desc(root.activeElement), editing: !!(editing || holdEdit) });
      if (evs.length > 80) evs.shift();
    };
    for (const type of ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'focusin', 'focusout']) root.addEventListener(type, rec, true);
    let diagT = null;
    window.__uifbDiag = () => {
      clearTimeout(diagT);
      const startAt = performance.now();
      diagT = setTimeout(() => {
        const list = evs.filter((x) => x.t >= startAt - 1500);
        fetch('/__uifb/api/diag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'edit-focus', ua: navigator.userAgent, w: innerWidth, h: innerHeight, vv: window.visualViewport ? [Math.round(visualViewport.height), Math.round(visualViewport.offsetTop)] : null, startAt: Math.round(startAt), events: list, finalActive: desc(root.activeElement) }) }).catch(() => {});
      }, 3000);
    };
  }
  $('input').addEventListener('pointerdown', () => {
    const el = $('input');
    el.style.maxHeight = inputMax() + 'px';
    const before = el.offsetHeight;
    addEventListener('pointerup', () => {
      if (el.offsetHeight === before) return;
      inputBase = el.offsetHeight;
      savePrefs({ inputH: inputBase });
    }, { once: true });
  });
  {
    let gap = 0;
    $('msgs').addEventListener('scroll', () => { const b = $('msgs'); gap = b.scrollHeight - b.scrollTop - b.clientHeight; });
    new ResizeObserver(() => {
      const b = $('msgs');
      // 말풍선 안에서 고치는 중이면(키보드가 올라와 목록이 줄어듦) 맨 아래로 끌어내리지 않고 고치는 칸이 보이게 둔다.
      const a = root.activeElement;
      if (a?.classList?.contains('edit') && b.contains(a)) { a.scrollIntoView({ block: 'nearest' }); return; }
      if (gap < 40) b.scrollTop = b.scrollHeight;
    }).observe($('msgs'));
  }
  $('input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('form').requestSubmit(); }
  });

  // ── 보관함: 나중에 보낼 메시지를 세션별로 모았다가 골라서 보낸다(리뷰 서버 drafts.json, 리뷰 페이지와 같은 보관함) ──
  let drafts = [];
  let draftsRenderedKey = ''; // 보관함을 마지막으로 그렸을 때의 내용
  let trash = []; // 최근 7일 보낸 것·지운 것
  let showTrash = false;
  const openGone = new Set(); // 펼친 보낸 것·지운 것(항목 번호)
  const openDrafts = new Set(); // 펼친 보관함 항목(항목 번호)
  // 보관함에서 보내거나 지운 직후 잠깐 띄우는 알림. 지운 것은 "되살리기"로 바로 되돌릴 수 있다.
  let toastT = null;
  // undo: 되살리기 함수, 또는 { label, fn } 으로 다른 동작 단추(예: "그 분류 열기").
  function toast(text, undo) {
    const t = $('toast');
    t.textContent = '';
    const sp = document.createElement('span');
    sp.textContent = text;
    t.append(sp);
    if (undo) {
      const act = typeof undo === 'function' ? { label: '되살리기', fn: undo } : undo;
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = act.label;
      b.onclick = () => { act.fn(); t.hidden = true; };
      t.append(b);
    }
    const c = $('composeRow').getBoundingClientRect();
    const p = $('panel').getBoundingClientRect();
    t.style.left = p.left + p.width / 2 + 'px';
    t.style.top = c.top - 36 + 'px';
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.hidden = true; }, undo ? 6000 : 3500);
  }
  let draftsKey = '';
  let showDrafts = false;
  let pickFor = null;
  const checked = new Set();
  const draftsApi = async (body) => {
    const r = await fetch('/__uifb/api/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await poll();
    return r.json();
  };
  const mine = () => drafts.filter((d) => d.to === activeTab && !d.hold); // 보관함(완전 나중)
  const holds = () => drafts.filter((d) => d.to === activeTab && d.hold); // 보류(대화창 맨 아래에 잠깐 대기)
  // 사용자 메시지에 붙는 읽음 표시. 세션이 받아 갔으면(delivered) "읽음", 아직이면 세션 상태에 따라 언제 읽는지 적는다.
  let delivered = {};
  function readMark(m) {
    if (m.from !== 'user' || m.context === 'terminal' || !m.to) return '';
    if (m.cancelled) return ' · 보내기 취소함';
    if (got(m)) return ' · 읽음';
    const s = sessionById(m.to);
    if (s?.status?.state === 'working' || s?.status?.state === 'permission') return m.interject ? ' · 안 읽음(다음 단계에서 바로 읽음)' : ' · 안 읽음(작업 중이라 끝나면 읽음)';
    return s?.watch?.active ? ' · 안 읽음(곧 읽음)' : ' · 안 읽음';
  }

  function updateDraftsBtn() {
    const n = mine().length;
    $('draftsBtn').textContent = (n ? `전체 ${n}` : '전체') + (showDrafts && sheetLabel === null ? ' ▾' : ' ▴');
    $('draftsBtn').setAttribute('aria-pressed', String(showDrafts && sheetLabel === null));
    const inLabel = sheetLabel === null ? n : mine().filter((d) => (d.label || '') === sheetLabel).length;
    $('dtitle').textContent = sheetLabel === null ? `보관함 · 전체 ${n}개` : `보관함 · ${sheetLabel || '미분류'} ${inLabel}개`;
    renderCats();
  }

  // 분류 칩 한 줄(보관함 버튼 옆). 한 번에 한 가지 일만 하도록 누르는 길이로 나눈다.
  // 짧게 = "나중에"로 담을 분류 정하기(진한 색), 꾹(0.5초) = 그 분류 보관함 열기. 열린 칩은 짧게 눌러도 닫힌다.
  const HOLD = 500;
  function renderCats() {
    if (!prefsReady) return; // 서버에 저장된 분류를 받기 전에 그리면 잠깐 "미분류"가 골라진 것처럼 보인다
    const counts = new Map([['', 0], ...allLabels().map((l) => [l, 0])]);
    for (const d of mine()) counts.set(d.label || '', (counts.get(d.label || '') || 0) + 1);
    const box = $('cats');
    const key = JSON.stringify([activeTab, [...counts], sheetLabel, showDrafts, draftLabel]);
    if (box.dataset.key === key || root.activeElement?.classList.contains('newlb') || box.querySelector('.pressing')) return; // 새 분류 이름을 쓰는 중이거나 누르는 중이면 다시 그리지 않는다
    box.dataset.key = key;
    box.textContent = '';
    for (const [name, c] of [...counts].sort((a, b) => (a[0] ? a[0] : '\uffff').localeCompare(b[0] ? b[0] : '\uffff', 'ko'))) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cat' + (showDrafts && sheetLabel === name ? ' open' : '');
      b.title = showDrafts ? '누르면 이 분류 보관함 열기' : '짧게: 나중에 담을 분류 · 꾹: 이 분류 보관함 열기';
      b.innerHTML = '<span class="fill"></span>';
      b.append(`${name || '미분류'} ${c}${showDrafts && sheetLabel === name ? ' ▾' : ''}`);
      b.setAttribute('aria-pressed', String((draftLabel || '') === name));
      // 보관함이 열려 있으면 짧게 눌러도 그 분류 보관함으로 바꿔 연다(담을 분류는 그대로). 닫혀 있으면 짧게 = 담을 분류 고르기.
      holdable(b, () => (showDrafts ? (sheetLabel === name ? setDraftsView(false) : openSheet(name)) : setDraftLabel(name || null)), () => (showDrafts && sheetLabel === name ? setDraftsView(false) : openSheet(name)), () => showDrafts && sheetLabel === name);
      box.append(b);
    }
    // 새 분류: 평소에는 다른 분류 칩과 같은 크기의 "+ 새 분류" 칩이고, 누르면 그 자리에서 이름 칸으로 바뀐다
    // (폰은 글자가 16px보다 작은 칸에 쓰면 화면이 확대되므로, 쓰는 동안만 칸이 커진다). Enter 만들기, Esc·비우고 나가면 취소.
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'cat addcat';
    addBtn.textContent = '+ 새 분류';
    addBtn.onclick = () => {
      const add = document.createElement('input');
      add.className = 'newlb';
      add.placeholder = '새 분류 이름';
      add.setAttribute('aria-label', '새 분류 이름');
      add.maxLength = 30;
      const back = () => { box.dataset.key = ''; renderCats(); };
      add.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); const v = add.value.trim(); add.blur(); if (v) setDraftLabel(v); else back(); }
        if (e.key === 'Escape') { add.value = ''; add.blur(); back(); }
      };
      add.onblur = () => { if (!add.value.trim()) back(); };
      addBtn.replaceWith(add);
      add.focus();
    };
    box.append(addBtn);
  }
  // 짧게 누르면 tap, 꾹 누르면 hold. 누르는 동안 칩이 차오르고, 다 차면 튀어 오르며 (안드로이드는) 짧게 진동한다.
  // isOpen 이 참이면 짧게 눌러도 hold(닫기)를 한다. 칩 줄을 스크롤하느라 움직이면 취소한다.
  function holdable(el, tap, hold, isOpen) {
    let t = null, start = null, long = false;
    const cancel = () => { clearTimeout(t); t = null; el.classList.remove('pressing'); };
    el.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      start = { x: e.clientX, y: e.clientY }; long = false;
      el.classList.add('pressing');
      t = setTimeout(() => {
        t = null; long = true;
        el.classList.remove('pressing'); el.classList.add('pop');
        navigator.vibrate?.(15);
        hold();
      }, HOLD);
    });
    el.addEventListener('pointermove', (e) => { if (t && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) { cancel(); start = null; } });
    el.addEventListener('pointercancel', () => { cancel(); start = null; });
    el.addEventListener('pointerleave', () => { if (t) { cancel(); start = null; } });
    el.addEventListener('pointerup', () => {
      const was = !!t; cancel();
      if (!start || long || !was) return;
      start = null;
      if (isOpen()) hold(); else tap();
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.shiftKey || isOpen() ? hold() : tap(); } }); // 키보드: Enter 짧게, Shift+Enter 열기
  }

  // 저장한 위치가 지금 화면에서도 그대로인지. 같은 화면이 아니면 판단하지 않는다.
  function locOf(w) {
    if (!w?.selector) return null;
    if (w.url !== here()) return { k: 'other', label: `다른 화면 · ${w.url}` };
    let el = null;
    try { el = w.selector.startsWith(WIDGET_PREFIX) ? root.querySelector(w.selector.slice(WIDGET_PREFIX.length)) : document.querySelector(w.selector); } catch {}
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
    const keepTop = box.scrollTop; // 다시 그려도 보던 자리를 지킨다
    draftsRenderedKey = draftsKey + '|' + sessions.map((x) => x.id).join();
    box.textContent = '';
    const fits = [];
    renderTrash(box); // 최근 보낸 것·지운 것은 맨 위(접혀 있음)
    const list = mine();
    for (const id of [...checked]) if (!list.some((d) => d.id === id)) checked.delete(id);
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = '보관함이 비어 있습니다.\n글을 쓰고 "나중에"를 누르면 여기에 담깁니다.';
      box.append(p);
    }
    // 분류별로 묶는다. 최근에 담은 분류가 위로 온다.
    const groups = new Map();
    for (const d of [...list].sort((a, b) => String(b.at).localeCompare(String(a.at)))) {
      const k = d.label || '';
      if (sheetLabel !== null && k !== sheetLabel) continue; // 분류 버튼으로 열었으면 그 분류만
      groups.set(k, [...(groups.get(k) || []), d]);
    }
    for (const [label, items] of groups) {
      const g = document.createElement('section');
      // 분류 버튼으로 그 분류만 열었으면 제목에 이미 분류 이름이 있으니 접기 줄을 빼고 보내기만 둔다.
      const only = sheetLabel !== null;
      g.className = 'dgroup' + (folded.has(label) && !only ? ' folded' : '') + (only ? ' only' : '');
      const head = document.createElement('header');
      const fold = document.createElement('button');
      fold.type = 'button';
      fold.className = 'fold';
      fold.textContent = (folded.has(label) ? '▸ ' : '▾ ') + (label || '미분류');
      fold.onclick = () => { folded.has(label) ? folded.delete(label) : folded.add(label); saveFold(); renderDrafts(); };
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = `${items.length}개`;
      const gs = document.createElement('button');
      gs.type = 'button';
      gs.className = 'gsend';
      gs.textContent = items.length > 1 ? '이 분류 모두 보내기' : '보내기';
      gs.onclick = () => withBusy(gs, () => sendDrafts(items.map((d) => d.id)));
      if (only) head.append(gs);
      else head.append(fold, n, gs);
      g.append(head);
      box.append(g);
    for (const d of items) { // 같은 분류 안에서도 최근에 담은 것이 위
      const card = document.createElement('div');
      card.className = 'draft' + (movedId === d.id ? ' moved' : '');
      card.dataset.id = String(d.id);
      const top = document.createElement('div');
      top.className = 'top';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = checked.has(d.id);
      cb.setAttribute('aria-label', '보낼 항목으로 고르기');
      cb.onchange = () => { cb.checked ? checked.add(d.id) : checked.delete(d.id); updateFoot(); };
      const ta = document.createElement('textarea');
      ta.value = d.text;
      // 인용과 같은 방식: 4줄까지 보이고, 길면 "펼치기"로 전체를 본다(고치려고 누르면 저절로 펼친다).
      ta.rows = 1;
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'dmore';
      more.hidden = true;
      // 재기(measure)와 높이 바꾸기(apply)를 나눠, 보관함을 처음 열 때 모든 칸을 한 번에 재고 한 번에 바꾼다(칸마다 번갈아 하면 화면 계산이 칸 수만큼 반복돼 버벅인다).
      const measure = () => {
        const cs = getComputedStyle(ta);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.45;
        const edge = parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
        return { full: ta.scrollHeight + 2, lh, edge, four: Math.floor(lh * 4 + edge + parseFloat(cs.paddingBottom)) };
      };
      const apply = ({ full, lh, edge, four }) => {
        const open = openDrafts.has(d.id);
        // 접힌 칸은 아래 여백을 없애고 4줄에 딱 맞춘다(여백이 있으면 그 자리에 5번째 줄 윗부분이 비친다).
        if (!open && full > four + 1) { ta.style.paddingBottom = '0'; ta.style.height = Math.floor(lh * 4 + edge) + 'px'; }
        else ta.style.height = full + 'px';
        more.hidden = full <= four + 1;
        more.textContent = open ? '접기' : '펼치기';
      };
      const fit = () => { ta.style.height = 'auto'; ta.style.paddingBottom = ''; apply(measure()); };
      more.onclick = () => { openDrafts.has(d.id) ? openDrafts.delete(d.id) : openDrafts.add(d.id); fit(); };
      ta.addEventListener('input', fit);
      ta.addEventListener('focus', () => { if (!openDrafts.has(d.id)) { openDrafts.add(d.id); fit(); } });
      fits.push({ measure, apply });
      ta.setAttribute('aria-label', '보관한 메시지');
      ta.onchange = () => { if (ta.value.trim()) draftsApi({ action: 'update', id: d.id, text: ta.value }); };
      top.append(cb, ta);
      const meta = document.createElement('div');
      meta.className = 'meta';
      const when = document.createElement('span');
      when.textContent = new Date(d.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + (d.round ? ` · ${d.round}차 비교` : '');
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
      const btn = (label, fn, cls) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (cls) b.className = cls; b.onclick = () => withBusy(b, fn); acts.append(b); };
      btn('이것만 보내기', () => sendDrafts([d.id]), 'send1');
      if (loc?.el) btn('위치 보기', () => flash(loc.el));
      if (d.where?.selector) btn('다시 찍기', () => { pickFor = d.id; startPick(); });
      if (sessions.length > 1) {
        const sel = document.createElement('select');
        sel.setAttribute('aria-label', '받을 세션 바꾸기');
        for (const x of sessions) { const o = document.createElement('option'); o.value = x.id; o.textContent = x.id === d.to ? `${x.name}에게` : `${x.name}(으)로 옮기기`; sel.append(o); }
        sel.value = d.to;
        sel.onchange = () => { const to = sel.value; moveDraft(d.id, { to }, `✓ ${nameOf(to)} 보관함으로 옮김`, { label: `${nameOf(to)} 열기`, fn: () => { tabSetAt = Date.now(); switchTab(to); savePrefs({ tab: to }); setDraftsView(true); } }); };
        acts.append(sel);
      }
      {
        const ls = document.createElement('select');
        ls.setAttribute('aria-label', '분류 바꾸기');
        for (const name of ['', ...allLabels()]) { const o = document.createElement('option'); o.value = name; o.textContent = name ? `분류: ${name}` : '분류: 미분류'; ls.append(o); }
        { const o = document.createElement('option'); o.value = '\u0000new'; o.textContent = '+ 새 분류…'; ls.append(o); }
        ls.value = d.label || '';
        // "+ 새 분류…"를 고르면 그 자리에 이름 칸을 띄운다(Enter 저장, Esc·바깥 누르면 취소)
        ls.onchange = () => {
          if (ls.value !== '\u0000new') return moveDraft(d.id, { label: ls.value }, `✓ ${ls.value || '미분류'}(으)로 옮김`, { label: `${ls.value || '미분류'} 열기`, fn: () => openSheet(ls.value) });
          const inp = document.createElement('input');
          inp.className = 'newlb';
          inp.placeholder = '새 분류 이름';
          inp.maxLength = 30;
          inp.style.cssText = 'font-size:11px;padding:3px 7px;border-radius:6px;border:1px solid #4f46e5;width:110px';
          const cancel = () => { inp.remove(); ls.hidden = false; ls.value = d.label || ''; };
          inp.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); const v = inp.value.trim(); if (v) moveDraft(d.id, { label: v }, `✓ 새 분류 ${v}(으)로 옮김`, { label: `${v} 열기`, fn: () => openSheet(v) }); else cancel(); }
            if (e.key === 'Escape') cancel();
          };
          inp.onblur = () => { if (inp.isConnected) cancel(); };
          ls.hidden = true;
          ls.after(inp);
          inp.focus();
        };
        acts.append(ls);
      }
      btn('지우기', async () => {
        await draftsApi({ action: 'delete', ids: [d.id] });
        toast('지웠어요', () => draftsApi({ action: 'restore', ids: [d.id] }));
      });
      card.append(top, more, meta, acts);
      g.append(card);
    }
    }
    updateFoot();
    updateDraftsBtn(); // 보내거나 지운 뒤 머리말 개수도 바로 맞춘다
    // 새로 만든 칸은 rows=1 이라 바로 잴 수 있다: 모두 잰 뒤 모두 바꾼다.
    const ms = fits.map((f) => f.measure());
    fits.forEach((f, i) => f.apply(ms[i]));
    box.scrollTop = keepTop;
  }

  // 보관함 맨 위: 최근 7일 보낸 것·지운 것(접혀 있음). "다시 담기"로 보관함에 되돌린다.
  function renderTrash(box) {
    const list = trash.filter((d) => d.to === activeTab && (sheetLabel === null || (d.label || '') === sheetLabel)).sort((a, b) => String(b.goneAt).localeCompare(String(a.goneAt)));
    if (!list.length) return;
    const sec = document.createElement('section');
    sec.className = 'dgroup trash' + (showTrash ? '' : ' folded');
    const head = document.createElement('header');
    const fold = document.createElement('button');
    fold.type = 'button';
    fold.className = 'fold';
    fold.textContent = (showTrash ? '▾ ' : '▸ ') + '최근 보낸 것·지운 것';
    fold.onclick = () => { showTrash = !showTrash; saveFold(); renderDrafts(); };
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = `${list.length}개 · 7일 보관`;
    head.append(fold, n);
    sec.append(head);
    if (showTrash) for (const d of list) {
      const row = document.createElement('div');
      row.className = 'gone';
      const what = document.createElement('span');
      what.className = 'gwhat ' + d.gone;
      what.textContent = (d.gone === 'sent' ? '보냄' : '지움') + ' ' + shortAt(d.goneAt) + (d.msgId ? ` · #${d.msgId}` : '');
      // 글을 누르면 전체를 펼치고, 다시 누르면 한 줄로 접는다.
      const tx = document.createElement('span');
      tx.className = 'gtext' + (openGone.has(d.id) ? ' open' : '');
      tx.textContent = (d.label ? `[${d.label}] ` : '') + d.text;
      tx.title = openGone.has(d.id) ? '접기' : '눌러서 펼치기';
      tx.onclick = () => { openGone.has(d.id) ? openGone.delete(d.id) : openGone.add(d.id); renderDrafts(); };
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = '다시 담기';
      b.onclick = () => withBusy(b, async () => { await draftsApi({ action: 'restore', ids: [d.id] }); toast('✓ 다시 담음'); });
      row.append(what, tx, b);
      sec.append(row);
    }
    box.append(sec);
  }

  // 분류나 받을 세션을 바꾸면 알림을 띄우고, 옮겨 간 항목을 잠깐 테두리로 보여 준다(다른 세션으로 옮긴 것은 이 목록에서 빠진다).
  let movedId = null;
  async function moveDraft(id, patch, msg, go) {
    movedId = id;
    await draftsApi({ action: 'update', id, ...patch });
    renderDrafts();
    // "○○ 열기"로 옮겨 간 곳을 바로 열 수 있다. 연 뒤에도 옮긴 항목이 테두리로 보인다.
    toast(msg, go && { label: go.label, fn: () => { movedId = id; go.fn(); setTimeout(() => $('drafts').querySelector(`.draft[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 100); setTimeout(() => { if (movedId === id) movedId = null; }, 1800); } });
    $('drafts').querySelector(`.draft[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setTimeout(() => { if (movedId === id) { movedId = null; $('drafts').querySelector(`.draft[data-id="${id}"]`)?.classList.remove('moved'); } }, 1800);
  }

  function updateFoot() {
    const n = mine().filter((d) => checked.has(d.id)).length;
    $('dsend').disabled = n === 0;
    $('dsend').textContent = n > 1 ? `선택한 ${n}개 한 번에 보내기` : '선택한 것 보내기';
    $('dall').checked = n > 0 && n === mine().length;
  }

  async function sendDrafts(ids) {
    const out = await draftsApi({ action: 'send', ids, combine: true, device: deviceNow() });
    const sent = out?.sent || [];
    if (sent.length) toast(`✓ ${ids.length}개 보냄 → ${nameOf(sent[0].to)}`);
    ids.forEach((id) => checked.delete(id));
    if (!mine().length) setDraftsView(false);
    else renderDrafts();
  }

  // 시트는 보관함 버튼 줄 바로 위에 붙는다. 입력칸이 커지면 따라 올라간다.
  function placeSheet() {
    if (!showDrafts) return;
    const p = $('panel').getBoundingClientRect();
    $('dsheet').style.bottom = Math.round(p.bottom - $('composeRow').getBoundingClientRect().top) + 'px';
  }
  new ResizeObserver(placeSheet).observe($('form'));
  let sheetLabel = null; // null 이면 전체, '' 이면 미분류, 그 밖에는 그 분류만
  function openSheet(label) {
    sheetLabel = label;
    if (showDrafts) { updateDraftsBtn(); renderDrafts(); } else setDraftsView(true);
  }
  function setDraftsView(on) {
    if (!on) sheetLabel = null;
    if (on && !showDrafts) loadFold();
    showDrafts = on;
    placeToBottom();
    $('dsheet').hidden = !on;
    updateDraftsBtn();
    if (on) { placeSheet(); renderDrafts(); }
  }
  $('dclose').onclick = () => setDraftsView(false);
  // 보관함이 열려 있을 때 대화 목록(시트 바깥)을 누르면 닫는다.
  $('msgs').addEventListener('pointerdown', () => { if (showDrafts) setDraftsView(false); });
  $('draftsBtn').onclick = () => (showDrafts && sheetLabel === null ? setDraftsView(false) : openSheet(null));
  $('dall').onchange = () => { mine().forEach((d) => ($('dall').checked ? checked.add(d.id) : checked.delete(d.id))); renderDrafts(); };
  $('dsend').onclick = () => withBusy($('dsend'), () => sendDrafts(mine().filter((d) => checked.has(d.id)).map((d) => d.id)));

  // "나중에"로 담으면 입력한 글이 보관함 버튼으로 날아 들어가고, 버튼이 한 번 튀며 개수가 오른다.
  // 폰에서는 "나중에"를 누르면 키보드가 닫히며 화면 배치가 바뀌므로, 날아가는 동안 매 프레임 버튼 위치를 다시 읽어 따라간다.
  function flyToDrafts(text, target = () => $('draftsBtn')) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const bump = () => {
      const t = target();
      if (!t) return;
      t.classList.remove('got');
      void t.offsetWidth;
      t.classList.add('got');
    };
    if (reduce) return bump();
    const g = document.createElement('div');
    g.className = 'fly';
    g.textContent = text.replace(/\s+/g, ' ').slice(0, 24);
    const from = $('input').getBoundingClientRect();
    g.style.left = from.left + 8 + 'px';
    g.style.top = from.top + 6 + 'px';
    root.append(g);
    const start = performance.now();
    const dur = 500;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const e = t * t * (3 - 2 * t); // 부드럽게 출발해 부드럽게 도착
      const src = $('input').getBoundingClientRect();
      const to = (target() || $('draftsBtn')).getBoundingClientRect();
      const gw = g.offsetWidth;
      const gh = g.offsetHeight;
      const x0 = src.left + 8;
      const y0 = src.top + 6;
      const x1 = to.left + to.width / 2 - gw / 2;
      const y1 = to.top + to.height / 2 - gh / 2;
      const sc = 1 - 0.75 * e;
      g.style.left = x0 + (x1 - x0) * e + 'px';
      g.style.top = y0 + (y1 - y0) * e - Math.sin(Math.PI * e) * 24 + 'px'; // 살짝 위로 휘어 날아간다
      g.style.transform = `scale(${sc})`;
      g.style.opacity = String(1 - 0.6 * e);
      if (t < 1) requestAnimationFrame(step);
      else { g.remove(); bump(); }
    };
    requestAnimationFrame(step);
  }

  // 보류하기: 대화창 맨 아래에 잠깐 대기. 보관함 담기: 바로 보관함(완전 나중).
  async function saveLater(toDrafts) {
    const text = $('input').value.trim();
    if (!text || !sessionById(activeTab)) return;
    const kind = 'draft:' + activeTab;
    await withBusy($(toDrafts ? 'stash' : 'later'), async () => {
    try {
      const r = await draftsApi({ action: 'add', cid: cidFor(kind, text), ...(toDrafts ? {} : { hold: true }), to: activeTab, text, label: draftLabel, context: CFG.context, round: CFG.round, device: deviceNow(), ...(CFG.pick ? { where: where || { url: here() } } : {}) });
      if (!r?.id) throw new Error('add');
      doneCid(kind, text);
      sentTexts.set(text, Date.now());
      flyToDrafts(text, toDrafts ? () => $('draftsBtn') : () => (folded.has(HOLD_FOLD) && $('msgs').querySelector('.holdhead')) || [...$('msgs').querySelectorAll('.msg.hold')].at(-1) || $('msgs'));
      if ($('input').value.trim() === text) { $('input').value = ''; autoGrow($('input')); clearTimeout(composeT); composeT = null; saveCompose(activeTab, ''); }
      render();
      $('msgs').scrollTop = $('msgs').scrollHeight;
      where = null;
      $('where').hidden = true;
      updateDraftsBtn();
      if (toDrafts) toast('✓ 보관함에 담음', { label: `${draftLabel || '미분류'} 열기`, fn: () => openSheet(draftLabel || '') });
    } catch {
      toast('담지 못했어요. 글은 입력칸에 남겨 뒀어요');
    }
    });
  }
  $('later').onclick = () => saveLater(false);
  $('stash').onclick = () => saveLater(true);

  // 오른쪽 위 손잡이를 끌어 창 크기를 바꾼다(창은 왼쪽 아래에 붙어 있다). 크기는 이 브라우저에 기억한다.
  function applySize(sz) {
    if (!sz || innerWidth < 768) return; // 모바일은 화면을 채우는 창이라 크기를 정하지 않는다
    const w = Math.min(Math.max(300, sz.w), innerWidth - 32);
    const h = Math.min(Math.max(320, sz.h), innerHeight - 180);
    $('panel').style.width = w + 'px';
    $('panel').style.height = h + 'px';
  }
  // 창 크기와 입력칸 높이는 리뷰 서버(prefs.json)에 두어 앱 화면·리뷰 페이지가 함께 쓰고, 데스크톱(768px 이상)과 모바일은 따로 기억한다.
  let size = null;
  let prefs = {};
  let dragging = false;
  let tabSetAt = 0; // 이 화면에서 방금 탭을 바꿨으면 서버의 옛 값으로 되돌리지 않는다
  const device = () => (innerWidth < 768 ? 'mobile' : 'desktop');
  const savePrefs = (patch) => fetch('/__uifb/api/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device: device(), ...patch }) }).then((r) => r.json()).then((p) => { prefs = p; }).catch(() => {});
  function applyPrefs(p) {
    prefs = p || {};
    // 처음 받을 때와, 이 화면에서 방금 고르지 않았을 때는 서버에 저장된 담을 분류를 바로 따른다.
    if (!prefsReady || Date.now() - labelSetAt > 5000) draftLabel = prefs.draftLabels?.[activeTab] ?? null;
    prefsReady = true;
    // 보류 묶음 접힘은 새로고침·다른 화면에서도 따른다(보관함 창이 열려 있으면 그쪽 접힘을 건드리지 않게 넘어감, 방금 접었으면 서버 옛 값으로 되돌리지 않음).
    // 여기서 바로 그리지 않는다(첫 확인 때는 세션 목록이 아직 비어 있어 엉뚱한 탭으로 그려진다). 접힘은 poll 의 다시 그리기 키에 들어 있다.
    if (!showDrafts && Date.now() - foldSetAt > 5000) loadFold();
    renderCats();
    if (dragging) return;
    const mine = prefs[device()] || {};
    size = mine.panel || null;
    if (size) applySize(size);
    else { $('panel').style.width = ''; $('panel').style.height = ''; }
    inputBase = mine.inputH || null;
    if (!$('input').value) autoGrow($('input'));
    // 다른 화면에서 고른 세션 탭을 따른다(지금 이 화면에서 글을 쓰는 중이 아닐 때만).
    if (prefs.tab && prefs.tab !== activeTab && sessionById(prefs.tab) && Date.now() - tabSetAt > 5000 && Date.now() - typedAt > 3000 && !composeT) switchTab(prefs.tab);
  }
  function switchTab(id) {
    flushCompose();
    if (id !== activeTab) setReply(null);
    activeTab = id;
    labelSetAt = 0;
    draftLabel = prefs?.draftLabels?.[id] ?? null; // 그 세션에서 고른 분류로 바꾼다
    if (!showDrafts) loadFold();
    scrollToUnread = true;
    try { localStorage.setItem('__uifb_tab', activeTab); } catch {}
    render();
    loadCompose(true);
  }
  addEventListener('resize', () => applyPrefs(prefs));
  $('grip').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const r = $('panel').getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
    $('grip').setPointerCapture(e.pointerId);
    dragging = true;
    const move = (ev) => { size = { w: start.w + (ev.clientX - start.x), h: start.h - (ev.clientY - start.y) }; applySize(size); };
    const up = () => {
      $('grip').removeEventListener('pointermove', move);
      dragging = false;
      savePrefs({ panel: size });
    };
    $('grip').addEventListener('pointermove', move);
    $('grip').addEventListener('pointerup', up, { once: true });
  });
  $('grip').addEventListener('dblclick', () => { size = null; $('panel').style.width = ''; $('panel').style.height = ''; savePrefs({ panel: null }); });

  // ── 쓰던 글: 세션 탭마다 보내지 않은 글을 리뷰 서버(compose.json)에 저장한다. 새로고침해도 남고 다른 화면에서 이어 쓴다 ──
  let composed = {};
  let composeT = null;
  let typedAt = 0;
  function flushCompose() {
    if (!composeT) return;
    clearTimeout(composeT);
    composeT = null;
    saveCompose(activeTab, $('input').value);
  }
  function saveCompose(session, text) {
    if (!session) return;
    composed[session] = text ? { text } : undefined;
    typedAt = Date.now(); // 저장이 서버에 닿기 전 다음 확인에서 옛 글을 다시 채우지 않게(보낸 뒤 입력칸에 글이 되살아나던 문제)
    fetch('/__uifb/api/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session, text }) }).catch(() => {});
  }
  // force: 탭을 바꿨을 때. 아니면 지금 쓰는 중(최근 3초 안에 입력)에는 덮어쓰지 않는다.
  function loadCompose(force) {
    const el = $('input');
    let want = composed[activeTab]?.text || '';
    // 이미 보낸 글이 서버 임시 저장에 남아 있으면(먼저 출발한 저장이 비우기보다 늦게 도착한 경우) 되살리지 않고 서버도 비운다.
    const sentAt = sentTexts.get(want.trim());
    // 새로고침 등으로 보낸 기록(sentTexts)이 사라졌어도, 같은 글이 2분 안에 이미 이 세션에 보내졌으면 되살리지 않는다.
    const justSent = want && messages.some((m) => m.from === 'user' && m.to === activeTab && m.text === want.trim() && Date.now() - Date.parse(m.at) < 120_000);
    if (want && ((sentAt && Date.now() - sentAt < 10 * 60_000) || justSent)) { want = ''; saveCompose(activeTab, ''); }
    if (!force && (Date.now() - typedAt < 3000 || composeT)) return;
    if (el.value !== want) { el.value = want; autoGrow(el); }
  }
  $('clr').onclick = () => { $('input').value = ''; $('input').dispatchEvent(new Event('input')); $('input').focus(); };
  // 입력칸 값이 코드로 바뀌는 곳(보내기, 동기화, 탭 전환)이 여러 군데라, 지우기 버튼은 짧은 주기로 맞춘다.
  setInterval(() => { $('clr').hidden = !$('input').value; }, 300);
  $('input').addEventListener('input', () => {
    $('clr').hidden = !$('input').value;
    typedAt = Date.now();
    clearTimeout(composeT);
    const session = activeTab;
    composeT = setTimeout(() => { composeT = null; saveCompose(session, $('input').value); }, 400);
  });
  addEventListener('pagehide', flushCompose);

  // ── 보관 분류: "나중에"로 담을 때 붙일 분류. 마지막으로 고른 분류가 두 화면에서 유지된다 ──
  let draftLabel = null;
  let labelSetAt = 0; // 방금 이 화면에서 고른 분류를 서버의 옛 값으로 되돌리지 않게
  const folded = new Set();
  let foldSetAt = 0;
  const HOLD_FOLD = '__보류__'; // 보류 묶음 접힘도 같은 곳에 남긴다(분류 이름과 겹치지 않는 이름)
  // 접은 분류와 "최근 보낸 것·지운 것" 펼침은 서버 설정에 세션마다 남겨, 새로고침해도(다른 화면에서도) 그대로 둔다.
  const saveFold = () => savePrefs({ fold: { session: activeTab, labels: [...folded], trash: showTrash } });
  function loadFold() {
    const f = prefs?.fold?.[activeTab];
    folded.clear();
    for (const l of f?.labels || []) folded.add(l);
    showTrash = !!f?.trash;
  }
  // 분류와 고른 분류는 세션 탭마다 따로다(다른 세션의 분류가 섞이지 않게).
  const allLabels = () => [...new Set([...mine().map((d) => d.label).filter(Boolean), ...(draftLabel ? [draftLabel] : [])])].sort((a, b) => a.localeCompare(b, 'ko'));
  function setDraftLabel(v) {
    draftLabel = v;
    labelSetAt = Date.now();
    prefs.draftLabels = { ...(prefs.draftLabels || {}), [activeTab]: v };
    savePrefs({ draftLabel: v, session: activeTab });
    if ($('cats').contains(root.activeElement)) root.activeElement.blur();
    updateDraftsBtn();
  }
  setInterval(() => {
    const saved = prefs?.draftLabels?.[activeTab] ?? null;
    if (saved !== draftLabel && Date.now() - labelSetAt > 5000) draftLabel = saved;
    renderCats();
  }, 1000);

  $('close').onclick = () => $('btn').click();

  // ── 알림(웹 푸시) ──
  // 홈 화면에 앱처럼 설치할 수 있게 설치 정보를 붙인다(아이폰은 설치한 앱에서만 웹 알림을 받는다).
  {
    const add = (tag, attrs) => { const el = document.createElement(tag); Object.assign(el, attrs); document.head.append(el); };
    if (!document.querySelector('link[rel="manifest"]')) add('link', { rel: 'manifest', href: '/__uifb/manifest.webmanifest?start=' + encodeURIComponent(location.pathname) });
    if (!document.querySelector('link[rel="apple-touch-icon"]')) add('link', { rel: 'apple-touch-icon', href: '/__uifb/icon-180.png' });
    if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) add('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
    if (!document.querySelector('meta[name="mobile-web-app-capable"]')) add('meta', { name: 'mobile-web-app-capable', content: 'yes' });
  }
  const pushReady = () => window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  async function currentSub() {
    if (!pushReady()) return null;
    const reg = await navigator.serviceWorker.getRegistration('/');
    return reg ? reg.pushManager.getSubscription() : null;
  }
  async function showNotif() {
    const sub = await currentSub().catch(() => null);
    const on = !!sub && Notification.permission === 'granted';
    $('notif').classList.toggle('on', on);
    $('notif').textContent = on ? '🔔 알림' : '🔕 알림';
  }
  // 알림 설정 창: 받을 알림 종류와 "보고 있을 땐 보내지 않기". 이 기기에만 적용된다(서버에 기기마다 저장).
  const NKINDS = [['answer', '세션 답장'], ['done', '작업 끝남'], ['permission', '승인 필요'], ['review', '비교 페이지 준비'], ['stale', '오래 멈춤(5분 그대로)'], ['peer', '세션끼리 메시지']];
  async function openNotifSettings(sub) {
    const box = $('nset');
    const post = (body) => fetch('/__uifb/api/push-prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint, ...body }) }).then((r) => r.json());
    const { prefs = {} } = await post({});
    box.textContent = '';
    const h = document.createElement('b');
    h.textContent = '이 기기에 알림 받을 때';
    box.append(h);
    const row = (key, text) => {
      const l = document.createElement('label');
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = !!prefs[key];
      c.onchange = () => post({ prefs: { [key]: c.checked } });
      l.append(c, text);
      box.append(l);
    };
    for (const [k, t] of NKINDS) row(k, t);
    box.append(document.createElement('hr'));
    row('quiet', '대화창을 보고 있을 땐 보내지 않기');
    const bar = document.createElement('div');
    bar.className = 'nbtns';
    const btn = (t, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.onclick = fn; bar.append(b); };
    btn('시험 알림', async () => { await fetch('/__uifb/api/push-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); toast('시험 알림을 보냈어요'); });
    btn('알림 끄기', async () => {
      await sub.unsubscribe();
      await fetch('/__uifb/api/push-unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      box.hidden = true;
      toast('알림을 껐어요');
      showNotif();
    });
    btn('닫기', () => { box.hidden = true; });
    box.append(bar);
    box.hidden = false;
  }
  // 이 기기에서 대화창을 보고 있으면 15초마다 알려, 서버가 그동안 이 기기에는 알림을 보내지 않게 한다("보고 있을 땐 보내지 않기").
  // 다른 앱·다른 창으로 가거나 대화창을 닫으면 바로 "안 봄"을 알린다(안 그러면 마지막 신호 뒤 30초 동안 알림이 막혀 놓친다).
  let lastViewing = null;
  const viewing = async (force) => {
    const on = !$('panel').hidden && document.visibilityState === 'visible' && document.hasFocus();
    if (!on && lastViewing === false && force !== true) return;
    lastViewing = on;
    const sub = await currentSub().catch(() => null);
    if (sub) fetch('/__uifb/api/push-viewing', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint, off: !on }) }).catch(() => {});
  };
  setInterval(viewing, 15_000);
  document.addEventListener('visibilitychange', () => viewing());
  addEventListener('blur', () => viewing());
  addEventListener('focus', () => viewing());
  addEventListener('pagehide', () => viewing(true));
  new MutationObserver(() => viewing()).observe($('panel'), { attributes: true, attributeFilter: ['hidden'] });
  $('notif').onclick = async () => {
    if (!$('nset').hidden) { $('nset').hidden = true; return; }
    if (!pushReady()) {
      const ios = /iPhone|iPad/.test(navigator.userAgent);
      return toast(!window.isSecureContext ? 'https:// 주소로 열어야 알림을 켤 수 있어요' : ios ? '사파리 공유 → 홈 화면에 추가한 앱에서 켜 주세요' : '이 브라우저는 알림을 지원하지 않아요');
    }
    try {
      const old = await currentSub();
      if (old && Notification.permission === 'granted') return openNotifSettings(old);
      if ((await Notification.requestPermission()) !== 'granted') return toast('알림 권한이 꺼져 있어요(설정에서 허용해 주세요)');
      const reg = await navigator.serviceWorker.register('/__uifb/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const { publicKey } = await fetch('/__uifb/api/push-key').then((r) => r.json());
      const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await fetch('/__uifb/api/push-subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), url: location.pathname, device: deviceNow() }) });
      await fetch('/__uifb/api/push-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      toast('✓ 알림을 켰어요. 시험 알림을 보냈어요');
      openNotifSettings(sub);
    } catch (e) {
      toast('알림을 켜지 못했어요: ' + (e?.message || e));
    }
    showNotif();
  };
  showNotif();

  // 홈 화면에 설치한 앱에는 브라우저의 새로고침이 없어 ↻ 단추를 둔다. 위젯이 새로 바뀌면 알림으로도 알려 준다.
  // 새로고침: 대화창 머리말과, 대화창을 닫았을 때 여는 단추 아래(화면 전체를 새로 읽는다).
  // 누르면 바로 돌기 시작해서 새로고침 중임을 보인다(화면이 다시 뜰 때까지 돈다).
  // 직접 누른 새로고침도 세션이 부른 새로고침과 같은 "새로 고치는 중" 안내를 띄운다.
  const reloadNow = (b) => {
    b.classList.add('reloading');
    flushCompose();
    $('reloadCover').querySelector('span').textContent = '대화창을 새로 고치는 중이에요 · 잠시 손대지 마세요';
    $('reloadCover').hidden = false;
    requestAnimationFrame(() => setTimeout(() => location.reload(), 300));
  };
  $('reload').onclick = () => reloadNow($('reload'));
  $('rbtn').onclick = () => reloadNow($('rbtn'));
  const placeRbtn = () => {
    const b = $('btn').getBoundingClientRect();
    // 여는 단추 바로 아래 왼쪽 정렬. 여는 단추를 바닥에서 112px 띄워, 왼쪽 아래 구석의 앱 개발 도구 단추(예: Next.js 의 N)와 겹치지 않는다.
    $('rbtn').style.left = b.left + 'px';
    $('rbtn').style.top = b.bottom + 8 + 'px';
  };
  new ResizeObserver(placeRbtn).observe($('btn'));
  addEventListener('resize', placeRbtn);
  // 대화창 새로고침은 세션이 원할 때만 한다(세션이 /api/reload-widgets 를 부르면 서버의 새로고침 번호가 바뀜).
  // 그러면 "새로고침 중" 안내를 덮어 띄우고 잠깐 뒤 새로고침한다. 보내는 중(단추가 도는 중)이거나 말풍선을 고치는 중이면 끝날 때까지 기다린다.
  // 입력칸 글과 보던 위치는 서버에 남아 새로고침 뒤에도 그대로다.
  let reloadToken = null;
  const checkVersion = async () => {
    const t = await fetch('/__uifb/api/widget-version').then((r) => r.json()).then((j) => j.r).catch(() => null);
    if (t == null) return;
    if (reloadToken == null) reloadToken = t;
    else if (t !== reloadToken) { reloadToken = t; reloadSoon(); }
  };
  let reloadT = null;
  function reloadSoon() {
    clearTimeout(reloadT);
    const cover = $('reloadCover');
    cover.hidden = false;
    const wait = editing || holdEdit || root.querySelector('button.busy');
    cover.querySelector('span').textContent = wait ? '대화창을 새로 고칠 거예요 · 지금 하던 것을 마치면 바로' : '대화창을 새로 고치는 중이에요 · 잠시 손대지 마세요';
    if (wait) { reloadT = setTimeout(reloadSoon, 1000); return; }
    flushCompose();
    reloadT = setTimeout(() => location.reload(), 1200);
  }
  checkVersion();
  setInterval(checkVersion, 5_000);

  // 창이 열려 있던 채로 새로고침했으면 다시 연다(이 브라우저에만 기억한다. 폰에서 연다고 PC 창이 열리지 않게).
  let wasOpen = false;
  try { wasOpen = localStorage.getItem('__uifb_open') === '1'; } catch {}
  poll().then(() => { if (wasOpen && $('panel').hidden) $('btn').click(); });
  setInterval(poll, 3000);
})();
