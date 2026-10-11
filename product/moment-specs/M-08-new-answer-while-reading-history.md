# M-08 — A new answer arriving while reading older messages

Status: Retrofit draft 2026-10-12 — awaiting owner verdicts

> Retrofit: reconstructed from the shipped widget and the development chat.
> Code refs: `W` = `assets/app-widget.js`, `H` = `scripts/chat-handler.mjs`. `#N` = chat message.
> Korean strings exact as shipped, with English gloss. "(inferred — needs owner verdict)" = no owner message.

---

## 0. Meta

| Field | Value |
|---|---|
| Moment ID | `M-08` |
| Name | Keeping my place in history when a new answer arrives, and getting back to it |
| Source | ST-46 → ST-45 → ST-46; TR-72, TR-73; scroll keep-place (W:826-1164); to-bottom button (SC-15) |
| Journey | J-01 stage 5 "Read answer"; J-04 stage 4 "Catch up". F-14 and F-01 step 6; B-05, B-06, B-20, B-196…B-204 (`flows.md`) |
| Screens | SC-05 message list, SC-15 to-bottom button, SC-04 tab badge, SC-01 launcher badge and peek (panel closed), document title |
| Model scope / revision | `state-model.md` retrofit r1 |
| Review evidence | No automated test for scroll, badges, mark-read or to-bottom (code.md §6). Owner verified: read on full visibility (#139), long answer starts at its top (#781, #784), position kept (#1216, "거의 그대로" #1217), to-bottom count (#1322) |
| Trigger | The agent's answer lands (3 s poll) while the owner is scrolled up in the same tab |
| Exit | Owner keeps reading undisturbed, then taps ↓ or scrolls down; the answer is marked read once its bottom edge has been on screen |
| Linked decisions | ADR-0011 (read time), ADR-0009 (order by delivery time), ADR-0010 (hold unread at the bottom). Owner evidence: read = fully visible, messenger-style (D6 part 1, #79, #83); "여기부터 새 메시지" and per-session badges (#55); long new answer shows its start (#776); keep position (#1203, #1210, #1213); ↓ button (#932) with colour + count (#1317) |
| Inherited UX contracts | None |
| Status | Draft (retrofit) |

---

## 1. The four questions

### 1.1 What does the user intend here?

Finish reading the older part he scrolled back to, without being yanked away — then catch the
new answer from its beginning.

### 1.2 What might the user not know?

- That a new answer arrived below (it is off-screen).
- How many unread answers are below.
- That reading it counts only once it has been fully on screen (bottom edge), and only in this tab.
- That read state is shared with his other screens and the review page.

### 1.3 What might make the user anxious?

- The list jumping while reading (B4 part 3, #1203; B6 part 3, #1210).
- Landing at the end of a long answer and missing its start (#776).
- Losing track of which answers are new (#55).

### 1.4 What feedback must the system give?

| Feedback ID / branch | Information needed | Control / result / indicator and placement | ST/TR refs | Visible copy IDs or None + reason | Accessible state / announcement |
|---|---|---|---|---|---|
| FB-01 / B1 | Nothing moved | The message at the top of the view stays at the same spot after re-render (anchor + offset) | W:1160-1163 | None — absence of movement is the feedback | — |
| FB-02 / B1 | New answer is below, and how many | Round ↓ at the bottom-right of the list (shown when >200 px from the bottom) turns indigo with a red count bubble | TR-72 → ST-45; SC-15 | C-01, C-02 | `aria-label` C-02 |
| FB-03 / B1 | Where new starts | `여기부터 새 메시지` line above the first unread answer; indigo left bar on unread bubbles | ST-45 | C-03 | Text; bar is visual only |
| FB-04 / B1 | Counts elsewhere | Tab badge per session; launcher badge and `(N)` title prefix | ST-45 | C-04 | Badges are numbers only |
| FB-05 / B2 | Near the bottom: show the start | If within 80 px of the bottom, the list scrolls so the new answer's top is in view | W:1155-1158 | None | — |
| FB-06 / B1 | It's read now | Bar removed and counts drop as each answer's bottom edge comes into view; line removed when none left | TR-73 → ST-46 | None | — |
| FB-07 / B7 | Panel closed | 5 s peek bubble above the launcher with session name and the first 90 characters; tap opens that tab at the first unread | TR-72, TR-43 | None (content is the answer itself) | Peek `role="status"` |

---

## 2. Attention and effort

| Question | Answer |
|---|---|
| Where is the user's attention? | An older message in the middle of the list |
| Holding in head? | That something new came — the ↓ count holds it |
| Must decide | When to go down |
| System knows but asks anyway | Nothing |
| How long here? | Seconds to minutes |

---

## 3. Branches available at this moment

| # | Branch type | Candidate | ST / TR refs | Verdict | ADR |
|---|---|---|---|---|---|
| B1 | Main path | Scrolled up → answer arrives → place kept → ↓ shows count → tap ↓ or scroll → read | TR-72, TR-73 | Built, verified (#1216, #1322); Pending verdict | — |
| B2 | Alternate action | Near bottom (<80 px) → auto-scroll to the new answer's top | W:1155-1158 | Built, verified (#781, #784); Pending | — |
| B3 | Cancel / back out | Keep reading; ↓ stays | — | Built | — |
| B4 | Undo | No "mark unread" | TR-73 | Pending (G4) | — |
| B5 | Error / failure | Poll fails → no new answer, no signal (E10) | S1 | Pending | — |
| B6 | Wait | Agent still working: typing row at the bottom | ST-18 | Built | — |
| B7 | Empty | Panel closed → peek, badges, title; other tab → that tab's badge only | TR-72 | Built; Pending | — |
| B8 | Unauthorized | N/A | — | N/A | — |
| B9 | Interrupted | Reload → returns to the first unread line, else the saved position (id + offset), else the bottom | TR-57 | Built; small shift open (#1217) | — |
| B10 | Repeat / concurrent | Several answers arrive → count rises (shows `9+` above 9); read on another screen clears here (later timestamp wins) | TR-73 | Built (#139); Pending | — |

---

## 4. Copy as currently shipped

| Slot | Korean text (exact) | English gloss | Source |
|---|---|---|---|
| C-01 To-bottom button | `↓` + count bubble `N` / `9+` | "↓" + count | W:316, W:226, W:1230 |
| C-02 To-bottom accessible name | `맨 아래로` / `맨 아래로 · 새 답 N개` | "To the bottom" / "To the bottom · N new answers" | W:1231 |
| C-03 New-messages line | `여기부터 새 메시지` | "New messages from here" | W:863 |
| C-04 Title prefix | `(N) <page title>` | "(N) …" | W:1197 |
| Success / waiting copy | None | — | Visible result suffices |

---

## 5. Timing

- New messages arrive on the 3 s poll (faster for 4 s after a send).
- ↓ appears when more than 200 px from the bottom; "near bottom" threshold for auto-scroll is 80 px.
- Mark-read runs on every scroll and on visibility change; reading position saved 0.8 s after scrolling stops.
- Peek bubble visible 5 s.

## 6. Failure and recovery

| Failure | What the owner sees | Recovery | Evidence |
|---|---|---|---|
| Re-render while reading | Place kept by anchor; earlier versions jumped (fixed) | — | #1203-#1216 |
| Only 120 newest items rendered | Older history beyond 120 is not reachable in the panel | None | W:853; peer question O6 part 3 (#1388) |

## 7. Reversibility contract

| Question | Answer |
|---|---|
| Reversible? | Read state: no (no mark-unread) |
| Warned before committing? | N/A |
| Preserved if they leave? | Reading position per session (server prefs.pos); read state server-side |
| Where does work live? | prefs.json `pos`, seen.json |

Done criteria and stage 6 wireflow: not met; stage 6 skipped by owner choice (part 3 M13).

---

## 8. Gaps (needs owner verdict)

- **G1** ↓ scrolls to the very bottom, not to the start of the first unread answer below. With a long answer this lands at its end, unlike the #776 rule. Should ↓ go to the first unread? (inferred)
- **G2** The `여기부터 새 메시지` line stays put until a full re-render, even after the answers below it are read (state-model TR-73 note).
- **G3** History is capped at the newest 120 items with no "show older" control (O6 part 3 unanswered).
- **G4** No way to mark an answer unread again.
- **G5** The list region is `aria-live="polite"` and re-renders the whole list, which may re-announce everything to screen readers. The ↓ scroll also ignores reduced-motion settings (inferred).
- **G6** No offline signal: if polling fails, no new answers arrive and nothing says so (E10).

---

## Evidence

#28, #45, #52, #55, #59, #79, #83, #93, #139, #325, #776, #781, #784, #932, #934, #935, #1203, #1209, #1210, #1213, #1216, #1217, #1317, #1319, #1322; W:302, W:316, W:826-830, W:855-865, W:1145-1164, W:1188-1237, W:1238-1275.
