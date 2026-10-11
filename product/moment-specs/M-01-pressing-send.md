# M-01 — Pressing Send

Status: Retrofit draft 2026-10-12 — awaiting owner verdicts

> Retrofit: reconstructed from the shipped widget and the development chat, not designed ahead
> of the code. Code refs: `W` = `assets/app-widget.js`, `H` = `scripts/chat-handler.mjs`
> (line numbers as of 2026-10-12). `#N` = owner/agent message in the development chat.
> Korean strings are quoted exactly as shipped, with an English gloss. Lines marked
> "(inferred — needs owner verdict)" have no owner message behind them.

---

## 0. Meta

| Field | Value |
|---|---|
| Moment ID | `M-01` |
| Name | Pressing Send and waiting for the server to accept |
| Source | ST-01 → ST-02 → ST-03 (or back to ST-01); TR-01, TR-02, TR-03, TR-04; follow-on TR-06 (read mark) |
| Journey | J-01 stage 4 "Send"; J-07 (no resend of already-sent text after reload). F-01 main steps 3-5; B-01, B-09, B-10, B-11, B-12, B-13, B-15, B-17, B-21, B-22 (`flows.md`) |
| Screens | SC-07 compose row, SC-05 message list (new bubble + read mark + delivery hint), SC-16 toast, SC-03 mode line |
| Model scope / revision | `state-model.md` retrofit r1 |
| Review evidence | No diagram. Shipped GUI only. Tests T14 (send creates one message, clears input), T30 (slow server retry creates one message) |
| Trigger | Owner presses `보내기` or Enter in the input with non-empty text and a session tab selected |
| Exit | Success: input empty, own bubble at list bottom with read mark. Failure: text still in input, toast, button usable again |
| Linked decisions | ADR-0027 (wait for server acceptance), ADR-0026 (preserve in-progress work), ADR-0011 (read time = actual pickup). Owner evidence: correction D14 part 3 (#1270, #1271): no optimistic send |
| Inherited UX contracts | Candidate shared contract "server-sending button waits with ↻, unlocks after 8 s, cid dedupe" — applied to all sending buttons at owner request (#1275), symbol chosen by owner (#1297, #1300). Not yet recorded as an approved contract |
| Status | Draft (retrofit) |

---

## 1. The four questions

### 1.1 What does the user intend here?

Get this instruction to the selected session now and move on — often from a phone, often
while doing something else in the app. He wants proof that it actually left, not a promise.

### 1.2 What might the user not know?

- Whether the server has taken the message yet (the bubble appears only after it has).
- That the text stays in the input until the server accepts it, so it is safe to wait or retry.
- That pressing again after a timeout will not create a duplicate (same client id, server dedupes).
- Which session will receive it, and whether it will be read right away, after the current
  work, or only when he asks the session in its terminal (watcher off).
- That an attached reply/reference and picked location go with this message and are then cleared.

### 1.3 What might make the user anxious?

- "Did it go?" — the original bug: bubble appeared late and sent text stayed in the input (#1267, #1268, B8 part 3).
- "If I press again, will it send twice?" (#1270, #1271).
- "If it failed, did I lose what I typed?" (#345, #1435).
- A mid-send reload broke a send once (B18 part 3, #1372).

### 1.4 What feedback must the system give?

| Feedback ID / branch | Information needed | Control / result / indicator and placement | ST/TR refs: trigger -> persistent state / exit | Visible copy IDs or None + reason | Accessible state / announcement |
|---|---|---|---|---|---|
| FB-01 / B1, B6 | Request in flight; which button | The pressed button's label is hidden and a spinning `↻` is drawn on it; the button ignores presses. Input and other controls stay usable. | TR-02 -> ST-02; ends on server reply or after 8 s | None — symbol only (owner chose ↻, #1297) | Gap G4: no `aria-busy`, label made transparent; screen reader still hears `보내기` |
| FB-02 / B1 | Message accepted | Input empties; reply/reference bar and location bar clear; own bubble appears at the list bottom ("held", floating) with read mark | TR-03 -> ST-03 | C-05 read mark; no success toast (visible result suffices) | List region is `aria-live="polite"` (W:308) — whole list announced (inferred) |
| FB-03 / B1 | Where/when it will be read | Read mark suffix on the bubble; one-line delivery hint under the last own message; header mode line | ST-03 substates; TR-06 -> ST-05 | C-05, C-06, C-07 | Text only |
| FB-04 / B5 | Send failed; text kept | Toast pill above the compose row (3.5 s); text remains in input; button re-enabled | TR-04 -> ST-01 | C-03 | Toast `role="status"` |
| FB-05 / B6 | Waited too long; may retry | After 8 s the spinner stops and the button can be pressed again. No message is shown unless the request actually fails (W:336) | ST-02 -> ST-02 (unlocked) | None (gap G1) | None |
| FB-06 / B7 | No session to send to | Input disabled; placeholder explains | — | C-08 | Disabled input |

---

## 2. Attention and effort

| Question | Answer |
|---|---|
| Where is the user's attention at this instant? | The Send button and the input, then the bottom of the list |
| What are they holding in their head that the UI should be holding instead? | Whether the press "took"; the typed text (UI holds it until accepted) |
| What must they type, remember, decide, or look up? | Only the text; target is the selected tab |
| What does the system already know that it is asking for anyway? | Nothing asked |
| How long are they here? | Usually < 1 s; up to 8 s before the button unlocks |

---

## 3. Branches available at this moment

| # | Branch type | Candidate | ST / TR refs | Verdict | ADR |
|---|---|---|---|---|---|
| B1 | Main path | Press → ↻ → server 200 → input cleared, bubble appears, fast re-poll for read mark | TR-02, TR-03 | Built; owner-requested (#1270, #1271); Pending verdict | — |
| B2 | Alternate action | `끼워넣기` (interject), `보류` (hold), `▤ 보관함` (drafts box) from the same row | TR-05, TR-17, TR-25 | See M-02, M-06 | — |
| B3 | Cancel / back out | Cannot cancel the request in flight; after acceptance, `보내기 취소` / `보류로` while unread | TR-11, TR-12 | See M-03; Pending | — |
| B4 | Undo after the fact | No undo once read; resend corrected text | TR-14…TR-16 | Built; Pending | — |
| B5 | Error / failure | POST fails → toast, text kept, press again | TR-04 | Built (T30); Pending | — |
| B6 | Wait / long-running | 8 s unlock with same cid | TR-04 (unlock) | Built; message at timeout missing (G1) | — |
| B7 | Empty / nothing to act on | Empty text: press does nothing. No session: input disabled | TR-01 guard | Built; Pending (EM1 next action missing) | — |
| B8 | Unauthorized / expired | LAN key cookie missing/expired → request rejected; shows as B5 failure (inferred — needs owner verdict) | — | Pending | — |
| B9 | Interrupted | Reload mid-send: agent-invoked reload waits for busy buttons (TR-55); manual ↻ does not wait (inferred from W:2299) | TR-53, TR-55 | Partially built; Pending | — |
| B10 | Repeat / concurrent | Double press ignored while busy; retry after unlock dedupes by cid; late first success still clears input if text unchanged | TR-02 guard, H:259-260 | Built (T30); edited-text retry not deduped (G3) | — |

---

## 4. Copy as currently shipped

| Slot | Korean text (exact) | English gloss | Source |
|---|---|---|---|
| C-01 Primary action label | `보내기` | "Send" | W:318 |
| C-02 Input placeholder | `<name>에게 질문이나 요청 · Enter 보내기` | "Question or request to <name> · Enter to send" | W:1179 |
| C-03 Error toast | `보내지 못했어요. 글은 입력칸에 남겨 뒀어요` | "Couldn't send. I left your text in the input." | W:1502 |
| C-04 Generic action error (any busy button) | `처리하지 못했어요. 다시 눌러 주세요` | "Couldn't process it. Please press again." | W:337 |
| C-05 Read mark on own bubble | ` · 안 읽음(곧 읽음)` / ` · 안 읽음(작업 중이라 끝나면 읽음)` / ` · 안 읽음` / ` · 읽음` | "unread (will be read soon)" / "unread (busy; will read when done)" / "unread" / "read" | W:1612-1616 |
| C-06 Delivery hint under last own message | `<name>에게 전달하는 중…` / `<name>이(가) 읽고 답하는 중…` / `자동으로 전달되지 않습니다. <name> 터미널에 "대화 확인해"라고 보내 주세요.` | "Delivering to <name>…" / "<name> has read it and is answering…" / "Not delivered automatically. Send '대화 확인해' (check the chat) in <name>'s terminal." | W:1071 |
| C-07 Header mode line | `<name>에게 보냅니다. 바로 전달됩니다.` / `<name>에게 보냅니다. 지금은 자동으로 읽지 않으니 그 세션 터미널에 "대화 확인해"라고 알려 주세요.` | "Sending to <name>. Delivered right away." / "Sending to <name>. It is not reading automatically now, so tell that session's terminal '대화 확인해'." | W:1176-1177 |
| C-08 No session | `등록된 세션이 없습니다` | "No registered session" | W:1179 |
| Waiting explanation | None — `↻` on the button only | — | Gap G1 |
| Success confirmation | None — the bubble and empty input are the result | — | Owner rejected optimistic UI, did not ask for a toast |
| Error: why | Missing | — | Gap G5 |

---

## 5. Timing

- Spinner starts on press; ends on server reply.
- 8 s without reply → button unlocks silently (W:336).
- After success: immediate poll, then 8 polls every 500 ms (4 s) so the read mark updates fast (W:1499; #842, F19 part 2).
- Error toast visible 3.5 s (W:1597).
- Normal background poll every 3 s.

## 6. Failure and recovery

| Failure | What the owner sees | Recovery | Evidence |
|---|---|---|---|
| POST rejected / network error | Toast C-03, text in input, button enabled | Press `보내기` again (same cid, one message) | T30; #1270-#1271 |
| No reply in 8 s | Spinner stops; nothing else | Press again; if the first request lands later it is deduped | W:336 |
| Server saved but reply lost | Toast C-03 although the message exists; bubble appears on next poll | Retry is deduped by cid; owner may see both "failed" and the bubble (inferred) | Same shape as B18 part 3 (#1372) |
| Poll fails after send | Read mark stops updating; no offline signal | None | state-model E10 |

## 7. Reversibility contract

| Question | Answer |
|---|---|
| Is this moment reversible? | Partially |
| If yes — how, and for how long? | While unread: `보내기 취소` / `보류로` (M-03). After read: resend a corrected copy only |
| If no — is the user warned before committing? | No pre-commit warning; the read-mark suffix tells when it will be read |
| What is preserved if they leave mid-moment? | Text (server compose, 400 ms debounce, flushed on pagehide/reload), reply/reference, location |
| Where does their unsaved work live? | compose.json (server, shared across screens); `__uifb_reply`, `__uifb_where` (this browser) |

Done criteria and stage 6 wireflow: not met — stage 6 skipped by owner choice (part 3 M13); see Gaps.

---

## 8. Gaps (needs owner verdict)

- **G1** At 8 s the button just unlocks; no text says the send may not have gone through. `state-model.md` TR-04 describes a toast at 8 s, but the code shows the toast only on an actual failure. Should a timeout explain itself?
- **G2** C-03 says "couldn't send" whenever the request errors, even when the server may have saved it (lost response). Should uncertain outcomes use different wording from known failures?
- **G3** If the owner edits the text after a timeout and presses again, the new text gets a new cid, so a late first request plus the edited one gives two messages. Acceptable?
- **G4** Busy state has no accessible equivalent (no `aria-busy`, label made transparent).
- **G5** Error copy has no "why" (state-model E1).
- **G6** Manual ↻ during a send does not wait for the busy button (agent-invoked reload does). Should manual reload wait too? (inferred from W:2299)
- **G7** LAN key expiry during a send shows the generic failure toast; no way to tell that re-opening the `?k=` link is needed (inferred).
- **G8** The "shared ↻ busy contract" (#1275, #1297) has never been recorded as an approved shared contract with scope.

---

## Evidence

#345, #842, #1202, #1267, #1268, #1270, #1271, #1274, #1275, #1277, #1297, #1298, #1300, #1372, #1373; T14, T30; W:328-338, W:1474-1504, W:1608-1617, W:1066-1072, W:1170-1179.
