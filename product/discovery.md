# Discovery — agent-chat-widget + ui-review-page

**Status:** Retrofit draft 2026-10-12 — awaiting owner verdicts

> Retrofit: reconstructed from chat #ids. The product shipped before this stage ran.
> Everything below is rebuilt from the owner's chat history (2026-10-07 to 2026-10-11)
> and the code as of 2026-10-12. `#N` = global message number in that history.
> Nothing here is confirmed until the owner gives a verdict.
> Lines marked "(inferred — needs owner verdict)" have no direct owner message behind them.

## Problem

The owner builds web apps by directing several AI coding-agent sessions (Claude Code and
Codex) at once. Each session lives in its own terminal. That forces him to sit at the
computer, switch terminals to see which session said what, and wait for an agent to finish
before he can add a thought. Away from the desk he loses track of what each session is doing.

- Wants one screen to handle all work across sessions: "나는 한 화면에서 모든 작업을 다 처리하려는 거야" (#11, #13).
- Wants to keep working from the phone, anywhere, including over a mobile network (#430, #587, #617, #629).
- Has ideas while the agent is busy and needs somewhere to put them (#246, #373, #786, #1121).
- Could not tell whether the agent had read a message sent while it worked (#605).
- Reviewing UI changes from screenshots alone was not enough to judge feel or animation (#541, #1510).

## Users

| ID | User | Situation | Needs | Evidence |
|---|---|---|---|---|
| U-1 (primary) | The owner: a developer directing several coding-agent sessions on one project | Often on a phone (iOS Safari, home-screen app) over Wi-Fi or a mobile network, sometimes on desktop; tests each change live right away | One place to talk to every session; know what each is doing and what it has read; never lose a thought or half-written text; be told when attention is needed | #11, #32, #605, #617, #1155, #1435; testing habit P16 (part 2), M14 (part 3) |
| U-2 (secondary) | A developer adopting the widget for their own project | Clones the public repo, puts the proxy in front of their app, registers their sessions | Setup without dependencies; clear separation of chat and review page; no assumptions about the owner's machine | Public MIT repo (#401, #404); README may link it (#419); split into standalone submodules (#1538, #1542, #1547). Needs and setup pain are (inferred — needs owner verdict) |

Out of scope as users: teams sharing one widget, or people who are not the developer of the
app (inferred — needs owner verdict).

## Goals

| ID | Goal | Evidence |
|---|---|---|
| G-1 | Direct every agent session of a project from one chat panel attached to the app, one tab per session | #11, #13, #22 |
| G-2 | Work from a phone anywhere, at a stable address, as comfortably as on desktop | #462–#473, #587, #617, #629 |
| G-3 | Capture thoughts while an agent is busy without interrupting it, and choose when and how they reach it (hold, drafts box, interject) | #246, #373, #786, #792, #1121, #1134 |
| G-4 | Always know what each session has read and which answer belongs to which question | #605, #648, #661, #823, #990, #1088 |
| G-5 | Be notified when a session needs attention, and land in the right place when tapping the notice | #45, #1155, #1175, #1455 |
| G-6 | Never lose in-progress work (typed text, attached quote, picked location, edits) to a reload or network trouble | #345, #1405, #1435, #1438 |
| G-7 | Judge UI changes by rating them side by side, with live HTML where feel matters | #541, #543, #544, #545 |
| G-8 | Keep the tool reusable: one shared module, separate repos for chat and review page | #305, #316, #1538, #1542, #1545 |

## Non-goals

| ID | Non-goal | Evidence |
|---|---|---|
| NG-1 | Exposing the app or chat on the public internet (public tunnels, public relay services) | #441, #617–#621, #1157 |
| NG-2 | An "all sessions" combined tab | #22 |
| NG-3 | Showing app and chat side by side on a phone | #640 |
| NG-4 | Optimistic sending that shows success before the server accepts | #1270, #1271 |
| NG-5 | Hidden behavior rules the agent invents without telling the owner | #821, #823, #829 |
| NG-6 | Silent automatic reloads; reload only as an announced tool | #1374, #1375 |
| NG-7 | A delete action for cancelled sends (cancelled message stays as a trace) | #1117, #1119 |
| NG-8 | Fixed lists of "UX principles" applied regardless of context | #1488 |
| NG-9 | Cancel/interject for Codex sessions (not built; never requested) (inferred — needs owner verdict) | code.md §5 |
| NG-10 | Multi-user accounts or team use (inferred — needs owner verdict) | — |

## Constraints

| ID | Constraint | Evidence |
|---|---|---|
| C-1 | No runtime dependencies; Node 18+. Test tooling (playwright-core) is the only dev dependency | README line 3, package.json. No owner message found — confirm it is a hard rule (inferred — needs owner verdict) |
| C-2 | Reachable only locally, on the LAN with an access key, or over the owner's private tailnet; nothing public | #441, #445, #617–#631, #1157 |
| C-3 | Public repos: no private data, hostnames, keys or personal records in commits | #401, #404, #1547, #1585–#1589; key-in-URL bug #458–#460 |
| C-4 | Works with both Claude Code (hooks) and Codex (`codex queue`, transcript tail) | #194–#216 |
| C-5 | Must work on iOS Safari: 16px inputs, no autofocus on touch, keyboard-aware layout | #467–#473, #1204 |
| C-6 | Must not disturb other sessions; shared servers restart only with the owning session's permission | #209 |
| C-7 | UI text and agent messages in Korean | #65; agent self-correction #839, #1354 |
| C-8 | Automated tests run on every commit | #1510, #1512 |
| C-9 | Measure real values; no guessed magic numbers in layout | #986 |

## Success signals

| ID | Signal | Evidence |
|---|---|---|
| SC-1 | The owner drives all sessions from the panel without going back to a terminal for routine work | #11, #144, #187 (inferred as a measurable signal — needs owner verdict) |
| SC-2 | A thought typed while the agent works is never lost and reaches the agent at the moment he chooses | #246, #792, #1121, #1435 |
| SC-3 | Every own message shows a truthful read state, and the chat order matches the real reading order | #605, #661, #823 |
| SC-4 | Notifications arrive once, only when wanted, and open the right session | #1336–#1349, #1455 |
| SC-5 | A reload or network change loses nothing he was doing | #1438, #1444 |
| SC-6 | A UI round can be judged and its verdicts reach the agent without retyping | #561, #563, #218–#223 |
| SC-7 | The owner stops finding regressions by hand; tests catch them first | #1508, #1510 (inferred as a signal — needs owner verdict) |
| SC-8 | Another developer can set the widget up on a new project from the README alone | (inferred — needs owner verdict) |

Approvals observed in chat ("잘되네", "오케이 좋아", "오케이 이걸로 됐다") are the only
satisfaction evidence so far (#666, #851, #1049). No usage measurements exist.

## Decision Tree and Current Frontier

| ID | Decision or question | Depends on | State | Answer or next action | Evidence / ADR |
|---|---|---|---|---|---|
| DQ-01 | Route chat by session, not by fix target | — | confirmed (retrofit) | One tab per registered session | #11, #13; ADR pending |
| DQ-02 | Who the product is for | — | open | Owner first; adopter second? Confirm U-2 is a real target | #401, #419 |
| DQ-03 | Remote access model | C-2 | confirmed (retrofit) | Private tailnet + LAN key; no public tunnel | #617–#631, #1157 |
| DQ-04 | How deferred thoughts are kept | G-3 | confirmed (retrofit) | Two places: Hold (bottom of chat) and Drafts box (by category) with separate buttons | #1121–#1143 |
| DQ-05 | When a sent message reaches a busy agent | G-3 | confirmed (retrofit) | Waits until work ends; explicit Interject button otherwise | #792, #794 |
| DQ-06 | Chat order: send time or read time | G-4 | open | Built as read time; peer session asked to keep send order (#1388), unanswered | #648, #661, #1388 |
| DQ-07 | What a cancelled send becomes | — | confirmed (retrofit) | Stays as struck-through trace; can move to Hold | #1113–#1119, #1407 |
| DQ-08 | Notification kinds and quiet rules | G-5 | confirmed (retrofit) | Kinds 1–5 on, peer off, "quiet while viewing" as setting | #1175, #1177, #1449 |
| DQ-09 | Reload behavior | G-6 | confirmed (retrofit) | Manual ↻ or agent-invoked tool, both with a cover; never automatic | #1374, #1375, #1391 |
| DQ-10 | Review page scope | G-7 | open | Generic comparison (#543–#545) vs owner's later view that verifying on the real screen is better (#1510) | #541–#545, #1510 |
| DQ-11 | Pre-hook conversation history in the panel | G-1 | deferred, never decided | Needs verdict | #6, #10 |
| DQ-12 | Is "no dependencies, Node 18+" a requirement | C-1 | open | Needs verdict | README |

## Later Checks (when needed)

| ID | Unknown / decision affected | Resolve at stage or earlier trigger | Evidence / pass criterion | Owner | Permitted work before check / stop point | Human verdict / ADR |
|---|---|---|---|---|---|---|
| LC-1 | Watcher stops when session closes or computer sleeps (G-1, J-01) | Stage 2 flows | Owner states acceptable recovery | Owner | Draft journeys; no flow freeze | Pending (#146, #189, #1521) |
| LC-2 | Batched drafts send drops reply/reference info (J-02, J-03) | Stage 2 flows | Decide whether batch carries quotes | Owner | Journeys only | Pending (agent #1409) |
| LC-3 | Resend focus jump on iOS, root cause unknown (J-03) | Stage 8 | Root cause found, diagnostics removed | Agent | None on that path | Pending (#1323, #1327) |
| LC-4 | Arrows between non-adjacent tabs unverified with 3+ sessions (J-06) | Stage 3 GUI review | Seen on screen | Owner | Journeys only | Pending (#734, #735) |
| LC-5 | ~25–30 queued drafts-box requests never processed (all journeys) | Before stage 2 | Triaged into journeys or rejected | Owner | Journeys draft | Pending (#511, #907, #1473) |
| LC-6 | Combined server wiring review "done" → chat is in neither repo (J-05, J-08) | Stage 2 | Setup path for adopters defined | Owner | Journeys draft | Pending (code.md §5) |

## Workflow Evidence

| ID | Source and exact location | Observed fact / reported behavior / inference | Finding | Human confirmation / limitation |
|---|---|---|---|---|
| WE-1 | Chat history part 1 (#3–#580) | Reported behavior: owner requests, decisions, bugs | Features grew one request at a time; owner tested each live | Agent summary of chat, not raw read by owner |
| WE-2 | Chat history part 2 (#581–#1110) | Reported behavior | Many corrections of agent-invented rules and layouts | Same |
| WE-3 | Chat history part 3 (#1111–#1603) | Reported behavior | Owner judged progress slow; asked for requirements → tests → principles (#1471–#1510) | Same |
| WE-4 | code.md (widget, handlers, scripts, review page as of 2026-10-12) | Observed fact | 2,397-line widget; 7 automated tests; most features untested | Code read, not run |
| WE-5 | Phone usage | Reported behavior only (owner messages from phone) | No screen recordings of real use | Ask owner for a recording of one real session (inferred — needs owner verdict) |

## Skill Execution Evidence

| Skill | Instructions loaded from | Work performed and evidence | Missing checks |
|---|---|---|---|
| grilling | not run | Retrofit only: decisions recovered from chat, no new questioning | Full grilling round with owner on DQ-02, DQ-06, DQ-10, DQ-12 |
| domain-modeling | not run | `GLOSSARY.md` drafted from UI labels and chat | Owner confirmation of terms; ADRs (0 written) |

## Completion Gate

| Requirement | Evidence | Verdict |
|---|---|---|
| Confirmed goals, users, non-goals and terminology | Drafted above and in GLOSSARY.md | Pending |
| Design tree sufficient for journeys; each finding resolved or approved for a named later check with a boundary | DQ-01..12, LC-1..6 | Pending |
| Real workflow evidence reviewed, or an explicit alternative agreed | WE-1..5 (chat summaries, code) | Pending |
| No blocking discovery finding remains | DQ-02, DQ-06, DQ-10, DQ-12 open | Pending |
| Human explicitly confirms shared understanding and readiness for journey drafting | — | Pending |
