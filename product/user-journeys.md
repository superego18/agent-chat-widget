# User Journeys — `agent-chat-widget` + `ui-review-page`

Status: Retrofit draft 2026-10-12 — awaiting owner verdicts

> **Layer position:** `product-brief` → **`user-journeys`** → `flows` → `state-model` → `screen-map` → `moment-spec`
> **Framing:** a journey is organized around a **user goal**, not a feature.
>
> Retrofit: reconstructed from chat #ids. The product already ships, so "Friction" lists
> where each journey hurts **today**, taken from bugs the owner reported. `#N` = global chat
> message number. Users, goals and SC ids come from `product/discovery.md`; terms from
> `GLOSSARY.md`. Flows do not exist yet, so every stage is "unrealized (stage 2)".
> Emotions are read from the owner's wording; anything else is marked
> "(inferred — needs owner verdict)".

---

## 0. Meta

| Field | Value |
|---|---|
| Version / date | Retrofit draft 1 / 2026-10-12 |
| Scope / exclusions | Chat panel, hold/drafts box, notifications, reload, setup, review page. Excludes the host app itself and the agents' own behavior |
| Status | Draft |
| Linked decisions | None yet (0 ADRs). See discovery DQ-01..12 |

---

## Journey index

| ID | Goal | User | Serves criterion | Status |
|---|---|---|---|---|
| J-01 | Direct a working session from my phone | U-1 | SC-1, SC-3 | Draft |
| J-02 | Get a thought out of my head while the agent is busy | U-1 | SC-2 | Draft |
| J-03 | Answer or point at something said earlier | U-1 | SC-3 | Draft |
| J-04 | Find out a session needs me, and get straight back to it | U-1 | SC-4 | Draft |
| J-05 | Judge a round of UI changes and hand the verdicts back | U-1 | SC-6 | Draft |
| J-06 | Keep several sessions moving at once | U-1 | SC-1, SC-3 | Draft |
| J-07 | Carry on after a reload or network trouble without losing anything | U-1 | SC-5 | Draft |
| J-08 | Put the widget on a new project | U-2 (and U-1 on each new project) | SC-8 | Draft |

---

## J-01 — Direct a working session from my phone

| Field | Value |
|---|---|
| User | U-1, away from the desk, phone on Wi-Fi or a mobile network |
| Goal | Tell a session what to do next and see it act, without a terminal |
| Serves | SC-1, SC-3 |
| Entry | Home-screen app or browser bookmark on the phone; a notification (J-04) |
| Done when | He sees `읽음` on his message and the answer arrives in the same tab |
| Span | Recurring, many times a day |

### Stages

| # | Stage | What the user is doing | What they need | Realized by flow |
|---|---|---|---|---|
| 1 | Open | Opens the app address on the phone | Stable address that works on any network, key not visible | unrealized (stage 2) |
| 2 | Orient | Opens `대화/피드백`, picks the session tab | What the session is doing now (working, approval, idle) | unrealized (stage 2) |
| 3 | Say it | Types, optionally `위치 찍기` on the app or chat | Full-screen panel, no zoom, keyboard not covering input | unrealized (stage 2) |
| 4 | Send | `보내기` | Proof the server took it; truthful read state | unrealized (stage 2) |
| 5 | Read answer | Reads the reply, scrolls history | Answer starts at its top; place kept | unrealized (stage 2) |

