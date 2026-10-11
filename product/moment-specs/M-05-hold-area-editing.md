# M-05 — Editing a held message in the hold area

Status: Retrofit draft 2026-10-12 — awaiting owner verdicts

> Retrofit: reconstructed from the shipped widget and chat handler and the development chat.
> Code refs: `W` = `assets/app-widget.js`, `H` = `scripts/chat-handler.mjs`. `#N` = chat message.
> Korean strings exact as shipped, with English gloss. "(inferred — needs owner verdict)" = no owner message.

---

## 0. Meta

| Field | Value |
|---|---|
| Moment ID | `M-05` |
| Name | Editing a hold item in place while its other actions stay available |
| Source | ST-10 ↔ ST-11; TR-18, TR-19, TR-21, TR-22, TR-23, TR-24, TR-20 (fold); entry from TR-17 / TR-12 / TR-13 |
| Journey | J-02 stage 3 "Change mind" and 5 "Release". F-06 steps 3-4; B-71…B-84 (`flows.md`) |
| Screens | SC-06 hold area (fold header + dashed hold bubbles with action row), SC-05, SC-16 toast |
| Model scope / revision | `state-model.md` retrofit r1 |
| Review evidence | No automated test for any hold action (code.md §6). Owner tested hold creation (#1128-#1131); edit/delete/move built #1237, #1242, #1246; no owner confirmation found for edit itself |
| Trigger | Owner presses `수정` on a dashed hold bubble at the bottom of the chat |
| Exit | `저장` (text updated), `수정 취소` (edit discarded), or one of `지우기` / `보관함` / `끼워넣기` / `보내기` directly from the editor (these save the edit first, except delete) |
| Linked decisions | ADR-0019 (stack holds at the chat bottom), ADR-0020 (separate hold and drafts-box buttons and styles), ADR-0026. Owner evidence: multiple stacked holds (#1122, #1124); hold actions edit/delete/interject/fold/cancelled→hold (#1227-#1231); other actions stay available while editing, hold interject orange (#1238, #1239); `▤ 보관함` label (#1306) |
| Inherited UX contracts | M-01 busy/↻ contract on every hold action button; preservation rule "중간에 하던 것들은 무조건 보존" (#1435, #1438) |
| Status | Draft (retrofit) |

---

## 1. The four questions

### 1.1 What does the user intend here?

Polish a parked thought — fix wording, add a line — and then decide in the same place whether
to send it, interject it, stash it in the drafts box, or drop it.

### 1.2 What might the user not know?

- That a hold item never reaches the session until he presses `보내기` or `끼워넣기`.
- That `보관함`, `끼워넣기` and `보내기` first save the edited text, while `지우기` throws the edit away.
- That `보내기` from hold sends the text as typed (no drafts-box numbering or metadata).
- That the edit (text and caret) survives a reload, but only in this browser.

### 1.3 What might make the user anxious?

- Losing an in-progress edit to a reload or re-render (#1405, #1433-#1438; "a re-render closes the keyboard", W:1340).
- Sending the old text by mistake while an edit is open.
- Holds piling up and hiding the conversation (fold added for this, #1230).

### 1.4 What feedback must the system give?

| Feedback ID / branch | Information needed | Control / result / indicator and placement | ST/TR refs | Visible copy IDs or None + reason | Accessible state / announcement |
|---|---|---|---|---|---|
| FB-01 / B1 | This is unsent and editable | Dashed bubble with tag and meta line; `수정` in its action row | ST-10 | C-01, C-02, C-03 | Buttons |
| FB-02 / B1 | Editing now | Bubble body becomes a textarea (focused); action row splits into two lines: [`수정 취소` `저장`] then [`지우기` `보관함` `끼워넣기`* `보내기`] | TR-18 → ST-11 | C-04 | Textarea `aria-label` C-05 |
| FB-03 / B1 | Saved | Editor closes, bubble shows new text; no toast | TR-19 → ST-10 | None — visible result suffices | — |
| FB-04 / B2 | Sent from hold | Hold bubble disappears; new own bubble appears with read mark (fast re-poll); no toast | TR-23 / TR-24 → ST-03/ST-04 + ST-14 | None (gap G3) | List live region |
| FB-05 / B2 | Moved to drafts box | Toast with action to open the destination label | TR-22 → ST-12 | C-07 | Toast `role="status"` |
| FB-06 / B4 | Deleted, undoable | Toast with `되살리기` for 6 s; then restorable from "최근 보낸 것·지운 것" for 7 days | TR-21 → ST-15; TR-31 | C-08 | Toast `role="status"` |
| FB-07 / B10 | Many holds | Fold header with count; folded state remembered per session | TR-20 | C-09 | Button |

\* `끼워넣기` only while the target Claude session is working (W:1135-1139).

---

## 2. Attention and effort

| Question | Answer |
|---|---|
| Where is the user's attention? | The hold bubble at the bottom, keyboard open on a phone |
| Holding in head? | Whether the edit is saved — `저장` and the save-first rule hold it |
| Must decide | Save vs send now vs stash vs delete |
| System knows but asks anyway | Nothing |
| How long here? | Seconds to minutes; may span a reload |

---

## 3. Branches available at this moment

| # | Branch type | Candidate | ST / TR refs | Verdict | ADR |
|---|---|---|---|---|---|
| B1 | Main path | `수정` → edit → `저장` | TR-18, TR-19 | Built; unverified; Pending verdict | — |
| B2 | Alternate action | From the editor: `보내기`, `끼워넣기`, `보관함` (each saves first) | TR-23, TR-24, TR-22 | Built (#1238, #1242); Pending | — |
| B3 | Cancel / back out | `수정 취소` → original text | TR-19 | Built; Pending | — |
| B4 | Undo after the fact | `지우기` → toast `되살리기`; trash restore within 7 days | TR-21, TR-31 | Built; unverified; Pending | — |
| B5 | Error / failure | Save/move/send request fails → generic toast; editor state (inferred) | W:337 | Pending | — |
| B6 | Wait | Each action button shows ↻ until the server answers | M-01 contract | Built | — |
| B7 | Empty | `저장` with empty text → nothing happens, editor stays open (W:1120-1121) | TR-19 guard | Built; no message (G1) | — |
| B8 | Unauthorized | N/A — single owner | — | N/A | — |
| B9 | Interrupted | Reload: text, focused field and caret restored (`__uifb_edit`); agent-invoked reload waits while editing | TR-55, TR-57 | Built (#1443, #1446); Pending | — |
| B10 | Repeat / concurrent | Several holds stacked; only one edited at a time; poll does not re-render while the editor has focus | W:1340 | Built; Pending | — |

---

## 4. Copy as currently shipped

| Slot | Korean text (exact) | English gloss | Source |
|---|---|---|---|
| C-01 Hold bubble tag | `보류 · 아직 안 보냄` | "Hold · not sent yet" | W:1091 |
| C-02 Hold meta line | `<time> · 보내기를 누를 때까지 세션에 가지 않음` | "<time> · won't go to the session until you press Send" | W:1104 |
| C-03 Edit action | `수정` | "Edit" | W:1132 |
| C-04 Editor actions | `수정 취소` / `저장` / `지우기` / `▤ 보관함` / `끼워넣기` / `보내기` | "Cancel edit" / "Save" / "Delete" / "▤ Drafts box" / "Interject" / "Send" | W:1129-1140, W:288 (▤ via CSS) |
| C-05 Editor accessible name | `보류 글 고치기` | "Edit held text" | W:1112 |
| C-06 Quote on hold (if attached) | `↩ <who>의 고른 부분: "<quote>"` / `↩ 답장 · <who>: <text>` / `📎 참고 · …` | as in M-04 | W:1101 |
| C-07 Moved to drafts box | `✓ 보관함으로 옮김` + action `<label> 열기` (`미분류 열기` when unlabelled) | "✓ Moved to the drafts box" + "Open <label>" | W:1134 |
| C-08 Deleted | `지움` + action `되살리기` | "Deleted" + "Restore" | W:1133, W:1582 |
| C-09 Fold header | `▾ 보류 N개` / `▸ 보류 N개 · 펼치기` | "▾ N on hold" / "▸ N on hold · expand" | W:1082 |
| Empty-save explanation | None | — | Gap G1 |

---

## 5. Timing

- Edit text and caret written to this browser every 1 s (W:2343-2364).
- Toasts: 6 s with an action, 3.5 s without.
- After send/interject from hold: 8 polls at 500 ms for the read mark.

## 6. Failure and recovery

| Failure | What the owner sees | Recovery | Evidence |
|---|---|---|---|
| Server error on any action | `처리하지 못했어요. 다시 눌러 주세요` | Press again | W:337 |
| Reload mid-edit | Cover waits ("지금 하던 것을 마치면 바로") for agent reloads; after any reload, edit and caret restored | Continue editing | TR-55, TR-57; #1444-#1446 |
| Target stops working mid-edit | `끼워넣기` disappears from the row on the next render (inferred) | Use `보내기` | W:1135 |

## 7. Reversibility contract

| Question | Answer |
|---|---|
| Reversible? | Yes for edit/delete/move; no for send once read |
| How / how long? | `수정 취소`; delete undo 6 s, trash 7 days; drafts item can be sent or deleted later |
| Warned before committing? | No confirmation on send or delete |
| Preserved if they leave? | Saved hold items server-side; in-progress edit per browser |
| Where does work live? | drafts.json (`hold:true`); `__uifb_edit` (this browser) |

Done criteria and stage 6 wireflow: not met; stage 6 skipped by owner choice (part 3 M13).

---

## 8. Gaps (needs owner verdict)

- **G1** `저장` with empty text silently does nothing. Should it explain, or offer `지우기`?
- **G2** `지우기` while editing discards the unsaved edit, and undo brings back only the last saved text (inferred from W:1133).
- **G3** Sending from hold shows no toast or confirmation. The hold bubble disappears and a new bubble appears. Enough feedback?
- **G4** Nothing on screen says that `보내기` / `끼워넣기` / `보관함` save the open edit first. The owner asked for the actions to stay available (#1238) but not for that cue.
- **G5** No path from a drafts-box item back to hold (state-model R3 note). Wanted?
- **G6** The in-progress edit is kept only in this browser. On another screen the old text shows. Intended?
- **G7** Hold editing, delete/undo, move and send have no owner confirmation on screen and no automated test (code.md §6). Run a review round?

---

## Evidence

#1121, #1122, #1124, #1127-#1131, #1143, #1145, #1227-#1246, #1292, #1296, #1306-#1311, #1403, #1409, #1435-#1446; W:1076-1144, W:2343-2364; H:441-449, H:483-525.
