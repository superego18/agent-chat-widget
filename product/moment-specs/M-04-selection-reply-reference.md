# M-04 — Selecting text in a bubble to reply to it or reference it

Status: Retrofit draft 2026-10-12 — awaiting owner verdicts

> Retrofit: reconstructed from the shipped widget and the development chat.
> Code refs: `W` = `assets/app-widget.js`, `F` = `scripts/chat-format.mjs`. `#N` = chat message.
> Korean strings exact as shipped, with English gloss. "(inferred — needs owner verdict)" = no owner message.

---

## 0. Meta

| Field | Value |
|---|---|
| Moment ID | `M-04` |
| Name | Turning a selected passage into a partial reply or a reference |
| Source | ST-33 → ST-34 → ST-36 / ST-38; TR-59, TR-60, TR-61, TR-62; whole-message variant TR-58 → ST-35 / ST-37 |
| Journey | J-03 stage 2 "Select" and 3 "Write". F-05; B-51…B-60, B-65…B-67, B-98 (`flows.md`) |
| Screens | SC-05 (message body, yellow highlight), SC-09 (selection pill), SC-08 (reply/reference bar), SC-07 (input focus) |
| Model scope / revision | `state-model.md` retrofit r1 |
| Review evidence | No automated test for selection. Owner verified on Safari (#879, #881, #885), pill restyle (#1265), body-only rule on iOS (#1363). T82 covers whole-message `참고` surviving reload |
| Trigger | Owner long-presses or drags to select text inside a message body in the current tab |
| Exit | Reply/reference bar shows the quote above the input and the input is focused; or the selection is dropped and the pill hides |
| Linked decisions | ADR-0028 (reference separate from reply), ADR-0029 (selection pill floating above the input), ADR-0016 (explicit reply targets), ADR-0026. Owner evidence: native selection + "reply to this" action, not sentence chips (D22 part 2, #877); floating box above input, short labels, toast colour (D11-D13 part 3, #1255-#1263); separate `참고` (D10 part 3, #1248-#1251); pill only for selection inside a body (#1351-#1357) |
| Inherited UX contracts | None |
| Status | Draft (retrofit) |

---

## 1. The four questions

### 1.1 What does the user intend here?

Answer exactly one point in a long agent answer — or attach a passage as context — so the agent
responds to the right thing without him retyping it.

### 1.2 What might the user not know?

- That the pill appears only when the selection starts inside a message body (not on meta lines, tags or empty space).
- The difference between `답장` (the agent treats it as the question being answered) and `참고` (context only, "답장 아님").
- That the quote is kept with the next message, a hold item or a draft, and survives a reload.
- That a drafts-box batch send drops the quote (LC-2, O7 part 3).

### 1.3 What might make the user anxious?

- Quoting the wrong message: long-press outside a bubble once quoted a wrong one (B16 part 3, #1351-#1357).
- "Will the agent treat this as my question?" (J-03 moments).
- The keyboard closing or focus jumping when the pill is tapped (#902-#904).

### 1.4 What feedback must the system give?

| Feedback ID / branch | Information needed | Control / result / indicator and placement | ST/TR refs | Visible copy IDs or None + reason | Accessible state / announcement |
|---|---|---|---|---|---|
| FB-01 / B1 | Selection can become a reply or reference | Floating pill, light purple (same as the drafts-box toast), centred above the compose row; hides ~0.4 s after the selection is gone | TR-59 → ST-34 | C-01 | Two buttons; not announced (G5) |
| FB-02 / B1 | What is attached and as what | Reply bar above input (dashed grey for reference) with the quoted part; selection cleared; input focused (keyboard opens) | TR-60 → ST-36 / ST-38 | C-02 | Bar text; × has `aria-label` C-03 |
| FB-03 / B1 | Which part of the original | Yellow highlight on the quoted range in the original bubble (CSS Custom Highlight) | ST-36 / ST-38 | None — highlight is the result | Not exposed to assistive tech (G6) |
| FB-04 / B1 | After sending: what this message answered | Quote block in the sent bubble: yellow "고른 부분" / grey "전체 답장" / dashed "참고"; 4-line clamp with `펼치기`; `원문으로` jump; orange link line for partial replies | ST-03 with `replyQuote` | C-04, C-05 | Buttons |
| FB-05 / B2 | Whole-message variant | `답장` / `참고` links in each bubble's meta line (mouse: on hover only) | TR-58 | C-06 | Links |

---

## 2. Attention and effort

| Question | Answer |
|---|---|
| Where is the user's attention? | The passage he selected, mid-bubble |
| Holding in head? | Which point he is answering — the bar and highlight hold it |
| Must decide | Reply vs reference |
| System knows but asks anyway | Nothing |
| How long here? | A few seconds |

---

## 3. Branches available at this moment

| # | Branch type | Candidate | ST / TR refs | Verdict | ADR |
|---|---|---|---|---|---|
| B1 | Main path | Select in body → pill → `↩ 답장` → bar + focus → send | TR-59, TR-60, TR-03 | Built, verified (#879-#885, #1363); Pending verdict | — |
| B2 | Alternate action | `📎 참고` from the pill; whole-message `답장` / `참고` links | TR-60, TR-58 | Built (#1254, #745-#750, T82); Pending | — |
| B3 | Cancel / back out | Clear selection → pill hides; × on the bar | TR-61, TR-62 | Built; TR-61 unverified | — |
| B4 | Undo after the fact | × removes the attachment before sending; after sending, no detach | TR-62 | Pending | — |
| B5 | Error / failure | Quote text not found in the original (edited/re-rendered) → no highlight, quote still sent (inferred from W:458-487) | — | Pending | — |
| B6 | Wait | N/A — local only | — | N/A | — |
| B7 | Empty | Selection outside a body (meta, tag, blank) → no pill | W:427-441 | Built (#1356, #1357) | — |
| B8 | Unauthorized | N/A — single owner | — | N/A | — |
| B9 | Interrupted | Reload: attached quote restored (`__uifb_reply`); open pill not restored (inferred) | TR-57 | Built (#1432; T82); pill part Pending | — |
| B10 | Repeat / concurrent | New selection replaces the attachment; one attachment at a time | W:513-522 | Built; Pending | — |

---

## 4. Copy as currently shipped

| Slot | Korean text (exact) | English gloss | Source |
|---|---|---|---|
| C-01 Pill actions | `↩ 답장` / `📎 참고` | "↩ Reply" / "📎 Reference" | W:313 |
| C-02 Reply bar | `↩ 답장 · <who>의 일부: "<quote>"` / `📎 참고 · <who>의 일부: "<quote>"`; whole message: `↩ 답장 · <who>: <text>` | "↩ Reply · part of <who>'s message: '…'" / "📎 Reference · part of …"; whole: "↩ Reply · <who>: …" | W:456 |
| C-03 Bar clear (accessible name) | `답장 취소` | "Cancel reply" | W:312 |
| C-04 Quote in sent bubble | `↩ <who>의 고른 부분: "<quote>"` / `↩ <who>에게 전체 답장: <text>` / `📎 참고 · <who>의 일부: "<quote>"` | "↩ The part of <who>'s message I picked: '…'" / "↩ Whole reply to <who>: …" / "📎 Reference · part of <who>'s message: '…'" | W:897 |
| C-05 Quote controls | `펼치기` / `접기` / `원문으로` | "Expand" / "Collapse" / "Go to original" | W:905, W:910 |
| C-06 Per-message links | `답장` / `참고` (title `답장이 아니라 참고하라고 이 메시지를 붙이기`) | "Reply" / "Reference" (tooltip "Attach this message for reference, not as a reply") | W:932-939 |
| Agent-side label (not shown in panel) | `참고로 붙인 메시지(답장 아님)` | "Message attached for reference (not a reply)" | F:4 |
| Helper text | None — the difference between reply and reference is explained only by a desktop tooltip | — | Gap G2 |

---

## 5. Timing

- Pill shows on `selectionchange` if the last body selection is < 300 ms old; hides ~400 ms after the selection is gone.
- A selection is remembered for 60 s so tapping `답장` on the same message after the selection collapses still quotes the part (W:518).
- Input focus right after tap; selection cleared first so the iOS keyboard stays (#902-#904).

## 6. Failure and recovery

| Failure | What the owner sees | Recovery | Evidence |
|---|---|---|---|
| iOS reports no selection position | Decided by the press point; selection outside a body ignored | Re-select inside the body | W:417-441; #1362 |
| Highlight API unsupported | No yellow highlight; the quote still goes with the message | None needed | W:480-487 |
| Batch send from drafts box | Quote silently dropped | Send items individually (unverified) | LC-2; O7 part 3 |

## 7. Reversibility contract

| Question | Answer |
|---|---|
| Reversible? | Yes, until sent |
| How / how long? | × on the bar; a new selection replaces it |
| Warned before committing? | N/A — nothing is sent at this moment |
| Preserved if they leave? | Attached quote (tab, id, quote, ref flag) per browser; survives reload |
| Where does work live? | `__uifb_reply` (this browser only — not shared with other screens) |

Done criteria and stage 6 wireflow: not met; stage 6 skipped by owner choice (part 3 M13).

---

## 8. Gaps (needs owner verdict)

- **G1** The attached quote is kept only in this browser. The typed text is shared across screens, so a quote started on the phone is missing on desktop. Intended? (journey J-07 stage 4)
- **G2** The difference between reply and reference is not explained anywhere on a phone. The tooltip is mouse-only.
- **G3** Batch send from the drafts box drops reply and reference info (LC-2). Fix or accept?
- **G4** If the quoted text cannot be found in the original (for example after a re-render with changed markup), the highlight silently fails. Needs a fallback? (inferred)
- **G5** The pill appears with no accessible announcement, and no keyboard path opens it from a selection.
- **G6** The yellow highlight is colour-only and not exposed to assistive technology.
- **G7** Whole-message `답장` / `참고` links are hover-only with a mouse. Can desktop users find them?

---

## Evidence

#737, #745-#750, #868, #873, #876-#885, #891, #894, #897-#904, #1032, #1247-#1265, #1351-#1363, #1403, #1405, #1409, #1429, #1432; T82; W:313, W:411-528, W:889-942; F:4.
