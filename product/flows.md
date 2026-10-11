# Flows — `agent-chat-widget` + `ui-review-page`

Status: Retrofit draft 2026-10-12 — awaiting owner verdicts

> **Layer position:** `user-journeys` → **`flows`** → `state-model` → `screen-map` → `moment-spec` → `wireflow`
> **Structure:** use-case style — Main, Alternate, Exception. Not one giant flowchart.
>
> Retrofit: the product already ships. Main flows describe what the code does today
> (code.md, 2026-10-12); branch verdicts come from the owner's chat history (part 1–3).
> `#N` = global chat message number. Journeys `J-01..J-08` from `product/user-journeys.md`;
> terms from `GLOSSARY.md`. Lines marked "(inferred)" are read from code or reasoning,
> not from an owner message, and need confirmation.

Verdict vocabulary used in every branch row:

| Verdict | Meaning |
|---|---|
| `Adopted (owner, #ids)` | The owner asked for or approved this behavior in chat. "via bug report" = the owner reported the opposite as a bug, which fixes the expected behavior |
| `Rejected (owner, #ids)` | The owner turned this alternative down in chat |
| `Deferred (owner, #ids)` | The owner explicitly postponed it |
| `Built, no owner verdict` | The code does it, but the owner never decided it (often an agent-chosen rule or value) |
| `NEEDS VERDICT` | Gap or open question nobody decided. Not built, or built with unknown behavior |

Dimension codes (from `ux-edge-case-discovery`): Alt = alternate action, D1 cancel/escape,
D2 undo, D3 waiting, D4 empty/first-run, D5 authorization/expiry, D6 interruption/preservation,
D7 repetition/concurrency, D8 degradation/environment. Branch IDs `B-xx` are global and stable.

---

## 0. Meta

| Field | Value |
|---|---|
| Version / date | Retrofit draft 1 / 2026-10-12 |
| Status | Draft |
| Linked decisions | None yet (0 ADRs). Discovery DQ-01..12, LC-1..6 |
| Collaboration mode | Retrofit: agent draft reconstructed from chat and code; owner reviews and gives verdicts. Main flows are observed implementation, not proposals |
| ST/TR, SC/M refs | Pending — `state-model.md` and moment specs not yet linked. Every "ST/TR" cell is Pending until stage 3 |

---

## Flow index

| ID | Name | Serves journey | Status |
|---|---|---|---|
| F-01 | Send a message and see it read | J-01 | Draft |
| F-02 | Interject while the session works | J-02, J-01 | Draft |
| F-03 | Cancel an unread send / move it to Hold | J-02 | Draft |
| F-04 | Resend after read | J-03 | Draft |
| F-05 | Reply or reference (whole or part) | J-03 | Draft |
| F-06 | Hold area | J-02 | Draft |
| F-07 | Drafts box | J-02, J-06 | Draft |
| F-08 | Reload with preservation (manual ↻ and agent tool) | J-07 | Draft |
| F-09 | Notifications | J-04 | Draft |
| F-10 | Multi-session tabs and session-to-session messages | J-06 | Draft |
| F-11 | Watcher delivery and ordering (system flow) | J-01, J-02, J-07 | Draft |
| F-12 | Review page round | J-05 | Draft |
| F-13 | App proxy setup and access key | J-08, J-01 | Draft |
| F-14 | Catch up on unread answers | J-04, J-01 | Draft |
| F-15 | Location pick | J-01, J-02 | Draft |

Journey coverage: J-01 (F-01, F-02, F-11, F-13, F-14, F-15), J-02 (F-02, F-03, F-06, F-07, F-11, F-15),
J-03 (F-04, F-05), J-04 (F-09, F-14), J-05 (F-12), J-06 (F-07, F-10), J-07 (F-08, F-11), J-08 (F-13).

---

## F-01 — Send a message and see it read

| Field | Value |
|---|---|
| Serves journey | J-01 (stages 1–5) |
| Actor | Owner; watcher/session (system) |
| Precondition | App opened through the app proxy; at least one session registered |
| Trigger | Owner wants to tell a session something |
| State context | Pending (stage 3) |
| Success outcome | Message shows `읽음`, sits at its read time, and the answer arrives in the same tab |
| Moments produced | TBD (J-01 "안 읽음 suffix" moment) |

### Main flow

| # | Actor | Step | System response |
|---|---|---|---|
| 1 | Owner | Taps `대화/피드백` | Panel opens (full screen on phone, no autofocus on touch); list scrolls to first unread / saved position / bottom |
| 2 | Owner | Picks a session tab | Mode line shows that session's state (e.g. `<name>에게 보냅니다. 바로 전달됩니다.`) |
| 3 | Owner | Types | Text saved per session on the server (400 ms debounce) |
| 4 | Owner | Presses `보내기` | Button shows spinning `↻` until the server accepts; then input clears and the bubble appears held at the bottom as `안 읽음(곧 읽음)` with a delivery hint |
| 5 | System | Watcher picks the message up (F-11) | Mark becomes `읽음`; bubble drops into the timeline at its read time |
| 6 | System | Session answers | Answer appears; if the owner was at the bottom, the list shows the answer's top |

### Alternate flows

