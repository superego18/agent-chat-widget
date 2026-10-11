# UX Review — agent-chat-widget (retrofit, stage 5 review gate) — 2026-10-12

Reviewer: critic-agent (did not author the artifacts under review). Proposes only; nothing in
`product/`, `docs/adr/` or code was changed.

Reviewed: `product/discovery.md`, `product/user-journeys.md`, `product/flows.md` (incl. "Verdicts
needed" 1–92), `product/state-model.md`, `product/screen-map.md`, `product/moment-specs/M-01 … M-11`
(incl. their §8 Gaps, 74 items), `product/technical-design.md` (incl. Open Checks), `GLOSSARY.md`,
`CODING_STANDARDS.md`, `docs/adr/0001–0038` + README. Spot-checked code: `assets/app-widget.js`
(poll/compose sync W:1296-1351, W:2123-2161; tabs W:770-795; ARIA attributes; history handling),
`scripts/chat-handler.mjs` (text limits, id scheme, `unknown` status), `README.md`, `tests/chat.test.mjs`
(7 tests).

Decisions consulted: ADR-0001 … ADR-0038. Nothing below re-raises a rejected or deferred decision.
Where an ADR's "Revisit when" condition bears on a finding it is named.

Dimensions skipped: none. All eight applied (see §Dimension coverage).

Evidence limits (read before acting on any finding):
- **Text + code only.** No diagram exists and the operable GUI was not exercised in this gate.
  Findings marked "(code reading, not run)" describe what the code does on reading; each needs a
  reproduction before a fix (ADR-0031). GUI evidence for this gate is **Pending** (see R-16).
- Excluded on purpose: everything already listed in `flows.md` "Verdicts needed" or in a moment
  spec's Gaps section. Those are consolidated in `reviews/2026-10-12-verdict-batch.md`, not repeated here.

---

## Dimension coverage

| Dim | Already covered by existing lists (not repeated) | New findings here |
|---|---|---|
| D1 Cancel / escape | B-07, B-44, B-60, B-208/209, M-07 G2 | R-10 |
| D2 Undo / reversibility | B-36, B-176, B-202, M-03 G1, M-05 G2, M-11 G1 | R-06, R-13 |
| D3 Waiting | B-15/16, B-26/27, B-160, M-01 G1 | — (R-08 sharpens B-160) |
| D4 Empty / first run | B-12, B-13, B-99, B-175, M-11 G7 | R-12 |
| D5 Authorization / ownership | B-103, B-130/131, B-148, B-190/191 | R-05, R-07 |
| D6 Interruption / preservation | B-21, B-112–114, M-07 G1–G5 | R-01, R-02, R-11 |
| D7 Repetition / concurrency | B-22, B-38, B-84, B-104, B-146, B-166 | R-04 |
| D8 Degradation / environment | B-17, B-20, B-149, B-161/162, M-04 G5/G6, M-08 G5 | R-03, R-08, R-09 |
| Artifact completeness / traceability | — | R-14, R-15, R-16, R-17 |

---

## Critical — data loss, permanent confusion, or a dead end

### R-01 — Typed text can be silently replaced by an older server copy after failed saves
- **Tier:** Critical · D6, D8 · (code reading, not run)
- **What is wrong:** Compose saves are fire-and-forget (`fetch(...).catch(() => {})`, W:2137). The
  local `composed` map is overwritten wholesale by every successful poll (W:1305), and
  `loadCompose(false)` writes the server text into the input whenever the owner has not typed for
  3 s (W:2150-2151). If saves fail while polls succeed (flaky mobile network, tailnet reconnect,
  chat server restarted), or the owner pauses typing while offline and the network then returns,
  the next poll puts the **last successfully saved (older) text** back into the input, discarding
  what he typed since. Separately, the `pagehide` flush (W:2163) uses a plain `fetch` without
  `keepalive`, so the last <400 ms of typing can be lost on a real page unload.
- **User impact:** The owner loses part of a message he was writing, with no signal. This directly
  contradicts the adopted rule "중간에 하던 것들은 무조건 보존" (ADR-0026, #1435, #1438) on the exact
  network (phone, mobile data) the product is built for (G-2).
- **Trace:** J-01 st.3, J-07 st.3 · F-01 step 3, B-22 (related, two devices — this is one device) ·
  ST-01, TR-01 · SC-07 · M-01 §7 (says text is preserved).
- **Suggested resolution (expected behavior):** Local text that is newer than the last confirmed
  server save is never replaced by the server copy; a failed save is retried or surfaced. Add a test
  that drops `/api/compose` POSTs and asserts the input keeps its text.

### R-02 — A torn write of a shared state file can wipe the drafts box, holds, read state or push subscriptions
- **Tier:** Critical · D6, D7
- **What is wrong:** `drafts.json`, `compose.json`, `seen.json`, `prefs.json`, `push-subs.json` are
  written non-atomically; a parse error is read as empty and the next write overwrites the file
  (technical-design Known risks; state-model §8). The technical design lists this only as an
  engineering Open Check; no UX artifact states the user-visible consequence.
- **User impact:** One crash, disk-full or concurrent write mid-save can erase days of drafts-box
  notes and all Hold items and trash (no undo, since trash lives in the same file); mark every
  answer as read on every device (`seen.json` empty → W:1325-1333 seeds "seen" to the latest item);
  or silently stop all notifications. Permanent loss of exactly the work J-02 exists to protect (SC-2).
- **Trace:** J-02 all stages, J-04 st.4, J-07 · F-06, F-07, F-09, F-14 · ST-10…ST-16, ST-43, ST-45/46 ·
  SC-06, SC-12 · technical-design Open Check "Atomic writes".
- **Suggested resolution:** All shared files written atomically; an unreadable file is never treated
  as empty (refuse the write and surface an error instead, as `delivered.json` already does).

---

## High — recoverable only by guessing, retrying blindly, or leaving and returning

### R-03 — Long messages are silently truncated at 12,000 characters
- **Tier:** High · D8 (extremes of real data)
- **What is wrong:** The server keeps only the first 12,000 characters of a message and of the
  compose text (`slice(0, 12000)`, H:254, H:383). Bodies over 256 KB are dropped (`req.destroy()`)
  and surface as the generic failure toast with no reason. The widget has no length limit or counter.
- **User impact:** Pasting a long log or spec sends a cut-off message; the agent works from partial
  input and the owner believes the whole text went. Compose text beyond the limit is lost after a
  reload or on another device.
- **Trace:** J-01 st.3–4 · F-01 steps 3–4 · TR-01, TR-03 · SC-07 · M-01 (not mentioned).
- **Suggested resolution:** Over-limit text is refused before sending with a visible reason (or
  sent whole); never truncated silently.

### R-04 — Lost updates on `delivered.json` can re-deliver old messages or roll back read state
- **Tier:** High · D7
- **What is wrong:** Three writers (watcher, hook relay, handler) read-modify-write `delivered.json`
  without a lock; the rename is atomic but the update is not (technical-design Known risks). This is a
  different race from B-38 (cancel vs pickup).
- **User impact:** A lost update can move a session's `lastId` backwards, so the next watcher run
  re-delivers messages the agent already handled (duplicate work), or drops a `_read` time so a read
  message jumps back to unread / to the wrong place. Breaks SC-3 ("truthful read state").
- **Trace:** J-01 st.4 · F-11 steps 3–4, F-02 step 3 · ST-03→ST-05, TR-06, TR-08 · SC-05.
- **Suggested resolution:** One writer, or a lock around the read-modify-write; a regression test
  with two concurrent writers.

### R-05 — Setup does not keep `.ui-feedback/` out of git
- **Tier:** High · D5
- **What is wrong:** All runtime state lives in `<project>/.ui-feedback/` — full chat history,
  `lan-key`, `vapid.json` (push private key), push endpoints, diagnostics. `install-hooks.mjs` only
  git-ignores `settings.local.json`; the README's quick start does not mention ignoring
  `.ui-feedback/`. (Possibly handled by the separate ui-feedback-loop skill — not verifiable here.)
- **User impact:** On a project with a public repo (the owner publishes repos, C-3) a routine
  `git add .` publishes the conversation, the LAN access key and the push signing key. Not visible
  until after the push.
- **Trace:** J-08 st.2–3 · F-13 steps 2, 4 · discovery C-3, NG-1 · ADR-0007.
- **Suggested resolution:** Setup ensures `.ui-feedback/` is ignored, and the README says so.

### R-06 — Clear-input `×` erases the text on every device with no undo
- **Tier:** High · D2
- **What is wrong:** `×` (B-07, adopted #758) empties the input and the server compose copy at once
  (W:2153 → input event → save). Every other destructive action on notes has an undo
  (`되살리기` toast + trash for Hold/drafts, B-80/B-96). The `×` sits inside the input on a phone.
- **User impact:** A mis-tap wipes a long message being composed, on the phone and desktop alike,
  with no way back. The adoption of `×` did not decide reversibility.
- **Trace:** J-01 st.3, J-02 st.1 · F-01 B-07 · ST-01, TR-01 · SC-07.
- **Suggested resolution:** Clearing is undoable for a short window, consistent with the other deletes.

### R-07 — The active session tab is silently reassigned when a session disappears
- **Tier:** High · D5, D7 · **would change the F-10 main path** (route to requirement gate)
- **What is wrong:** If the selected session is no longer in the sessions list (unregistered, renamed,
  file removed), `renderTabs` switches `activeTab` to a session named `작업 세션` or the first one
  (W:773) with no notice. Compose text, categories and the next send now target another session.
  B-148 covers a session that *ended* but stays listed (grey tab); this is the case where it vanishes.
- **User impact:** A message meant for one session reaches another; the owner learns only from the
  wrong agent's answer.
- **Trace:** J-06 st.2–3, J-01 st.2 · F-10 step 2–3, B-148 · TR-45 · SC-04.
- **Suggested resolution:** A vanished target is shown as such, and sending is blocked or explicitly
  redirected by the owner; never switched silently.

### R-08 — "Unknown" session status looks identical to a healthy session
- **Tier:** High · D3, D8 · sharpens B-160
- **What is wrong:** The server reports `unknown` for a session non-idle for >30 min or with no status
  file (H:77-80, ST-21). The tab dot only distinguishes busy / watching / off (W:783), so an
  `unknown` session with a live watcher shows the same green dot as a healthy one. ST-21 has no
  visible representation (screen-map SC-04 lists it, the code does not draw it).
- **User impact:** Exactly when hooks have failed (the #667/#676 case), the panel looks normal; the
  owner waits for an answer that will not come.
- **Trace:** J-01 st.2, J-06 st.1 · F-11 B-160, B-161 · ST-21, TR-38 · SC-04 · E11.
- **Suggested resolution:** Unknown/stuck is visibly distinct from working and idle, with a next step.

---

## Medium — noticeable friction, correct outcome

### R-09 — Session state is conveyed by colour and motion only
- **Tier:** Medium · D8
- **What is wrong:** Tab dots (busy pulse / green / grey) and launcher dots (amber = approval) have no
  text, title or accessible name (W:781-784, W:303). Tabs use `role="tab"` with `aria-pressed`
  instead of `aria-selected`. CODING_STANDARDS §5: "important meaning cannot depend only on motion,
  color". Peer-send arrows are shown "only while it happens" (motion-only).
- **User impact:** In bright sunlight or with reduced motion the owner cannot tell which session waits
  for approval; any screen-reader path is absent. (Single sighted owner today — hence Medium.)
- **Trace:** J-06 st.1, J-04 st.2 · F-10 step 1, F-14 B-197 · ST-17…ST-21 · SC-01, SC-04.
- **Suggested resolution:** Each state has a text equivalent (tooltip/label) and selected-tab semantics.

### R-10 — The phone's back gesture leaves the host page instead of closing the panel layer
- **Tier:** Medium · D1
- **What is wrong:** The widget adds no history entries (no `popstate` handling; screen-map §6 marks
  it inferred). On a phone the panel is full-screen, so it reads as a screen; back/swipe-back
  navigates the host app underneath while the panel, drafts sheet or pick mode stays open.
- **User impact:** The owner's natural escape gesture does something unexpected; the panel reopens on
  the app's previous page.
- **Trace:** J-01 st.2 · F-01 step 1, F-07 step 3, F-15 step 1 · TR-44, TR-47, TR-49 · SC-P, SC-11, SC-12.
- **Suggested resolution:** Decide whether back should close the top layer (sheet → pick → panel), or
  record that it intentionally does not.

### R-11 — Relaunching more than 2 minutes after a killed send can refill already-sent text
- **Tier:** Medium · D6, D7 · (code reading, not run)
- **What is wrong:** If iOS kills the app while a send is in flight, the server may have saved the
  message while `compose.json` still holds the text. On relaunch, the "already sent" check uses an
  in-memory map (lost) and a 2-minute window on identical text (W:2144-2148). After 2 minutes the
  text is refilled; pressing send makes a second message (the client id is not persisted either).
- **User impact:** Duplicate instruction to the agent; contradicts B-21 ("already-sent text not
  refilled", adopted #1202, #1267).
- **Trace:** J-07 st.3, J-01 st.4 · F-01 B-21 · TR-01, TR-03 · SC-07 · M-01 B9.
- **Suggested resolution:** Already-sent text is never refilled regardless of elapsed time.

### R-12 — Empty session tab has no designed state
- **Tier:** Medium · D4
- **What is wrong:** EM3 (session tab with no messages) is "Pending (not designed)" in the state model
  and is not in any verdict list. A newly registered session shows an empty list.
- **User impact:** First use of a session gives no cue whether delivery works (only the mode line).
  Minor for the owner; first impression for an adopter (depends on R-17).
- **Trace:** J-01 st.2, J-08 st.5 · F-01 step 1 · ST-27 · SC-05 · state-model EM3.
- **Suggested resolution:** Confirm the mode line is enough, or add a one-line empty state.

### R-13 — Trash expires silently after 7 days, and the 7-day number's provenance conflicts
- **Tier:** Medium · D2
- **What is wrong:** flows B-80/B-96 mark the 7-day trash window "Adopted (owner, #908 …)", while
  state-model ST-16 says the 7-day window was "never stated as an owner number". Expiry is silent
  (screen-map §5, Pending).
- **User impact:** A note the owner meant to restore can vanish without notice; artifacts disagree on
  whether he chose that.
- **Trace:** J-02 st.3 · F-06 B-80, F-07 B-96 · ST-16, TR-32 · SC-12.
- **Suggested resolution:** Owner confirms the window and that silent expiry is acceptable.

### R-14 — Cross-references are stale and two ID namespaces collide
- **Tier:** Medium · artifact completeness (blocks "trace findings to branch/transition IDs")
- **What is wrong:**
  - `state-model.md` §0/§2.4 and `screen-map.md` §0/§7 say `flows.md` does not exist and `docs/adr/`
    holds only a README; `flows.md` §0 says "0 ADRs" and every ST/TR cell "Pending". All three are
    now false (flows has 212 branches, 38 ADRs exist).
  - `SC-1…SC-8` (success signals, discovery) and `SC-00…SC-18` (screens, screen-map) share a prefix;
    state-model's "SC refs" column cites screen IDs; journeys cite success-signal IDs.
  - Moment specs use local branch IDs B1–B10 alongside global flow IDs B-01…B-212.
- **User impact:** The owner (and later agents) cannot follow a verdict from journey to code; the
  stage-6 coverage check cannot pass as written.
- **Trace:** discovery, flows §0, state-model §0/§2.4, screen-map §0/§7, M-01…M-11 §3.
- **Suggested resolution:** Refresh refs after the verdict batch; rename one SC namespace.

### R-15 — Some flow rows contradict accepted ADRs
- **Tier:** Medium · artifact completeness
- **What is wrong:**
  - ADR-0018 (Accepted) says a cancelled trace "can be resent later"; flows B-36 asks the same
    question as NEEDS VERDICT.
  - ADR-0035 (Accepted, not built) decides the drafts-backlog flow; flows B-101 / LC-5 still NEEDS VERDICT.
  - ADR-0022 lists five default kinds; the built `work` kind defaults on (M-09 G3). ADR-0024 implies it.
  - discovery DQ-06 "open" while ADR-0009 is Accepted with a revisit trigger.
  - B-80 "Adopted" vs ST-16 (see R-13).
- **User impact:** The owner gets asked again about things he decided, or gives a verdict that
  silently conflicts with a record.
- **Trace:** ADR-0009, 0018, 0022, 0024, 0035 · B-36, B-101, B-156 · DQ-06, LC-5.
- **Suggested resolution:** Rule that an Accepted ADR wins until superseded; mark those flow rows
  accordingly (folded into the verdict batch).

### R-16 — This gate has no GUI evidence; 36 transitions are unverified by anyone
- **Tier:** Medium · gate completeness
- **What is wrong:** Stage 5 asks to review model, diagram and operable GUI together. No diagram
  exists; the GUI was not exercised here; state-model §2.4 shows 36 transitions with neither a test
  nor an owner confirmation (hold, drafts, push settings, review page).
- **User impact:** Verdicts given on text alone may "adopt" behavior that does not work as described
  (e.g. R-01, M-07 G1 are code readings, not observations).
- **Trace:** state-model §2.4, screen-map §3 ("No archify diagram"), ux-process stage 5.
- **Suggested resolution:** Owner accepts a text-only gate for the retrofit, with GUI reproduction
  required only for the Critical/High items before they are fixed.

### R-17 — "Who is this for" (DQ-02) is still open, yet a block of verdicts depends on it
- **Tier:** Medium · requirement gate (would change scope, not a branch)
- **What is wrong:** Whether adopters (U-2) are a real target is undecided (DQ-02), but J-08, F-13
  B-190–B-194, B-174/LC-6, R-05, R-12 and the no-dependency rule (DQ-12) are only worth fixing if
  they are.
- **User impact:** Without this answer the owner must judge ~12 setup items individually.
- **Trace:** discovery DQ-02, U-2, SC-8 · J-08 · F-13 · ADR-0036 (revisit: "an adopter needs the combined setup").
- **Suggested resolution:** Decide DQ-02 first; adopter-only items can then be deferred as a block.

---

## Out of scope — real, but cost exceeds harm

### R-18 — Access key compared with plain string equality
- **Harm:** Theoretical timing side channel. Reachable only on the LAN or the private tailnet (ADR-0007);
  practical risk negligible. Trace: F-13 B-181, `lan-auth.mjs`.

### R-19 — In-memory push dedupe sets grow without bound
- **Harm:** Slow memory growth in a long-running chat server; a restart clears it. Trace: F-09 B-128.

### R-20 — Push notifications show message text on the lock screen
- **Harm:** Anyone holding the phone can read agent answers. Single-owner device; owner chose the kinds
  (ADR-0022). Trace: F-09 step 4.

---

## Proposed decisions

All findings above need an owner verdict; they are merged with the existing open lists in
`reviews/2026-10-12-verdict-batch.md`. Priority order for these new ones:

1. R-01 — never overwrite newer local typing (batch V-001)
2. R-02 — atomic shared-state writes (V-002)
3. R-17 — decide DQ-02 first to unlock bulk deferral (V-021)
4. R-07 / R-08 — no silent misrouting; unknown status visible (V-015, V-008)
5. R-04 — single writer for delivery state (V-011)
6. R-03 — no silent truncation (V-006)
7. R-05 — keep `.ui-feedback/` out of git (V-024)
