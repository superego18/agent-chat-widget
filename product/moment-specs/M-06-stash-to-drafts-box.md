# M-06 — Putting a thought in the drafts box under a category

Status: Retrofit draft 2026-10-12 — awaiting owner verdicts

> Retrofit: reconstructed from the shipped widget and chat handler and the development chat.
> Code refs: `W` = `assets/app-widget.js`, `H` = `scripts/chat-handler.mjs`. `#N` = chat message.
> Korean strings exact as shipped, with English gloss. "(inferred — needs owner verdict)" = no owner message.

---

## 0. Meta

| Field | Value |
|---|---|
| Moment ID | `M-06` |
| Name | Stashing typed text into the drafts box under the chosen category |
| Source | ST-01 → ST-12; TR-25; category choice via chips (prefs.draftLabels); follow-on TR-48 (open sheet from toast or chip) |
| Journey | J-02 stage 2 "Choose route" and 4 "Sort". F-07 steps 1-2; B-85…B-88, B-96, B-99, B-101, B-105 (`flows.md`) |
| Screens | SC-07 (input, `▤ 보관함` button, chips row `전체 N` / category chips / `+ 새 분류`), SC-16 (toast), SC-12 (drafts sheet, reached from the toast or a long-press) |
| Model scope / revision | `state-model.md` retrofit r1 |
| Review evidence | No automated test for the drafts box (code.md §6). Owner accepted the fly animation ("오케이 좋아", #851, #853, #854); chip scheme chosen by owner (#567-#578); toast action label chosen by owner (#974, #976) |
| Trigger | Owner has text in the input and presses `▤ 보관함`, optionally after tapping a category chip |
| Exit | Input empty; text flies into the `전체` chip, which bumps and counts up; toast offers to open that category. Failure: text stays, toast |
| Linked decisions | ADR-0020 (separate hold and drafts-box buttons and styles). Owner evidence: drafts box exists (#246, #250); categories per session (#373, #533); short tap = choose category, long press = open its sheet (D34 part 1, #567-#573); separate `보류` and `보관함` buttons (D4/D5 part 3, #1134-#1143); toast colour/size (#939); `<분류명> 열기` (#974, #976) |
| Inherited UX contracts | M-01 busy/↻ contract on the button; "visible feedback that an action happened" (part 2 P4) |
| Status | Draft (retrofit) |

---

## 1. The four questions

### 1.1 What does the user intend here?

Get a thought out of his head without bothering the busy agent, filed where he will find it
later ("나중에 분류해서 보내기" — send later, by category).

### 1.2 What might the user not know?

- Which category it will land in (the darker, pressed chip) and that the choice is per session tab.
- That it will not be sent until he sends it from the drafts sheet.
- That the attached reply/reference and location go with it and are cleared from the compose row.
- That a chip does two things: short tap chooses the category, a 0.5 s press opens that category's sheet.

### 1.3 What might make the user anxious?

- "Did it save?" (#849, #908, #968) — the reason for the fly animation and the toast.
- "Where did it go?" — answered by `<label> 열기`.
- Drafts piling up unprocessed (#907, #1473) — about the ongoing flow, not this moment.

### 1.4 What feedback must the system give?

| Feedback ID / branch | Information needed | Control / result / indicator and placement | ST/TR refs | Visible copy IDs or None + reason | Accessible state / announcement |
|---|---|---|---|---|---|
| FB-01 / B1 | Which category is selected | Selected chip is darker; each chip shows its count | prefs.draftLabels | C-03 | Chip `aria-pressed` |
| FB-02 / B6 | Saving | `▤ 보관함` shows ↻ until the server answers | M-01 contract | None | Gap (as M-01 G4) |
| FB-03 / B1 | Saved, and where | First 24 characters fly from the input into the `전체` chip, which bumps and counts up; under reduced motion the chip flashes instead. Input clears; toast with destination action | TR-25 → ST-12 | C-05, C-06 | Toast `role="status"`; fly ghost is decorative |
| FB-04 / B2 | Look at it now | Toast action `<label> 열기` opens the drafts sheet on that category | TR-48 | C-06 | Toast button |
| FB-05 / B5 | Not saved; text kept | Toast; text stays in input | TR-25 failure | C-07 | Toast `role="status"` |
| FB-06 / B2 | New category | `+ 새 분류` turns into a name field in place; Enter creates and selects it | — | C-04 | Input `aria-label` |

---

## 2. Attention and effort

| Question | Answer |
|---|---|
| Where is the user's attention? | The input and the button column; on a phone the keyboard closes on press |
| Holding in head? | Which category — the selected chip holds it, per session |
| Must decide | Category (optional; default is the last chosen or `미분류`) |
| System knows but asks anyway | Nothing; session, device, commit, location, time are stamped automatically |
| How long here? | About 1 s |

---

## 3. Branches available at this moment

| # | Branch type | Candidate | ST / TR refs | Verdict | ADR |
|---|---|---|---|---|---|
| B1 | Main path | (choose chip) → `▤ 보관함` → fly + toast | TR-25 | Built, accepted (#851-#854); Pending verdict | — |
| B2 | Alternate action | `+ 새 분류` then stash; `<label> 열기` from toast; long-press a chip to open its sheet; `보류` instead (M-05) | TR-48, TR-17 | Built; Pending | — |
| B3 | Cancel / back out | Before pressing: nothing to cancel. Esc or emptying the name field cancels `+ 새 분류` | — | Built | — |
| B4 | Undo after the fact | Delete the card in the sheet (toast `지웠어요` + undo; trash 7 days) | TR-30, TR-31 | Built; unverified; Pending | — |
| B5 | Error / failure | Add fails → toast, text kept | TR-25 failure | Built; "why" missing | — |
| B6 | Wait | ↻ on the button; 8 s unlock; cid dedupe | M-01 contract | Built | — |
| B7 | Empty | Empty input → press does nothing. Empty drafts sheet shows stale copy (C-09) | EM2 | Built; copy stale (G1) | — |
| B8 | Unauthorized | N/A | — | N/A | — |
| B9 | Interrupted | Reload mid-typing: input text restored; new-category text restored (`__uifb_sheet`); fly animation lost (harmless) | TR-57 | Built (#1444); Pending | — |
| B10 | Repeat / concurrent | Same text pressed twice → one draft (cid) | H:483 | Built; Pending | — |

---

## 4. Copy as currently shipped

| Slot | Korean text (exact) | English gloss | Source |
|---|---|---|---|
| C-01 Stash button | `▤ 보관함` (title `보관함에 담아 두고 나중에 분류해서 보내기`) | "▤ Drafts box" (tooltip "Keep it in the drafts box to sort and send later") | W:318, W:288 |
| C-02 Open-all chip | `전체` / `전체 N` + `▴`/`▾` | "All" / "All N" | W:1621 |
| C-03 Category chip | `<label> N` / `미분류 N`; title `짧게: 나중에 담을 분류 · 꾹: 이 분류 보관함 열기` (sheet open: `누르면 이 분류 보관함 열기`) | "<label> N" / "Uncategorized N"; tooltip "Tap: category to stash 'later' into · Press and hold: open this category's box" | W:1644-1646 |
| C-04 New category | `+ 새 분류`; field placeholder `새 분류 이름` | "+ New category"; "New category name" | W:1657-1662 |
| C-05 Success toast | `✓ 보관함에 담음` | "✓ Put in the drafts box" | W:2049 |
| C-06 Toast action | `<label> 열기` / `미분류 열기` | "Open <label>" / "Open Uncategorized" | W:2049 |
| C-07 Failure toast | `담지 못했어요. 글은 입력칸에 남겨 뒀어요` | "Couldn't save it. I left your text in the input." | W:2051 |
| C-08 Sheet title | `보관함 · 전체 N개` / `보관함 · <label> N개` | "Drafts box · all N" / "Drafts box · <label> N" | W:1624 |
| C-09 Empty sheet | `보관함이 비어 있습니다.\n글을 쓰고 "나중에"를 누르면 여기에 담깁니다.` | "The drafts box is empty. Write something and press 'Later' to put it here." — refers to a button that no longer exists | W:1738 |
| C-10 Message tag after sending | ` · 보관함 › <label>` | "· Drafts box › <label>" | W:945 |

---

## 5. Timing

- Long press threshold 0.5 s with a fill animation; Android vibrates 15 ms (haptic untested, O9 part 1).
- Fly animation tracks the button every frame because the phone keyboard closes during it (#852, #853).
- Toast with action: 6 s.

## 6. Failure and recovery

| Failure | What the owner sees | Recovery | Evidence |
|---|---|---|---|
| Add request fails | C-07; text kept; attachments kept | Press again (cid dedupe) | W:2051 |
| Category list not yet loaded | Chips not drawn until prefs arrive (avoids flashing `미분류`) | Wait one poll | B18 part 2, #945-#948 |

## 7. Reversibility contract

| Question | Answer |
|---|---|
| Reversible? | Yes |
| How / how long? | Edit, relabel, move to another session, delete (undo 6 s, trash 7 days) in the sheet |
| Warned before committing? | N/A — nothing is sent |
| Preserved if they leave? | Draft server-side; card edits autosaved every 0.8 s |
| Where does work live? | drafts.json (server); sheet state in `__uifb_sheet` (this browser) |

Done criteria and stage 6 wireflow: not met; stage 6 skipped by owner choice (part 3 M13).

---

## 8. Gaps (needs owner verdict)

- **G1** Stale copy: the empty drafts box (C-09) and the chip tooltip (C-03) still say `나중에`, but the button is now `보관함` (code.md §5). Replacement wording needs an owner verdict.
- **G2** The chips still use a press-and-hold gesture for a second action, while the later owner principle prefers separate named buttons over hidden gestures (part 3 P2, #1136, #1137). Keep the owner's own chip scheme (D34 part 1) or revisit?
- **G3** Nothing near the button shows which category will be used, except the darker chip in a scrollable row. Is that clear enough on a phone? (inferred)
- **G4** No toast for `보류` (M-05), but a toast for `보관함`. Is the difference intended?
- **G5** The failure toast has no "why" (E6).
- **G6** Drafts-box moments have no automated test (code.md §6).

---

## Evidence

#246, #250, #267, #373, #500, #501, #511, #513-#578, #849-#854, #866, #907, #908, #939, #945-#953, #968-#977, #1134-#1144, #1243-#1246, #1306-#1311, #1444, #1473; W:288, W:318, W:1572-1600, W:1619-1702, W:1738, W:1986-2056; H:483-495.