### Emotions / worries
- Unsure whether the agent saw a message sent while it worked; this led to read receipts (#605).
- Distrust when the chat looks dead: thought the conversation stopped (#582, #1521).
- Wants it to feel like a real messenger (#32, #79, #83).

### Friction inventory (where it hurts today)

| Stage | Current cost | Must be removed? |
|---|---|---|
| 1 | Address broke when the Mac changed networks (#582–#587); access key leaked into sent location (#458) | Y (fixed; keep tested) |
| 2 | Status stuck on "working" when a hook failed silently (#667, #676) | Y |
| 3 | iOS zoom, autofocus raising the keyboard, page dragging behind the panel (#467–#471, #1204) | Y (fixed; untested) |
| 4 | Message sent while agent worked never delivered (#954, #1062); delayed bubble and text left in input (#1267) | Y |
| 5 | List jumped while reading; position shifted on new answers (#1203, #1210) | Y |
| all | Watcher stops when the session forgets to restart it; messages wait silently (#1521, #1522) | Y — open (LC-1) |

### Moments of judgment

| Stage | Why it is a moment | `M-xx` |
|---|---|---|
| 4 | `안 읽음(…)` suffix decides whether he waits, interjects or cancels | TBD |
| 2 | Stale "N분째 그대로예요" decides whether to go to the terminal | TBD |

Evidence: #11, #32, #458, #462–#473, #582–#587, #605, #617, #629, #776, #1203–#1216, #1521.

---

## J-02 — Get a thought out of my head while the agent is busy

| Field | Value |
|---|---|
| User | U-1, agent mid-task |
| Goal | Capture an idea now and decide later whether, when and how it reaches the agent |
| Serves | SC-2 |
| Entry | Watching an answer stream; testing the app on the phone; a sudden idea |
| Done when | The thought is either delivered at the moment he chose, or parked where he will find it |
| Span | One sitting (hold) to several days (drafts box) |

### Stages

| # | Stage | What the user is doing | What they need | Realized by flow |
|---|---|---|---|---|
| 1 | Capture | Types the thought | Text kept even if he leaves | unrealized (stage 2) |
| 2 | Choose route | `보내기` (read after work ends), `끼워넣기` (read between tool calls), `보류` (stays at bottom), `▤ 보관함` (by category) | Four distinct, clearly named buttons; one action per input | unrealized (stage 2) |
| 3 | Change mind | `보내기 취소`, `보류로`, toggle `끼워넣기 취소`, edit a hold item | Undo before the agent reads it | unrealized (stage 2) |
| 4 | Sort | Picks a category chip, `+ 새 분류`, moves items | Category per session; visible confirmation (toast, fly animation) | unrealized (stage 2) |
| 5 | Release | Sends one, a category, or selected drafts as one numbered message | Quotes and locations kept with the item | unrealized (stage 2) |

### Emotions / worries
- Does not want to interrupt the agent unless he chooses to: "내가 끼워넣고 싶으면 끼워넣을 수 있는거지?" (#794).
- Wants minimal choices first (#1115) and separate named buttons over gestures (#1136, #1137).
- Needs to see that the save happened (#849, #908, #968).
- Drafts pile up; he worries about the ongoing flow, not today's backlog (#1473).

### Friction inventory (where it hurts today)

| Stage | Current cost | Must be removed? |
|---|---|---|
| 2 | Old single `나중에` with short/long press was ambiguous (#525, #1134) | Y (fixed) |
| 3 | Cancelled message refused because status lagged (#842) | Y (fixed) |
| 4 | Category chips duplicated, selection mixed across sessions, flash of `미분류` on reload (#525, #533, #945) | Y (fixed) |
| 5 | Batched send drops reply/reference info (agent #1409) | Y — open (LC-2) |
| all | ~25–30 queued drafts never processed (#907, #1473) | Owner verdict (LC-5) |
| all | Hold and drafts box features have no automated tests (code.md §6) | Y |

### Moments of judgment

| Stage | Why it is a moment | `M-xx` |
|---|---|---|
| 2 | Picking among send / interject / hold / drafts box | TBD |
| 3 | Racing the agent to cancel before it reads | TBD |

Evidence: #246, #250, #373, #513–#578, #786–#808, #832, #849, #908, #1113–#1143, #1227–#1246, #1407.

---

## J-03 — Answer or point at something said earlier

| Field | Value |
|---|---|
| User | U-1 |
| Goal | Make clear which earlier message (or part of it) his new message answers or relies on |
| Serves | SC-3 |
| Entry | Reading a long agent answer; scrolling back through history |
| Done when | The agent responds to the right point and the line between question and answer is visible |
| Span | One sitting |

### Stages

| # | Stage | What the user is doing | What they need | Realized by flow |
|---|---|---|---|---|
| 1 | Find | Scrolls to the message | Position kept; `원문으로` to jump | unrealized (stage 2) |
| 2 | Select | Taps `답장` / `참고`, or selects text → `↩ 답장` / `📎 참고` | Pill only when selecting inside a message; works on iOS | unrealized (stage 2) |
| 3 | Write | Types with the quote bar above input | Quote readable (4 lines, `펼치기`) | unrealized (stage 2) |
| 4 | Fix | `다시 보내기` on a read message; edits in the bubble | Edit inside the original bubble, explicit resend | unrealized (stage 2) |
| 5 | Follow | Taps a message to highlight its links | Lines that do not clutter, exact targets | unrealized (stage 2) |

### Emotions / worries
- Text references like "#N에 대한 답" are not intuitive (#996).
- Lines make the screen busy (#1043); wants it calm but traceable (#1019).
- Wants accuracy over guessing for reply targets: "그걸 보려고 하는 거니까" (#1090).

### Friction inventory (where it hurts today)

| Stage | Current cost | Must be removed? |
|---|---|---|
| 2 | Long-press outside a bubble quoted the wrong message (#1351–#1357) | Y (fixed; untested) |
| 3 | Quotes cut to one line (#884) | Y (fixed) |
| 4 | Resend focuses the main input instead of the edit box on iOS; cause unknown (#1323, #1327) | Y — open (LC-3) |
| 5 | Links fall back to order guessing when the agent omits `<re N>` (code.md §5) | Owner verdict |

### Moments of judgment

| Stage | Why it is a moment | `M-xx` |
|---|---|---|
| 2 | Reply vs reference: does the agent treat it as the question? | TBD |

Evidence: #737, #749, #753, #766, #868–#904, #990–#1049, #1088, #1247–#1265, #1351–#1371.

---

## J-04 — Find out a session needs me, and get straight back to it

| Field | Value |
|---|---|
| User | U-1, in another app, another browser tab, or with the panel closed |
| Goal | Notice an answer, finished work, approval request, ready review page or stuck session, then act on it |
| Serves | SC-4 |
| Entry | Push notification on phone/desktop; badge, peek or `(N)` title while the panel is closed |
| Done when | He is in the right session tab, at the first unread answer |
| Span | Recurring |

### Stages

| # | Stage | What the user is doing | What they need | Realized by flow |
|---|---|---|---|---|
| 1 | Set up | `🔕 알림` → allow → `시험 알림`; picks kinds | Works on iOS home-screen app; per-device settings | unrealized (stage 2) |
| 2 | Get told | Receives a push or sees badge/peek | Once per event; quiet while viewing if chosen | unrealized (stage 2) |
| 3 | Return | Taps the notice | Opens that session's tab | unrealized (stage 2) |
| 4 | Catch up | Reads from `여기부터 새 메시지` | Read marks synced across devices | unrealized (stage 2) |

### Emotions / worries
- Wants notices to be useful but quiet; other-session activity should not buzz (#1449).
- Annoyed by missed and doubled notices (#1336, #1343).

### Friction inventory (where it hurts today)

| Stage | Current cost | Must be removed? |
|---|---|---|
| 2 | Notices missed for 30 s after leaving the panel (#1336) | Y (fixed) |
| 2 | Same answer notified twice (#1343) | Y (fixed) |
| 3 | Tapping opened the previously viewed tab (#1455) | Y (fixed) |
| 4 | Opening the panel cleared all badges; read state not shared across screens (#55, #325) | Y (fixed) |
| all | No automated tests for push (code.md §6) | Y |

### Moments of judgment

| Stage | Why it is a moment | `M-xx` |
|---|---|---|
| 1 | Choosing which kinds to allow; agent recommended fewer than he chose (#1177) | TBD |
| 2 | `승인 필요` — the session is blocked until he acts | TBD |

Evidence: #28, #45, #55, #325, #1155–#1180, #1336–#1349, #1447–#1463.

---

## J-05 — Judge a round of UI changes and hand the verdicts back

| Field | Value |
|---|---|
| User | U-1 |
| Goal | Decide per change `좋음` / `수정 필요` / `되돌리기` (or pick between options) and let the session continue without retyping |
| Serves | SC-6 |
| Entry | `비교 페이지 준비` notification; a link from the session in chat |
| Done when | `평가 완료 표시` pressed, verdicts appear in chat, the session continues |
| Span | One sitting per round |

### Stages

| # | Stage | What the user is doing | What they need | Realized by flow |
|---|---|---|---|---|
| 1 | Open | Opens the review page | Same chat panel available there | unrealized (stage 2) |
| 2 | Inspect | Compares before/after or options; zooms, pins notes; tries live HTML demos | Numbered boxes tied to change lines; real interaction for feel | unrealized (stage 2) |
| 3 | Rate | Picks a verdict, writes a one-line memo, `전체 의견` | Autosave | unrealized (stage 2) |
| 4 | Hand back | `평가 완료 표시` | `자동 이어가기 켜짐` so the session wakes | unrealized (stage 2) |

### Emotions / worries
- Screenshots cannot show feel or animation (#541).
- Later: the review page cannot really be used, so he prefers checking on the real screen (#1510). Whether this journey stays is open (DQ-10).

### Friction inventory (where it hurts today)

| Stage | Current cost | Must be removed? |
|---|---|---|
| 1 | Panel could not be hidden on the review page (#300) | Y (fixed) |
| 2 | Leftover "리뷰" wording (#581, #589, #602) | Y (fixed) |
| 4 | "Done" wiring lives in a combined server that is in neither repo (code.md §5) | Owner verdict (LC-6) |
| all | Review page has no automated tests (code.md §5) | Y |

### Moments of judgment

| Stage | Why it is a moment | `M-xx` |
|---|---|---|
| 3 | Choosing among proposals after trying them live (#1010, #1019) | TBD |

Evidence: #218–#244, #300, #541–#563, #579, #581, #1008–#1019, #1510.

---

## J-06 — Keep several sessions moving at once

| Field | Value |
|---|---|
| User | U-1 with two or more sessions (e.g. a work session and a skill session) |
| Goal | Know what each session is doing, talk to each without mixing them up, and see when they talk to each other |
| Serves | SC-1, SC-3 |
| Entry | Panel open on any tab; notification from another session |
| Done when | Every session is either working on something he asked or waiting on him, and he knows which |
| Span | Recurring |

### Stages

| # | Stage | What the user is doing | What they need | Realized by flow |
|---|---|---|---|---|
| 1 | Scan | Looks at tab dots and per-tab badges | Busy / watching / off at a glance | unrealized (stage 2) |
| 2 | Switch | Changes tab | Sending only to that session; its own drafts categories | unrealized (stage 2) |
| 3 | Watch handoffs | Sees `세션끼리` bubbles and the arrow between tabs | Shown only while it happens | unrealized (stage 2) |
| 4 | Redirect | Moves a draft to another session; asks one session to wait for another | Sessions do not disturb each other | unrealized (stage 2) |

### Emotions / worries
- Wants one screen for everything (#11).
- Protective of other sessions' work; shared servers restart only with permission (#209).

### Friction inventory (where it hurts today)

| Stage | Current cost | Must be removed? |
|---|---|---|
| 1 | Codex sessions have no live status, cancel or interject (code.md §5) | Owner verdict (NG-9) |
| 3 | Arrow for non-adjacent tabs never checked with 3+ sessions (#734, #735) | Owner verdict (LC-4) |
| 3 | Peer messages matched by identical text within 10 min (code.md §5) | (inferred — needs owner verdict) |
| 2 | Drafts category selection mixed across sessions (#533) | Y (fixed) |

### Moments of judgment

| Stage | Why it is a moment | `M-xx` |
|---|---|---|
| 1 | Deciding which session needs him first | TBD |

Evidence: #11, #13, #22, #194–#216, #209, #533, #700–#735, #1152.

---

## J-07 — Carry on after a reload or network trouble without losing anything

| Field | Value |
|---|---|
| User | U-1 |
| Goal | Return to exactly what he was doing: tab, reading position, typed text, attached quote, picked location, edits |
| Serves | SC-5 |
| Entry | Manual `↻`; agent-invoked reload; phone app restored from background; network change |
| Done when | Screen looks as he left it and nothing he typed is gone or resent |
| Span | One sitting |

### Stages

| # | Stage | What the user is doing | What they need | Realized by flow |
|---|---|---|---|---|
| 1 | Reload happens | Presses `↻` or the session reloads the widget | Cover `대화창을 새로 고치는 중이에요 · 잠시 손대지 마세요`; wait if he is editing | unrealized (stage 2) |
| 2 | Return | Panel reopens | Same tab, same scroll offset | unrealized (stage 2) |
| 3 | Resume | Continues typing or editing | Text, quote, location, caret, sheet state restored; sent text not restored | unrealized (stage 2) |
| 4 | Switch device | Continues on desktop what he started on the phone | Text, tab, read state, reading position shared | unrealized (stage 2) |

### Emotions / worries
- "사용자가 원치 않게 새로고침될 수 있으니까 중간에 하던 것들은 무조건 보존" (#1438).
- Wants to know when not to touch anything (#1374, #1375).

### Friction inventory (where it hurts today)

| Stage | Current cost | Must be removed? |
|---|---|---|
| 1 | Silent auto-reload broke a send mid-flight (#1372) | Y (fixed by reload tool) |
| 2 | Small residual shift on reload, cause unknown (#1217) | Y — open |
| 3 | Typed text, attached quote and pick lost on reload (#345, #1405, #1433) | Y (fixed) |
| 3 | Already-sent text refilled into the input (#1202, #1267) | Y (fixed) |
| 4 | Some state is server-shared, some per-browser only (reply, location, edits, sheet) (code.md §5) | (inferred — needs owner verdict) |

### Moments of judgment

| Stage | Why it is a moment | `M-xx` |
|---|---|---|
| 1 | Agent asks to reload while he is mid-edit | TBD |

Evidence: #325, #334–#356, #477, #582–#587, #1181–#1225, #1372–#1393, #1403–#1446.

---

## J-08 — Put the widget on a new project

| Field | Value |
|---|---|
| User | U-2 (adopter); also U-1 starting a new project |
| Goal | Get the panel showing on his app and talking to his sessions |
| Serves | SC-8 |
| Entry | README of the public repo; the owner's own skill (inferred — needs owner verdict) |
| Done when | `대화/피드백` appears on the app and a test message reaches a session |
| Span | One sitting |

### Stages

| # | Stage | What the user is doing | What they need | Realized by flow |
|---|---|---|---|---|
| 1 | Get it | Adds the repos (as submodules or a clone) | No dependencies; Node 18+ | unrealized (stage 2) |
| 2 | Run | Starts chat server and app proxy | Two commands; app works as before through the proxy | unrealized (stage 2) |
| 3 | Connect | Registers sessions, installs hooks, starts the watcher | Clear steps; hooks kept out of git | unrealized (stage 2) |
| 4 | Reach from phone | `--lan` with access key or tailnet | Private access only | unrealized (stage 2) |
| 5 | Add review page | Mounts ui-review-page and wires "done" | Documented wiring | unrealized (stage 2) |

### Emotions / worries
- Owner asks about openness and trust before installing tools (#619) — an adopter likely does too (inferred — needs owner verdict).
- Owner wants clean separation of chat and review page (#1545).

### Friction inventory (where it hurts today)

| Stage | Current cost | Must be removed? |
|---|---|---|
| 2 | Dev server blocked HMR from another host, causing reload loops (#484) | Y (fixed) |
| 3 | Session registration and hooks are documented in another skill, not this README (README) | (inferred — needs owner verdict) |
| 3 | Other device must pull and enable hooks path per repo (agent #1564, #1575) | (inferred — needs owner verdict) |
| 5 | Combined server with `onDone` wiring is in neither repo (code.md §5) | Owner verdict (LC-6) |

### Moments of judgment

| Stage | Why it is a moment | `M-xx` |
|---|---|---|
| 4 | Choosing an access method that keeps the app private | TBD |

Evidence: #401, #404, #419, #430–#459, #484, #1538–#1547, #1564, #1575; README.

---

## Production freeze readiness (Stage 7)

- [ ] Every journey states a user goal, not a feature or a screen
- [ ] Every journey maps to a success criterion in the brief
- [ ] "Done when" is written from the user's perspective
- [ ] Entry points include arrivals from outside the product
- [ ] Every stage names the flow that realizes it — or is flagged as unrealized
- [ ] As the later model evolves, J/F refs trace to ST/TR paths and SC/M refs in `state-model.md` coverage; reconcile Pending gaps at stage 6
- [ ] Moments of judgment identified and handed to `moment-specs/`
- [ ] Journey Agent review completed
