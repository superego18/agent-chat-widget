# M-02 — Sending while the session is working (interject or wait)

Status: Retrofit draft 2026-10-12 — awaiting owner verdicts

> Retrofit: reconstructed from the shipped widget, hook relay and watcher, and the development
> chat. Code refs: `W` = `assets/app-widget.js`, `H` = `scripts/chat-handler.mjs`,
> `HR` = `scripts/hook-relay.mjs`, `WR` = `scripts/wait-review.mjs`. `#N` = chat message.
> Korean strings exact as shipped, with English gloss. "(inferred — needs owner verdict)" = no owner message.

---

## 0. Meta

| Field | Value |
|---|---|
| Moment ID | `M-02` |
| Name | Choosing between "read when the work ends" and "interject now" while a session works |
| Source | ST-18/ST-19 (session working / waiting for approval) × ST-03/ST-04; TR-05, TR-08, TR-09, TR-10, TR-06 (guard: not while working), TR-37 (stale) |
| Journey | J-02 stage 2 "Choose route" and 3 "Change mind"; J-01 stage 4. F-02; B-02 (F-01), B-23…B-31 (`flows.md`) |
| Screens | SC-07 (`끼워넣기` button), SC-05 (bubble read mark, `끼워넣기` toggle, typing row), SC-03 (mode line), SC-04 (tab dot), SC-01 (launcher dots) |
| Model scope / revision | `state-model.md` retrofit r1 |
| Review evidence | No diagram; no automated test for interject. Owner verified live (#799, #808, #818; toggle #1053, #1059) |
| Trigger | Owner has text to send and the target Claude session is working or waiting for approval |
| Exit | Message saved as unread, either plain (read after Stop) or interject (read at next tool boundary); or converted later with the toggle; then read (ST-05) |
| Linked decisions | ADR-0013 (interject only through an explicit button), ADR-0011, ADR-0009, ADR-0003 (Codex via queue). Owner evidence: decision D10 part 2 (#792, #794): explicit `끼워넣기` only while working, plain send waits |
| Inherited UX contracts | M-01 busy/↻ contract for both buttons |
| Status | Draft (retrofit) |

---

## 1. The four questions

### 1.1 What does the user intend here?

Get a thought to the agent without derailing it — unless he decides it matters now. In his
words: "내가 끼워넣고 싶으면 끼워넣을 수 있는거지?" ("I can interject if I want to, right?") (#794).

### 1.2 What might the user not know?

- That plain `보내기` will not reach the agent until its current turn ends.
- That `끼워넣기` is delivered between tool calls, not instantly, and only for Claude sessions.
- Whether the session is really working or stuck (hook failed, B5 part 2 #667-#683).
- That he can switch an already-sent unread message to interject, or back (#1051).
- That a session waiting for approval in the terminal will not take either kind until approved (inferred).

### 1.3 What might make the user anxious?

- "Did the agent see what I sent while it was working?" — origin of read receipts (#605).
- "Will interjecting break what it is doing?"
- "Is it actually working, or frozen?" (#667, #676; stale hint).
- Messages sent while working that never got delivered (B21, B28 part 2: #954, #1062).

### 1.4 What feedback must the system give?

| Feedback ID / branch | Information needed | Control / result / indicator and placement | ST/TR refs | Visible copy IDs or None + reason | Accessible state / announcement |
|---|---|---|---|---|---|
| FB-01 / B1 | Session is working right now, and on what | Pulsing tab dot; launcher dots (amber for approval); typing row at list bottom with current tool | ST-18, ST-19; TR-33…TR-35 | C-06, C-07 | Launcher `title` C-08; dots are visual only |
| FB-02 / B2 | An "interject" route exists now | `끼워넣기` button appears under `보내기` only while target is a Claude session in ST-18/ST-19 | W:1169 | C-01, C-02 (tooltip) | Button appears without announcement |
| FB-03 / B1 | When a plain message will be read | Read mark suffix on the floating unread bubble | ST-03 | C-03 | Text only |
| FB-04 / B2 | When an interject will be read | Orange ` · 끼워넣기` tag and suffix on the bubble | ST-04 | C-04, C-05 | Text only |
| FB-05 / B4 | Change mind before it is read | On-bubble `끼워넣기` / `끼워넣기 취소` toggle while unread | TR-09, TR-10 | C-09 | Button |
| FB-06 / B1 | It was read | Read mark `읽음`; bubble drops from bottom to the read-time position | TR-06, TR-08 → ST-05 | C-03 last form | Drop animation off under reduced motion; mark stays |
| FB-07 / B6 | It may be stuck | Typing row appends stale hint after 5 min; one "오래 멈춤" push | TR-37 → ST-20 | C-07 stale | Text only; unverified on screen (#683) |
| FB-08 / B5 | Toggle refused (already read) | Browser `alert()` with server text | 409 | C-10 | Native alert |

---

## 2. Attention and effort

| Question | Answer |
|---|---|
| Where is the user's attention? | The streaming answer / typing row, then the two send buttons |
| Holding in head? | Whether the agent is mid-task; the UI shows it via dots and typing row |
| Must decide | Wait or interject — one extra decision only while working |
| System knows but asks anyway | Nothing |
| How long here? | Seconds to decide; minutes until read |

---

## 3. Branches available at this moment

| # | Branch type | Candidate | ST / TR refs | Verdict | ADR |
|---|---|---|---|---|---|
| B1 | Main path | `보내기` while working → unread "(작업 중이라 끝나면 읽음)" → watcher delivers after Stop | TR-02, TR-03, TR-36, TR-06 | Built; owner-chosen (#792); Pending verdict | — |
| B2 | Alternate action | `끼워넣기` → unread "(다음 단계에서 바로 읽음)" → PostToolUse injects | TR-05, TR-08 | Built, verified (#799, #808, #818); Pending | — |
| B3 | Cancel / back out | `보내기 취소` / `보류로` while unread | TR-11, TR-12 | See M-03 | — |
| B4 | Undo after the fact | Toggle `끼워넣기` / `끼워넣기 취소` on unread bubble | TR-09, TR-10 | Built, verified (#1053, #1059); Pending | — |
| B5 | Error / failure | Toggle after delivery → 409 alert | H:864 | Built; alert() pattern Pending (E4) | — |
| B6 | Wait / long-running | Working ≥5 min → stale hint + push; >30 min → status unknown, watcher no longer blocked | TR-37, TR-38 | Built, agent-initiated, unverified (part 2 F8) | — |
| B7 | Empty | Not working → no `끼워넣기` button; plain send only | W:1169 | Built; Pending | — |
| B8 | Unauthorized | Codex session: no working status, no interject, delivered immediately via queue | TR-07 | Built; NG-9 inferred | — |
| B9 | Interrupted | Turn ends with no further tool call → interject not injected; watcher delivers it after Stop like a plain message (WR pendingMessages includes it) | TR-36, TR-06 | Built (inferred from WR:70-87); Pending | — |
| B10 | Repeat / concurrent | Several interjects queued → all injected at the next PostToolUse together | HR:97-114 | Built; Pending | — |

---

## 4. Copy as currently shipped

| Slot | Korean text (exact) | English gloss | Source |
|---|---|---|---|
| C-01 Interject button | `끼워넣기` | "Interject" (slot it in) | W:318 |
| C-02 Interject tooltip | `하던 일이 끝나길 기다리지 않고, 세션이 다음 단계로 넘어갈 때 바로 읽게 보내기` | "Send so the session reads it at its next step, without waiting for the current work to finish" | W:318 |
| C-03 Read mark | ` · 안 읽음(작업 중이라 끝나면 읽음)` → ` · 읽음` | "unread (busy; will read when done)" → "read" | W:1615, W:1613 |
| C-04 Interject read mark | ` · 안 읽음(다음 단계에서 바로 읽음)` | "unread (will read right at the next step)" | W:1615 |
| C-05 Interject tag | ` · 끼워넣기` (orange) | "interject" | W:1000 |
| C-06 Typing row | `작업 중 · <detail>` / `작업 중 · 생각하는 중` / `터미널에서 승인을 기다리는 중` | "Working · <tool>" / "Working · thinking" / "Waiting for approval in the terminal" | W:815 |
| C-07 Stale suffix | ` · N분째 그대로예요. 답이 안 오면 터미널을 확인해 주세요` | "· unchanged for N minutes. If no answer comes, please check the terminal" | W:818 |
| C-08 Launcher tooltip | `세션이 작업 중` / `세션이 터미널에서 승인을 기다리는 중` | "A session is working" / "A session is waiting for approval in the terminal" | W:1193 |
| C-09 Bubble toggle | `끼워넣기` / `끼워넣기 취소` | "Interject" / "Cancel interject" | W:966 |
| C-10 Toggle error (alert) | `세션이 이미 받아 갔습니다.` (fallback `바꾸지 못했습니다.`) | "The session already took it." (fallback "Couldn't change it.") | H:864, W:969 |
| C-11 Mode line while watcher handles | `<name>이(가) 메시지를 처리하는 중입니다. 지금 보내도 처리가 끝나면 바로 받습니다.` | "<name> is handling messages. If you send now, it takes it as soon as it finishes." | W:1174 |
| Agent-side wrapper (not shown to owner) | `[대화창 · 작업 중에 끼워넣은 메시지] …` | "[Chat · message interjected during work] …" | HR:109 |

---

## 5. Timing

- Interject button visibility follows status polled every 3 s; status itself is pushed by hooks on each event.
- Interject delivered at the next PostToolUse (seconds, depends on the agent's tools).
- Plain message delivered by the watcher (1 s poll) after Stop; done push 3 s after Stop.
- Stale hint at ≥5 min without status change; stale push once per stuck state; status treated as unknown after 30 min.

## 6. Failure and recovery

| Failure | What the owner sees | Recovery | Evidence |
|---|---|---|---|
| Hook relay fails, status stuck "working" | Typing row keeps showing; stale hint after 5 min; plain messages wait up to 30 min | Check the terminal (C-07) | B5 part 2 #667-#683; state-model E11 |
| Watcher off when work ends | Plain message stays "안 읽음"; hint C-06 of M-01 asks to type in terminal | Owner asks session to restart watcher | B22 part 3 #1521-#1526 |
| Toggle after delivery | alert C-10 | None needed; message was read | H:864 |

## 7. Reversibility contract

| Question | Answer |
|---|---|
| Reversible? | Partially — until the message is read |
| How / how long? | Toggle interject, cancel, or move to hold while unread |
| Warned before committing? | No; the tooltip explains interject timing (desktop hover only) |
| Preserved if they leave? | Message is server-side; nothing local at risk |
| Where does unsaved work live? | N/A after acceptance |

Done criteria and stage 6 wireflow: not met; stage 6 skipped by owner choice (part 3 M13).

---

## 8. Gaps (needs owner verdict)

- **G1** The `끼워넣기` button appears and disappears with status polls (3 s), shifting the button column while he types. Acceptable? (inferred)
- **G2** In approval wait (ST-19) the button is offered, but nothing is read until he approves in the terminal. Should the copy say so?
- **G3** If the turn ends without another tool call, an interject is delivered like a plain message after Stop, and the "(다음 단계에서 바로 읽음)" promise is not kept. Wording or behavior?
- **G4** Interject and cancel use different server guards (code.md §5: interject ignores `id <= d[to]`), so a message can be cancellable but not interjectable or the other way round.
- **G5** C-10 uses `alert()` with no next step (state-model E4).
- **G6** Codex sessions show no working state and no interject (NG-9 is inferred, never requested). Confirm the non-goal.
- **G7** C-02 lives only in a hover tooltip, which touch phones never show. The meaning of `끼워넣기` is not visible on the phone.
- **G8** Stale hint and stale push (FB-07) were agent-initiated and never confirmed on screen (#683). Keep, change, or remove?

---

## Evidence

#605, #667, #676, #683, #786, #791, #792, #794, #799, #804, #808, #818, #819-#821, #954, #1051, #1053, #1059, #1062, #1096, #1098, #1102, #1229, #1239, #1521-#1526; W:318, W:813-818, W:960-974, W:1168-1177, W:1608-1617; HR:95-114; WR:70-87; H:851-871.
