# M-11 — Rating a round on the review page and marking it done

Status: Retrofit draft 2026-10-12 — awaiting owner verdicts

> Retrofit: reconstructed from the shipped ui-review-page and the development chat.
> Code refs: `RP` = ui-review-page `assets/review-page.js`, `RT` = `assets/review-template.html`,
> `RH` = `scripts/review-handler.mjs`. `#N` = chat message. Korean strings exact as shipped,
> with English gloss. "(inferred — needs owner verdict)" = no owner message.

---

## 0. Meta

| Field | Value |
|---|---|
| Moment ID | `M-11` |
| Name | Rating each change, then handing the verdicts back with "done" |
| Source | ST-47 → ST-48 → ST-49; TR-75, TR-76, TR-77; watcher state ST-22 / ST-24 for auto-continue |
| Journey | J-05 stages 3 "Rate" and 4 "Hand back". F-12; B-167…B-180 (`flows.md`) |
| Screens | SC-17 review (comparison) page; SC-18 zoom dialog; the chat panel embedded on the same page |
| Model scope / revision | `state-model.md` retrofit r1 |
| Review evidence | No tests in ui-review-page (code.md §5). Owner verified that done verdicts appear in chat (#572) and that done wakes a Codex session (#218-#223) |
| Trigger | Owner opens a review page (agent link or "비교 페이지 준비" push) and picks verdicts |
| Exit | `평가 완료 표시` pressed and saved: button disabled, summary posted to chat, session woken (auto-continue) or owner told to type in the terminal. Failure: note, button re-enabled |
| Linked decisions | ADR-0008 (compare UI on a generic live HTML page). Owner evidence: round review page with done waking the session (#218-#223); generic comparison page with live HTML (D32/D33 part 1, #541-#545); verdicts also go to chat (#561, #563); renamed "비교 페이지" (#581). Later the owner doubted the page's usefulness versus checking on the real screen (#1510; DQ-10 open) |
| Inherited UX contracts | None |
| Status | Draft (retrofit) |

---

## 1. The four questions

### 1.1 What does the user intend here?

Give a verdict per change quickly, add a word where needed, and let the session continue
without retyping anything.

### 1.2 What might the user not know?

- That every choice is saved immediately (no separate save).
- Whether the session is waiting and will continue by itself (auto-continue) or needs a terminal nudge.
- That done is one-way: the page cannot be reopened for changes.
- That done does not require every item to be rated.

### 1.3 What might make the user anxious?

- "Did my ratings save?"
- "Will the session actually pick this up?" — the auto-continue banner exists for this.
- Pressing done too early, with no way back.

### 1.4 What feedback must the system give?

| Feedback ID / branch | Information needed | Control / result / indicator and placement | ST/TR refs | Visible copy IDs or None + reason | Accessible state / announcement |
|---|---|---|---|---|---|
| FB-01 / B1 | Choice taken and saved | Verdict button pressed state; per-item status text `저장 중…` → `저장됨`; header count `n / N` | TR-75 → ST-47/48 | C-02, C-03 | `aria-pressed`; status text not live (G5) |
| FB-02 / B1 | Will the session continue by itself? | Mode banner at the top: auto-continue on (with agent name and expiry) / off; re-checked every 5 s | ST-22 / ST-24 | C-06 | Text |
| FB-03 / B1 | What to do when finished | Note under the done button, depending on auto-continue | ST-47/48 | C-07 | Text |
| FB-04 / B1 | Done recorded and what happens next | Button disabled; note says the agent continues or that he must type in the terminal; summary appears in chat | TR-76 → ST-49 | C-08 | Text |
| FB-05 / B5 | Done failed | Note; button re-enabled | TR-77 | C-09 | Text |
| FB-06 / B9 | Already done earlier | On load: button disabled, note | ST-49 | C-10 | Text |
| FB-07 / B5 | Server unreachable on load | Connection line | S8 | C-04 | Text |

---

## 2. Attention and effort

| Question | Answer |
|---|---|
| Where is the user's attention? | The before/after captures or live demos, then the verdict buttons |
| Holding in head? | Which items he has rated — the count and pressed states hold it |
| Must decide | One verdict per item; when to press done |
| System knows but asks anyway | Nothing |
| How long here? | Minutes per round |

---

## 3. Branches available at this moment

| # | Branch type | Candidate | ST / TR refs | Verdict | ADR |
|---|---|---|---|---|---|
| B1 | Main path | Rate items → (memo, overall) → `평가 완료 표시` → chat summary → session continues | TR-75, TR-76 | Built (#572); Pending verdict | — |
| B2 | Alternate action | Options comparison (`A안` … + `다른 방향`); zoom and pin notes | RP:69-98, SC-18 | Built; Pending | — |
| B3 | Cancel / back out | Leave without done; choices stay saved | ST-47 | Built | — |
| B4 | Undo after the fact | Change a verdict before done; nothing after done | TR-75; TR-76 one-way | Pending (G1) | — |
| B5 | Error / failure | Item save fails → `저장 실패 …`; done fails → note + retry; overall comment save failure is silent | TR-77, RP:410, RP:416 | Partially built (G4) | — |
| B6 | Wait | `저장 중…` per item; no loader for the page itself except `불러오는 중…` | S8 | Built | — |
| B7 | Empty | Page with no items | EM5 | Pending | — |
| B8 | Unauthorized | Auto-continue off (no watcher) → owner must type `피드백 확인해` in the terminal | ST-24 | Built; Pending | — |
| B9 | Interrupted | Reopen after done → disabled + note; reload before done → saved choices restored | ST-49 | Built; Pending | — |
| B10 | Repeat / concurrent | Done twice → second blocked by disabled button and server `done` flag | RH:158 | Built | — |

---

## 4. Copy as currently shipped

| Slot | Korean text (exact) | English gloss | Source |
|---|---|---|---|
| C-01 Verdicts / memo | `좋음` / `수정 필요` / `되돌리기` (options: option labels + `다른 방향`); memo placeholder `한 줄 의견 (선택)` | "Good" / "Needs changes" / "Revert" (options: … + "Different direction"); "One-line comment (optional)" | RP:5, RP:73, RP:313 |
| C-02 Item save status | `저장 중…` / `저장됨` / `저장 실패 — 서버가 켜져 있는지 확인하세요` | "Saving…" / "Saved" / "Save failed — check that the server is running" | RP:406-410 |
| C-03 Count | `n / N` | rated / total | RP:389 |
| C-04 Connection line | `불러오는 중…` → `선택하면 자동 저장됩니다.` / `서버에 연결되지 않았습니다. 터미널에서 서버를 켜 주세요.` | "Loading…" → "Choices save automatically." / "Can't reach the server. Start the server in the terminal." | RT:15, RP:479-481 |
| C-05 Overall | heading `전체 의견`; placeholder `방향, 색감, 추가로 바꾸고 싶은 점 등` | "Overall comment"; "Direction, colours, anything else to change" | RT:18-19 |
| C-06 Mode banner | `자동 이어가기 켜짐 · <agent>가 기다리는 중 (<time>까지)` + `완료 표시만 누르면 바로 이어서 작업합니다. 터미널에 메시지를 보낼 필요가 없습니다.` / `자동 이어가기 꺼짐` + `완료 표시를 누른 뒤 터미널에 "피드백 확인해"라고 보내야 작업이 이어집니다.` / after done: `자동 이어가기 · <agent>가 피드백을 받아 작업을 이어갑니다` + `터미널에 보낼 메시지는 없습니다.` | "Auto-continue on · <agent> is waiting (until <time>)" + "Just press done and it continues; no terminal message needed." / "Auto-continue off" + "After pressing done, send '피드백 확인해' (check the feedback) in the terminal to continue." / "Auto-continue · <agent> takes the feedback and continues" + "No terminal message needed." | RP:427-434, RT:14 (`확인 중…` "Checking…" before first poll) |
| C-07 Note before done | `다 봤으면 완료를 누르세요. 터미널 메시지는 필요 없습니다.` / `다 봤으면 완료를 누르고, 터미널에 "피드백 확인해"라고 보내 주세요.` | "When you've seen everything, press done. No terminal message needed." / "When you've seen everything, press done and send '피드백 확인해' in the terminal." | RP:437-439 |
| C-08 Done action and result | button `평가 완료 표시`; result `완료로 표시했습니다. <agent>가 이어서 작업합니다. 터미널에 보낼 메시지는 없습니다.` / `완료로 표시했습니다. 이제 터미널에 "피드백 확인해"라고 보내 주세요.` | "Mark rating done"; "Marked done. <agent> continues. No terminal message needed." / "Marked done. Now send '피드백 확인해' in the terminal." | RT:20, RP:462-464 |
| C-09 Done failure | `저장 실패 — 서버가 켜져 있는지 확인하세요.` | "Save failed — check that the server is running." | RP:465 |
| C-10 Already done | `이미 완료로 표시된 비교 페이지입니다. 작업이 이어지지 않았다면 터미널에 "피드백 확인해"라고 보내 주세요.` | "This comparison page is already marked done. If work didn't continue, send '피드백 확인해' in the terminal." | RP:478 |
| Pre-commit confirmation for done | None | — | Gap G1 |

---

## 5. Timing

- Each verdict or memo saves immediately; overall comment saves 0.6 s after typing stops.
- Auto-continue state polled every 5 s; the banner reflects the state at the moment done is pressed.
- Done: one POST; button disabled from the press.

## 6. Failure and recovery

| Failure | What the owner sees | Recovery | Evidence |
|---|---|---|---|
| Item save fails | C-02 failure text by the item | Re-press the verdict (inferred) | RP:410 |
| Overall comment save fails | Nothing | None | RP:416 `.catch(() => {})` |
| Done save fails | C-09; button enabled again | Press done again | TR-77 |
| Watcher expires before done | Banner switches to off; note tells him to use the terminal | Type `피드백 확인해` in the terminal | ST-24 |
| Done saved but the chat/wake wiring is missing | Note says the agent continues; nothing happens (inferred) | Terminal | LC-6: `onDone` wiring lives in neither repo |

## 7. Reversibility contract

| Question | Answer |
|---|---|
| Reversible? | Verdicts: yes until done. Done: No |
| How / how long? | Change any verdict or memo until done |
| If no — warned before committing? | No. The button label and note do not say it is final |
| Preserved if they leave? | All choices saved server-side per round |
| Where does work live? | `r<round>.json` (non-atomic write, code.md §5) |

The template requires a pre-commit confirmation for an irreversible step. None is shipped (G1).

Done criteria and stage 6 wireflow: not met; stage 6 skipped by owner choice (part 3 M13).

---

## 8. Gaps (needs owner verdict)

- **G1** Done is irreversible with no confirmation and no "it's final" wording.
- **G2** Done is allowed with unrated items (count shown, not checked) (state-model ST-48). Warn, block, or allow?
- **G3** The done → chat summary → session-wake wiring lives in a combined server that is in neither repo (LC-6). The success note can promise continuation that never happens.
- **G4** A failed overall-comment save is silent (RP:416).
- **G5** Item save status text is not announced (no live region).
- **G6** Whether this journey stays at all: the owner later preferred verifying on the real screen (#1510; DQ-10 open). Freeze this moment or retire it?
- **G7** Empty review page (no items) has no designed state (EM5).

---

## Evidence

#218-#223, #226, #229, #541-#545, #561, #563, #570, #572, #579, #581, #589, #602, #1008-#1019, #1510; RP:5, RP:73, RP:306-481; RT:12-20; RH:128-164.
