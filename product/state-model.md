# State Model — agent-chat-widget + ui-review-page (shipped product, retrofit)

Status: Retrofit draft 2026-10-12 — awaiting owner verdicts

> **Layer position:** `flows` → **`state-model`** → `screen-map` → `moment-spec` → `wireflow` → implementation
> **Retrofit note:** this model is reconstructed from shipped code and chat history, not designed
> ahead of it. Nothing here is an adopted contract until the owner gives a verdict. Every row is
> Draft. Rows marked "(inferred — needs owner verdict)" describe behavior the code shows but no
> owner message confirms, or behavior that is not directly visible in code.

Evidence notation:
- Code: `W` = `assets/app-widget.js`, `H` = `scripts/chat-handler.mjs`, `F` = `scripts/chat-format.mjs`,
  `HR` = `scripts/hook-relay.mjs`, `WR` = `scripts/wait-review.mjs`, `SW` = `assets/sw.js`,
  `RP` = ui-review-page `assets/review-page.js`, `RH` = ui-review-page `scripts/review-handler.mjs`.
  `W:1610` = line 1610 as of 2026-10-12.
- Chat: `#n` = owner/agent message number in the development chat (#3–#1603, 2026-10-07 to 10-11).
- Tests: `T14`, `T30`, `T54`, `T70`, `T82`, `T98`, `T117` = test starting at that line of
  `tests/chat.test.mjs` (Playwright, 390×800 touch viewport, pre-commit hook).

---

## 0. Meta

| Field | Value |
|---|---|
| Target flow | None yet — `product/flows.md` does not exist. Branch refs below are Pending until stage 2 is retro-filled. |
| Target screen / section | Chat widget panel injected into the host app (and into the review page), plus the review (comparison) page |
| Date / version | 2026-10-12 · retrofit r1 · code as of agent-chat-widget HEAD on that date |
| Scope / exclusions | In: user message lifecycle, hold, drafts, trash, session status, watcher, panel, reply/reference attachment, location attachment, push subscription/viewing, answer read state, review round. Out: app proxy injection, LAN access key, session registration, hook installer, capture tooling (2x capture, recipes, prune), link-line geometry, panel resize, peer (session-to-session) messages except where they touch read state. Entry states: ST-26 (panel closed) / ST-33 / ST-39 / ST-42 with no message in flight. Terminal states: ST-05, ST-06/ST-07, ST-16, ST-49. |
| Diagram / prototype evidence | None. The shipped product is the only operable GUI; no diagram exists. |
| Linked decisions | None — `docs/adr/` holds only README. |
| Status | Draft (retrofit) |

---

## 1. Async sources (state surface)

| ID | User action or data source | Kind | Expected duration | Independent section? |
|---|---|---|---|---|
| S1 | 3s poll: `GET /api/chat`, `/api/sessions`, `/api/drafts`, `/api/compose`, `/api/prefs`, `/api/seen` (W:1295-1351) | background fetch | <300 ms local; every 3 s; 8×500 ms burst after send (W:1499) | N — one poll, failures swallowed (inferred — needs owner verdict) |
| S2 | Action POSTs: `/api/chat`, `/api/chat-cancel`, `/api/chat-interject`, `/api/drafts` (add/update/delete/restore/send) via `withBusy` (W:328-338) | user action | <1 s; button unlocks after 8 s | Y — per button |
| S3 | Hook relay `POST /api/status` (UserPromptSubmit / PreToolUse / PostToolUse / Stop / Notification / MessageDisplay) (HR:78-146) | background (agent side) | event-driven | Y (session status region) |
| S4 | Watcher `wait-review.mjs` polling 1 s, writes `delivered.json` and `watch-<sid>.json` (WR) | background (agent side) | indefinite; exits after delivery | Y |
| S5 | Debounced writes: `/api/compose` (400 ms), `/api/prefs`, `/api/seen`, drafts card autosave (800 ms) | background write | <300 ms | Y |
| S6 | Push: `/api/push-key`, `-subscribe`, `-unsubscribe`, `-test`, `-prefs`, `-viewing` (15 s heartbeat) + browser permission + SW | user action + background | permission prompt is user-paced | Y (settings dialog) |
| S7 | Reload token poll `GET /api/widget-version` every 5 s (W:2319-2338) | background fetch | 5 s | Y |
| S8 | Review page `GET/POST /api/feedback?round=` (autosave), `GET /api/watch` (RP:398, RP:422-466) | user action + background | <300 ms | Y (review page) |
| S9 | Codex transcript tail `GET /api/transcript?session=` (H:556) | background fetch | per poll | N (merged into list) |
| S10 | Element picking (local DOM hit-testing, no network) (W:1382-1464) | user action | user-paced | N/A — local only |

---

## 2. States, transitions and coverage (core)

### 2.1 State inventory

#### R1 — User message lifecycle (`chat.json` entry `from:'user'`, non-terminal, with `to`)

| ST ID | Meaning / region | Source conditions | Work / persistence state | SC refs | Resolution / verdict |
|---|---|---|---|---|---|
| ST-01 | Composing — text in the input for the active session tab | S5 (compose.json) | Local text, saved per session to server after 400 ms; flushed on tab switch / pagehide / reload (W:2123-2161) | SC-07 | Draft |
| ST-02 | Sending — submit pressed, button spinning (↻), waiting for server 200 | S2 | Text still in input; `cid` assigned (W:328-338); not yet in chat.json or uncertain | SC-07 | Draft — owner rejected optimistic UI (#1270, #1271) |
| ST-03 | Sent, unread ("held") — floats at list bottom, read mark "안 읽음" with substates: "(곧 읽음)" watcher active, "(작업 중이라 끝나면 읽음)" session working, plain (W:1610-1617, W:753) | S1, S3, S4 | Acknowledged saved (chat.json); not delivered | SC-05 | Draft — owner asked for hold-then-drop (#661, verified #666, #698) |
| ST-04 | Sent, unread, interject — "(다음 단계에서 바로 읽음)" (orange) | S1, S3 | Saved with `interject:true`; awaiting PostToolUse | SC-05 | Draft — explicit interject only (#792, #794) |
| ST-05 | Delivered / read — "읽음"; placed at read time (`_read`/`_at`), or at send time if read >1 h later (W:755) | S1, S4 | Saved; `delivered.json` has id / `_at` | SC-05 | Draft — read time = actual read moment only (#823-#829) |
| ST-06 | Cancelled — struck-through trace "보내기 취소함", never delivered | S2 | `cancelled` timestamp in chat.json; no delete (#1117, #1119) | SC-05 | Draft — cancel stays a trace (#1113-#1119) |
| ST-07 | Cancelled and moved to hold — trace stays; an ST-10 hold item exists with `fromMsg` | S2 | Hold item carries reply/ref/location (#1403, built #1409) | SC-05, SC-06 | Draft |
| ST-08 | Resend editing — original read bubble turned into an inline editor (W:1001-1046) | local; `__uifb_edit` | Edit text + caret kept in localStorage for 1 s cadence (W:2345-2364) | SC-05 | Draft — resend edits in bubble (#766) |
| ST-09 | Resent marker — orthogonal flag on a new entry (`resendOf`) that then follows ST-03 → ST-05; original unchanged (H:285) | S2 | Saved | SC-05 | Draft |

#### R2 — Hold item (`drafts.json` entry with `hold:true`)

| ST ID | Meaning | Source conditions | Work / persistence state | SC refs | Resolution / verdict |
|---|---|---|---|---|---|
| ST-10 | Held — dashed bubble at list bottom; never sent until an explicit send | S1, S2 | Saved server-side (drafts.json); carries reply/ref/location | SC-06 | Draft — multiple stacked holds (#1122, #1124) |
| ST-11 | Hold editing — inline editor in the hold bubble; other actions remain available (#1238) | local; `__uifb_edit` | Unsaved edit kept in localStorage; saved on 저장 or before move/send | SC-06 | Draft |

Hold area fold (`보류 N개` folded/unfolded) is a view flag persisted per session (prefs.fold) — not a separate item state.

#### R3 — Draft item (`drafts.json` entry without `hold`)

| ST ID | Meaning | Source conditions | Work / persistence state | SC refs | Resolution / verdict |
|---|---|---|---|---|---|
| ST-12 | Draft — card in drafts sheet under a label for a session | S1, S2, S5 | Saved; card text autosaved 800 ms (W:1811-1814); stamped commit/device/location | SC-12 | Draft |
| ST-13 | Draft checked — selected for "선택한 N개 한 번에 보내기" | local; `__uifb_sheet` | Checked set kept per browser across reload (W:1962-1963) | SC-12 | Draft |

#### R4 — Trash item (`drafts.json` `trash[]`, 7 days)

| ST ID | Meaning | Source conditions | Work / persistence state | SC refs | Resolution / verdict |
|---|---|---|---|---|---|
| ST-14 | Trash — sent (`gone:'sent'`, `msgId`) | S2 | Saved | SC-12 (recent sent/deleted section) | Draft (#908, built #914) |
| ST-15 | Trash — deleted (`gone:'deleted'`) | S2 | Saved; undo toast 되살리기 ~6 s | SC-12, SC-16 | Draft |
| ST-16 | Expired — older than 7 days, filtered on read, dropped on next write (H:395-404) | S1 | Gone | — | Draft (inferred — needs owner verdict: 7-day window never stated as an owner number) |

#### R5 — Session status (`status-<sid>.json`, Claude sessions)

| ST ID | Meaning | Source conditions | Work / persistence state | SC refs | Resolution / verdict |
|---|---|---|---|---|---|
| ST-17 | Idle | S3 | — | SC-01, SC-03, SC-04 | Draft |
| ST-18 | Working ("생각하는 중" or current tool label) | S3 | — | SC-01, SC-03, SC-04, SC-05 typing row | Draft (#32, built #52/#54) |
| ST-19 | Permission — waiting for approval (amber) | S3 | — | SC-01, SC-04, SC-05 | Draft |
| ST-20 | Stale working — working with no status change ≥5 min ("N분째 그대로"); one stale push | S3 + clock | Display-only (W:816-818); server push once (H:169-177) | SC-05 | Draft — agent-initiated, not owner-requested, unverified on screen (part2 F8, #683) |
| ST-21 | Unknown — non-idle older than 30 min, or no status file (H:74-80) | S3 + clock | — | SC-04 | Draft (inferred — needs owner verdict) |

Codex sessions have no hook status; they show without working state (#52 F8 "Claude Code only").

#### R6 — Watcher (`watch-<sid>.json`)

| ST ID | Meaning | Source conditions | Work / persistence state | SC refs | Resolution / verdict |
|---|---|---|---|---|---|
| ST-22 | Active — `wait-review` running with live pid; header "바로 전달됩니다" | S4 | — | SC-03, SC-04 (green dot) | Draft — always-on watcher (#141-#151, #187-#189) |
| ST-23 | Handling — watcher exited after delivering; agent working on it, up to 10 min | S4 | — | SC-03 | Draft (inferred — needs owner verdict on 10-min window) |
| ST-24 | Off — no watcher; "not auto-delivered" hint after last user message (W:1066-1073) | S4 | Messages stay ST-03 | SC-03, SC-05 | Draft |
| ST-25 | Queue — Codex session, always treated as active via `codex queue` (H:70) | config | — | SC-04 | Draft (#194-#216) |

#### R7 — Panel (per browser)

| ST ID | Meaning | Source conditions | Work / persistence state | SC refs | Resolution / verdict |
|---|---|---|---|---|---|
| ST-26 | Closed — launcher (+ outer ↻) visible | local; `__uifb_open` | Open state per browser (#477, #479) | SC-01, SC-02 | Draft |
| ST-27 | Open — panel with tabs, list, compose; mobile full-screen | local | Scroll position per session (prefs.pos) | SC-03 … SC-10, SC-15 | Draft |
| ST-28 | Picking — pick hint bar; target [앱 화면 \| 대화창] | S10 | Not persisted (inferred — needs owner verdict: reload during pick drops pick mode) | SC-11 | Draft (#636-#646) |
| ST-29 | Drafts sheet open — all or one label | local; `__uifb_sheet` | Open label, checks, new-label text kept per browser | SC-12 | Draft (#513-#578) |
| ST-30 | Notification settings open | S6 | — | SC-13 | Draft |
| ST-31 | Reload waiting — cover "새로 고칠 거예요 · 지금 하던 것을 마치면 바로" while editing or a button is busy | S7 | All in-progress work intact | SC-14 | Draft (#1374, #1375) |
| ST-32 | Reloading — cover "새로 고치는 중이에요 · 잠시 손대지 마세요", ↻ spinning; compose flushed | S7 / user | Compose flushed to server before reload | SC-14 | Draft (#1219-#1225, #1391) |

#### R8 — Reply attachment (per browser, `__uifb_reply`)

| ST ID | Meaning | Source conditions | Work / persistence state | SC refs | Resolution / verdict |
|---|---|---|---|---|---|
| ST-33 | None | local | — | SC-07 | Draft |
| ST-34 | Selection pending — text selected inside a message body; pill "↩ 답장 \| 📎 참고" shown | local | Not persisted (inferred — needs owner verdict) | SC-09 | Draft (#1351-#1363) |
| ST-35 | Reply, whole message (grey quote) | local | localStorage; survives reload (#1405, #1429 → #1432) | SC-08 | Draft (#737, #749) |
| ST-36 | Reply, selected part (yellow quote + highlight) | local | same | SC-08 | Draft (#868-#885) |
| ST-37 | Reference, whole message (dashed; "답장 아님") | local | same | SC-08 | Draft (#1247-#1254) |
| ST-38 | Reference, selected part | local | same | SC-08 | Draft |

#### R9 — Location attachment (per browser, `__uifb_where`)

| ST ID | Meaning | Source conditions | Work / persistence state | SC refs | Resolution / verdict |
|---|---|---|---|---|---|
| ST-39 | None | local | — | SC-07 | Draft |
| ST-40 | Attached — "위치: …" bar (url, selector, text, rect, viewport) | S10 | localStorage; survives reload (#1433-#1438) | SC-10 | Draft |

#### R10 — Push subscription and viewing (per device)

| ST ID | Meaning | Source conditions | Work / persistence state | SC refs | Resolution / verdict |
|---|---|---|---|---|---|
| ST-41 | Unsupported — insecure context / no SW / iOS not installed to home screen | S6 | — | SC-03 (bell) + SC-16 toast | Draft |
| ST-42 | Off — bell "🔕 알림" | S6 | — | SC-03 | Draft |
| ST-43 | On, not viewing — pushes sent per enabled kinds | S6 | push-subs.json (per device prefs) | SC-03, SC-13 | Draft (#1155-#1180) |
| ST-44 | On, viewing — panel open + visible + focused, heartbeat 15 s; "quiet while viewing" suppresses; "work" kind only for other tab | S6 | `viewingAt`, `viewingTab` | SC-03 | Draft (#1447-#1458) |

#### R11 — Agent answer read state (per session, `seen.json`) — added; not in the requested list

| ST ID | Meaning | Source conditions | Work / persistence state | SC refs | Resolution / verdict |
|---|---|---|---|---|---|
| ST-45 | Unread answer — tab badge, launcher badge, "(N)" title, "여기부터 새 메시지" line, indigo bar, to-bottom count | S1 | seen.json later-timestamp-wins | SC-01, SC-04, SC-05, SC-15 | Draft (#55, #59) |
| ST-46 | Seen | S1, S5 | Synced across app and review page (#325, #328) | SC-05 | Draft (#79, #83, verified #139) |

#### R12 — Review round (ui-review-page, `r<round>.json`)

| ST ID | Meaning | Source conditions | Work / persistence state | SC refs | Resolution / verdict |
|---|---|---|---|---|---|
| ST-47 | Open — some items without a verdict | S8 | Each verdict/memo autosaved | SC-17 | Draft |
| ST-48 | Rated — every item has a verdict, not yet done (count shown, RP:389) | S8 | Saved | SC-17 | Draft (inferred — needs owner verdict: the code does not gate "done" on all items rated) |
| ST-49 | Done — `done:true`; button disabled; summary posted to chat and session woken via `onDone` | S8 | Saved; irreversible in UI | SC-17 | Draft (#218-#223, #561-#572) |

### 2.2 Transitions

Columns: Before → After, trigger (actor), guard, effects, what is preserved across reload / network
failure, recovery, evidence. Verdict for every row: Draft (retrofit) unless stated.

#### R1 — User message

| TR ID | Before ST | Trigger / actor | Guard | After ST | Effects | Preserved across reload / network failure | Recovery / undo | Evidence |
|---|---|---|---|---|---|---|---|---|
| TR-01 | (empty) / ST-01 | Typing in input (user) | A session tab exists; else input disabled with "등록된 세션이 없습니다" (W:1179) | ST-01 | Compose saved per session after 400 ms; clear × appears | Text survives reload and is shared across screens (compose.json); just-sent text not restored (sentTexts + 2-min check, W:2140) | Clear × (#758) | W:2123-2161; #345 → #354; B11 part1; T82 |
| TR-02 | ST-01 | Enter / 보내기 (user) | Text non-empty; active session; button not busy | ST-02 | Button shows ↻ spinner; `cid` generated | Text stays in input until server 200 | — | W:1477-1486; #1267-#1274; T14 |
| TR-03 | ST-02 | Server 200 (system) | `cid` not already stored (dedupe) | ST-03 | Input cleared; reply/location attachment cleared; 8×500 ms fast re-poll | Message saved in chat.json | Cancel (TR-11) / 보류로 (TR-12) | H:252-299; W:1486-1499; #1270; T14 |
| TR-04 | ST-02 | POST fails or 8 s elapse (system) | — | ST-01 | Toast "보내지 못했어요. 글은 입력칸에 남겨 뒀어요"; button re-enabled | Text kept; same `cid` reused so a late success + retry yields one message | Press send again | W:336, W:1501-1502; #1270-#1271 (D14 part3); T30 |
| TR-05 | ST-01 | 끼워넣기 button (user) | Target is a Claude session in ST-18/ST-19; same text/session/busy guards as TR-02 | ST-02 → ST-04 | As TR-02/TR-03 with `interject:true` | As TR-02/TR-04 | As TR-04 | W:1169, W:1475-1476; #792, #794, verified #799/#808/#818 |
| TR-06 | ST-03 | Watcher `check()` marks delivered (system, S4) | Session status not ST-18/ST-19 (unless status >30 min old); delivered.json readable; message not cancelled | ST-05 | Read mark → "읽음"; bubble drops from bottom to its read-time position; delivered.json `_at`/`_read` | delivered.json atomic rename; skip-on-unreadable (F:38-54) | None — delivery is irreversible; resend via TR-14 | WR:74-127; F:31; #605 verified #607/#611; B21 #954-#961; B28 #1062; T54 (delivery simulated by fixture), T98 (placement) |
| TR-07 | ST-02 | Server accepts message for a Codex session (system) | Target tool = codex and not `noQueue` | ST-05 | `codex queue` called; marked delivered immediately | — | No cancel/interject for Codex | H:289, H:539; #194-#216 |
| TR-08 | ST-04 | PostToolUse hook injects message between tool calls (system, S3) | `interject`; delivered.json readable | ST-05 | Injected into running turn; marked delivered | As TR-06 | None | HR:97-114; #786-#818; B9 part2 #804 |
| TR-09 | ST-03 | "끼워넣기" toggle on a sent bubble (user) | Not delivered (`_at`), not Codex, not cancelled; button shown only if target ST-18/ST-19 | ST-04 | `interject:true` saved | Saved server-side | TR-10 | H:851-871; W:960-974; #1051 verified #1053/#1059 |
| TR-10 | ST-04 | "끼워넣기 취소" (user) | Same as TR-09 | ST-03 | `interject` removed | Saved | TR-09 | H:865-866 |
| TR-11 | ST-03 / ST-04 | "보내기 취소" (user) | User message, has `to`, not terminal, not delivered (`id <= d[to]` or `_at`), not Codex; else 409 shown via `alert()` | ST-06 | `cancelled` saved; strike-through text (not buttons, B20 part2) | Saved | No un-cancel; TR-13 moves it to hold | H:829-848; W:975-987; #832 verified #835/#841/#848; T54 (button visibility only) |
| TR-12 | ST-03 / ST-04 | "보류로" on unread (user) | Cancel succeeds (TR-11 guard); else alert "이미 읽혀서 보류로 돌리지 못했습니다" and re-poll | ST-07 (+ ST-10 created) | Cancel, then drafts add hold with cid `tohold-<id>` carrying reply/ref/location; toast "✓ 보류로 옮김" | Both writes saved; partial failure (cancel ok, hold add fails) leaves ST-06 (inferred — needs owner verdict) | Hold item can be sent again (TR-23) | W:988-998, W:351; #1407/#1410 built #1415; T70 |
| TR-13 | ST-06 | "보류로" on cancelled bubble (user) | No draft/trash item with `fromMsg === id` | ST-07 (+ ST-10 created) | As TR-12 without cancel | Saved | As TR-12 | W:947-958; #1231 built #1237 |
| TR-14 | ST-05 | "다시 보내기" (user) | Message read (button hidden while unread) | ST-08 | Bubble text becomes editable; focus to editor | Edit text, focused field and caret restored after reload (`__uifb_edit`) | TR-15 | W:1001-1046; #766; #1411 built #1419; #1405-#1446; T54 (visibility only); O1 part3 focus-jump root cause open |
| TR-15 | ST-08 | Cancel edit (user) | — | ST-05 | Editor closed, original unchanged | — | — | W:1001-1046 (inferred — needs owner verdict: cancel control label not confirmed in chat) |
| TR-16 | ST-08 | "다시 보내기" in editor (user) | Edited text non-empty; button not busy | ST-05 (original) + new entry ST-03 with ST-09 | New message with `resendOf`, tagged "다시 보냄"; session receives "[N]을(를) 사용자가 고쳐 다시 보낸 메시지" | As TR-02/TR-04 (busy + cid) | Cancel the new message (TR-11) | W:357, W:1038-1045; H:285; #766 verified #773-#775 |

#### R2 — Hold item

| TR ID | Before ST | Trigger / actor | Guard | After ST | Effects | Preserved across reload / network failure | Recovery / undo | Evidence |
|---|---|---|---|---|---|---|---|---|
| TR-17 | ST-01 | "보류" (user) | Text non-empty; valid `to`; cid dedupe; button not busy | ST-10 | Input cleared after 200; reply/ref/location carried; fly animation to hold (to fold header when folded) | On failure toast "담지 못했어요. 글은 입력칸에 남겨 뒀어요"; text kept | Delete (TR-21) | W:2030, W:2051; H:483-495; #1121-#1144; #1403 → #1409; #1307 → #1310 |
| TR-18 | ST-10 | "수정" (user) | — | ST-11 | Inline editor | Edit + caret restored after reload (`__uifb_edit`) | TR-19 | W:1132; #1227-#1238 |
| TR-19 | ST-11 | "저장" / "수정 취소" (user) | Save: text non-empty | ST-10 | Saved or discarded | Saved server-side | — | W:1117-1130 |
| TR-20 | ST-10 | Fold / unfold "보류 N개" (user) | — | ST-10 | View flag | Persisted per session (prefs.fold) | Toggle | W:1077-1085, W:2168; #1292 → #1296 (B9 part3) |
| TR-21 | ST-10 / ST-11 | "지우기" (user) | — | ST-15 | Toast "지움" + 되살리기 | Saved | Undo toast ~6 s or trash restore within 7 days (TR-31) | W:1133; H:512-517; #1227-#1237 |
| TR-22 | ST-10 / ST-11 | "보관함" (user) | Pending edit saves first | ST-12 | `hold:false`; toast "✓ 보관함으로 옮김" + "<label> 열기" | Saved | Move again | W:1134; H:503; #1243-#1246, #1306-#1308 |
| TR-23 | ST-10 / ST-11 | "보내기" (user) | Pending edit saves first | ST-03 (new message) + ST-14 | Sent as typed (no drafts formatting) | Saved | Cancel new message (TR-11) | W:1140; H:441-449 |
| TR-24 | ST-10 / ST-11 | "끼워넣기" (user) | Target Claude session in ST-18/ST-19 | ST-04 (new message) + ST-14 | As TR-23 with interject | Saved | TR-10 | W:1137-1139; #1229, #1239 |

#### R3 — Draft item

| TR ID | Before ST | Trigger / actor | Guard | After ST | Effects | Preserved across reload / network failure | Recovery / undo | Evidence |
|---|---|---|---|---|---|---|---|---|
| TR-25 | ST-01 | "▤ 보관함" (user) | Text non-empty; `to`; label = currently selected chip for this session | ST-12 | Input cleared; fly-into-button animation, count bump; toast "✓ 보관함에 담음" + "<label> 열기" | On failure text kept (W:2051) | Delete (TR-30) | W:2030, W:2049; H:483; #246/#250 built #267; #849-#854; #1134-#1144; #533 → #536 |
| TR-26 | ST-12 | Edit text (autosave 800 ms) / change label / change session / "다시 찍기" (user) | Session select only when >1 session; text non-empty | ST-12 | Saved; move shows toast "<label|session> 열기" and outlines moved card | Card text autosaved while typing; new-label input kept (`__uifb_sheet`) | Move back | W:1811-1868, W:1926; #968-#987; #500/#501 |
| TR-27 | ST-12 ↔ ST-13 | Checkbox / footer "전체" (user) | — | ST-13 / ST-12 | Footer "선택한 N개 한 번에 보내기" count | Checked set kept per browser (`__uifb_sheet`) | Uncheck | W:1781, W:1983; #1444 |
| TR-28 | ST-12 / ST-13 | "이것만 보내기" / "이 분류 모두 보내기" / "선택한 N개 한 번에 보내기" (user) | ids non-empty; button not busy | ST-14 + ST-03 (one combined numbered message per session+label) | Message carries `draft{label,items}`, location/time/commit/device context; toast "✓ N개 보냄 → <session>"; sheet closes when last item sent | Saved; cid dedupe | Restore from trash (TR-31); cancel message (TR-11) | W:1944-1949; H:451-477; #246/#250; #856-#861; O7 part3: combined send drops reply/ref (unverified) |
| TR-29 | ST-12 | Long-press label chip / "전체" (user) — opens sheet | — | see TR-48 | — | — | — | (navigation, see R7) |
| TR-30 | ST-12 | "지우기" (user) | — | ST-15 | Toast "지웠어요" + undo | Saved | Undo toast or TR-31 | W:1869-1872; #908 built #914 |

There is no UI transition ST-12 → ST-10 (draft back to hold). Gap, (inferred — needs owner verdict) whether wanted.

#### R4 — Trash item

| TR ID | Before ST | Trigger / actor | Guard | After ST | Effects | Preserved across reload / network failure | Recovery / undo | Evidence |
|---|---|---|---|---|---|---|---|---|
| TR-31 | ST-14 / ST-15 | "다시 담기" or toast undo (user) | Within 7 days | ST-12, or ST-10 when `hold` was set | Toast "✓ 다시 담음" | Saved | Delete again | H:519-525; W:1917; #908, #919-#922 |
| TR-32 | ST-14 / ST-15 | 7 days pass (system, on read) | `goneAt` > 7 days | ST-16 | Filtered; removed on next write | — | None | H:395-404 |

#### R5 — Session status

| TR ID | Before ST | Trigger / actor | Guard | After ST | Effects | Preserved across reload / network failure | Recovery / undo | Evidence |
|---|---|---|---|---|---|---|---|---|
| TR-33 | any | UserPromptSubmit hook (agent side) | Session registered under a cwd ancestor (B5 part2 #667-#683) | ST-18 | Working dots on launcher and tab; typing row; marks that session's earlier answers read (TR-74) | Status file on disk | — | HR:78-80; #32, #52 |
| TR-34 | ST-18 | PreToolUse hook | — | ST-18 | Tool label in typing row | — | — | HR:89-92 |
| TR-35 | any | Notification hook | Message matches permission/approve/승인/허용 | ST-19 | Amber dots; permission push | — | — | HR:120-124; #1096 verified #1098/#1102 |
| TR-36 | ST-18 / ST-19 | Stop hook | — | ST-17 | Done push after 3 s with last answer (deduped vs answer push, B15 part3); unblocks watcher delivery | — | — | HR:116-117; H:149; #1343 → #1346 verified #1349 |
| TR-37 | ST-18 | ≥5 min without status change (clock) | — | ST-20 | "N분째 그대로" hint; one stale push | — | — | W:816-818; H:169-177; part2 F8 unverified #683 |
| TR-38 | ST-18 / ST-19 / ST-20 | >30 min without update, or file missing (read time) | — | ST-21 | Watcher no longer blocked by stuck working | — | — | H:74-80 (inferred — needs owner verdict) |

#### R6 — Watcher

| TR ID | Before ST | Trigger / actor | Guard | After ST | Effects | Preserved across reload / network failure | Recovery / undo | Evidence |
|---|---|---|---|---|---|---|---|---|
| TR-39 | ST-24 / ST-23 | Agent starts `wait-review.mjs` | Session found; `--done` requires `--round` | ST-22 | Header "바로 전달됩니다"; unread marks "(곧 읽음)" | watch file with pid | — | WR:41-61; #141-#151 |
| TR-40 | ST-22 | Watcher exits 0 after delivering / review done | — | ST-23 | `state:'handling'`, `until` = now + 10 min | — | Agent re-arms (TR-39) | WR:93-98, WR:112-117; B2 part1 #42 → #43 |
| TR-41 | ST-23 | 10 min pass without re-arm (clock) | `until` < now | ST-24 | UI says not auto-delivered | — | Owner tells terminal to restart watcher | H:598-599; B22 part3 #1521-#1526 |
| TR-42 | ST-22 | SIGINT/SIGTERM, `--minutes` timeout, pid dead, `expiresAt` passed | — | ST-24 | As TR-41 | — | As TR-41 | WR:63-69, WR:135; H:602-603; O2 part1 #146, #189 |

#### R7 — Panel

| TR ID | Before ST | Trigger / actor | Guard | After ST | Effects | Preserved across reload / network failure | Recovery / undo | Evidence |
|---|---|---|---|---|---|---|---|---|
| TR-43 | ST-26 | Launcher click; peek toast click; notification click (`postMessage` / `#uifb-tab=`); restore `__uifb_open` after reload | — | ST-27 | Page scroll locked; Next.js devtools hidden; scroll to first unread / saved position / bottom; no autofocus on touch | Open state per browser; scroll pos per session (prefs.pos) | TR-44 | W:1353-1371, W:2340-2342, W:2381; #477/#479; #1455 → #1459 verified #1463 |
| TR-44 | ST-27 | Launcher / "닫기" (mobile) (user) | — | ST-26 | Viewing ends (TR-70) | Compose, attachments untouched | TR-43 | W:1353 |
| TR-45 | ST-27 | Tab switch (user) or synced tab from another device (system) | Remote tab applied only if no local switch in 5 s and no typing in 3 s | ST-27 | Compose flushed and swapped per session; labels per session | prefs.tab | Switch back | W:2090-2092; #346, #347, #355 |
| TR-46 | ST-27 | "위치 찍기" (user); segment [앱 화면 \| 대화창] | — | ST-28 | Panel hidden for app target; hover box | Not persisted (inferred — needs owner verdict) | 취소 / Esc (TR-47) | W:1382-1464; #636-#646 |
| TR-47 | ST-28 | Click target (→ ST-40), Esc, 취소 (user) | — | ST-27 | On pick: location attached (TR-64) | — | — | W:1424-1455; #640, #642 |
| TR-48 | ST-27 | "전체 N" chip / long-press label chip 0.5 s (user); restore `__uifb_sheet` | — | ST-29 | Drop-up sheet over compose area | Open label restored after reload | TR-49 | W:1964-1984, W:1631; #567-#578 (D34 part1) |
| TR-49 | ST-29 | "닫기 ▾" / same chip / tap list / last item sent (user/system) | — | ST-27 | — | — | TR-48 | W:1949, W:1981; #567 → #570 |
| TR-50 | ST-29 | Tap another label chip while open (user) | — | ST-29 (other label) | Switches the open label, not the save-to label | — | — | part2 F44 #988, unverified #989 |
| TR-51 | ST-27 | Bell when subscribed (user) | ST-43/ST-44 | ST-30 | Settings popover | — | TR-52 | W:2218-2252 |
| TR-52 | ST-30 | Bell / 닫기 / 알림 끄기 (user) | — | ST-27 | — | — | — | W:2242-2270 |
| TR-53 | any of ST-26 … ST-30 | ↻ in header or outer ↻ (user) | — | ST-32 | ↻ spins; cover shown; compose flushed; reload after 300 ms | Compose, reply, location, edits, sheet state, open state, scroll pos all restored | — | W:2299-2315; #1181-#1225, #1391 → #1393 |
| TR-54 | any of ST-26 … ST-30 | Reload token changed (agent ran `reload-widgets`) (system, S7) | No bubble/hold editing and no busy button | ST-32 | Cover; compose flushed; reload after 1.2 s | As TR-53 | — | W:2319-2338; H:676-677; #1374/#1375 (D17 part3); B18 part3 #1372; T117 |
| TR-55 | any of ST-26 … ST-30 | Reload token changed | Editing or a button busy | ST-31 | Cover "지금 하던 것을 마치면 바로"; re-check every 1 s | All in-progress work intact | — | W:2327-2333 |
| TR-56 | ST-31 | Editing ends and no busy button | — | ST-32 | As TR-54 | As TR-53 | — | W:2327-2336 |
| TR-57 | ST-32 | Page reload completes (system) | — | ST-26 or ST-27 (per `__uifb_open`) with R1/R3/R8/R9 restored | Restores compose (server), reply/ref, location, `__uifb_edit` (text + caret), `__uifb_sheet`, scroll pos | — | — | W:2340-2365, W:525-528, W:1466-1472; #1433-#1446 (D18 part3); T82, T117 |

Reload is never automatic on file change (#1374, #1375); T117 asserts this negative guard.

#### R8 — Reply attachment

| TR ID | Before ST | Trigger / actor | Guard | After ST | Effects | Preserved across reload / network failure | Recovery / undo | Evidence |
|---|---|---|---|---|---|---|---|---|
| TR-58 | ST-33…38 | "답장" / "참고" link on a message (user; hover-only on mouse) | — | ST-35 / ST-37 | Reply bar above input (dashed for reference) | `__uifb_reply` | × (TR-62) | W:928-942, W:513; #737/#749 verified #745-#750; #1247-#1254; T82 (참고) |
| TR-59 | ST-33…38 | Text selection inside a message body (user) | Selection within a body; iOS decides by press point (Safari fallback) | ST-34 | Pill "↩ 답장 \| 📎 참고" above compose row | Not persisted (inferred — needs owner verdict) | Clear selection (TR-61) | W:411-512; B16 part3 #1351-#1363 |
| TR-60 | ST-34 | Pill "↩ 답장" / "📎 참고" (user) | — | ST-36 / ST-38 | Quote highlighted yellow (Custom Highlight); input focus | `__uifb_reply` | × | W:459-512; #877-#885, #902-#904; #1255-#1265 |
| TR-61 | ST-34 | Selection cleared (user) | — | previous ST | Pill hides | — | — | W:490-512 (inferred — needs owner verdict) |
| TR-62 | ST-35…38 | × on reply bar (user); or successful send / hold / stash (system) | — | ST-33 | On hold/stash the attachment moves with the item | Carried into hold/draft (#1403 → #1409); NOT carried by combined drafts send (O7 part3) | Re-attach | W:513-528; #1403 |

#### R9 — Location attachment

| TR ID | Before ST | Trigger / actor | Guard | After ST | Effects | Preserved across reload / network failure | Recovery / undo | Evidence |
|---|---|---|---|---|---|---|---|---|
| TR-63 | ST-39 / ST-40 | Pick completes in ST-28 (user) | — | ST-40 | "위치: …" bar | `__uifb_where` | × (TR-64) | W:1424-1472; #1433 → #1443 |
| TR-64 | ST-40 | × (user); successful send / hold / stash (system) | — | ST-39 | Location travels with the message/item | Carried into hold/draft | Pick again | W:1466-1472 |

#### R10 — Push subscription and viewing

| TR ID | Before ST | Trigger / actor | Guard | After ST | Effects | Preserved across reload / network failure | Recovery / undo | Evidence |
|---|---|---|---|---|---|---|---|---|
| TR-65 | ST-42 | Bell (user) | Not secure / no SW / iOS not installed | ST-41 | Toast explains which (https / home-screen / unsupported) | — | Open via https or installed app | W:2271-2274 |
| TR-66 | ST-42 | Bell (user) | Permission granted; SW registers; subscribe ok | ST-43 | Test push sent; toast "✓ 알림을 켰어요…" | push-subs.json | 알림 끄기 (TR-67) | W:2275-2289; H:708-712; #1155-#1170 |
| TR-67 | ST-43 / ST-44 | "알림 끄기" (user) or endpoint 404/410 (system) | — | ST-42 | Toast "알림을 껐어요" | Subscription removed | TR-66 | W:2242-2248; H:138-142 |
| TR-68 | ST-43 / ST-44 | Kind checkboxes / quiet toggle (user) | Device subscribed (404 otherwise) | same | Per-device prefs | push-subs.json | Toggle back | H:697-702; #1175-#1180 (D7 part3) |
| TR-69 | ST-43 | Heartbeat every 15 s (system) | Panel open, page visible, focused | ST-44 | Quiet-while-viewing suppression; other-tab "work" pushes silent | `viewingAt` | — | W:2255-2263; H:703-705; #1447-#1458 |
| TR-70 | ST-44 | Blur / hidden / panel close / pagehide (immediate) or 30 s without heartbeat | — | ST-43 | Pushes resume | — | — | W:2264-2268; H:126; B14 part3 #1336 → #1337 verified #1340/#1342 |
| TR-71 | (OS) | Tap a push notification (user, external) | — | ST-27 on that session's tab | Focuses existing window or opens `#uifb-tab=` | — | — | SW:22-32; W:2381; #1455 → #1459 verified #1463 |

#### R11 — Agent answer read state

| TR ID | Before ST | Trigger / actor | Guard | After ST | Effects | Preserved across reload / network failure | Recovery / undo | Evidence |
|---|---|---|---|---|---|---|---|---|
| TR-72 | ST-46 | New agent answer arrives (system, S1) | — | ST-45 | Badges, "(N)" title; peek toast 5 s if panel closed; to-bottom count; answer push | seen.json unchanged | — | W:1188-1197, W:1260, W:1220; #28/#29, #45/#52, #1317 verified #1322 |
| TR-73 | ST-45 | Message fully visible in list (user scroll) | Panel open on that tab | ST-46 | Badges decrement; new-messages line remains until re-render | seen.json, later-timestamp-wins; synced app ↔ review page | — | W:1202 `markSeenVisible`; H:326; #79/#83 → #93, verified #139; B6 part1 |
| TR-74 | ST-45 | Owner talks to that session (terminal or widget) (user/system) | — | ST-46 | Earlier answers marked read | seen.json | — | H:297-298; #330 → #333 |

#### R12 — Review round

| TR ID | Before ST | Trigger / actor | Guard | After ST | Effects | Preserved across reload / network failure | Recovery / undo | Evidence |
|---|---|---|---|---|---|---|---|---|
| TR-75 | ST-47 / ST-48 | Verdict button / memo / overall comment (user) | — | ST-47, or ST-48 once all items rated | Autosave POST; count updates | r<round>.json per item (non-atomic write) | Change verdict | RP:356-402; RH:128-164 |
| TR-76 | ST-47 / ST-48 | "완료" (user) | Not already done | ST-49 | Button disabled; summary posted to chat; session woken (Claude watcher `--done` / Codex queue via `onDone`) | `done:true` persisted; reopening shows "이미 완료로 표시된 비교 페이지입니다…" | None in UI (one-way) | RP:455-478; RH:158; #218-#223; #561/#563 verified #572 |
| TR-77 | ST-47 / ST-48 | "완료" POST fails (system) | — | same | Note "저장 실패 — 서버가 켜져 있는지 확인하세요."; button re-enabled | Earlier autosaves kept | Press 완료 again | RP:465 |

### 2.3 Async-source state matrix

Compact form: one row per source, one column per state kind. "Pending" = not designed; needs an owner verdict.

| Source | Loading | Success | Error | Empty | Partial | Stale | Unauthorized | Offline |
|---|---|---|---|---|---|---|---|---|
| S1 poll | No loader; list shows last data (W:1295) | List/tabs/badges update; re-render only on key change | Swallowed; old data stays (inferred — needs owner verdict) | No sessions: input disabled "등록된 세션이 없습니다"; empty list: Pending | One endpoint fails, others apply (inferred — needs owner verdict) | Old list kept up to 3 s; status stale shown as ST-20/ST-21 | LAN key missing → server rejects before widget loads (see §9) | Nothing indicates offline — Pending (B2 part2: owner thought conversation was dead #582-#586) |
| S2 actions | ↻ spinner on the pressed button; 8 s unlock | Result visible (bubble, hold, card, toast) | Toast "처리하지 못했어요. 다시 눌러 주세요" / "보내지 못했어요…"; cancel/interject 409 via `alert()` | N/A — action | Two-step "보류로" (cancel then add) can half-complete (inferred — needs owner verdict) | N/A | As S1 | Same as Error after 8 s; text kept |
| S3 status | N/A | Dots, typing row, header line | Hook failure is silent (B5 part2) — Pending | No status file → ST-21 | Missing MessageDisplay chunks dropped silently (HR:137-145) — Pending | ST-20 (≥5 min) / ST-21 (>30 min) | N/A | N/A (local hooks) |
| S4 watcher | "(곧 읽음)" while active | "읽음" + drop animation | Watcher crash → ST-24 hint | N/A | N/A | ST-23 handling expires to ST-24 after 10 min | N/A | N/A |
| S5 compose/prefs/seen | None | Silent | Silent (inferred — needs owner verdict) | N/A | N/A | Cross-device timing guards (5 s tab, 3 s typing) | N/A | Local text stays in input; server copy may lag — Pending |
| S6 push | Bell busy during enable | Toast + test push | Toast "알림을 켜지 못했어요: <message>" (raw error text) | N/A | N/A | Subscription 404/410 → ST-42 silently | Permission denied toast | Pending |
| S7 reload token | N/A | Cover → reload | Fetch failure ignored | N/A | N/A | N/A | N/A | Token unchanged; no reload |
| S8 review | Pending (inferred: no loader) | Verdict pressed state | Done failure note (TR-77); item autosave failure: Pending | No items: Pending | Some items rated (ST-47) | N/A | N/A | Same as Error |
| S9 Codex transcript | None | Codex messages in list | Silent | N/A | N/A | Up to one poll | N/A | Pending |

### 2.4 Coverage ledger (authoritative)

No `flows.md` exists, so every Branch + J/F ref is Pending. Represented = the shipped GUI shows it
(code reference). Exercised: **Test** = automated test in `tests/chat.test.mjs` (effect asserted),
**Test-guard** = the test asserts only the guard / button visibility, not the effect,
**Owner** = owner verified in chat (#id), **Unverified** = no test and no owner confirmation found.
Diagram: none for any row. Owner-reviewed (this model): Pending for all rows.

| TR | Branch refs | SC refs | Represented | Exercised | Evidence of exercise |
|---|---|---|---|---|---|
| TR-01 | Pending | SC-07 | Y | Test | T82 (typed text survives reload) |
| TR-02 | Pending | SC-07 | Y | Test | T14, T30 |
| TR-03 | Pending | SC-05, SC-07 | Y | Test | T14 |
| TR-04 | Pending | SC-07, SC-16 | Y | Test | T30 |
| TR-05 | Pending | SC-07 | Y | Owner | #799, #808, #818 |
| TR-06 | Pending | SC-05 | Y | Test (widget side only; watcher not tested) + Owner | T54, T98; #607, #611 |
| TR-07 | Pending | SC-05 | Y | Unverified | Codex wake confirmed working #207/#214 is agent-reported |
| TR-08 | Pending | SC-05 | Y | Owner | #799, #808, #818 |
| TR-09 | Pending | SC-05 | Y | Owner | #1053, #1059 |
| TR-10 | Pending | SC-05 | Y | Owner | #1053, #1059 (inferred — needs owner verdict: off-toggle specifically) |
| TR-11 | Pending | SC-05 | Y | Test-guard + Owner | T54; #835, #841, #848 |
| TR-12 | Pending | SC-05, SC-06 | Y | Test | T70 |
| TR-13 | Pending | SC-05, SC-06 | Y | Unverified | — |
| TR-14 | Pending | SC-05 | Y | Test-guard + Owner | T54; #773-#775 |
| TR-15 | Pending | SC-05 | Y | Unverified | — |
| TR-16 | Pending | SC-05 | Y | Owner | #773-#775 |
| TR-17 | Pending | SC-06, SC-07 | Y | Owner | #1128-#1131 (M14 part3) |
| TR-18 | Pending | SC-06 | Y | Unverified | — |
| TR-19 | Pending | SC-06 | Y | Unverified | — |
| TR-20 | Pending | SC-06 | Y | Unverified | — |
| TR-21 | Pending | SC-06, SC-16 | Y | Unverified | — |
| TR-22 | Pending | SC-06 | Y | Unverified | — |
| TR-23 | Pending | SC-06 | Y | Unverified | — |
| TR-24 | Pending | SC-06 | Y | Unverified | — |
| TR-25 | Pending | SC-07, SC-12 | Y | Owner | #851, #853, #854 (animation accepted) |
| TR-26 | Pending | SC-12, SC-16 | Y | Unverified | Built #970-#987; no owner confirmation found |
| TR-27 | Pending | SC-12 | Y | Unverified | — |
| TR-28 | Pending | SC-12, SC-05 | Y | Owner | #572 context; bundle send used repeatedly (#511-#524) (inferred — needs owner verdict) |
| TR-29 | — | — | — | — | Navigation alias of TR-48; not counted |
| TR-30 | Pending | SC-12, SC-16 | Y | Unverified | — |
| TR-31 | Pending | SC-12 | Y | Unverified | — |
| TR-32 | Pending | — | N (silent) | Unverified | — |
| TR-33 | Pending | SC-01, SC-04, SC-05 | Y | Owner | #1098, #1102 |
| TR-34 | Pending | SC-05 | Y | Owner | #1098 (inferred — needs owner verdict: tool label specifically) |
| TR-35 | Pending | SC-01, SC-04 | Y | Owner | #1098, #1102 |
| TR-36 | Pending | SC-04 | Y | Owner | #1349 (done push dedupe) |
| TR-37 | Pending | SC-05 | Y | Unverified | #683 says unverified on screen |
| TR-38 | Pending | SC-04 | Y | Unverified | — |
| TR-39 | Pending | SC-03 | Y | Owner | #151, #189 |
| TR-40 | Pending | SC-03 | Y | Unverified | — |
| TR-41 | Pending | SC-03, SC-05 | Y | Owner (as failure) | #1521-#1526 |
| TR-42 | Pending | SC-03, SC-05 | Y | Unverified | — |
| TR-43 | Pending | SC-01, SC-03 | Y | Owner | #1463 (notification entry); #479 |
| TR-44 | Pending | SC-03 | Y | Unverified | — |
| TR-45 | Pending | SC-04 | Y | Unverified | — |
| TR-46 | Pending | SC-11 | Y | Owner | #645, #646 |
| TR-47 | Pending | SC-11 | Y | Owner | #645, #646 |
| TR-48 | Pending | SC-07, SC-12 | Y | Unverified | Built #578; haptic untested (O9 part1) |
| TR-49 | Pending | SC-12 | Y | Unverified | — |
| TR-50 | Pending | SC-12 | Y | Unverified | #989 says unverified |
| TR-51 | Pending | SC-13 | Y | Unverified | — |
| TR-52 | Pending | SC-13 | Y | Unverified | — |
| TR-53 | Pending | SC-02, SC-03, SC-14 | Y | Owner | #1225 |
| TR-54 | Pending | SC-14 | Y | Test | T117 |
| TR-55 | Pending | SC-14 | Y | Unverified | — |
| TR-56 | Pending | SC-14 | Y | Unverified | — |
| TR-57 | Pending | SC-14, SC-07, SC-08 | Y | Test (compose + reference only) + Owner | T82, T117; #1217 ("거의 그대로"), #1444-#1446 |
| TR-58 | Pending | SC-05, SC-08 | Y | Test (reference) + Owner | T82; #745, #748, #750 |
| TR-59 | Pending | SC-09 | Y | Owner | #1363 |
| TR-60 | Pending | SC-09, SC-08 | Y | Owner | #879, #881, #885, #1265 |
| TR-61 | Pending | SC-09 | Y | Unverified | — |
| TR-62 | Pending | SC-08 | Y | Unverified | #1409 built; no owner confirmation |
| TR-63 | Pending | SC-10 | Y | Owner | #645 |
| TR-64 | Pending | SC-10 | Y | Unverified | — |
| TR-65 | Pending | SC-03, SC-16 | Y | Unverified | — |
| TR-66 | Pending | SC-03 | Y | Owner (implied by later push tests) | #1340, #1342 |
| TR-67 | Pending | SC-13 | Y | Unverified | — |
| TR-68 | Pending | SC-13 | Y | Owner | #1458 (quiet other-session push) |
| TR-69 | Pending | — (invisible) | N | Owner | #1340, #1342 |
| TR-70 | Pending | — (invisible) | N | Owner | #1340, #1342 |
| TR-71 | Pending | SC-04 (external entry) | Y | Owner | #1463 |
| TR-72 | Pending | SC-01, SC-04, SC-15 | Y | Owner | #1322 (to-bottom count); #52 |
| TR-73 | Pending | SC-05 | Y | Owner | #139 |
| TR-74 | Pending | SC-04 | Y | Unverified | — |
| TR-75 | Pending | SC-17 | Y | Unverified | No URP tests |
| TR-76 | Pending | SC-17 | Y | Owner | #572 |
| TR-77 | Pending | SC-17 | Y | Unverified | — |

Summary: 76 counted transitions (TR-29 is an alias). Test or Test-guard: 11 (TR-01, 02, 03, 04, 06, 11, 12, 14, 54, 57, 58; TR-11 and TR-14 assert the guard only). No automated test: 65. Of those, owner-verified in chat: 29; unverified: 36.

---

## 3. Loading rules

### 3.1 Loader selection

| Situation | Choice | Rationale |
|---|---|---|
| Any server-sending button (send, interject, hold, stash, cancel, resend, drafts send, restore) | Inline ↻ spinner on that button; unlock after 8 s | Owner rejected optimistic UI (#1270, #1271); same symbol as reload (#1297) |
| Reload | Full cover + spinning ↻ | Owner wants to know not to touch anything (#1374, #1375, #1391) |
| Background poll | No loader | <1 s, every 3 s |
| Review page autosave | No loader; pressed state | <1 s (inferred — needs owner verdict) |

Optimistic UI is not used for sends (adopted by owner correction #1270).

### 3.2 Wait-time thresholds

| Duration | Consider | Value for this feature |
|---|---|---|
| < 1s | Immediate control/result feedback | Send → bubble after 200; fast re-poll 8×500 ms for read mark |
| 1–5s | Busy control | Button ↻ |
| 5–10s | Retain context | 8 s unlock with text kept |
| > 10s | Honest indeterminate feedback | Unread message read mark explains why ("작업 중이라 끝나면 읽음"); stale hint at 5 min |
| On failure | Surface as soon as known | Toast keeps text; but network loss of the poll is not surfaced (Pending) |

---

## 4. Error rules

### 4.1 Error inventory

| ID | Trigger | ① What happened | ② Why | ③ What to do next | Placement |
|---|---|---|---|---|---|
| E1 | Send POST fails / 8 s timeout | "보내지 못했어요" | Missing | "글은 입력칸에 남겨 뒀어요" (implied retry) | Toast |
| E2 | Generic action fails (`withBusy`) | "처리하지 못했어요" | Missing | "다시 눌러 주세요" | Toast |
| E3 | Cancel after delivery (409) | "세션이 이미 받아 가서 취소할 수 없습니다." | Included | Missing | `alert()` — inconsistent with toasts (code.md §5) |
| E4 | Interject after delivery (409) | "세션이 이미 받아 갔습니다." | Included | Missing | `alert()` |
| E5 | 보류로 after delivery | "이미 읽혀서 보류로 돌리지 못했습니다." | Included | Missing | `alert()` |
| E6 | Hold/stash add fails | "담지 못했어요" | Missing | "글은 입력칸에 남겨 뒀어요" | Toast |
| E7 | Push unsupported | Context-specific | Included | Included (https / home screen) | Toast |
| E8 | Push enable fails | "알림을 켜지 못했어요: <raw message>" | Raw error text | Missing | Toast — raw exception surfaced (violates §4.3) |
| E9 | Review done save fails | "저장 실패" | "서버가 켜져 있는지 확인하세요" | Re-press (button re-enabled) | Inline note |
| E10 | Server unreachable during poll | Nothing shown | — | — | Pending — silent failure (B2 part2) |
| E11 | Hook relay fails / status stuck | Only ST-20/ST-21 after 5/30 min | — | — | Pending |

### 4.2 Placement rules

Template defaults apply. Retrofit gap: E3–E5 use `alert()` (modal without a way forward). Pending owner verdict.

### 4.3 Prohibitions

- [ ] No raw exception in UI — fails for E8
- [ ] No silent failures — fails for E10, E11, S5 writes
- [ ] Every error offers recovery — E3–E5 do not
- [x] Failure is never hidden behind a long loading state — 8 s cap

---

## 5. Empty states

| ID | Which emptiness | What this area is for | Why it is empty | Next action |
|---|---|---|---|---|
| EM1 | No registered session | Talking to sessions | No session registered | Input placeholder "등록된 세션이 없습니다"; no next action shown — Pending |
| EM2 | Drafts box empty | Notes to send later | Nothing stashed | Copy says press "나중에" but button is now "보관함" — stale copy (W:1738) |
| EM3 | Session tab with no messages | Conversation | New session | Pending (not designed) |
| EM4 | Hold area empty | — | — | Area hidden (N/A) |
| EM5 | Review page with no items | — | — | Pending |

---

## 6. Success feedback

| Action | Stakes | Feedback |
|---|---|---|
| Send | Low | Bubble appears; input clears; read mark updates |
| Hold / stash | Low | Fly animation + toast with "<label> 열기" |
| Move draft | Low | Toast + outline on moved card |
| Drafts send | Medium | Toast "✓ N개 보냄 → <session>" |
| Cancel | Medium | Strike-through trace |
| Review done | High | Button disabled + note; summary in chat |
| Push enabled | Low | Toast + test push |

---

## 7. Partial loading and graceful degradation

```
Panel
├─ Tabs + status: from S1 sessions + S3 status (no own error)
├─ Message list: S1 chat + S9 Codex transcripts (no own error)
├─ Hold area / drafts sheet: S1 drafts (no own error)
└─ Notification settings: S6 (toasts)
Review page
└─ Items: S8 (done error only)
```

- [x] No full-page loading screen
- [ ] One failed API call does not produce a full-page error — true, but it also produces no signal (Pending)
- [x] Stale-but-useful content kept during refresh
- [ ] Mixed states explicitly designed — Pending

---

## 8. Interruption, undo, and work preservation

Owner rule: "사용자가 원치 않게 새로고침될 수 있으니까 중간에 하던 것들은 무조건 보존" (#1435, #1438).

| Question | Answer |
|---|---|
| Cancel midway? | Send: unread message can be cancelled (TR-11) or moved to hold (TR-12); after delivery no cancel. Edits: 수정 취소 / cancel edit. |
| Leave or refresh mid-task? | Kept: compose (server, shared), reply/ref, location, bubble/hold edit text + caret, sheet label/checks/new-label text, open state, scroll pos, folds (TR-57). Not kept: pick mode, selection pill (inferred — needs owner verdict). Agent-initiated reload waits for editing/busy (TR-55). |
| Undo? | Delete hold/draft: toast undo ~6 s, then trash restore for 7 days. Send/cancel/review done: no undo. |
| Interrupted (crash, network drop)? | Send: text kept, cid dedupe (TR-04). Two-step "보류로" may half-complete. Non-atomic writes of drafts/prefs/compose/seen/push-subs: a parse error reads as empty and the next write overwrites (data-loss risk, code.md §5). |
| Same action twice? | cid dedupe on chat and drafts add; busy lock. |
| Concurrently from two places? | Cross-device timing guards; seen later-wins; delivered.json read-modify-write by three writers without a lock (lost-update risk); cancel vs watcher delivery TOCTOU race. Pending. |
| Already-completed target? | Cancel/interject on delivered → 409; 보류로 on cancelled checks `fromMsg`; review done twice → no second onDone. |

---

## 9. Authorization states

| Condition | What is shown | Next action |
|---|---|---|
| Unauthenticated (LAN without key cookie) | Server rejects; widget not loaded (inferred — needs owner verdict on what the page shows) | Open the `?k=` link |
| Insufficient permission | N/A — single owner | — |
| Expired token / ended session | Key cookie 30 days: same as unauthenticated. Agent session ended: watcher ST-24 hint | Re-open link / restart watcher |
| Resource owned by another user | N/A — single owner | — |
| Deleted or expired resource | Trash expired (ST-16): gone silently; unregistered session: tab disappears (inferred — needs owner verdict) | Pending |

---

## 10. Review gate

Not run. Critic Agent review is Pending.

---

## 11. Handoff to Screen Map and Moment Spec

| ST/TR refs | SC refs | Moment Spec candidate | Why |
|---|---|---|---|
| ST-03/ST-04, TR-06, TR-11, TR-12 | SC-05 | Y | Owner must judge "will it be read, and can I still take it back?" |
| TR-02 → TR-03 / TR-04 | SC-07 | Y | Waiting for server; double-press risk |
| TR-53 … TR-57 | SC-14 | Y | Owner cannot act; must trust preservation |
| ST-34, TR-59, TR-60 | SC-09 | Y | Selection on iOS is ambiguous (B16 part3) |
| ST-23 → ST-24 (TR-41) | SC-03, SC-05 | Y | Silent loss of auto-delivery |
| TR-76 | SC-17 | Y | One-way door |
| TR-28 | SC-12 | N | Routine |

---

## Provenance

- Template: `templates/state-model.md` (ux-process kit).
- Sources: code retrofit notes (2026-10-12), development chat retro parts 1–3, spot-checked against `W:1608-1618`, `H:66-80`, `H:594-606`, `H:826-872`, `W:2296-2340`, `RH:125-165`, `RP` done handling.
