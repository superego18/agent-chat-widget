# M-07 — A reload happening, and what comes back

Status: Retrofit draft 2026-10-12 — awaiting owner verdicts

> Retrofit: reconstructed from the shipped widget, chat handler and the development chat.
> Code refs: `W` = `assets/app-widget.js`, `H` = `scripts/chat-handler.mjs`. `#N` = chat message.
> Korean strings exact as shipped, with English gloss. "(inferred — needs owner verdict)" = no owner message.

---

## 0. Meta

| Field | Value |
|---|---|
| Moment ID | `M-07` |
| Name | Waiting through a reload (owner-pressed ↻ or agent-invoked) and finding the work intact |
| Source | ST-31, ST-32; TR-53 (manual ↻), TR-54 / TR-55 / TR-56 (agent `reload-widgets`), TR-57 (restore) |
| Journey | J-07 stages 1-3. F-08; B-106…B-117 (`flows.md`) |
| Screens | SC-02 outer ↻, SC-03 header ↻, SC-14 reload cover; after reload SC-00 or SC-P with SC-07/SC-08/SC-10/SC-12 restored |
| Model scope / revision | `state-model.md` retrofit r1 |
| Review evidence | T117 (no automatic reload on file change; token change shows cover then reloads); T82 (compose text and reference survive reload). Owner OK on spinning ↻ (#1225), "거의 그대로" on position (#1217), preservation (#1444-#1446) |
| Trigger | Owner presses ↻ (header or under the launcher), or a session runs `reload-widgets` after changing the widget |
| Exit | Page reloads; panel reopens if it was open, on the same tab and reading position, with in-progress work restored |
| Linked decisions | ADR-0025 (reload only on request with an overlay), ADR-0026 (preserve in-progress work across reloads). Owner evidence: never reload silently; reload is a deliberate tool with a "don't touch" overlay (D17 part 3, #1374, #1375); manual ↻ shows the same overlay (#1391); ↻ everywhere (#1181-#1201); keep everything in progress (D18 part 3, #1433-#1438) |
| Inherited UX contracts | Preservation rule "사용자가 원치 않게 새로고침될 수 있으니까 중간에 하던 것들은 무조건 보존" (#1438) |
| Status | Draft (retrofit) |

---

## 1. The four questions

### 1.1 What does the user intend here?

Manual ↻: get a fresh widget (the home-screen app has no browser reload). Agent reload: he did
not ask for it in that instant — he wants it not to break what he was doing.

### 1.2 What might the user not know?

- Why the screen was covered (agent reload) — the cover says what is happening, not who started it.
- That he should not tap anything for about a second.
- That the reload waits while he is editing a bubble or hold item, or while a button is busy.
- Exactly what comes back: input text, reply/reference, picked location, bubble/hold edit with
  caret, drafts sheet label/checks/new-category text, open panel, tab, reading position, folds.
- What does not come back: pick mode, an open selection pill, a toast (inferred).

### 1.3 What might make the user anxious?

- A silent reload once broke a send mid-flight (B18 part 3, #1372).
- Losing typed text, quote or pick (B11 part 1 #345; B19-B20 part 3 #1403-#1433).
- Already-sent text reappearing in the input (B3/B8 part 3, #1202, #1267).
- The list jumping to another place after reload (#1213, #1217).

### 1.4 What feedback must the system give?

| Feedback ID / branch | Information needed | Control / result / indicator and placement | ST/TR refs | Visible copy IDs or None + reason | Accessible state / announcement |
|---|---|---|---|---|---|
| FB-01 / B1 | Manual reload started | Pressed ↻ turns tinted and spins; full-screen cover with large spinning ↻ and text | TR-53 → ST-32 | C-03 | Cover `role="status"` |
| FB-02 / B2 | Agent reload coming, waiting for me | Same cover, "will reload once you finish" text; re-checks every 1 s | TR-55 → ST-31 | C-04 | Cover `role="status"` |
| FB-03 / B2 | Agent reload now | Cover text switches to the reloading text; reload 1.2 s later | TR-54 / TR-56 → ST-32 | C-03 | Cover `role="status"` |
| FB-04 / B1 | Work restored | No message; the restored state itself (panel, tab, scroll, text, bars, editor caret, sheet) | TR-57 | None — the restored screen is the result | Focus returned to the field that had it |

---

## 2. Attention and effort

| Question | Answer |
|---|---|
| Where is the user's attention? | Wherever he was working; the cover takes over the whole screen |
| Holding in head? | What he was doing — the restore holds it |
| Must decide | Nothing (manual) / finish the edit (agent reload while editing) |
| System knows but asks anyway | Nothing |
| How long here? | ~0.3 s + page load (manual); ~1.2 s + page load (agent); open-ended while waiting |

---

## 3. Branches available at this moment

| # | Branch type | Candidate | ST / TR refs | Verdict | ADR |
|---|---|---|---|---|---|
| B1 | Main path | Manual ↻ → cover → reload after 300 ms → restore | TR-53, TR-57 | Built (#1225, #1393); Pending verdict | — |
| B2 | Alternate action | Agent `reload-widgets` → cover → reload after 1.2 s; waits while editing or busy | TR-54, TR-55, TR-56 | Built (T117 for the idle path); wait path unverified | — |
| B3 | Cancel / back out | No way to postpone or cancel a reload | — | Pending (G2) | — |
| B4 | Undo | N/A | — | N/A | — |
| B5 | Error / failure | Version fetch fails → ignored, no reload; page load fails → browser error (outside widget) | S7 | Pending | — |
| B6 | Wait / long-running | Wait state can last as long as the edit stays open | ST-31 | Pending (G1) | — |
| B7 | Empty | Nothing in progress → plain reload | — | Built | — |
| B8 | Unauthorized | LAN key cookie expired → page reload hits the key check (inferred: widget not loaded) | state-model §9 | Pending | — |
| B9 | Interrupted | OS or browser reload (phone restores the app): same restore, no cover | TR-57 | Built (#1435-#1446); Pending | — |
| B10 | Repeat / concurrent | Server restart does not trigger reload (token persisted, H:118-119); several widgets reload together on one token | S7 | Built; Pending | — |

---

## 4. Copy as currently shipped

| Slot | Korean text (exact) | English gloss | Source |
|---|---|---|---|
| C-01 Header ↻ (title) | `새로고침` | "Reload" | W:306 |
| C-02 Outer ↻ (title / accessible name) | `화면 새로고침` | "Reload screen" | W:303 |
| C-03 Cover, reloading | `대화창을 새로 고치는 중이에요 · 잠시 손대지 마세요` | "Reloading the chat · please don't touch anything for a moment" | W:2302, W:2332 |
| C-04 Cover, waiting | `대화창을 새로 고칠 거예요 · 지금 하던 것을 마치면 바로` | "The chat is about to reload · right after you finish what you're doing" | W:2332 |
| Who triggered it | None — manual and agent reloads look the same | — | Gap G3 |
| Restore confirmation | None | — | Visible state suffices (inferred) |

---

## 5. Timing

- Manual: cover immediately, compose flushed, reload after one frame + 300 ms.
- Agent: token polled every 5 s; cover immediately on change; if editing or a busy button exists, re-check every 1 s; else reload 1.2 s later.
- Busy buttons self-unlock after 8 s, which ends that wait.
- Edit text and caret are saved every 1 s; scroll position saved 0.8 s after scrolling stops.

## 6. Failure and recovery

| Failure | What the owner sees | Recovery | Evidence |
|---|---|---|---|
| Waiting for an edit to finish | Cover over the whole screen, including the edit's `저장` / `수정 취소` buttons (cover has no `pointer-events: none`, W:231) | Inferred: none in the widget; browser reload. The edit would still be restored from `__uifb_edit` | W:231, W:2327-2333 (not exercised) |
| Small position shift after reload | List a few pixels off | Scroll | #1217 (open, cause unknown) |
| Edit typed in the last <1 s before reload | That last second may be lost (1 s save cadence) (inferred) | Retype | W:2343-2364 |

## 7. Reversibility contract

| Question | Answer |
|---|---|
| Reversible? | N/A — nothing is changed by the reload itself |
| Warned before committing? | Yes: the cover appears before the reload (≥300 ms) |
| Preserved if they leave mid-moment? | Compose (server), reply/reference, location, edit + caret, sheet state, open state, tab, scroll position, folds |
| Where does work live? | compose.json, prefs.json (server); `__uifb_reply`, `__uifb_where`, `__uifb_edit`, `__uifb_sheet`, `__uifb_open` (this browser) |

Done criteria and stage 6 wireflow: not met; stage 6 skipped by owner choice (part 3 M13).

---

## 8. Gaps (needs owner verdict)

- **G1** Possible deadlock (inferred from code, not run): during an agent reload's wait state, the cover covers the whole screen and blocks taps, so the owner cannot press `저장` or `수정 취소` to finish the edit the cover asks him to finish. The wait then never ends.
- **G2** No way to postpone or cancel an agent-invoked reload.
- **G3** The cover does not say who started the reload or why. The owner asked to know "not to touch" (#1374), not the source. Is that enough?
- **G4** Pick mode and an open selection pill are not restored (state-model ST-28, ST-34, inferred). Does the "무조건 보존" rule cover them?
- **G5** Part of the restored state is per browser (reply, location, edit, sheet, open), part is shared (compose, tab, position) (J-07 stage 4). Which should follow the owner across devices?
- **G6** Residual position shift after reload (#1217) is still open.

---

## Evidence

#345, #1181-#1225, #1202, #1213, #1216, #1217, #1267, #1313, #1316, #1372-#1393, #1403-#1446; T82, T117; W:231-233, W:303-306, W:2296-2365; H:118-119, H:676-677.
