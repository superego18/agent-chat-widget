# M-10 — A session-to-session message appearing

Status: Retrofit draft 2026-10-12 — awaiting owner verdicts

> Retrofit: reconstructed from the shipped widget, chat handler, hook relay and the development
> chat. Code refs: `W` = `assets/app-widget.js`, `H` = `scripts/chat-handler.mjs`,
> `HR` = `scripts/hook-relay.mjs`. `#N` = chat message. Korean strings exact as shipped, with
> English gloss. "(inferred — needs owner verdict)" = no owner message.
> Note: `state-model.md` §0 puts peer messages out of scope except where they touch read
> state, so this moment has no dedicated ST/TR rows; refs below point to the closest ones.

---

## 0. Meta

| Field | Value |
|---|---|
| Moment ID | `M-10` |
| Name | Seeing one session message another, while it happens and afterwards |
| Source | No dedicated ST/TR (out of model scope). Related: ST-18 (sender working with `peerTo`), TR-34 (PreToolUse SendMessage), TR-33 (receiver UserPromptSubmit), R11 read state (peer messages are not counted unread) |
| Journey | J-06 stage 3 "Watch handoffs". F-10 step 4; B-138…B-141, B-147, B-58 (`flows.md`) |
| Screens | SC-04 (tab arrow between tabs), SC-05 (dashed amber peer bubble in both sessions' tabs), external push if `peer` kind on (M-09) |
| Model scope / revision | `state-model.md` retrofit r1 — scope gap noted in G1 |
| Review evidence | No automated test (code.md §6). Owner saw it after a retest (#719); arrow timing accepted for now (#730, #731); non-adjacent arrow unverified (#734, #735) |
| Trigger | A session sends a message to another registered session (agent SendMessage); the receiver's hook reports receipt |
| Exit | Bubble stays in both tabs with `받음` once received; arrow disappears when the sender stops sending |
| Linked decisions | ADR-0001 (route chat by session), ADR-0017 (merge links into one trunk); no ADR for peer display itself. Owner evidence: show session-to-session messages and an arrow between tabs (#700); arrow only while sending, no 8 s linger (D6 part 2, #725); bubble sides flipped (D19 part 2, #864); reply lines include peer messages (#1152); peer push off by default (#1177) |
| Inherited UX contracts | None |
| Status | Draft (retrofit) |

---

## 1. The four questions

### 1.1 What does the user intend here?

Keep track of sessions coordinating among themselves — who asked whom for what — so he is not
surprised by work he did not request and can step in if needed.

### 1.2 What might the user not know?

- That the message was written by a session, not by him (shown by the dashed amber style and tag).
- Whether the receiver actually got it (`받음`).
- That the same bubble also shows in the other session's tab.
- That peer messages never raise unread badges.

### 1.3 What might make the user anxious?

- Sessions doing things he did not ask for; disturbing each other's work (part 1 P5, #209).
- Not seeing the exchange at all (B6 part 2, #719).

### 1.4 What feedback must the system give?

| Feedback ID / branch | Information needed | Control / result / indicator and placement | ST/TR refs | Visible copy IDs or None + reason | Accessible state / announcement |
|---|---|---|---|---|---|
| FB-01 / B1 | Sending is happening now | Animated arrow between adjacent tabs in send direction; for non-adjacent tabs `→ <receiver>` after the sender tab. Only while the sender's status has `peerTo` | ST-18 + peerTo | C-01, C-02 | `title` only; arrow animation off under reduced motion |
| FB-02 / B1 | This is session-to-session | Dashed amber bubble; tag `세션끼리`; route line `<A> → <B>`; in the sender's tab on the left, in the receiver's tab on the right | — | C-03, C-04 | Text |
| FB-03 / B1 | Received | ` · 받음` after the time once the receiver's hook reports it | — | C-05 | Text |
| FB-04 / B2 | What it relates to | Reply link lines also connect peer messages to answers (#1152) | — | None | Visual only |

---

## 2. Attention and effort

| Question | Answer |
|---|---|
| Where is the user's attention? | Usually on another tab or not on the panel at all |
| Holding in head? | Which sessions are coordinating — the arrow and bubbles hold it while visible |
| Must decide | Whether to intervene |
| System knows but asks anyway | Nothing |
| How long here? | The arrow lasts only while sending (seconds); the bubble stays |

---

## 3. Branches available at this moment

| # | Branch type | Candidate | Refs | Verdict | ADR |
|---|---|---|---|---|---|
| B1 | Main path | Sender sends → arrow → bubble in both tabs → `받음` | H:200-228, W:797-808, W:878-888 | Built (#711, #719); Pending verdict | — |
| B2 | Alternate action | Peer push (off by default) | M-09 | Built | — |
| B3 | Cancel / back out | Owner cannot stop or cancel a peer message | — | Pending (G6) | — |
| B4 | Undo | N/A | — | N/A | — |
| B5 | Error / failure | Receiver never reports → no `받음`; receiver name unknown → `다른 세션` | H:206-221 | Pending | — |
| B6 | Wait | N/A | — | N/A | — |
| B7 | Empty | Receiver not registered → bubble only in sender tab with `→ <peer name>` | H:222-225 | Built; Pending | — |
| B8 | Unauthorized | N/A | — | N/A | — |
| B9 | Interrupted | Server restart: bubble persists in chat.json; arrow state from status files | — | Built | — |
| B10 | Repeat / concurrent | Identical text sent twice within 10 min → receipt matched to the latest unmatched one | H:206 | Pending (G3) | — |

---

## 4. Copy as currently shipped

| Slot | Korean text (exact) | English gloss | Source |
|---|---|---|---|
| C-01 Tab arrow | `→` / `←` (adjacent) or `→ <receiver>` (non-adjacent) | — | W:806-807 |
| C-02 Arrow tooltip | `<A> → <B> 메시지 보내는 중` | "<A> → <B> sending a message" | W:805 |
| C-03 Bubble tag | `세션끼리` | "Between sessions" | W:872 |
| C-04 Route line | `<A> → <B>` (unknown side: `다른 세션`) | "<A> → <B>" (unknown: "another session") | W:885 |
| C-05 Received mark | `<time> · 받음` | "<time> · received" | W:886 |

---

## 5. Timing

- Arrow follows the sender's status (PreToolUse SendMessage) via the 3 s poll; gone when the status changes.
- Receipt recorded when the receiver's UserPromptSubmit hook reports the same text within 10 min.

## 6. Failure and recovery

| Failure | What the owner sees | Recovery | Evidence |
|---|---|---|---|
| Hook relay fails on the receiver | No `받음` | None | B5 part 2 pattern |
| Peer name not yet learned | `다른 세션` in the route line | Learned on the first matched receipt (peers.json) | H:195-221 |

## 7. Reversibility contract

| Question | Answer |
|---|---|
| Reversible? | N/A — the owner takes no action here |
| Preserved if they leave? | Bubbles in chat.json |
| Where does work live? | Server |

Done criteria and stage 6 wireflow: not met; stage 6 skipped by owner choice (part 3 M13).

---

## 8. Gaps (needs owner verdict)

- **G1** Peer messages are outside the state model's scope, so this moment has no ST/TR rows. Bring them in?
- **G2** Peer messages never count as unread (no badge, no `여기부터 새 메시지` line). A handoff in another tab is easy to miss. Intended? (inferred from W:384)
- **G3** Receipt is matched by identical text within 10 min (code.md §5). Duplicate texts can attach `받음` to the wrong bubble.
- **G4** The arrow for non-adjacent tabs (3+ sessions) has never been checked on screen (LC-4).
- **G5** The arrow can be too brief to notice. A minimum display time was deferred ("일단은 유지", #730, #731).
- **G6** The owner cannot stop, hold or answer into a peer exchange from the panel. Is a control needed, or is watching enough?
- **G7** Peer bubbles are ordered by send time, while the owner's own messages are ordered by read time (DQ-06). Mixed ordering rules in one list.

---

## Evidence

#209, #700, #711, #719, #725, #730, #731, #733-#735, #864, #1152, #1154, #1177, #1388; W:129-133, W:384, W:764-808, W:872-888; H:195-228.
