# Verdict Batch — agent-chat-widget (retrofit) — 2026-10-12

One deduplicated list of everything awaiting an owner verdict, from four sources:

| Source | Items in | Ref format used below |
|---|---|---|
| `product/flows.md` "Verdicts needed" | 92 | `FV#n` (list number) + branch `B-xx` |
| Moment-spec Gaps (`product/moment-specs/M-01…M-11` §8) | 74 | `M-xx Gn` |
| Review gate findings (`reviews/2026-10-12-review-gate.md`) | 20 | `R-xx` |
| `product/technical-design.md` Open Checks | 6 | `OC:<name>` |
| **Total raw** | **192** | merged into **131 V-items** |

Proposed by the critic agent; nothing is decided until the owner answers. Missing answers are not
tacit approval. Each answer becomes an ADR (decision-memory) or updates an existing one.

## Counts

| Tier | Items | Meaning |
|---|---|---|
| Critical | 4 | Work lost, a dead end, or the owner permanently misled |
| High | 20 | Recoverable only by guessing, retrying blindly, or going to the terminal |
| Medium | 38 | Noticeable friction; correct outcome |
| Low | 69 | Minor, gated by another verdict, or confirming current behavior |
| **Total** | **131** | of which **42 bulk-acceptable** |

## How to answer fast

1. **Answer V-021 and V-022 first.** They decide whether adopters and the review page are in scope;
   if "owner only" / "review page optional", you can Defer V-023, V-054–V-058, V-084–V-088 and V-124–V-125
   as one block.
2. **Bulk-accept V-090 … V-131** with one reply ("bulk OK"), unless you want to pull one out. Each keeps
   today's behavior, risk is low. Most are `Built, no owner verdict` → "Confirm current behavior?".
3. Then go through Critical → High → Medium. Low non-bulk items (V-063 … V-089) can be deferred together.

**Bulk-acceptable group (42):** V-090 – V-131 (listed in the last table). Recommendation for every one
is "Keep current behavior".

Legend: **Type** `Confirm current behavior?` = built, the owner never decided it. `Gap` = missing or
undecided behavior. `Process` = artifact/gate hygiene. Options default to Adopt / Reject / Defer.
`(code reading)` = derived from code, not observed on screen; reproduce before fixing (ADR-0031).

---

## Critical (4)

| V | Question for the owner | Options | Recommended verdict — reason | Type | Sources |
|---|---|---|---|---|---|
| V-001 | Must typed text never be replaced by an older server copy after saves fail (flaky network, server restart)? | Adopt (local newer text always wins; failed save retried/surfaced) / Accept risk / Defer | **Adopt** — silent loss of typing on the phone network breaks "무조건 보존" (ADR-0026). (code reading) | Gap | R-01; FV#7 B-22 (related); J-01, J-07; ST-01/TR-01; M-01 §7 |
| V-002 | Should every shared state file be written atomically, and an unreadable file never treated as empty? | Adopt atomic + refuse-on-parse-error / Adopt + file lock / Keep as built | **Adopt atomic + refuse-on-parse-error** — one torn write can erase the drafts box, holds, trash, read state and push subscriptions | Gap | R-02; OC:Atomic writes; state-model §8; J-02, J-04, J-07 |
| V-003 | Must cancel, interject-toggle and delivery be one atomic, consistent server check, so a message shown cancelled can never reach the agent? | Adopt / Accept race but mark "may have been read" / Defer | **Adopt** — today the owner can be permanently misled about what the agent received | Gap | FV#17 B-38; M-03 G4; M-02 G4; F-03, F-11; TR-06, TR-11 |
| V-004 | When an agent reload waits for an edit to finish, must the owner be able to finish (or postpone) the edit, with a maximum wait? | A: non-blocking notice while waiting + max wait / B: add "postpone" on the cover / C: keep | **A** — the blocking cover can hide the very `저장`/`수정 취소` it waits for: a dead end. (code reading) | Gap | FV#44 B-112; M-07 G1; M-07 G2; TR-55/56; SC-14; screen-map §5 |

## High (20)

