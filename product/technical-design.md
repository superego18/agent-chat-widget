# Technical Design - agent-chat-widget + ui-review-page (as built)

**Status:** Retrofit — describes as-built (not an approval of the stack)
**Reviewed on:** 2026-10-12 (code as of commit `5a55625` in agent-chat-widget)
**Approved scope:** None yet. This file records what exists so later changes have a baseline.
Owner verdicts behind the shape of the system are in `docs/adr/` (ADR-0001 … ADR-0038).

> Retrofit: reconstructed from the code of both repos and the chat history (#ids). The product
> shipped before this stage ran. Lines marked "(no owner verdict)" describe code the agent chose
> without a recorded owner decision.

## Owner Requests Before Research

No research round ran; the stack grew request by request. Owner requests that shaped it:

| Request | Source |
|---|---|
| One screen to direct every session of a project | #11 (ADR-0001) |
| Use from the phone anywhere; nothing public | #441, #617 (ADR-0007) |
| Phone/desktop notifications | #1155 (ADR-0021) |
| Modularize as much as possible; split into two standalone repos, each with its own server, history kept | #305, #1538–#1547 (ADR-0004, ADR-0036) |
| Tests run automatically on every commit | #1510, #1512 (ADR-0034) |
| No runtime dependencies, Node 18+ | README only — not confirmed by the owner (discovery DQ-12) |

## Constraints and Evidence

- Journeys J-01…J-08 (`product/user-journeys.md`), state model (`product/state-model.md`), screen map
  (`product/screen-map.md`), discovery constraints C-1…C-9 (`product/discovery.md`).
- Observed facts: two repos, plain Node ES modules, no runtime dependencies; `playwright-core` is the
  only dev dependency (tests). Browser side is one script injected into the host app.
- Target devices: iOS Safari (home-screen app) on the phone; desktop browsers. Device class is decided by
  width (768px).
- Agents supported: Claude Code (hooks) and Codex (`codex queue`, transcript tail).

## Principal Choices

| ID / requirement | Options and tradeoffs | As built / reason | Cost and operating assumptions | Verdict / evidence / ADR |
|---|---|---|---|---|
| PC-1 Runtime | Node with no dependencies vs a framework | Plain Node `http`, ES modules | Runs anywhere Node 18+ exists; everything hand-written | README; no owner verdict (DQ-12) |
| PC-2 Storage | JSON files vs a database | JSON files under `.ui-feedback/` in the project | Single user, single machine; no locking | no owner verdict |
| PC-3 Widget packaging | Framework UI vs one injected script | One IIFE with Shadow DOM, injected by a proxy | No build step; one 2,397-line file | ADR-0004 (shared module) |
| PC-4 Agent bridge | Polling transcripts vs hooks + watcher | Claude Code hooks + `wait-review.mjs` watcher; Codex via `codex queue` | Watcher must be re-armed after each reply | ADR-0002, ADR-0003 |
| PC-5 Access | Public tunnel vs LAN key + private tailnet | `--lan` key cookie; tailnet HTTPS | Owner-only access | ADR-0007 |
| PC-6 Notifications | Public relay vs own web push | Own RFC 8291/8292 web push, VAPID keys local | Needs HTTPS and home-screen install on iOS | ADR-0021 |
| PC-7 Repos | One repo vs two | `agent-chat-widget` + `ui-review-page`, public, MIT | Combined server wiring lives in neither | ADR-0036 |
| PC-8 Tests | Manual owner testing vs automated | Playwright (`playwright-core`, local Chrome), pre-commit hook | Needs local Chrome; `core.hooksPath` per machine | ADR-0034 |

## Data Flow and Boundaries

### Modules

agent-chat-widget (`assets/`, `scripts/`):

| Module | Lines | Role |
|---|---|---|
| `assets/app-widget.js` | 2,397 | The whole chat panel: tabs, list, compose, hold, drafts box, reply/reference, links, push settings, reload, location pick, state preservation |
| `assets/sw.js` | 32 | Service worker: shows pushes, opens the right session tab on tap |
| `scripts/chat-handler.mjs` | 908 | Request handler: chat, drafts, compose, prefs, seen, sessions, status, push, reload token, PWA manifest |
| `scripts/chat-server.mjs` | 34 | Standalone server mounting the handler (default port 4799) |
| `scripts/app-proxy.mjs` | 106 | Proxy in front of the app (default port 4798): injects the widget, forwards `/__uifb/*`, passes HMR WebSockets |
| `scripts/hook-relay.mjs` | 150 | Claude Code hook entry: status, user prompt, tool labels, interject injection, agent messages |
| `scripts/wait-review.mjs` | 139 | Watcher: waits until the session is idle, prints pending messages, marks them delivered, exits |
| `scripts/chat-format.mjs` | 54 | Message formatting for agents; atomic read/write of `delivered.json` |
| `scripts/register-session.mjs` | 113 | Registers a session by finding a marker in recent Claude/Codex transcripts |
| `scripts/install-hooks.mjs` | 48 | Writes `.claude/settings.local.json` hooks and git-ignores it |
| `scripts/chat-reply.mjs` | 52 | CLI for the agent to post a reply |
| `scripts/reload-widgets.mjs` | 9 | The reload tool: bumps the reload token (ADR-0025) |
| `scripts/lan-auth.mjs` | 85 | `--lan` access key, cookie, printed LAN/tailnet URLs |
| `scripts/web-push.mjs` | 63 | Web push encryption and VAPID signing, no dependencies |

ui-review-page: `assets/review-page.js|css`, `assets/review-template.html` (data block only),
`assets/capture-2x.js`, `scripts/review-handler.mjs`, `scripts/review-server.mjs`,
`scripts/make-capture.mjs`, `scripts/prune-captures.mjs`. It embeds the same chat widget.

### Main flow

```
Owner (phone/desktop browser)
  -> app proxy :4798 (injects widget.js into the app's HTML)
  -> widget polls /__uifb/api/* every 3 s  -> chat server :4799 -> .ui-feedback/*.json
Owner sends -> POST /api/chat (cid) -> chat.json
  Claude session: watcher (wait-review) waits until status is idle -> prints message -> marks delivered.json
                  or Interject: PostToolUse hook injects between tool calls -> marks delivered.json
  Codex session:  server runs `codex queue` at once -> marks delivered
Agent answers -> MessageDisplay hook (or chat-reply.mjs) -> POST /api/chat with `<re N>` -> chat.json
Hooks (UserPromptSubmit / PreToolUse / Stop / Notification) -> POST /api/status -> status-<id>.json -> pushes
```

### Delivery and hook pipeline

- Delivery state is `delivered.json` (`{sid: lastId, _at, _read}`), written by the watcher, the hook relay
  and the server. Writes are temp-file-then-rename; an unreadable file skips the check instead of
  counting as empty (commit 1607886) (no owner verdict).
- Ordering in the widget: held (unread) at the bottom; delivered at `_read`/`_at` (ADR-0009, ADR-0010,
  ADR-0011); a delivery more than 1 hour after sending falls back to send time (no owner verdict).
- Reply links: `<re N>` stripped into `re[]` (ADR-0016), with an order-based fallback.
- Session status: `status-<sid>.json`; non-idle older than 30 minutes reads as unknown. The widget shows
  "stale" after 5 minutes of unchanged work.

### Persisted files (`.ui-feedback/`, inside the project using the widget)

`chat.json` (messages), `delivered.json`, `seen.json` (last-read per session), `prefs.json` (panel size,
input height, tab, labels, scroll position, folds), `compose.json` (unsent text), `drafts.json` (drafts,
holds, 7-day trash), `push-subs.json` and `vapid.json` (mode 0600), `reload.json`, `peers.json`,
`status-<sid>.json`, `watch-<sid>.json`, `sessions/<sid>.json`, `lan-key` (0600), `diag.jsonl`
(temporary). Review page: `r<round>.json`, `captures.json`, `review*.html`, `captures/`. Per-device
browser storage: tab, seen fallback, panel open, reply, location, edits, drafts sheet (ADR-0026).

### APIs (chat handler)

| Path | Purpose |
|---|---|
| `GET/POST /api/chat` | Messages + delivered map / add message (cid dedupe, reply, reference, interject, resend, drafts, location, `<re>`) |
| `POST /api/chat-cancel`, `/api/chat-interject` | Cancel, or toggle Interject, on an undelivered message |
| `GET /api/sessions`, `/api/transcript`, `/api/watch` | Sessions with status and watcher state; Codex transcript tail; review auto-continue |
| `POST /api/status` | Hook status updates (trigger pushes) |
| `GET/POST /api/drafts`, `/api/compose`, `/api/prefs`, `/api/seen` | Drafts/holds/trash; unsent text; preferences; read state |
| `GET /api/widget-version`, `POST /api/reload-widgets` | Reload token (ADR-0025) |
| `/api/push-*` | VAPID key, subscribe, unsubscribe, test, per-device prefs, viewing heartbeat |
| `POST /api/diag` | Temporary diagnostics (should be removed, LC-3) |
| `/__uifb/widget.js`, `sw.js`, `manifest.webmanifest`, icons | Static assets and PWA manifest |

Review handler: `/api/feedback?round=` (verdicts, overall, done → `onDone`), `/api/captures`,
`/api/watch` (delegated), static review files.

### Access and auth

- Local requests are trusted. With `--lan`, a random key arrives once as `?k=`, becomes a 30-day HttpOnly
  cookie, and is stripped from the URL; requests via the tailnet's HTTPS proxy also need the key.
- No accounts or roles: single owner (discovery NG-10, unconfirmed). Nothing is exposed publicly (ADR-0007).

### Push

- Kinds: answer, done, permission, review page ready, stale (>5 min), peer, work (quiet). Defaults and the
  quiet-while-viewing setting per ADR-0022; silent other-session activity per ADR-0024; one push per
  answer per ADR-0023.
- Viewing heartbeat every 15 s; blur, hide or close ends viewing at once; 30 s without heartbeat ends it.
- Tapping a notice focuses the window and opens that session's tab.

### Tests

`tests/chat.test.mjs` (Playwright, 390×800 touch viewport, local Chrome), run by `npm test` and the
pre-commit hook. Seven tests: send and clear; slow-server retry makes one message; unread actions;
unread to hold; reload keeps compose text and reference; ordering by read time with the 1-hour rule;
reload only on request with the cover. Untested: hold actions, drafts box, interject, cancel/interject
server guards, resend, partial quotes, links, peer messages, status/watcher/hooks, unread and scroll
handling, location pick, push, proxy, access key, desktop widths, and the whole review page.

### Known risks

| Risk | Where |
|---|---|
| The widget is one 2,397-line IIFE with ~40 shared mutable variables and ~280 lines of inline CSS | `assets/app-widget.js` |
| Any key change re-renders the whole list; the render key is ad hoc and must grow with every field | widget render loop |
| Polling every 3 s across 6 endpoints, plus 1 s / 300 ms timers | widget |
| Cancel vs watcher delivery race (check-then-act across two files) | handler cancel vs watcher |
| `delivered.json` lost updates: three writers read-modify-write without a lock (rename is atomic, the update is not) | watcher, hook relay, handler |
| `drafts.json`, `prefs.json`, `compose.json`, `seen.json`, `push-subs.json` written non-atomically; a parse error reads as empty and the next write overwrites | handler |
| Message id = `messages.length + 1` | handler |
| Peer messages matched by identical text within 10 minutes | handler |
| A missed Stop hook blocks delivery for up to 30 minutes; "handling" expires after 10 minutes if the watcher is not re-armed | watcher, handler |
| MessageDisplay chunks joined within 3 s; missing chunks dropped silently | hook relay |
| Codex depends on its internal transcript format; no cancel or interject | handler |
| Temporary diagnostics still shipped | `/api/diag`, widget |
| Cross-device sync relies on timing guards (3–5 s) | widget |
| In-memory dedupe sets grow without bound | handler push |
| Access key compared with plain equality; key embedded in the manifest start URL | `lan-auth.mjs`, handler |
| Review-ready detection uses `fs.watch` (platform-dependent) | handler |
| Combined server wiring review "done" to chat is in neither repo | both repos (LC-6) |
| Dead "all sessions" code paths; stale "나중에" empty-state copy; `alert()` vs toast inconsistency | widget |

## Open Checks and Delegation

| Finding / decision it affects | Evidence or experiment needed | Owner / resolve trigger | Permitted work / stop point | Verdict / ADR |
|---|---|---|---|---|
| Atomic writes for shared state files (only `chat.json`, `delivered.json` today) | Owner verdict on extending to all files, or a lock | Owner | Keep as built | Pending — no ADR |
| 1-hour ordering fallback | Owner verdict (agent-made rule; see ADR-0011) | Owner, with DQ-06 | Keep as built | Pending — ADR-0009 note |
| Split of the widget file | Module boundaries proposal | Owner | None until approved | Pending |
| No-dependency / Node 18+ as a hard rule | Owner verdict | Owner | — | Pending (DQ-12) |
| Combined server for review "done" → chat | Setup path for adopters | Owner | — | Pending (LC-6) |
| Remove diagnostics after LC-3 root cause | Root cause found | Agent | — | ADR-0031 |

No routine implementation choices were explicitly delegated by the owner.

## Approval and Handoff

Not approved. This design describes the as-built system for the retrofit; the owner's verdicts on the
open checks above must be listed in `product/STATUS.md` and answered before any `to-spec` handoff.
