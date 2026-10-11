# M-03 — Cancelling an unread message or moving it to hold

Status: Retrofit draft 2026-10-12 — awaiting owner verdicts

> Retrofit: reconstructed from the shipped widget and chat handler and the development chat.
> Code refs: `W` = `assets/app-widget.js`, `H` = `scripts/chat-handler.mjs`. `#N` = chat message.
> Korean strings exact as shipped, with English gloss. "(inferred — needs owner verdict)" = no owner message.

---

## 0. Meta

| Field | Value |
|---|---|
| Moment ID | `M-03` |
| Name | Taking back a message the session has not read yet |
| Source | ST-03/ST-04 → ST-06 or ST-07 (+ ST-10); TR-11, TR-12, TR-13; race with TR-06/TR-08 |
| Journey | J-02 stage 3 "Change mind" ("racing the agent to cancel before it reads"). F-03; B-32…B-40 (`flows.md`) |
| Screens | SC-05 (own unread bubble action row, cancelled trace), SC-06 (new hold item), SC-16 (toast) |
| Model scope / revision | `state-model.md` retrofit r1 |
| Review evidence | T54 (buttons shown only while unread; resend only after read), T70 (unread → hold cancels and creates hold). Owner verified cancel (#835, #841, #848) |
| Trigger | Owner sees his own bubble still marked `안 읽음…` and wants it not to be delivered as is |
| Exit | Cancelled trace (struck-through, stays), or cancelled trace + dashed hold item at the list bottom; or refusal because it was read in the meantime |
| Linked decisions | ADR-0018 (cancelled sends stay as struck-through traces), ADR-0030 (no resend on unread), ADR-0019 (stacked holds). Owner evidence: cancel stays a struck-through trace, no delete (D1/D2 part 3, #1113-#1119); unread → `보류로` (#1407, #1410); no resend on unread (#1411) |
| Inherited UX contracts | M-01 busy/↻ contract on each action button |
| Status | Draft (retrofit) |

---

## 1. The four questions

### 1.1 What does the user intend here?

Stop the agent from acting on something he no longer means — and usually keep the text to fix
and send later rather than lose it.

### 1.2 What might the user not know?

- Whether the session has already taken it (status may lag a few seconds; B10 part 2 #842).
- That a cancelled message stays visible as a trace and cannot be un-cancelled or deleted.
- That `보류로` both cancels and creates a hold item carrying its reply/reference and location.
- That Codex messages are delivered immediately and cannot be cancelled (no buttons shown).

### 1.3 What might make the user anxious?

- Racing the agent: "Did my cancel win?" — a cancel was once refused because the UI lagged (#842).
- "Is my text gone?" — answered by `보류로` keeping it.
- A cancelled-but-visible message might look as if the agent still saw it.

### 1.4 What feedback must the system give?

| Feedback ID / branch | Information needed | Control / result / indicator and placement | ST/TR refs | Visible copy IDs or None + reason | Accessible state / announcement |
|---|---|---|---|---|---|
| FB-01 / B1 | This message can still be taken back | Small `보내기 취소` and `보류로` buttons in the meta line of an unread own bubble; hidden once read; never on Codex targets | ST-03/ST-04 | C-01, C-02 | Buttons |
| FB-02 / B1 | Cancel took effect | Bubble greyed, text struck through (buttons not struck, B20 part 2), mark ` · 보내기 취소함`; stays in place | TR-11 → ST-06 | C-03 | Text only |
| FB-03 / B2 | Moved to hold | Cancelled trace + tag ` · 보류로 옮김`; dashed hold bubble at list bottom; toast | TR-12/TR-13 → ST-07 + ST-10 | C-04, C-05 | Toast `role="status"` |
| FB-04 / B5 | Too late — already read | `alert()` with server text; list re-polled | 409 | C-06 | Native alert |
| FB-05 / B2 | A cancelled message can still be rescued | `보류로` on a cancelled bubble until it has been moved once | TR-13 | C-02 | Button |

---

## 2. Attention and effort

| Question | Answer |
|---|---|
| Where is the user's attention? | His own floating unread bubble at the bottom |
| Holding in head? | Whether the agent is about to read it — the read mark suffix holds this |
| Must decide | Cancel only, or cancel and keep (`보류로`) |
| System knows but asks anyway | Nothing |
| How long here? | Seconds; races the watcher (1 s poll) when the session is idle |

---

## 3. Branches available at this moment

| # | Branch type | Candidate | ST / TR refs | Verdict | ADR |
|---|---|---|---|---|---|
| B1 | Main path | `보내기 취소` → struck-through trace | TR-11 | Built, verified (#835-#848); Pending verdict | — |
| B2 | Alternate action | `보류로` (cancel + hold) on unread; `보류로` on an already cancelled bubble | TR-12, TR-13 | Built (T70; #1415; #1237); Pending | — |
| B3 | Cancel / back out | Not pressing; message delivers normally | TR-06 | N/A | — |
| B4 | Undo after the fact | No un-cancel; hold item can be sent again; hold item deletable with undo | TR-23, TR-21 | Rejected delete-of-trace by owner (#1117-#1119); un-cancel never discussed — Pending | — |
| B5 | Error / failure | Already read → 409 → alert; network error → generic toast | H:842 | Built; alert() Pending (E3, E5) | — |
| B6 | Wait | Button shows ↻ until server answers | M-01 contract | Built | — |
| B7 | Empty | Read message: no cancel/hold, only `다시 보내기` | T54 | Built (#1411) | — |
| B8 | Unauthorized | Codex target: no buttons (delivered immediately) | TR-07 | Built; Pending (NG-9 inferred) | — |
| B9 | Interrupted | `보류로` is two requests (cancel, then hold add); if the second fails, the message stays cancelled with no hold item (inferred) | TR-12 | Pending | — |
| B10 | Repeat / concurrent | Watcher delivers between "unread" display and server cancel check → refused; server-side cancel vs watcher is not atomic (TOCTOU, code.md §5) | TR-06 vs TR-11 | Pending | — |

---

## 4. Copy as currently shipped

| Slot | Korean text (exact) | English gloss | Source |
|---|---|---|---|
| C-01 Cancel action | `보내기 취소` | "Cancel send" | W:980 |
| C-02 Move to hold action | `보류로` | "To hold" | W:955, W:992 |
| C-03 Cancelled mark | ` · 보내기 취소함` | "· send cancelled" | W:1612 |
| C-04 Moved tag on trace | ` · 보류로 옮김` | "· moved to hold" | W:950 |
| C-05 Toast | `✓ 보류로 옮김` | "✓ Moved to hold" | W:354 |
| C-06 Refusal (alert) | `세션이 이미 받아 가서 취소할 수 없습니다.` (server text; client fallbacks `취소하지 못했습니다.` / `이미 읽혀서 보류로 돌리지 못했습니다.`) | "The session already took it, so it can't be cancelled." (fallbacks "Couldn't cancel." / "It was already read, so it couldn't be moved to hold.") | H:842, W:983, W:995 |
| C-07 Hold bubble tag | `보류 · 아직 안 보냄` | "Hold · not sent yet" | W:1091 |
| Error: what to do next | Missing | — | Gap G3 |
| Pre-commit confirmation | None | — | Gap G1 |

---

## 5. Timing

- Visibility of the buttons follows the 3 s poll, plus 8×500 ms fast polls right after sending.
- Watcher picks up messages within ~1 s when the session is idle, so the window to cancel can be very short.
- Toast 3.5 s.

## 6. Failure and recovery

| Failure | What the owner sees | Recovery | Evidence |
|---|---|---|---|
| Read before cancel arrives | alert C-06; bubble drops to its read position on re-poll | Send a correction (resend or new message) | H:842; #842 |
| Network error | Toast `처리하지 못했어요. 다시 눌러 주세요` | Press again | W:337 |
| Cancel ok, hold add fails | Struck-through trace, no hold item, generic toast (inferred) | `보류로` on the cancelled bubble (TR-13) | W:988-998 |

## 7. Reversibility contract

| Question | Answer |
|---|---|
| Reversible? | No for cancel (no un-cancel); yes for the text via hold |
| How / how long? | Hold item stays until sent or deleted; deleted hold items restorable 7 days |
| Warned before committing? | No confirmation; cancel is immediate |
| Preserved if they leave? | Server-side; nothing local |
| Where does work live? | chat.json (`cancelled`), drafts.json (hold item with `fromMsg`) |

Done criteria and stage 6 wireflow: not met; stage 6 skipped by owner choice (part 3 M13).

---

## 8. Gaps (needs owner verdict)

- **G1** Cancel is irreversible and has no confirmation. The owner chose "trace, no delete" but never ruled on un-cancel or a confirm step.
- **G2** The two-step `보류로` can half-complete: cancelled with no hold item. Is the manual recovery through TR-13 enough?
- **G3** Refusals use `alert()` with no next step (E3/E5). The client fallback text is shown only when the server sends no error, so the owner usually sees the server wording.
- **G4** Race: the button can show while the watcher is already delivering. The server cancel check is not atomic with delivery (TOCTOU), so a cancelled message could still be read (code.md §5).
- **G5** A cancelled trace stays in the timeline at send time. Should it be visibly marked as "the agent never saw this" beyond the strike-through? (inferred)
- **G6** Codex targets show no cancel and no explanation of why (NG-9 inferred).

---

## Evidence

#832, #835, #841, #842, #843, #848, #951, #958, #1105-#1119, #1231, #1237, #1403, #1407, #1409, #1410, #1411, #1415, #1419; T54, T70; W:350-355, W:947-998, W:1612; H:829-848.