| V | Question for the owner | Options | Recommended verdict — reason | Type | Sources |
|---|---|---|---|---|---|
| V-005 | Show an "can't reach the chat server, retrying" state when polling fails? | Adopt / Reject / Defer | **Adopt** — the list looks alive but is dead (#582); nothing tells him | Gap | FV#1 B-17; B-195; M-08 G6; E10; J-01 |
| V-006 | Refuse over-limit messages with a visible reason instead of silently cutting them at 12,000 characters? | Adopt (refuse + reason) / Raise limit / Keep | **Adopt** — the agent works on partial input while he believes it got everything | Gap | R-03; F-01; TR-03; M-01 |
| V-007 | When the watcher stops (not re-armed, session closed, computer asleep), how should he find out? | A: push + clearer hint / B: try automatic re-arm (Stop hook) / C: keep hint only | **A now, investigate B** — messages wait silently today; ADR-0002 revisit trigger | Gap | FV#62 B-158; FV#63 B-159; LC-1; ADR-0002; TR-41/42 |
| V-008 | Show "stuck/unknown" sessions distinctly and let him force delivery instead of waiting up to 30 min? | Adopt both / Distinct state only / Keep | **Adopt both** — an `unknown` session currently looks like a healthy green one | Gap | FV#64 B-160; R-08; E11; ST-21, TR-38 |
| V-009 | Surface relay-hook failures (answer never reaches the chat) as a session warning? | Adopt / Reject / Defer | **Adopt** — silent; he waits for an answer that will not come | Gap | FV#66 B-161; E11 |
| V-010 | Mark an answer as possibly incomplete when display chunks are missing? | Adopt (mark) / Retry fetch / Accept | **Adopt (mark)** — he reads a partial answer as whole | Gap | FV#67 B-162; S3 Partial |
| V-011 | Give delivery state one writer (or a lock) so read marks never roll back and old messages are never re-delivered? | Adopt / Accept risk | **Adopt** — duplicate work for the agent; untruthful read state (SC-3) | Gap | R-04; F-11; TR-06, TR-08 |
| V-012 | Should clearing the input with `×` be undoable for a few seconds? | Adopt undo toast / Add confirm / Keep | **Adopt undo toast** — matches every other delete; a mis-tap wipes text on all devices | Gap | R-06; B-07; TR-01 |
| V-013 | Chat order: keep read time (built, ADR-0009) or switch to send order (peer request #1388)? | Keep read time / Send order / Per-message choice | **Keep read time** — your adopted rule; answer the peer request "no"; peer bubbles' different rule covered by V-122 | Gap | FV#65 B-156; M-10 G7; DQ-06; ADR-0009 |
| V-014 | History beyond the newest 120 items: add "show older", or accept the limit? | Adopt "show older" / Accept limit | **Adopt** — `원문으로` and the first unread can point at messages that cannot be reached | Gap | FV#3 B-20; FV#27 B-68; B-204; M-08 G3 |
| V-015 | When a session ends or disappears, what should its tab do — and may sends ever switch to another session without you? | Mark "ended", block sending, never switch silently / Remove tab / Keep | **Mark ended + block + no silent switch** — a message can reach the wrong agent today. Changes F-10 main path | Gap | FV#58 B-148; R-07; M-09 G5; TR-45 |
| V-016 | A tab change synced from another device can redirect a send. Keep sync, guard it, or make the tab per device? | Guard (never switch while input has text) / Per device / Keep | **Guard** — keeps the sync you asked for (#346) without misrouting | Gap | FV#57 B-146; TR-45 |
| V-017 | Should "send selected/category" from the drafts box carry each item's reply/reference? | Adopt / Accept loss | **Adopt** — the quote is dropped silently (LC-2) | Gap | FV#36 B-98; M-04 G3; LC-2; TR-28 |
| V-018 | Reply/reference and picked location when switching session tab: clear, keep, or keep per session? | Per session / Clear on switch / Keep (today) | **Per session** — today the quote can go to the wrong session | Gap | FV#25 B-67; FV#91 B-212 |
| V-019 | `승인 필요` on the phone: add an approve path, or say "approve in the terminal" in the notice? | Wording now, approve path later / Approve path now / Keep | **Wording now; defer approve path** — feasibility of approving from the panel unknown | Gap | FV#50 B-133; J-04 |
| V-020 | When a push subscription expires, tell him and offer re-enable? | Adopt / Keep silent | **Adopt** — notices stop with no sign | Gap | FV#51 B-131; TR-67 |
| V-021 | Who is the product for: you only, or adopters (U-2) as a real target? | Owner only (adopter items best-effort) / Owner + adopters | **Owner only for now** — lets you defer ~12 setup items as a block; revisit per ADR-0036 | Gap (gating) | R-17; DQ-02; U-2, SC-8, J-08 |
| V-022 | Keep the review-page journey, retire it for checking on the real screen, or keep it optional? | Keep / Retire / Optional, no further work | **Optional, no further work** — you said it "can't really be used" (#1510); avoids designing 8 dependent items | Gap (gating) | FV#72 B-172; M-11 G6; DQ-10; ADR-0008 |
| V-023 | "Done" wiring to the chat lives in neither repo. Ship it, document it, or stop promising continuation? | Ship in one repo / Document / Change success note only | **Change success note only** (until V-022 says otherwise) — today the note can promise a continuation that never happens | Gap | FV#73 B-174; M-11 G3; LC-6; OC:Combined server |
| V-024 | Should setup keep `.ui-feedback/` (chat history, LAN key, push private key) out of git and say so in the README? | Adopt / Reject | **Adopt** — one `git add .` on a public project publishes keys and history | Gap | R-05; F-13; C-3; ADR-0007 |

## Medium (38)

| V | Question for the owner | Options | Recommended verdict — reason | Type | Sources |
|---|---|---|---|---|---|
| V-025 | Should an uncertain send (8 s timeout, lost response) say "may not have gone — check before resending" instead of nothing / "couldn't send"? | Adopt / Keep | **Adopt** — known failure and unknown outcome need different words | Gap | M-01 G1; M-01 G2 |
| V-026 | Must already-sent text never be refilled after a relaunch, however long after? | Adopt / Keep 2-min window | **Adopt** — refill after iOS kill + >2 min invites a duplicate send. (code reading) | Gap | R-11; B-21; M-01 B9 |
| V-027 | Edited text retried after a timeout can produce two messages. Acceptable? | Accept / Guard | **Accept** — both visible, the extra one can be cancelled while unread | Gap | M-01 G3 |
| V-028 | Should manual `↻` wait for a busy send like the agent reload does? | Adopt / Keep | **Adopt** — same risk that broke a send once (#1372) | Gap | M-01 G6; TR-53 |
| V-029 | Rewrite error toasts to say what / why / next, and never show raw error text? | Adopt / Keep | **Adopt** — E1, E2, E6 lack "why"; E8 shows raw text | Gap | M-01 G5; M-06 G5; M-09 G4; E1, E2, E6, E8 |
| V-030 | First run with no session: what should the panel say and point to? | One line + where to register / Keep placeholder | **One line + pointer** — cheap; matters if V-021 includes adopters | Gap | FV#2 B-13; EM1 |
| V-031 | Codex messages show `읽음` the moment they are queued. Keep, or show a separate "queued" mark? | Separate mark / Keep | **Separate mark** — `읽음` claims a read that has not happened (SC-3) | Confirm current behavior? | FV#5 B-03; TR-07 |
| V-032 | Should `↓` jump to the first unread answer's top rather than the very bottom? | Adopt / Keep | **Adopt** — matches your "show the answer's top" rule (#776) | Gap | M-08 G1 |
| V-033 | Guard against two watchers for one session? | Adopt / Accept | **Adopt** — double delivery risk | Gap | FV#68 B-166 |
| V-034 | Messages read >1 h after sending are placed at send time (agent rule). Keep, delete, or keep and show it? | Keep + visible mark / Delete / Keep hidden | **Keep + visible mark** — NG-5 forbids hidden rules; decide with V-013 | Confirm current behavior? | FV#69 B-157; OC:1-hour fallback; ADR-0009 |
| V-035 | Missing/expired access key: what page and guidance (incl. expiry during a send)? | Plain page "open the key link again" + matching toast / Keep | **Adopt** — today it is a generic failure | Gap | FV#82 B-190; FV#83 B-191; M-01 G7 |
| V-036 | Should the phone's back gesture close the top layer (sheet → pick → panel)? | Adopt / Keep (record why) / Defer | **Defer** — confirm first whether you use back on the phone | Gap | R-10; TR-44/47/49 |
| V-037 | Replace `alert()` refusals (cancel/interject/`보류로` after read) with a toast giving the reason and next step? | Adopt / Keep | **Adopt** — modal with no way forward; inconsistent with every other message | Gap | FV#12 B-29; FV#19 B-39; M-02 G5; M-03 G3; E3–E5 |
| V-038 | Interject delivered as plain after the turn ends breaks the "(다음 단계에서 바로 읽음)" promise. Change wording or behavior? | Change wording / Keep | **Change wording** — keep behavior, stop the false promise | Confirm current behavior? | FV#13 B-26; M-02 G3 |
| V-039 | Interject during approval wait: keep behavior, and say "read after you approve"? | Keep + wording / Keep | **Keep + wording** | Confirm current behavior? | FV#15 B-25; M-02 G2 |
| V-040 | Codex sessions: no interject, cancel or live status. Accept as non-goal (NG-9) and say why controls are absent? | Accept + explain / Request feature | **Accept + explain** — Codex has no hooks (ADR-0003) | Gap | FV#11 B-31; M-02 G6; M-03 G6; NG-9; B-150 |
| V-041 | `보류로` can half-complete (cancelled, no hold item). Make it one server action? | Adopt / Accept manual recovery | **Adopt** — the text otherwise sits only in the struck trace | Gap | M-03 G2; TR-12 |
| V-042 | Cancelled trace: resend only via `보류로` → `보내기`, no confirm on cancel — confirm? | Confirm / Add `다시 보내기` on traces / Add confirm | **Confirm** — reads ADR-0018 "can be resent later" as via `보류로` | Gap | FV#18 B-36; M-03 G1; ADR-0018 |
| V-043 | Explain `끼워넣기`, reply vs reference, and whole-message `답장`/`참고` on touch, not only in hover tooltips? | Adopt / Keep | **Adopt** — the phone is the primary device; tooltips never show there | Gap | M-02 G7; M-04 G2; M-04 G7 |
| V-044 | Drafts/Hold items whose session no longer exists: what happens? | Show as "session gone" with move-to-session / Keep | **Adopt** — today they hang on a missing session | Gap | FV#38 B-103 |
| V-045 | Guard against sending the same draft or Hold item from two devices? | Adopt (server refuses already-sent) / Accept | **Adopt** | Gap | FV#39 B-104 |
| V-046 | `지우기` while editing a Hold item discards the unsaved edit; undo restores only the saved text. Save first? | Adopt / Keep | **Adopt** — undo should give back what was on screen | Gap | M-05 G2 |
| V-047 | The drafts backlog (B-101) is decided by ADR-0035 (bundling UI, not built). Close B-101 as decided? | Confirm ADR-0035 covers it / Reopen | **Confirm** — avoids a second decision on the same thing | Gap | FV#37 B-101; LC-5; ADR-0035; R-15 |
| V-048 | Which in-progress state should follow you to another device (reply/reference, location, edits, sheet, open state)? | Reply/reference + location shared with the text; edits/sheet per device / All shared / Keep split | **First option** — the quote belongs to the text that is already shared | Gap | FV#45 B-114; M-04 G1; M-05 G6; M-07 G5 |
| V-049 | Reload when the server/app is unreachable: show a timeout message on the cover? | Adopt / Keep | **Adopt** | Gap | FV#46 B-113 |
| V-050 | Resend of a reply/reference: keep the quote? | Keep quote / Drop | **Keep quote** | Gap | FV#21 B-45 |
| V-051 | Agent omits `<re N>`: draw order-guessed lines, or none? | No line / Guessed line (today) / Dashed "guessed" line | **No line** — you asked for accuracy over guessing (#1090); ADR-0016 revisit | Gap | FV#26 B-65; ADR-0016 |
| V-052 | Notification permission denied: what to show and how to retry? | Toast with how to re-enable / Keep | **Adopt** | Gap | FV#54 B-130 |
| V-053 | Review-ready and peer pushes open the app root, not the page/tab. Carry the target? | Adopt / Keep | **Adopt** — tap should land where the notice is about | Gap | M-09 G1; M-09 G2 |
| V-054 | Many session tabs on a phone: what should overflow do? | Scroll with active tab visible / Keep (unknown) | **Adopt + check on screen** — ADR-0001 revisit trigger | Gap | FV#60 B-149; ADR-0001 |
| V-055 | Review "done" is irreversible with no warning. Add reopen, or a warning, or defer? | Defer with V-022 / Warning / Reopen | **Defer with V-022** | Gap | FV#75 B-176; M-11 G1 |
| V-056 | Review autosave / overall-comment save failure: show it? | Adopt / Defer with V-022 | **Defer with V-022** | Gap | FV#77 B-177; M-11 G4 |
| V-057 | `자동 이어가기 꺼짐`: tell the owner what to do after done? | Adopt one-line instruction / Defer | **Defer with V-022** | Gap | FV#74 B-173 |
| V-058 | Registration and hook steps are missing from this README. Add them? | Adopt / Defer with V-021 | **Defer with V-021** | Gap | FV#81 B-194 |
| V-059 | Add automated tests for the owner-verified but untested features (hold, drafts box, push) before changing them? | Adopt / Defer | **Adopt** — ADR-0034; they can regress silently | Gap | M-05 G7; M-06 G6; M-09 G6; ADR-0034 |
| V-060 | Refresh stale cross-references and rename one of the colliding `SC` ID sets? | Adopt / Defer | **Adopt** after this batch | Process | R-14 |
| V-061 | Rule: an Accepted ADR wins over a later flow row until superseded? | Adopt / Reject | **Adopt** | Process | R-15; ADR-0009/0018/0022/0035 |
| V-062 | Accept a text-only stage-5 gate for the retrofit, with GUI reproduction required only for Critical/High items before fixing? | Adopt / Require full GUI review | **Adopt** | Process | R-16 |

## Low — needs a choice (27)

| V | Question for the owner | Options | Recommended verdict — reason | Type | Sources |
|---|---|---|---|---|---|
| V-063 | Empty session tab: is the mode line enough, or add a one-line empty state? | Keep / Add | **Keep** — mode line already says how delivery works | Gap | R-12; EM3 |
| V-064 | `여기부터 새 메시지` stays until a full re-render after reading. Fix? | Accept / Fix | **Accept** | Gap | M-08 G2 |
| V-065 | Mark an answer unread again? | Reject / Adopt | **Reject** — never asked for | Gap | FV#88 B-202; M-08 G4 |
| V-066 | Show terminal history from before registration? | Defer / Adopt | **Defer** — raised #6/#10, never decided | Gap | FV#4 B-14; DQ-11 |
| V-067 | Accessibility baseline (aria-busy, live regions, non-colour status, keyboard pill, highlight semantics): adopt, or record as out of scope for a single sighted owner? | Defer with record / Adopt | **Defer with record**; revisit if V-021 = adopters | Gap | M-01 G4; M-04 G5; M-04 G6; M-08 G5; M-11 G5; R-09 |
| V-068 | `끼워넣기` appearing/disappearing shifts the buttons while typing. Acceptable? | Accept / Reserve space | **Accept** | Gap | M-02 G1 |
| V-069 | Mark a cancelled trace as "the agent never saw this" beyond the strike-through? | Reject / Adopt | **Reject** — `보내기 취소함` already says it | Gap | M-03 G5 |
| V-070 | Move a Hold item to another session? | Defer / Adopt | **Defer** — possible via `보관함` then session select | Gap | FV#30 B-77 |
| V-071 | Move a draft back to Hold? | Defer / Adopt | **Defer** | Gap | FV#31 B-78; M-05 G5 |
| V-072 | Replace stale `나중에` copy (empty drafts box, chip tooltip) with `보관함` wording? | Adopt / Keep | **Adopt** — the button was renamed | Gap | FV#40 B-99; M-06 G1 |
| V-073 | Is the darker chip enough to show which category `보관함` saves to? | Accept / Show label on button | **Accept** until it causes a mis-file | Gap | M-06 G3 |
| V-074 | Should the reload cover say who started it and why? | Reject / Adopt | **Reject** — you asked only to know not to touch (#1374) | Gap | M-07 G3 |
| V-075 | Restore pick mode and the selection pill after reload? | Reject (record exception to ADR-0026) / Adopt | **Reject** — transient, re-doing is one tap | Gap | M-07 G4 |
| V-076 | Residual scroll shift after reload: keep open as a bug? | Keep open (find root cause, ADR-0031) / Accept | **Keep open** | Gap | M-07 G6; B-111 |
| V-077 | Offer `끼워넣기` in the resend editor while the session works? | Defer / Adopt | **Defer** | Gap | FV#22 B-46 |
| V-078 | Partial-quote highlight silently fails if the text cannot be found. Need a fallback? | Accept / Adopt | **Accept** | Gap | M-04 G4 |
| V-079 | Several devices: should reading on one clear notices on the other? | Defer / Adopt | **Defer** | Gap | FV#53 B-132 |
| V-080 | Chat server down means no pushes and no warning. Acceptable? | Accept / Adopt external check | **Accept** — V-005 covers it once the panel is opened | Gap | FV#52 B-134 |
| V-081 | Ask one session to wait for another, or control a peer exchange from the panel? | Defer / Adopt | **Defer** — watching is enough so far | Gap | FV#59 B-145; M-10 G6 |
| V-082 | Bring peer messages into the state model? | Adopt at next revision / Reject | **Adopt at next revision** | Process | M-10 G1 |
| V-083 | Check the non-adjacent tab arrow with 3+ sessions? | Keep deferred / Check now | **Keep deferred** (your #734/#735) until 3 sessions run | Gap | M-10 G4; LC-4; B-140 |
| V-084 | Review page: a memo being typed may be lost on reload. Preserve it? | Defer with V-022 / Adopt | **Defer with V-022** | Confirm current behavior? | FV#79 B-179 |
| V-085 | Old review rounds (≤29) without the shared widget: migrate? | Leave / Migrate | **Leave** | Gap | FV#78 B-180 |
| V-086 | Empty review page (no items): design a state? | Defer with V-022 / Adopt | **Defer with V-022** | Gap | M-11 G7; EM5 |
| V-087 | Registration fails (marker not found in 20 s): recovery copy? | Defer with V-021 / Adopt | **Defer with V-021** | Gap | FV#84 B-192 |
| V-088 | Second computer must pull and enable the hooks path per repo: automate or document? | Document / Automate | **Document** — you use two machines | Gap | FV#85 B-193 |
| V-089 | Split the 2,397-line widget into modules? | Defer until tests cover it / Approve now | **Defer** — V-059 first; ADR-0004 governs the split | Gap | OC:Split widget file; ADR-0004 |

## Low — bulk-acceptable: confirm current behavior (42)

Recommended verdict for every row: **Keep current behavior** (Adopt as built). Options: Keep / Change / Defer.

| V | Confirm current behavior? | Note | Sources |
|---|---|---|---|
| V-090 | Enter sends, Shift+Enter new line, also on phone | IME-safe | FV#10 B-01 |
| V-091 | Send button unlocks after 8 s | value only; wording is V-025 | FV#8 B-10 |
| V-092 | Empty send / `보류` / `저장` / resend-edit does nothing (no message) | button result is enough | FV#9 B-12; FV#24 B-48; FV#35 B-81; M-05 G1 |
| V-093 | Stale-working hint and one push after 5 min, current wording | agent-initiated; keep | FV#6 B-16; M-02 G8 |
| V-094 | Typing on two devices: last typing wins after 3 s | single-device loss is V-001 | FV#7 B-22 |
| V-095 | Record "busy ↻, unlock 8 s, cid dedupe" as the shared contract for all sending buttons | records what you asked for (#1275, #1297) | M-01 G8 |
| V-096 | Several pending messages delivered to the agent as one batch | | FV#70 B-153 |
| V-097 | Unreadable delivery record: skip instead of re-delivering | | FV#71 B-164 |
| V-098 | Tapping the peek opens that session's tab | | FV#89 B-201 |
| V-099 | Read on two devices: later time wins | | FV#90 B-203 |
| V-100 | Interject button visible through status lag → message becomes a normal send | | FV#14 B-30 |
| V-101 | Long single tool call: no duration shown for `다음 단계에서 바로 읽음` | | FV#16 B-27 |
| V-102 | `보류로` twice is refused (one Hold item per message) | | FV#20 B-40 |
| V-103 | Unsaved Hold edit is saved before `보내기`/`보관함`, with no extra cue | | FV#33 B-75; M-05 G4 |
| V-104 | Same Hold item edited on two devices: last write wins | | FV#34 B-84 |
| V-105 | Sent from Hold as plain text (no drafts numbering) | | FV#32 B-76 |
| V-106 | Selected drafts across sessions/categories split into one message each | | FV#41 B-94 |
| V-107 | Restoring a former Hold item returns it to Hold | | FV#42 B-97 |
| V-108 | Send disabled when nothing is checked | | FV#43 B-100 |
| V-109 | Toast for `보관함` but not for `보류` / send-from-Hold | Hold result is visible in the list | M-05 G3; M-06 G4 |
| V-110 | Keep your chip scheme (tap = save-to, long press = open) | your own D34 choice (#567–#573) | M-06 G2 |
| V-111 | Trash keeps items 7 days, then expires silently | resolves the provenance conflict | R-13; B-80; B-96; ST-16 |
| V-112 | iOS background kill uses the same restore path | | FV#47 B-117 |
| V-113 | Repeated reload requests collapse into one | | FV#48 B-116 |
| V-114 | Server restart never triggers a reload | | FV#49 B-115 |
| V-115 | Only one of reply or reference at a time | | FV#28 B-59 |
| V-116 | `×` on the reply/reference bar removes it | | FV#29 B-60 |
| V-117 | `×` on the location bar removes the pick | | FV#92 B-209 |
| V-118 | Unsupported environment explained by a toast | wording rewrite falls under V-029 | FV#55 B-129 |
| V-119 | `알림 끄기` turns notices off per device | | FV#56 B-126 |
| V-120 | Quiet "other session working" kind on by default | consistent with ADR-0024 | M-09 G3; ADR-0022 |
| V-121 | Peer messages matched by identical text within 10 min | | FV#61 B-147; M-10 G3 |
| V-122 | Peer messages never count as unread; ordered by send time | peer kind is off by default | M-10 G2 |
| V-123 | Arrow minimum display time stays deferred | your #730/#731 | M-10 G5; B-139 |
| V-124 | Two devices rating the same round: last write per item | | FV#80 B-178 |
| V-125 | Review "done" allowed with unrated items (count shown) | | FV#76 B-175; M-11 G2 |
| V-126 | Access key embedded in the home-screen app's start URL | private paths only (ADR-0007) | FV#86 B-184 |
| V-127 | Localhost exempt from the key (not tailnet/forwarded) | | FV#87 B-187 |
| V-128 | No runtime dependencies, Node 18+ as a rule | how it is built today | OC:No-dependency; DQ-12; C-1 |
| V-129 | Remove the shipped diagnostics once the iOS focus-jump root cause is found | ADR-0031 | OC:Remove diagnostics; LC-3; B-47 |
| V-130 | Accept as out of scope: key compared by plain equality; unbounded push dedupe sets; message text on the lock screen | harm stated in review | R-18; R-19; R-20 |
| V-131 | Leaving the resend editor without sending closes it; original unchanged | (J-03; listed last to keep numbering stable) | FV#23 B-44 |

---

## Source coverage (dedupe audit)

Every source item maps to exactly one V-item.

**flows.md "Verdicts needed" (FV#1–92):**
1→V-005 · 2→V-030 · 3→V-014 · 4→V-066 · 5→V-031 · 6→V-093 · 7→V-094 · 8→V-091 · 9→V-092 · 10→V-090 ·
11→V-040 · 12→V-037 · 13→V-038 · 14→V-100 · 15→V-039 · 16→V-101 · 17→V-003 · 18→V-042 · 19→V-037 · 20→V-102 ·
21→V-050 · 22→V-077 · 23→V-131 · 24→V-092 · 25→V-018 · 26→V-051 · 27→V-014 · 28→V-115 · 29→V-116 · 30→V-070 ·
31→V-071 · 32→V-105 · 33→V-103 · 34→V-104 · 35→V-092 · 36→V-017 · 37→V-047 · 38→V-044 · 39→V-045 · 40→V-072 ·
41→V-106 · 42→V-107 · 43→V-108 · 44→V-004 · 45→V-048 · 46→V-049 · 47→V-112 · 48→V-113 · 49→V-114 · 50→V-019 ·
51→V-020 · 52→V-080 · 53→V-079 · 54→V-052 · 55→V-118 · 56→V-119 · 57→V-016 · 58→V-015 · 59→V-081 · 60→V-054 ·
61→V-121 · 62→V-007 · 63→V-007 · 64→V-008 · 65→V-013 · 66→V-009 · 67→V-010 · 68→V-033 · 69→V-034 · 70→V-096 ·
71→V-097 · 72→V-022 · 73→V-023 · 74→V-057 · 75→V-055 · 76→V-125 · 77→V-056 · 78→V-085 · 79→V-084 · 80→V-124 ·
81→V-058 · 82→V-035 · 83→V-035 · 84→V-087 · 85→V-088 · 86→V-126 · 87→V-127 · 88→V-065 · 89→V-098 · 90→V-099 ·
91→V-018 · 92→V-117

**Moment-spec gaps (74):**
M-01: G1→V-025 · G2→V-025 · G3→V-027 · G4→V-067 · G5→V-029 · G6→V-028 · G7→V-035 · G8→V-095
M-02: G1→V-068 · G2→V-039 · G3→V-038 · G4→V-003 · G5→V-037 · G6→V-040 · G7→V-043 · G8→V-093
M-03: G1→V-042 · G2→V-041 · G3→V-037 · G4→V-003 · G5→V-069 · G6→V-040
M-04: G1→V-048 · G2→V-043 · G3→V-017 · G4→V-078 · G5→V-067 · G6→V-067 · G7→V-043
M-05: G1→V-092 · G2→V-046 · G3→V-109 · G4→V-103 · G5→V-071 · G6→V-048 · G7→V-059
M-06: G1→V-072 · G2→V-110 · G3→V-073 · G4→V-109 · G5→V-029 · G6→V-059
M-07: G1→V-004 · G2→V-004 · G3→V-074 · G4→V-075 · G5→V-048 · G6→V-076
M-08: G1→V-032 · G2→V-064 · G3→V-014 · G4→V-065 · G5→V-067 · G6→V-005
M-09: G1→V-053 · G2→V-053 · G3→V-120 · G4→V-029 · G5→V-015 · G6→V-059
M-10: G1→V-082 · G2→V-122 · G3→V-121 · G4→V-083 · G5→V-123 · G6→V-081 · G7→V-013
M-11: G1→V-055 · G2→V-125 · G3→V-023 · G4→V-056 · G5→V-067 · G6→V-022 · G7→V-086

**Review findings (20):** R-01→V-001 · R-02→V-002 · R-03→V-006 · R-04→V-011 · R-05→V-024 · R-06→V-012 ·
R-07→V-015 · R-08→V-008 · R-09→V-067 · R-10→V-036 · R-11→V-026 · R-12→V-063 · R-13→V-111 · R-14→V-060 ·
R-15→V-061 · R-16→V-062 · R-17→V-021 · R-18/R-19/R-20→V-130

**Technical-design Open Checks (6):** Atomic writes→V-002 · 1-hour fallback→V-034 · Split widget file→V-089 ·
No-dependency/Node 18+→V-128 · Combined server for done→V-023 · Remove diagnostics→V-129