| ID | Dim | From | Condition | Path now | Rejoins | Verdict |
|---|---|---|---|---|---|---|
| B-01 | Alt | 4 | Enter instead of `보내기` | Enter sends, Shift+Enter newline, IME-safe | 4 | Built, no owner verdict |
| B-02 | Alt | 4 | Session is working | `안 읽음(작업 중이라 끝나면 읽음)`; delivered after work ends | 5 | Adopted (owner, #792, #794) |
| B-03 | Alt | 4 | Target is a Codex session | Queued with `codex queue` at once and shown `읽음` immediately, though Codex may not have read it yet (inferred) | 6 | Built, no owner verdict (reachability adopted #196, #216; meaning of "read" for Codex never decided) |
| B-04 | Alt | 2 | Owner types in the terminal instead | Message appears tagged `터미널`; that session's earlier answers count as read | 6 | Adopted (owner, #330) |
| B-05 | Alt | 6 | Owner is reading history when the answer arrives | Position kept; `↓` turns indigo with a count | 6 | Adopted (owner, #776, #1210, #1317) |
| B-06 | Alt | 6 | Answer is long | List shows the answer's top, not its bottom | end | Adopted (owner, #776) |
| B-07 | D1 | 3 | Owner wants to discard what he typed | `×` (`입력칸 비우기`) clears input and its synced draft | 3 | Adopted (owner, #758) |
| B-08 | Alt | 4 | Show the bubble before the server accepts (optimistic send) | Not built | — | Rejected (owner, #1270, #1271) |

### Exception flows

| ID | Dim | From | Condition | Path now | Terminates in | Verdict |
|---|---|---|---|---|---|---|
| B-09 | D3/D8 | 4 | Server slow or request fails | Spinner; text kept; failure toast; button re-pressable after 8 s; client id prevents a duplicate | recovery at 4 | Adopted (owner, #1267, #1270, #1271, #1275) |
| B-10 | D3 | 4 | Choice of the 8 s unlock threshold | Agent-chosen value | recovery at 4 | Built, no owner verdict |
| B-11 | D7 | 4 | Double press or retry after timeout | One message only (client id dedupe) | step 5 | Adopted (owner, #1270, #1271) |
| B-12 | D4 | 4 | Input empty or whitespace | Nothing happens, no feedback | step 3 | Built, no owner verdict |
| B-13 | D4 | 1 | First run: no session registered | Input disabled; no guidance on how to register (inferred from code) | acknowledged dead end | NEEDS VERDICT |
| B-14 | D4 | 1 | Terminal history from before registration | Not shown in the panel | acknowledged dead end | NEEDS VERDICT (DQ-11; raised #6, #10, never decided) |
| B-15 | D3 | 4 | No watcher running | Hint `자동으로 전달되지 않습니다. …` under the last own message; recovery in F-11 (B-158, B-159) | recovery via F-11 | Adopted (owner, #42 — via bug report on the earlier misleading hint) |
| B-16 | D3 | 5 | Same working status for 5+ min | `N분째 그대로예요. 답이 안 오면 터미널을 확인해 주세요` | recovery in terminal | Built, no owner verdict (agent-initiated; unverified on screen, #683) |
| B-17 | D8 | any | Chat server unreachable (network change, server stopped, chat server down behind a running proxy) | Polls fail; list stays as last loaded; no offline indicator (inferred from code) | acknowledged dead end — looks "dead" (#582) | NEEDS VERDICT |
| B-18 | D8 | 1 | Phone changes network | Stable address via private tailnet | step 1 | Adopted (owner, #587, #617, #629) |
| B-19 | D8 | 3 | iOS: zoom on input, keyboard on open, page dragging behind panel | 16 px inputs, no autofocus on touch, background scroll locked, panel fits visual viewport | step 3 | Adopted (owner, #467, #469, #471, #1204) |
| B-20 | D8 | 1 | More than 120 messages | Only the last 120 render; older history unreachable in the panel | acknowledged dead end | NEEDS VERDICT (peer session asked #1388, unanswered) |
| B-21 | D6 | 4 | Reload or app backgrounded during send | Agent reload waits while a send is busy; compose kept on server; already-sent text not refilled | recovery at 4 | Adopted (owner, #1202, #1267, #1372, #1374) |
| B-22 | D7 | 3 | Typing on two devices at once | Compose text shared; last typing wins after a 3 s guard | step 3 | Built, no owner verdict (sharing itself adopted #345, #346) |

**Enumeration:** Alt B-01..B-08 · Cancel B-07 · Undo → F-03 (cancel unread) · Error B-09, B-10 · Wait B-15, B-16 · Empty B-12..B-14 · Unauthorized → F-13 (B-190, B-191) · Interrupted B-21 · Repeat/concurrent B-11, B-22 · Degradation B-17..B-20.

---

## F-02 — Interject while the session works

| Field | Value |
|---|---|
| Serves journey | J-02 (stage 2), J-01 |
| Actor | Owner; hook relay (system) |
| Precondition | Target is a Claude Code session in working or permission state |
| Trigger | Owner wants the agent to see something before the current work ends |
| State context | Pending (stage 3) |
| Success outcome | The agent reads the message between tool calls, and the bubble sits at that read time |
| Moments produced | TBD (J-02 "route choice" moment) |

### Main flow

| # | Actor | Step | System response |
|---|---|---|---|
| 1 | System | Session is working | Orange `끼워넣기` appears next to `보내기` |
| 2 | Owner | Types and presses `끼워넣기` | Spinner until accepted; bubble held as `안 읽음(다음 단계에서 바로 읽음)` |
| 3 | System | Next tool call ends | PostToolUse hook injects the message; read time recorded |
| 4 | System | — | Bubble shows `읽음` and drops in at its read time |

### Alternate flows

| ID | Dim | From | Condition | Path now | Rejoins | Verdict |
|---|---|---|---|---|---|---|
| B-23 | Alt | 2 | Interject every message automatically while working (terminal-like) | Not built; plain `보내기` waits | — | Rejected (owner, #792, #794) |
| B-24 | Alt | 2 | Message already sent as plain and still unread | `끼워넣기` toggle on the bubble; `끼워넣기 취소` turns it back | 3 / F-01 step 5 | Adopted (owner, #1051) |
| B-25 | Alt | 3 | Session awaits approval | Button stays; injection happens at the next tool call after approval (inferred) | 3 | Built, no owner verdict |
| B-26 | D3 | 3 | Work ends before another tool call | Watcher delivers it after the Stop (inferred) | F-01 step 5 | Built, no owner verdict |
| B-27 | D3 | 3 | One tool call runs for minutes | Mark stays `다음 단계에서 바로 읽음`; no sign of how long | 3 | Built, no owner verdict |
| B-28 | Alt | 4 | Placement of interjected messages | By actual read time; agent's 5 s ordering rule deleted | 4 | Adopted (owner, #819, #821, #823, #829) |

### Exception flows

| ID | Dim | From | Condition | Path now | Terminates in | Verdict |
|---|---|---|---|---|---|---|
| B-29 | D7 | 2 | `끼워넣기 취소` pressed after the hook already injected | Server refuses; shown by a browser `alert()`, unlike toasts elsewhere | recovery: bubble shows `읽음` | NEEDS VERDICT |
| B-30 | D7 | 1 | Status lag: button visible but session just went idle | Message stays pending and the watcher delivers it as plain (inferred) | F-01 step 5 | Built, no owner verdict |
| B-31 | D8 | 1 | Target is a Codex session | No `끼워넣기`, no `보내기 취소`, no live status (Codex has no hooks) | acknowledged dead end | NEEDS VERDICT (NG-9 is inferred, never requested or rejected) |

**Enumeration:** Alt B-23..B-28 · Cancel B-24 · Undo B-24 · Error B-29 · Wait B-26, B-27 · Empty: button hidden when idle (by design, B-23) · Unauthorized: N/A (same session access as F-01) · Interrupted: reload waits while busy (B-21) · Repeat/concurrent B-29, B-30 · Degradation B-31.

---

## F-03 — Cancel an unread send / move it to Hold

| Field | Value |
|---|---|
| Serves journey | J-02 (stage 3) |
| Actor | Owner |
| Precondition | Own message to a Claude session, not yet read |
| Trigger | Owner changes his mind before the agent reads it |
| State context | Pending (stage 3) |
| Success outcome | The agent never receives it; a trace remains |
| Moments produced | TBD (J-02 "racing the agent to cancel" moment) |

### Main flow

| # | Actor | Step | System response |
|---|---|---|---|
| 1 | Owner | Sees `보내기 취소` and `보류로` on the unread bubble | — |
| 2 | Owner | Presses `보내기 취소` | Server checks the message is still undelivered and marks it cancelled |
| 3 | System | — | Bubble struck through with `보내기 취소함`; stays as a trace; not delivered |

### Alternate flows

| ID | Dim | From | Condition | Path now | Rejoins | Verdict |
|---|---|---|---|---|---|---|
| B-32 | Alt | 2 | Owner wants to keep the text for later | `보류로` cancels and moves it to Hold in one action (keeps reply/reference/location) | F-06 step 3 | Adopted (owner, #1407, #1410) |
| B-33 | Alt | 3 | Already cancelled trace | `보류로` moves the trace's text to Hold | F-06 step 3 | Adopted (owner, #1231) |
| B-34 | D2 | 3 | Delete a cancelled trace | Not built | — | Rejected (owner, #1117, #1119) |
| B-35 | Alt | 2 | Cancel menu (back to input, to drafts box, bottom hold, per-cancel menu or default setting) | Not built; minimal set chosen | — | Rejected (owner, #1113, #1115) |
| B-36 | D2 | 3 | Resend or un-cancel a cancelled trace directly | Only via `보류로` → `보내기`; part 3 summary says the trace "can be resent later" — unclear which was meant | 3 | NEEDS VERDICT |

### Exception flows

| ID | Dim | From | Condition | Path now | Terminates in | Verdict |
|---|---|---|---|---|---|---|
| B-37 | D7 | 2 | Read state lagged, cancel refused on an already-read-looking message | Faster polling after send (0.5 s for 4 s) | recovery at 2 | Adopted (owner, #842 — via bug report) |
| B-38 | D7 | 2 | Watcher picks the message up at the same moment as cancel | Cancel and delivery are checked separately; the agent may get a message the screen shows as cancelled (code.md §5) | acknowledged dead end (silent) | NEEDS VERDICT |
| B-39 | D7 | 2 | Cancel or `보류로` refused (already read) | Browser `alert()` | recovery: bubble shows `읽음` | NEEDS VERDICT |
| B-40 | D7 | B-32/B-33 | `보류로` pressed twice | Second refused (one Hold item per message) | F-06 | Built, no owner verdict |

**Enumeration:** Alt B-32, B-33, B-35 · Cancel = this flow · Undo B-34, B-36 · Error B-39 · Wait: N/A (instant server call; spinner via B-09) · Empty: N/A (only shown on unread messages) · Unauthorized: Codex has no cancel (B-31) · Interrupted: N/A beyond B-21 · Repeat/concurrent B-37, B-38, B-40 · Degradation B-17.

---

## F-04 — Resend after read

| Field | Value |
|---|---|
| Serves journey | J-03 (stage 4) |
| Actor | Owner |
| Precondition | Own message already `읽음` |
| Trigger | Owner wants to correct or repeat what he said |
| State context | Pending (stage 3) |
| Success outcome | A new message tagged `다시 보냄` reaches the agent, linked to the original |
| Moments produced | TBD |

### Main flow

| # | Actor | Step | System response |
|---|---|---|---|
| 1 | Owner | Presses `다시 보내기` on a read message | Text becomes editable inside the original bubble; focus in the bubble |
| 2 | Owner | Edits | Edit text and caret saved locally (1 s) |
| 3 | Owner | Presses `다시 보내기` in the bubble | Spinner; new message tagged `다시 보냄`; original unchanged |
| 4 | System | Delivery (F-11) | Agent gets "[N]을(를) 사용자가 고쳐 다시 보낸 메시지" |

### Alternate flows

| ID | Dim | From | Condition | Path now | Rejoins | Verdict |
|---|---|---|---|---|---|---|
| B-41 | Alt | 1 | Edit in the main input instead of the bubble | Removed | — | Rejected (owner, #766) |
| B-42 | Alt | 1 | Message unread | No `다시 보내기`; cancel or `보류로` instead | F-03 | Adopted (owner, #1411) |
| B-43 | Alt | 1 | Original came from the drafts box | Only the owner's text is editable; metadata chips kept | 3 | Adopted (owner, #856) |
| B-44 | D1 | 2 | Owner abandons the edit | Leaves edit mode without sending | end | Built, no owner verdict |
| B-45 | Alt | 3 | Original was a reply or reference | Whether the resend keeps the quote is unknown | 3 | NEEDS VERDICT |
| B-46 | Alt | 3 | Session is working | Only plain resend; no `끼워넣기` in the bubble editor | F-01 B-02 | NEEDS VERDICT |

### Exception flows

| ID | Dim | From | Condition | Path now | Terminates in | Verdict |
|---|---|---|---|---|---|---|
| B-47 | D8 | 1 | iOS: focus jumps to the main input instead of the edit box | Root cause unknown; diagnostics still shipped | acknowledged dead end until fixed | Adopted (owner, #1323, #1327 — find root cause first; open as LC-3) |
| B-48 | D4 | 3 | Edited text emptied | Send blocked | step 2 | Built, no owner verdict |
| B-49 | D6 | 2 | Reload mid-edit | Edit text, focused field and caret restored | step 2 | Adopted (owner, #1435, #1438) |
| B-50 | D7 | 3 | Double press | One new message | step 4 | Adopted (owner, #1275) |

**Enumeration:** Alt B-41..B-43, B-45, B-46 · Cancel B-44 · Undo: N/A (resend creates a new message; original untouched — cancel it via F-03) · Error B-47 · Wait: spinner (B-09) · Empty B-48 · Unauthorized: N/A · Interrupted B-49 · Repeat B-50 · Degradation B-47.

---

## F-05 — Reply or reference (whole or part)

| Field | Value |
|---|---|
| Serves journey | J-03 (stages 1–3, 5) |
| Actor | Owner; session (adds `<re N>`) |
| Precondition | A message exists in the selected session's history |
| Trigger | Owner wants to answer or point at an earlier message |
| State context | Pending (stage 3) |
| Success outcome | The agent knows exactly which message or part is meant; a link line joins question and answer |
| Moments produced | TBD (J-03 "reply vs reference" moment) |

### Main flow

| # | Actor | Step | System response |
|---|---|---|---|
| 1 | Owner | Taps `답장` on a message (hover-only on mouse devices) | Bar `↩ 답장 · …` above the input |
| 2 | Owner | Types and sends (F-01 steps 4–5) | Bubble shows grey whole-reply quote `전체 답장` |
| 3 | System | Delivery | Agent gets the reply target; answers prefixed `<re N>` (stripped) |
| 4 | System | — | Faint tapered link line from question to answer |

### Alternate flows

| ID | Dim | From | Condition | Path now | Rejoins | Verdict |
|---|---|---|---|---|---|---|
| B-51 | Alt | 1 | Context only, not a reply | Separate `참고` button; bar `📎 참고 · …`; agent told "참고로 붙인 메시지(답장 아님)" | 2 | Adopted (owner, #1247, #1249, #1251) |
| B-52 | Alt | 1 | Reply/reference toggle inside the quote box | Not built | — | Rejected (owner, #1248, #1251) |
| B-53 | Alt | 1 | Part of a message | Select text inside the body → floating `↩ 답장` / `📎 참고` pill above the input; part highlighted yellow; bubble shows `고른 부분` | 2 | Adopted (owner, #868, #877, #1032, #1257, #1263, #1265) |
| B-54 | Alt | 1 | Sentence chips; buttons inside the message; black pill | Not built / removed | — | Rejected (owner, #877, #1255, #1259) |
| B-55 | Alt | 1 | Long-press or selection outside a message body | No pill; on iOS the press position decides | 1 | Adopted (owner, #1351, #1356, #1357, #1363) |
| B-56 | Alt | 2 | Long quote | 4 lines + `펼치기`/`접기`; `원문으로` scrolls and outlines the original | 2 | Adopted (owner, #884, #891, #897, #898) |
| B-57 | Alt | 2 | Owner sends the reply to Hold or the drafts box instead | Quote kept with the item and sent with it | F-06 / F-07 | Adopted (owner, #1403) |
| B-58 | Alt | 1 | Reply to a session-to-session message | Link lines include peer messages | 4 | Adopted (owner, #1152) |
| B-59 | Alt | 1 | Owner wants both reply and reference | One bar at a time (inferred) | 1 | Built, no owner verdict |
| B-60 | D1 | 2 | Owner drops the attachment | `×` on the bar | F-01 step 3 | Built, no owner verdict |
| B-61 | Alt | 4 | Link display | Faint by default; tapping a message emphasizes its links | 4 | Adopted (owner, #1043, #1045, #1049) |
| B-62 | Alt | 4 | Recent-only links; toggle button | Not built | — | Rejected (owner, #1045) |
| B-63 | Alt | 4 | Several questions answered by one answer | Links merge into one trunk | 4 | Adopted (owner, #1367, #1369) |
| B-64 | Alt | 4 | Lane cap, shortened far links | Not built | — | Rejected (owner, #1369) |

### Exception flows

| ID | Dim | From | Condition | Path now | Terminates in | Verdict |
|---|---|---|---|---|---|---|
| B-65 | D8 | 3 | Agent omits `<re N>` | Links guessed by delivery order | acknowledged dead end (possibly wrong line) | NEEDS VERDICT (owner wants accuracy, #1090; fallback never decided) |
| B-66 | D6 | 2 | Reload with an attachment | Reply/reference restored | step 2 | Adopted (owner, #1405, #1429) |
| B-67 | D7 | 1 | Owner switches session tab with a reply/reference attached | Attachment is per browser, not per session (inferred) — may go to the wrong session | Pending | NEEDS VERDICT |
| B-68 | D4 | 2 | `원문으로` target is older than the 120 rendered items | Unknown | Pending | NEEDS VERDICT |

**Enumeration:** Alt B-51..B-59, B-61..B-64 · Cancel B-60 · Undo: N/A (attachment removable before send; sent quote is part of the message) · Error B-65 · Wait: N/A · Empty B-68 · Unauthorized: N/A · Interrupted B-66 · Repeat/concurrent B-67 · Degradation B-65. Screen-reader path for link lines not raised (single sighted owner, inferred).

---

## F-06 — Hold area

| Field | Value |
|---|---|
| Serves journey | J-02 (stages 1–3, 5) |
| Actor | Owner |
| Precondition | A session tab is selected |
| Trigger | A thought the owner wants to keep at hand without sending yet |
| State context | Pending (stage 3) |
| Success outcome | The note waits at the bottom of the chat and is sent, interjected, moved or deleted when he chooses |
| Moments produced | TBD |

### Main flow

| # | Actor | Step | System response |
|---|---|---|---|
| 1 | Owner | Types | (as F-01 step 3) |
| 2 | Owner | Presses `보류` | Spinner; fly animation into the Hold area; input clears |
| 3 | System | — | Dashed bubble `보류 · 아직 안 보냄` under header `보류 N개`, with `수정`, `지우기`, `▤ 보관함`, `보내기` |
| 4 | Owner | Presses `보내기` on the item | Sent as a plain message (F-01 from step 4); item leaves Hold |

### Alternate flows

| ID | Dim | From | Condition | Path now | Rejoins | Verdict |
|---|---|---|---|---|---|---|
| B-69 | Alt | 2 | One single-slot hold bar above the input | Not built; multiple stacked items | — | Rejected (owner, #1122, #1124) |
| B-70 | Alt | 2 | One `나중에` button with short/long press | Replaced by separate `보류` / `보관함` buttons | — | Rejected (owner, #1134, #1136, #1137) |
| B-71 | Alt | 3 | Change the text | `수정` → `저장` / `수정 취소`; other actions stay available while editing | 3 | Adopted (owner, #1227, #1238) |
| B-72 | Alt | 3 | Move to the drafts box | `▤ 보관함` | F-07 | Adopted (owner, #1121, #1306) |
| B-73 | Alt | 4 | Session is working | Orange `끼워넣기` on the item | F-02 step 3 | Adopted (owner, #1227–#1231, #1239) |
| B-74 | Alt | 3 | Too many items on screen | Header `보류 N개` folds; fold remembered across reloads; fly animation targets the folded header | 3 | Adopted (owner, #1227–#1231, #1292, #1307) |
| B-75 | Alt | 4 | Item being edited and not saved | `보내기` / `보관함` save the edit first | 4 | Built, no owner verdict |
| B-76 | Alt | 4 | Sent from Hold | Plain text, no drafts numbering or metadata line | F-01 step 5 | Built, no owner verdict |
| B-77 | Alt | 3 | Move a Hold item to another session | No path | — | NEEDS VERDICT |
| B-78 | Alt | 3 | Move a draft back to Hold | No path (only via trash restore of a former Hold item) | — | NEEDS VERDICT |
| B-79 | — | all | Owner's own feedback on Hold and drafts box after more use | Waiting for owner | — | Deferred (owner, #1145) |

### Exception flows

| ID | Dim | From | Condition | Path now | Terminates in | Verdict |
|---|---|---|---|---|---|---|
| B-80 | D2 | 3 | `지우기` | Toast `되살리기` (6 s); item kept 7 days in `최근 보낸 것·지운 것` with `다시 담기` (returns to Hold) | recovery at 3 | Adopted (owner, #1227–#1231, #908) |
| B-81 | D4 | 2 | Empty input on `보류`, or empty text on `저장` | Refused | step 1 | Built, no owner verdict |
| B-82 | D3/D8 | 4 | Send or interject from Hold fails | Spinner, retry, no duplicate | recovery at 4 | Adopted (owner, #1275) |
| B-83 | D6 | 3 | Reload while editing an item | Edit text and caret restored | step 3 | Adopted (owner, #1435, #1438) |
| B-84 | D7 | 3 | Same item edited on two devices | Last write wins silently | step 3 | Built, no owner verdict |

**Enumeration:** Alt B-69..B-78 · Cancel `수정 취소` (B-71) · Undo B-80 · Error B-82 · Wait: spinner (B-82) · Empty B-81 · Unauthorized: target session gone → B-103 · Interrupted B-83 · Repeat/concurrent B-84 · Degradation: pile-up → B-101.

---

## F-07 — Drafts box

| Field | Value |
|---|---|
| Serves journey | J-02 (stages 2, 4, 5), J-06 (stage 4) |
| Actor | Owner |
| Precondition | A session tab is selected |
| Trigger | A thought to file by category and send later, possibly days later |
| State context | Pending (stage 3) |
| Success outcome | Notes are filed by category and later sent one, selected, or a whole category as one numbered message |
| Moments produced | TBD |

### Main flow

| # | Actor | Step | System response |
|---|---|---|---|
| 1 | Owner | Taps a category chip | Chip becomes the save-to category (per session) |
| 2 | Owner | Types and presses `▤ 보관함` | Spinner; text flies into the button; count +1; input clears |
| 3 | Owner | Later taps `전체 N` (or long-presses a chip) | Drop-up sheet `보관함 · 전체 N개` / `보관함 · <label>`; recent sent/deleted folded at top; newest first |
| 4 | Owner | Checks items | Footer `선택한 N개 한 번에 보내기` |
| 5 | Owner | Sends | One numbered message per session + category, with location/time/commit context; items move to recent sent |

### Alternate flows

| ID | Dim | From | Condition | Path now | Rejoins | Verdict |
|---|---|---|---|---|---|---|
| B-85 | Alt | 1 | Chip input scheme | Tap = set save-to category; long press (fill animation) = open that category; tap/outside closes | 1 | Adopted (owner, #567, #571, #573) |
| B-86 | Alt | 1 | Merged set-and-open chip; short = open / long = set | Not built | — | Rejected (owner, #525, #527, #528, #567) |
| B-87 | Alt | 1 | New category | `+ 새 분류` inline; also from the card's category select | 1 | Adopted (owner, #501, #947) |
| B-88 | Alt | 1 | Categories and selection | Kept per session | 1 | Adopted (owner, #533) |
| B-89 | Alt | 5 | Send one item / a whole category | `이것만 보내기` / `이 분류 모두 보내기` | 5 | Adopted (owner, #246, #373) |
| B-90 | Alt | 3 | Move an item to another category or session | Toast `<label> 열기` / `<session> 열기`; moved card outlined | 3 | Adopted (owner, #968, #971, #974, #976) |
| B-91 | Alt | 3 | Edit a card | 4-line clamp, `펼치기`, autosave (800 ms), measured line height | 3 | Adopted (owner, #978, #981, #986) |
| B-92 | Alt | 3 | Saved location drifted | `위치 그대로` / `화면이 바뀜 · 다시 찍기 권장` / `다른 화면`; `위치 보기`, `다시 찍기` | 3 | Adopted (owner, #248, #250) |
| B-93 | Alt | 3 | Sheet open, tap another chip | Switches the open category; tapping the current chip closes | 3 | Adopted (owner, #988 — unverified on screen) |
| B-94 | Alt | 5 | Selected items span several sessions or categories | Split into one message per session + category | 5 | Built, no owner verdict |
| B-95 | Alt | 5 | Scheduled send; auto-send when the session goes idle | Not built | — | Deferred (owner, #247) |

### Exception flows

| ID | Dim | From | Condition | Path now | Terminates in | Verdict |
|---|---|---|---|---|---|---|
| B-96 | D2 | 3/5 | Delete or send by mistake | Toast with undo; `최근 보낸 것·지운 것` at top for 7 days, expandable, `다시 담기` | recovery at 3 | Adopted (owner, #908, #919, #921) |
| B-97 | D2 | 3 | Restore a former Hold item | Returns to Hold, not the drafts box | F-06 step 3 | Built, no owner verdict |
| B-98 | D8 | 5 | Combined send of items that carry a reply/reference | Reply/reference info dropped (single send unverified) | acknowledged loss | NEEDS VERDICT (LC-2, agent #1409) |
| B-99 | D4 | 3 | Drafts box empty | Copy still says `"나중에"를 누르면`; button is now `보관함` | step 1 | NEEDS VERDICT (stale copy) |
| B-100 | D4 | 4 | Nothing checked | Send button disabled (inferred) | step 4 | Built, no owner verdict |
| B-101 | D8 | 3 | Backlog piles up (25–30 items never processed) | Nothing helps the ongoing flow; owner later sketched "drafts → work-bundle matching" UI (#1510) | acknowledged dead end | NEEDS VERDICT (LC-5; #907, #1473, #1510) |
| B-102 | D6 | 3 | Reload with sheet open, items checked, new-category text typed | Restored (per browser) | step 3 | Adopted (owner, #925, #1435, #1444) |
| B-103 | D5 | 3 | Target session of a draft or Hold item no longer exists (unregistered, renamed) | Unknown (inferred: items stay attached to a missing session) | Pending | NEEDS VERDICT |
| B-104 | D7 | 5 | Same draft sent from two devices | Checks are per device; double-send behavior unverified | Pending | NEEDS VERDICT |
| B-105 | D3/D8 | 2/5 | Save or send fails | Spinner, retry, no duplicate | recovery | Adopted (owner, #1275) |

**Enumeration:** Alt B-85..B-95 · Cancel `닫기 ▾`, tap list (built) · Undo B-96, B-97 · Error B-98, B-105 · Wait B-105 · Empty B-99, B-100 · Unauthorized B-103 · Interrupted B-102 · Repeat/concurrent B-104 · Degradation B-98, B-101.

---

## F-08 — Reload with preservation (manual ↻ and agent tool)

| Field | Value |
|---|---|
| Serves journey | J-07 (stages 1–3) |
| Actor | Owner (manual) or session (agent tool) |
| Precondition | Widget loaded |
| Trigger | Owner presses `↻`; or the session runs `reload-widgets` after changing the widget |
| State context | Pending (stage 3) |
| Success outcome | Screen looks as he left it; nothing typed is lost or resent |
| Moments produced | TBD (J-07 "agent asks to reload while he is mid-edit" moment) |

### Main flow

| # | Actor | Step | System response |
|---|---|---|---|
| 1 | Owner | Presses `↻` (panel header, or under the launcher) | `↻` spins; full cover `대화창을 새로 고치는 중이에요 · 잠시 손대지 마세요` |
| 2 | System | Page reloads | — |
| 3 | System | Restore | Panel open state, tab, scroll (message id + offset), compose text, reply/reference, location, in-bubble/Hold edits and caret, sheet state; just-sent text not refilled |

### Alternate flows

| ID | Dim | From | Condition | Path now | Rejoins | Verdict |
|---|---|---|---|---|---|---|
| B-106 | Alt | 1 | Session decides to reload | `reload-widgets` bumps a token; widgets notice within 5 s, show the cover, reload | 2 | Adopted (owner, #1374, #1375) |
| B-107 | Alt | 1 | Silent automatic reload on file change | Removed | — | Rejected (owner, #1372, #1374, #1375) |
| B-108 | Alt | 1 | `↻` only in the home-screen app or only inside the chat | Not built; shown everywhere | — | Rejected (owner, #1183) |
| B-109 | Alt | 1 | Manual `↻` feedback | Spins and shows the same cover | 2 | Adopted (owner, #1219, #1391) |
| B-110 | Alt | 3 | What is preserved | Everything in progress, unconditionally | 3 | Adopted (owner, #1433, #1435, #1438, #1444) |
| B-111 | Alt | 3 | Scroll position | Message id + pixel offset; small residual shift remains, cause unknown | 3 | Adopted (owner, #1210, #1213; residual shift open, #1217) |

### Exception flows

| ID | Dim | From | Condition | Path now | Terminates in | Verdict |
|---|---|---|---|---|---|---|
| B-112 | D3 | B-106 | Agent reload arrives while the owner is editing or a send is busy | Cover shown; reload waits in 1 s loops until editing/busy ends (inferred from code: cover may block the edit he is finishing; no maximum wait) | Pending | NEEDS VERDICT |
| B-113 | D8 | 2 | Server or app unreachable during reload | Page fails to load; cover has no timeout (inferred) | acknowledged dead end | NEEDS VERDICT |
| B-114 | D6 | 3 | Continue on another device | Text, tab, read state, position shared; reply/reference, location, edits, sheet, open state per browser only | Pending | NEEDS VERDICT (J-07 stage 4) |
| B-115 | D6 | 1 | Server restarts | Reload token persisted, so no spurious reload | end | Built, no owner verdict |
| B-116 | D7 | 1 | `↻` pressed twice or several agent requests in a row | One reload per token change | 2 | Built, no owner verdict |
| B-117 | D6 | 1 | Phone app backgrounded or killed by iOS | Same restore path (inferred) | step 3 | Built, no owner verdict |

**Enumeration:** Alt B-106..B-111 · Cancel: no way to cancel an agent reload (covered by B-112) · Undo: N/A · Error B-113 · Wait B-112 · Empty: N/A · Unauthorized: key cookie expired → B-191 · Interrupted B-114, B-115, B-117 · Repeat B-116 · Degradation B-113.

---

## F-09 — Notifications

| Field | Value |
|---|---|
| Serves journey | J-04 (stages 1–3) |
| Actor | Owner; chat server (push) |
| Precondition | Secure context (private HTTPS); on iOS, home-screen app installed |
| Trigger | Owner wants to be told when a session needs him |
| State context | Pending (stage 3) |
| Success outcome | One notice per event, only of chosen kinds; tapping opens that session's tab |
| Moments produced | TBD (J-04 "choosing kinds", "`승인 필요`" moments) |

### Main flow

| # | Actor | Step | System response |
|---|---|---|---|
| 1 | Owner | Taps `🔕 알림` | Browser permission prompt |
| 2 | Owner | Allows | Service worker registers, device subscribes, test push arrives; button becomes `🔔 알림` |
| 3 | Owner | Opens settings | Kinds: `세션 답장`, `작업 끝남`, `승인 필요`, `비교 페이지 준비`, `오래 멈춤(5분 그대로)` on; `세션끼리 메시지` off; quiet-while-viewing option |
| 4 | System | Event happens | Push once, unless the kind is off or (quiet and viewing) |
| 5 | Owner | Taps the notice | Window focused; that session's tab opens (F-14) |

### Alternate flows

| ID | Dim | From | Condition | Path now | Rejoins | Verdict |
|---|---|---|---|---|---|---|
| B-118 | Alt | 1 | Delivery approach | Private HTTPS + PWA + web push | 2 | Adopted (owner, #1155, #1157) |
| B-119 | Alt | 1 | Public relay service (ntfy); Mac-only notices | Not built | — | Rejected (owner, #1157) |
| B-120 | Alt | 3 | Default kinds | 1–5 on, peer off | 3 | Adopted (owner, #1175, #1177) |
| B-121 | Alt | 3 | Agent's recommended set (2·3·4 only) | Not used | — | Rejected (owner, #1177) |
| B-122 | Alt | 4 | Owner is looking at the chat | Quiet-while-viewing as a user setting | 4 | Adopted (owner, #1177) |
| B-123 | Alt | 4 | Another session's activity while viewing a different tab | Same push type but silent (`다른 세션 작업 중`) | 4 | Adopted (owner, #1447, #1449) |
| B-124 | Alt | 4 | In-chat status line or toast for other-session activity | Not built | — | Rejected (owner, #1449) |
| B-125 | Alt | 5 | Tap target | Opens that session's tab (also when no window was open) | 5 | Adopted (owner, #1455, #1463) |
| B-126 | D1 | 3 | Stop notices on this device | `알림 끄기` | end | Built, no owner verdict |

### Exception flows

| ID | Dim | From | Condition | Path now | Terminates in | Verdict |
|---|---|---|---|---|---|---|
| B-127 | D7 | 4 | Owner just left the panel | Immediately "not viewing" on blur/hide/close (no 30 s gap) | step 4 | Adopted (owner, #1336, #1340 — via bug report) |
| B-128 | D7 | 4 | Answer and work-done fire for the same answer | One notice | step 4 | Adopted (owner, #1343, #1349 — via bug report) |
| B-129 | D8 | 1 | Unsupported (not secure, no service worker, iOS not installed) | Toast explains | acknowledged dead end | Built, no owner verdict |
| B-130 | D5 | 1 | Owner denies permission (or OS blocks) | Unknown what is shown; no path back explained (inferred) | Pending | NEEDS VERDICT |
| B-131 | D5 | 4 | Subscription expired (endpoint 404/410) | Device silently turned off; owner not told | acknowledged dead end (silent) | NEEDS VERDICT |
| B-132 | D7 | 4 | Several devices subscribed | Each gets the push; reading on one device does not clear notices on the other | step 5 | NEEDS VERDICT |
| B-133 | D3 | 4 | `승인 필요` notice | Tap opens the tab, but approval can only be given in the terminal (inferred: no approve action in the panel) | acknowledged dead end on phone | NEEDS VERDICT |
| B-134 | D8 | 4 | Chat server down | No pushes, no warning | acknowledged dead end (silent) | NEEDS VERDICT |
| B-135 | D3 | 4 | Session stuck working >5 min; review page ready | One stale push per stuck state; review-ready push on new page | step 5 | Adopted (owner, #1175, #1177) |

**Enumeration:** Alt B-118..B-125 · Cancel B-126 · Undo: N/A (settings toggle back) · Error B-129..B-131, B-134 · Wait B-133, B-135 · Empty: no sessions → F-01 B-13 · Unauthorized B-130, B-131 · Interrupted: N/A (push is stateless) · Repeat/concurrent B-127, B-128, B-132 · Degradation B-129, B-134.

---

## F-10 — Multi-session tabs and session-to-session messages

| Field | Value |
|---|---|
| Serves journey | J-06 (stages 1–4) |
| Actor | Owner; sessions |
| Precondition | Two or more sessions registered |
| Trigger | Owner checks or directs several sessions; one session messages another |
| State context | Pending (stage 3) |
| Success outcome | He knows which session is working or waiting, and messages never go to the wrong one |
| Moments produced | TBD (J-06 "which session first" moment) |

### Main flow

| # | Actor | Step | System response |
|---|---|---|---|
| 1 | Owner | Scans tabs | Dot per tab (busy pulse / watching green / off grey), per-tab unread badge; launcher dots (amber when any waits for approval) |
| 2 | Owner | Taps a tab | Mode line, compose text and categories of that session |
| 3 | Owner | Sends | Goes only to that session |
| 4 | System | Session A messages session B | Arrow between tabs only while it happens; dashed amber `세션끼리` bubble with direction and `받음` |

### Alternate flows

| ID | Dim | From | Condition | Path now | Rejoins | Verdict |
|---|---|---|---|---|---|---|
| B-136 | Alt | 1 | Route by session (not by fix target) | One tab per session | 1 | Adopted (owner, #11, #13) |
| B-137 | Alt | 1 | "All sessions" tab | Removed | — | Rejected (owner, #22) |
| B-138 | Alt | 4 | Arrow duration | Only while the send happens | 4 | Adopted (owner, #725) |
| B-139 | Alt | 4 | Minimum arrow display time | Not built | — | Deferred (owner, #730, #731) |
| B-140 | Alt | 4 | Non-adjacent tabs (3+ sessions) | `→ target` after sender tab; never seen on screen | 4 | Deferred (owner, #734, #735; LC-4) |
| B-141 | Alt | 4 | Peer bubble side | This session's own utterances on the left like its replies | 4 | Adopted (owner, #864) |
| B-142 | Alt | 2 | Selected tab on other devices | Synced via server | 2 | Adopted (owner, #346, #347) |
| B-143 | Alt | 2 | Move a draft to another session | Session select on the card | F-07 | Adopted (owner, #968) |
| B-144 | Alt | — | Shared server restart | Only with the owning session's permission | — | Adopted (owner, #209) |
| B-145 | Alt | 4 | Ask one session to wait for another (J-06 stage 4) | No built path | — | NEEDS VERDICT |

### Exception flows

| ID | Dim | From | Condition | Path now | Terminates in | Verdict |
|---|---|---|---|---|---|---|
| B-146 | D7 | 2–3 | Tab switched on device A while the owner types on device B | B's tab follows after a 5 s guard; a send can go to a session he did not intend | Pending | NEEDS VERDICT |
| B-147 | D8 | 4 | Which peer message is which | Matched by identical text within 10 min | step 4 | Built, no owner verdict |
| B-148 | D5 | 1 | Session ended for good | Tab stays (grey); messages accepted but never delivered | acknowledged dead end | NEEDS VERDICT |
| B-149 | D8 | 1 | Many sessions on a phone-width header | Unknown overflow behavior | Pending | NEEDS VERDICT |
| B-150 | D8 | 1 | Codex session | See B-31 (no status, cancel, interject) | — | (see B-31) |

**Enumeration:** Alt B-136..B-145 · Cancel: N/A (tab switch is free) · Undo: N/A · Error B-147 · Wait: status dots, stale hint (B-16) · Empty: one session only — arrows/peer never shown (by design) · Unauthorized B-148 · Interrupted: tab restored on reload (B-110) · Repeat/concurrent B-146 · Degradation B-149, B-150.

---

## F-11 — Watcher delivery and ordering (system flow)

| Field | Value |
|---|---|
| Serves journey | J-01 (stage 4), J-02 (stage 5), J-07 |
| Actor | Session (agent) running the watcher; hook relay; chat server |
| Precondition | Claude Code session registered, hooks installed |
| Trigger | Session finishes a turn and re-arms the watcher |
| State context | Pending (stage 3) |
| Success outcome | Every owner message reaches the session once, at the moment shown as its read time |
| Moments produced | — (system flow; feeds J-01 read-state moment) |

### Main flow

| # | Actor | Step | System response |
|---|---|---|---|
| 1 | Session | Runs the watcher (`wait-review.mjs`) | Watch state active; tab green; own unread marks say `곧 읽음` |
| 2 | Owner | Sends (F-01) | Message stored |
| 3 | Watcher | Polls (1 s); waits while the session is working or awaiting approval | — |
| 4 | Watcher | Prints pending messages (with reply/quote and the `<re N>` instruction), records read time, exits | Bubbles show `읽음` and move to read time |
| 5 | Session | Replies (prefixed `<re N>`) | Answer shown, linked (F-05) |
| 6 | Session | Re-runs the watcher | Back to step 1 |

### Alternate flows

| ID | Dim | From | Condition | Path now | Rejoins | Verdict |
|---|---|---|---|---|---|---|
| B-151 | Alt | 1 | Watcher lifetime | No time limit; session wakes when the owner sends | 1 | Adopted (owner, #141, #144, #147, #187) |
| B-152 | Alt | 1 | Codex session | `codex queue`, no watcher | 5 | Adopted (owner, #196, #199, #216) |
| B-153 | Alt | 4 | Several messages pending | Delivered together in one batch | 5 | Built, no owner verdict |
| B-154 | Alt | 4 | Ordering | By actual read time; no compensating rules | 4 | Adopted (owner, #648, #661, #821, #823, #829) |
| B-155 | Alt | 4 | Agent-made compensating rules (work-end time, 5 s rule) | Deleted | — | Rejected (owner, #821, #823, #825, #827, #829) |
| B-156 | Alt | 4 | Keep chat in send order instead | Peer session asked; not answered | — | NEEDS VERDICT (DQ-06, #1388) |
| B-157 | Alt | 4 | Message read more than 1 h after sending | Placed at its send time instead (agent rule; NG-5 asks for disclosure) | 4 | Built, no owner verdict |

### Exception flows

| ID | Dim | From | Condition | Path now | Terminates in | Verdict |
|---|---|---|---|---|---|---|
| B-158 | D6 | 6 | Agent forgets to re-arm the watcher | "Handling" expires after 10 min → off; messages wait; hint says not auto-delivered | acknowledged dead end until the owner goes to the terminal | NEEDS VERDICT (LC-1; #1521, #1522) |
| B-159 | D6 | 1 | Session closed or computer asleep | Watcher off; messages wait | acknowledged dead end | NEEDS VERDICT (LC-1; #146, #189) |
| B-160 | D3 | 3 | Stop hook missed; status stuck "working" | Delivery blocked up to 30 min; stale hint at 5 min | recovery after 30 min | NEEDS VERDICT |
| B-161 | D8 | 5 | Relay hook fails silently (e.g. wrong working folder) | Answer never reaches the chat; status stuck | acknowledged dead end (silent) | NEEDS VERDICT (specific case fixed after #667, #676; no general surfacing) |
| B-162 | D8 | 5 | Answer display chunks missing | Joined within 3 s; missing parts silently dropped | acknowledged loss | NEEDS VERDICT |
| B-163 | D7 | 4 | Pending messages older than the session's last reply | Delivered (earlier skip removed) | step 4 | Adopted (owner, #954, #1062 — via bug report) |
| B-164 | D7 | 4 | Delivered record unreadable | Skips instead of re-delivering old history | step 3 | Built, no owner verdict (peer-reported #1477) |
| B-165 | D7 | 5 | Agent replies via script and final message | One answer shown | step 5 | Adopted (owner, #37 — via bug report) |
| B-166 | D7 | 1 | Two watchers for the same session | Unknown (inferred risk of double delivery) | Pending | NEEDS VERDICT |

**Enumeration:** Alt B-151..B-157 · Cancel → F-03 · Undo: N/A · Error B-161, B-162 · Wait B-160 · Empty: no pending messages → watcher keeps polling (by design) · Unauthorized: N/A (local files) · Interrupted B-158, B-159 · Repeat/concurrent B-163..B-166 · Degradation B-161, B-162.

---

## F-12 — Review page round

| Field | Value |
|---|---|
| Serves journey | J-05 (stages 1–4) |
| Actor | Owner; session preparing the round |
| Precondition | Session produced a round (`review*.html`, captures) and runs the watcher with `--done` |
| Trigger | `비교 페이지 준비` notice or a link in chat |
| State context | Pending (stage 3) |
| Success outcome | Verdicts appear in chat and the session continues without retyping |
| Moments produced | TBD (J-05 "choosing among proposals" moment) |

### Main flow

| # | Actor | Step | System response |
|---|---|---|---|
| 1 | Owner | Opens the review page | Items with before/after or options; banner `자동 이어가기 켜짐`; same chat panel available |
| 2 | Owner | Inspects | Numbered boxes tied to change lines; zoom (`맞춤`/`100%`/…); pins `이 위치에 대한 의견`; live HTML demos for options |
| 3 | Owner | Picks a verdict per item, one-line memo, `전체 의견` | Autosaved per round |
| 4 | Owner | `평가 완료 표시` | Summary posted to chat; watcher wakes the session (Codex via queue) |

### Alternate flows

| ID | Dim | From | Condition | Path now | Rejoins | Verdict |
|---|---|---|---|---|---|---|
| B-167 | Alt | 2 | Compare options live, not only screenshots | Generic comparison with live HTML | 3 | Adopted (owner, #541, #543, #544, #545) |
| B-168 | Alt | 1 | Chat on the review page | Shared widget; launcher hides/shows the panel | 1 | Adopted (owner, #300, #305) |
| B-169 | Alt | 2 | Mark regions | Numbered boxes, auto-measured, zoom-aligned | 2 | Adopted (owner, #226, #229, #579) |
| B-170 | Alt | 4 | Verdicts reach the chat | Posted as a chat message | 4 | Adopted (owner, #561, #563) |
| B-171 | Alt | 4 | Codex session | Done wakes it via queue | 4 | Adopted (owner, #218, #221, #223) |
| B-172 | Alt | — | Verify on the real screen instead of the review page | Owner said the page "can't really be used" | — | NEEDS VERDICT (DQ-10, #1510) |

### Exception flows

| ID | Dim | From | Condition | Path now | Terminates in | Verdict |
|---|---|---|---|---|---|---|
| B-173 | D3 | 4 | `자동 이어가기 꺼짐` (no watcher with `--done`) | Done saved; session not woken; no stated next step | acknowledged dead end | NEEDS VERDICT |
| B-174 | D5 | 4 | Done → chat wiring lives in a combined server in neither repo | Adopters get no "done" path | acknowledged dead end | NEEDS VERDICT (LC-6) |
| B-175 | D4 | 4 | Done pressed with unrated items | Unknown | Pending | NEEDS VERDICT |
| B-176 | D2 | 4 | Change a verdict or undo done after pressing done | Unknown | Pending | NEEDS VERDICT |
| B-177 | D8 | 3/4 | Autosave or done fails (server down) | No visible failure state (inferred) | Pending | NEEDS VERDICT |
| B-178 | D7 | 3 | Same round rated on two devices | Last write per item | step 3 | Built, no owner verdict |
| B-179 | D6 | 3 | Reload mid-rating | Saved verdicts kept; memo being typed may be lost (inferred) | step 3 | Built, no owner verdict |
| B-180 | D8 | 1 | Old rounds (≤29) | Do not use the shared widget or sync (#328) | acknowledged dead end | NEEDS VERDICT |

**Enumeration:** Alt B-167..B-172 · Cancel: leave page (autosaved) · Undo B-176 · Error B-174, B-177 · Wait B-173 · Empty B-175 · Unauthorized B-174 · Interrupted B-179 · Repeat/concurrent B-178 · Degradation B-177, B-180.

---

## F-13 — App proxy setup and access key

| Field | Value |
|---|---|
| Serves journey | J-08 (stages 1–5), J-01 (stage 1) |
| Actor | Adopter (U-2) or owner on a new project |
| Precondition | Node 18+; app dev server running |
| Trigger | Wants the panel on a project |
| State context | Pending (stage 3) |
| Success outcome | `대화/피드백` appears on the app and a test message reaches a session |
| Moments produced | TBD (J-08 "choosing an access method" moment) |

### Main flow

| # | Actor | Step | System response |
|---|---|---|---|
| 1 | Adopter | Adds the repos (submodule or clone) | — |
| 2 | Adopter | Starts the chat server and the app proxy in front of the app | Proxy injects the widget into HTML, forwards `/__uifb/api/*`, passes HMR WebSockets |
| 3 | Adopter | Opens the app through the proxy | Launcher appears; app behaves as before |
| 4 | Adopter | Registers a session (marker search), installs hooks, session runs the watcher | Tab appears; hooks kept out of git |
| 5 | Adopter | Sends a test message | Delivered (F-01, F-11) |

### Alternate flows

| ID | Dim | From | Condition | Path now | Rejoins | Verdict |
|---|---|---|---|---|---|---|
| B-181 | Alt | 3 | Reach from phone on the same network | `--lan`: printed URL with key → 30-day cookie, key stripped from the URL | 3 | Adopted (owner, #441, #443, #445, #458) |
| B-182 | Alt | 3 | Reach from anywhere | Private tailnet URL printed first | 3 | Adopted (owner, #617, #619, #621, #629) |
| B-183 | Alt | 3 | Public tunnel or public link | Not built | — | Rejected (owner, #441, #617, #621, #1157) |
| B-184 | Alt | 3 | Home-screen app | Manifest start URL carries the key | 3 | Built, no owner verdict |
| B-185 | Alt | 1 | Repo layout | Two repos (chat bundle, review page), separate servers | 1 | Adopted (owner, #1541, #1542, #1545) |
| B-186 | Alt | 1 | Commit a copy of the skill into the project repo | Not done | — | Rejected (owner, #391, #393) |
| B-187 | Alt | 3 | Request from localhost | Exempt from the key, except tailnet/forwarded requests | 3 | Built, no owner verdict |

### Exception flows

| ID | Dim | From | Condition | Path now | Terminates in | Verdict |
|---|---|---|---|---|---|---|
| B-188 | D8 | 3 | Dev server blocks HMR from another host (reload loop) | Origin/Referer rewritten | step 3 | Adopted (owner, #484 — via bug report) |
| B-189 | D5 | 3 | Key leaked (into a local log) | Not rotated | — | Rejected (owner, #460 — rotation declined for that leak) |
| B-190 | D5 | 3 | No key, wrong key | Unknown page (inferred: refused); no guidance | Pending | NEEDS VERDICT |
| B-191 | D5 | 3 | Cookie expired after 30 days | Needs the key URL again; home-screen app relies on manifest key (B-184) | Pending | NEEDS VERDICT |
| B-192 | D4 | 4 | Registration marker not found within 20 s | Registration fails; recovery copy unknown | Pending | NEEDS VERDICT |
| B-193 | D4 | 4 | Second computer: hooks local-only, must pull and enable the hooks path per repo | Manual, undocumented | Pending | NEEDS VERDICT (agent #1564, #1575) |
| B-194 | D4 | 4 | Registration and hook steps not in this README (in another skill) | Adopter has no path | acknowledged dead end | NEEDS VERDICT |
| B-195 | D8 | 2 | Chat server down while the proxy runs | See B-17 | — | (see B-17) |

**Enumeration:** Alt B-181..B-187 · Cancel: N/A (setup) · Undo: uninstall path not documented (folded into B-194) · Error B-188, B-192 · Wait B-192 · Empty B-193, B-194 · Unauthorized B-189..B-191 · Interrupted: N/A · Repeat: re-running registration with the same name (one name = one session, built) · Degradation B-195.

---

## F-14 — Catch up on unread answers

| Field | Value |
|---|---|
| Serves journey | J-04 (stage 4), J-01 (stage 5) |
| Actor | Owner |
| Precondition | Answers arrived while the panel was closed or another tab was selected |
| Trigger | Badge, peek, `(N)` title, or a notification (F-09) |
| State context | Pending (stage 3) |
| Success outcome | He reads from the first unread answer, and read state is the same on every screen |
| Moments produced | TBD |

### Main flow

| # | Actor | Step | System response |
|---|---|---|---|
| 1 | System | Answer arrives, panel closed | Launcher badge and working dots; 5 s peek above the launcher; `(N)` in the page title |
| 2 | Owner | Opens the panel or taps the peek | That tab opens at `여기부터 새 메시지` |
| 3 | Owner | Reads | Each message counts as read when fully visible; badges drop per session |
| 4 | System | — | Read state synced to other screens/devices |

### Alternate flows

| ID | Dim | From | Condition | Path now | Rejoins | Verdict |
|---|---|---|---|---|---|---|
| B-196 | Alt | 1 | Panel closed | Peek + title count | 2 | Adopted (owner, #45) |
| B-197 | Alt | 1 | Working indicator on the closed launcher | Three dots, amber for approval | 2 | Adopted (owner, #1096) |
| B-198 | Alt | 2 | Opening the panel | Clears only what is read, per session | 3 | Adopted (owner, #55 — via bug report) |
| B-199 | Alt | 3 | Read rule | Visible = read (messenger style) | 3 | Adopted (owner, #79, #83) |
| B-200 | Alt | 4 | Several screens | Read state shared via server | 4 | Adopted (owner, #325) |
| B-201 | Alt | 2 | Tap the peek | Opens that session's tab | 2 | Built, no owner verdict |

### Exception flows

| ID | Dim | From | Condition | Path now | Terminates in | Verdict |
|---|---|---|---|---|---|---|
| B-202 | D2 | 3 | Owner wants an answer back as unread | No path | — | NEEDS VERDICT |
| B-203 | D7 | 4 | Read on two devices at once | Later timestamp wins | step 4 | Built, no owner verdict |
| B-204 | D8 | 2 | First unread is older than the 120 rendered items | See B-20 | — | (see B-20) |

**Enumeration:** Alt B-196..B-201 · Cancel: close panel (unread stays unread) · Undo B-202 · Error: N/A · Wait: N/A · Empty: no unread → opens at saved position · Unauthorized: N/A · Interrupted: position restore (B-111) · Repeat/concurrent B-203 · Degradation B-204.

---

## F-15 — Location pick

| Field | Value |
|---|---|
| Serves journey | J-01 (stage 3), J-02 (stage 5) |
| Actor | Owner |
| Precondition | Panel open |
| Trigger | Owner wants the message to point at an element on the app or the chat itself |
| State context | Pending (stage 3) |
| Success outcome | The message carries URL, selector and text of the right element |
| Moments produced | TBD |

### Main flow

| # | Actor | Step | System response |
|---|---|---|---|
| 1 | Owner | `위치 찍기` | Hint bar `찍을 곳을 누르세요` with `[앱 화면 | 대화창]` and `취소`; hover box |
| 2 | Owner | Taps the element | Location bar `위치: …` with `×` |
| 3 | Owner | Sends, holds or files | Location travels with the message or item |

### Alternate flows

| ID | Dim | From | Condition | Path now | Rejoins | Verdict |
|---|---|---|---|---|---|---|
| B-205 | Alt | 1 | Point at the chat panel itself | One button + `[앱 화면 | 대화창]` switch | 2 | Adopted (owner, #636, #638, #640, #642) |
| B-206 | Alt | 1 | Two separate pick buttons; app and chat side by side | Not built | — | Rejected (owner, #638, #640) |
| B-207 | Alt | 1 | Pick on the review page | Same widget | 2 | Adopted (owner, #314) |
| B-208 | D1 | 1 | Back out | `취소` (phone), Esc | end | Adopted (owner, #642) |
| B-209 | D1 | 2 | Remove the picked location | `×` on the bar | end | Built, no owner verdict |

### Exception flows

| ID | Dim | From | Condition | Path now | Terminates in | Verdict |
|---|---|---|---|---|---|---|
| B-210 | D5 | 2 | Access key would leak into the captured URL | Key stripped from the address first | step 2 | Adopted (owner, #458 — via bug report) |
| B-211 | D6 | 2 | Reload with a pick | Restored | step 2 | Adopted (owner, #1433, #1438) |
| B-212 | D7 | 2 | Session tab switched with a pick attached | Pick is per browser, not per session (inferred) | Pending | NEEDS VERDICT |

**Enumeration:** Alt B-205..B-207 · Cancel B-208, B-209 · Undo B-209 · Error: N/A · Wait: N/A · Empty: nothing tappable → `취소` · Unauthorized B-210 · Interrupted B-211 · Repeat/concurrent B-212 · Degradation: drifted pick status in drafts (B-92).

---

## Verdicts needed

Numbered batch for the owner. NEEDS VERDICT first within each flow, then "Built, no owner verdict"
(confirm or change). Most important first within each group.

**F-01 Send**
1. B-17 — Server unreachable: show an "unreachable, retrying" state instead of a list that looks alive but is dead? (NEEDS VERDICT)
2. B-13 — First run with no session registered: what the panel should say and point to. (NEEDS VERDICT)
3. B-20 — More than 120 messages: add "show older", or accept the limit? (NEEDS VERDICT)
4. B-14 — Show terminal history from before registration? (NEEDS VERDICT, DQ-11)
5. B-03 — Codex messages shown `읽음` the moment they are queued: keep, or show a different mark? (Built)
6. B-16 — Stale-working hint after 5 min and its wording: keep? (Built)
7. B-22 — Typing on two devices: last typing wins after 3 s: acceptable? (Built)
8. B-10 — Send unlocks after 8 s: keep this value? (Built)
9. B-12 — Empty send does nothing silently: acceptable? (Built)
10. B-01 — Enter sends, Shift+Enter new line (also on phone): keep? (Built)

**F-02 Interject**
11. B-31 — Codex sessions: no interject, cancel or live status. Accept as non-goal (NG-9) or request? (NEEDS VERDICT)
12. B-29 — `끼워넣기 취소` refused after injection: message and toast instead of `alert()`. (NEEDS VERDICT)
13. B-26 — Work ends before another tool call: interjected message falls back to normal delivery: confirm. (Built)
14. B-30 — Button visible due to status lag: message becomes a normal send: confirm. (Built)
15. B-25 — Awaiting approval: injection waits until after approval: confirm. (Built)
16. B-27 — Long single tool call: no sign of how long `다음 단계에서 바로 읽음` will take: acceptable? (Built)

**F-03 Cancel / to Hold**
17. B-38 — Cancel and pickup at the same moment: agent may get a message shown as cancelled. Make atomic, or accept? (NEEDS VERDICT)
18. B-36 — Cancelled trace: resend only via `보류로` → `보내기`, or add `다시 보내기` on traces? (NEEDS VERDICT)
19. B-39 — Refused cancel/`보류로` uses `alert()`: switch to toast with the reason? (NEEDS VERDICT)
20. B-40 — `보류로` twice is refused (one Hold item per message): confirm. (Built)

**F-04 Resend**
21. B-45 — Resend of a reply/reference: keep the quote? (NEEDS VERDICT)
22. B-46 — Resend while the session works: offer `끼워넣기` in the bubble editor? (NEEDS VERDICT)
23. B-44 — Leaving resend edit without sending: confirm behavior. (Built)
24. B-48 — Emptied edit blocks resend: confirm. (Built)

**F-05 Reply / reference**
25. B-67 — Reply/reference attached, then tab switched: clear, keep, or keep per session? (NEEDS VERDICT)
26. B-65 — Agent omits `<re N>`: keep order-guessed lines or draw none? (NEEDS VERDICT)
27. B-68 — `원문으로` to a message outside the 120 rendered items: what happens? (NEEDS VERDICT)
28. B-59 — Only one of reply or reference at a time: confirm. (Built)
29. B-60 — `×` on the reply bar: confirm. (Built)

**F-06 Hold**
30. B-77 — Move a Hold item to another session: add? (NEEDS VERDICT)
31. B-78 — Move a draft back to Hold: add? (NEEDS VERDICT)
32. B-76 — Sending from Hold uses plain text (no drafts numbering/metadata): confirm. (Built)
33. B-75 — Unsaved edit is saved automatically before `보내기`/`보관함`: confirm. (Built)
34. B-84 — Same Hold item edited on two devices: last write wins silently: acceptable? (Built)
35. B-81 — Empty `보류`/`저장` refused: confirm. (Built)

**F-07 Drafts box**
36. B-98 — Combined send drops reply/reference: carry quotes in combined messages? (NEEDS VERDICT, LC-2)
37. B-101 — Ongoing backlog: what flow keeps the drafts box from piling up (e.g. drafts → work-bundle matching)? (NEEDS VERDICT, LC-5)
38. B-103 — Draft or Hold item whose session no longer exists: what happens? (NEEDS VERDICT)
39. B-104 — Same draft sent from two devices: guard against double send? (NEEDS VERDICT)
40. B-99 — Empty drafts box copy still says `"나중에"`: new wording. (NEEDS VERDICT)
41. B-94 — Selected items across sessions/categories split into one message each: confirm. (Built)
42. B-97 — Restoring a former Hold item returns it to Hold: confirm. (Built)
43. B-100 — Send disabled when nothing is checked: confirm. (Built)

**F-08 Reload**
44. B-112 — Agent reload while editing: what the owner sees, whether the cover blocks finishing the edit, maximum wait. (NEEDS VERDICT)
45. B-114 — Which in-progress state should follow him to another device (reply, location, edits, sheet, open state are per browser today)? (NEEDS VERDICT)
46. B-113 — Reload when the server/app is unreachable: cover timeout and message. (NEEDS VERDICT)
47. B-117 — iOS background kill uses the same restore path: confirm. (Built)
48. B-116 — Repeated reload requests collapse into one: confirm. (Built)
49. B-115 — Server restart never triggers a reload: confirm. (Built)

**F-09 Notifications**
50. B-133 — `승인 필요` on the phone: tap lands in the tab but approval needs the terminal. Add an approve path, or say so in the notice? (NEEDS VERDICT)
51. B-131 — Expired subscription silently turns notices off: tell the owner and offer re-enable? (NEEDS VERDICT)
52. B-134 — Chat server down: no pushes and no warning: acceptable? (NEEDS VERDICT)
53. B-132 — Several devices: should reading on one clear the notice on the other? (NEEDS VERDICT)
54. B-130 — Permission denied: what to show and how to retry. (NEEDS VERDICT)
55. B-129 — Unsupported environment explained by a toast: confirm wording. (Built)
56. B-126 — `알림 끄기` per device: confirm. (Built)

**F-10 Multi-session**
57. B-146 — Tab synced from another device can redirect a send: keep sync, guard it, or make tab per device? (NEEDS VERDICT)
58. B-148 — Session ended for good: remove/close its tab, block sending? (NEEDS VERDICT)
59. B-145 — Ask one session to wait for another: needed? (NEEDS VERDICT)
60. B-149 — Many tabs on a phone: overflow behavior. (NEEDS VERDICT)
61. B-147 — Peer messages matched by identical text within 10 min: acceptable? (Built)

**F-11 Watcher**
62. B-158 — Agent forgets to re-arm the watcher: acceptable recovery (auto re-arm, visible alert, push)? (NEEDS VERDICT, LC-1)
63. B-159 — Session closed / computer asleep: acceptable recovery? (NEEDS VERDICT, LC-1)
64. B-160 — Stuck "working" blocks delivery up to 30 min: allow the owner to force delivery, shorten, or alert? (NEEDS VERDICT)
65. B-156 — Chat order: read time (built) or send order (peer request)? (NEEDS VERDICT, DQ-06)
66. B-161 — Relay hook failures are silent: surface them? (NEEDS VERDICT)
67. B-162 — Missing answer chunks silently dropped: surface or retry? (NEEDS VERDICT)
68. B-166 — Two watchers for one session: guard? (NEEDS VERDICT)
69. B-157 — >1 h late message placed at send time: an agent-made rule; keep or delete? (Built)
70. B-153 — Several pending messages delivered as one batch: confirm. (Built)
71. B-164 — Unreadable delivered record: skip rather than re-deliver: confirm. (Built)

**F-12 Review page**
72. B-172 — Keep the review page journey, or verify on the real screen instead? (NEEDS VERDICT, DQ-10)
73. B-174 — "Done" wiring in neither repo: ship it, or document it for adopters? (NEEDS VERDICT, LC-6)
74. B-173 — `자동 이어가기 꺼짐`: what the owner is told to do after done. (NEEDS VERDICT)
75. B-176 — Change a verdict or undo done after done. (NEEDS VERDICT)
76. B-175 — Done with unrated items: allow, warn, or block? (NEEDS VERDICT)
77. B-177 — Autosave/done failure state. (NEEDS VERDICT)
78. B-180 — Old rounds (≤29) without the shared widget: migrate or leave? (NEEDS VERDICT)
79. B-179 — Reload mid-rating may lose a memo being typed: acceptable? (Built)
80. B-178 — Two devices rating the same round: last write per item: acceptable? (Built)

**F-13 Setup / access key**
81. B-194 — Registration and hook steps missing from this README. (NEEDS VERDICT)
82. B-190 — No/wrong key: what page and guidance. (NEEDS VERDICT)
83. B-191 — Cookie expiry after 30 days: re-entry path. (NEEDS VERDICT)
84. B-192 — Registration fails (marker not found in 20 s): recovery copy. (NEEDS VERDICT)
85. B-193 — Second computer must pull and enable hooks per repo: automate or document? (NEEDS VERDICT)
86. B-184 — Key embedded in the home-screen manifest: acceptable? (Built)
87. B-187 — Localhost exempt from the key: confirm. (Built)

**F-14 Catch up**
88. B-202 — Mark an answer unread again: needed? (NEEDS VERDICT)
89. B-201 — Tapping the peek opens that tab: confirm. (Built)
90. B-203 — Read on two devices: later timestamp wins: confirm. (Built)

**F-15 Location pick**
91. B-212 — Pick attached, then tab switched: clear, keep, or keep per session? (Decide together with B-67.) (NEEDS VERDICT)
92. B-209 — `×` removes the pick: confirm. (Built)

---

## Production freeze readiness (Stage 7)

- [x] Every flow serves at least one journey; every journey is served by at least one flow
- [x] Main flows contain no branches
- [ ] Every exception flow terminates (Pending rows remain until verdicts)
- [x] Every alternate flow states where it rejoins
- [ ] Branch enumeration run for every flow; rejections recorded as `DEC` (enumerated; DEC/ADR records not yet written)
- [ ] Journey Agent review completed
- [ ] Every flow names the moments it produces (TBD until moment specs)
- [ ] Branch paths reference authoritative ST/TR context and SC/M refs
