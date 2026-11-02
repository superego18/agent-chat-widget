# Session continuity

The widget owns its conversation and draft state. A provider session is its current execution target, not the only copy of its conversation.

- Native Codex messages are copied to `transcript-history/<sessionId>.json` when read. Stored copies remain readable after the provider rollout is removed or the review server restarts. Message IDs, full text and timestamps are retained; tool outputs are excluded.
- Same-name registration moves chat ownership, drafts (including trash and holds), compose state, preferences, read evidence, peer mappings and copied native history to the new target. It preserves message IDs, quote references, message bodies and queue outcomes. Nothing is automatically resent.
- Changed widget stores and registrations are backed up under `session-migrations/` before changing ownership. Keep this directory private, like the rest of `.ui-feedback/`.
- Stop the review server before replacing a session, then register the new one and restart with the correct provider profile. The owned runtime guard refuses migration while it is running. Other hosts must follow the same sequence.
- Keep the provider history until it has been copied and verified. Data removed before any widget copy exists cannot be recovered. Local widget data also needs a backup if it must survive deletion of this project or a disk failure.
- In Orca, register with `--orca-terminal <handle-from-terminal-list>` to identify incoming Codex peer messages. Re-register the same execution session after a handle change: its former handle is retained in `orca.previousTerminals` with an `until` timestamp. Historical sends qualify only before that cutoff. An initial historical binding must be verified before adding it; names alone are not evidence.
- Literal PowerShell send text is decoded and trimmed like native input. The entire input must match one send or an ordered sequence from the same registered sender, separated only by whitespace. Each send can be consumed once; all matched evidence IDs persist. Extra owner text, arbitrary prefixes, different senders and ambiguous matches remain ordinary input. Original native IDs and text are never rewritten.
- A matching successful Orca CLI receipt (`accepted`, request ID and target handle) allows a queued native input up to 24 hours after the send. Without that receipt, the legacy 60-second limit remains. Receipt acceptance alone never proves native pickup: classification still requires matching native input. Dynamic shell values and unresolved inputs are not inferred or resent.

## Codex interjection

- Ordinary sends use `codex queue`. The explicit `끼워넣기` action uses the shared daemon's `turn/steer` against the currently loaded thread and active turn. It never resumes, forks, starts or interrupts a thread as a fallback.
- Steering requires Node 22+ with built-in WebSocket and a Codex CLI exposing `app-server proxy` and the steering/turn-list protocol. Other supported Node versions retain ordinary queue delivery. The widget exposes the action while the target reports working or awaiting permission; the server verifies its actual active turn again at send time.
- A completed, changed or unavailable turn is a visible failure. A connection lost after submission is an unknown outcome; only explicit duplicate-risk confirmation permits retry. Failure never silently changes an interjection into an ordinary queued send.
- Acceptance records the target turn ID and keeps the original receipt and quote context. Only that receipt's exact native user input proves pickup. Existing drafts and message IDs keep their formats.

Verification: `node --test tests/session-replacement.test.mjs tests/transcript-history.test.mjs tests/history-widget.test.mjs` uses synthetic provider files, including deletion and replacement. It never removes a real provider transcript.

## Bounded receipt evidence, complete conversations

One reference-request or monitor context shares receipt-evidence budgets across
targets and both native/peer readers:64 registrations (8KiB each/512KiB total),
4 changed sources (256KiB each/1MiB total),64KiB complete JSONL records,
256 events/source and512 aggregate,16 receipts/64KiB per source and
128 receipts/256KiB aggregate. The shared projected cache admits at most32 entries
AND2MiB serialized data, including cached history; oversized history stays durable
without truncation and is not cached. These limits are not measured latency/RSS
bounds or a pagination policy for full native conversation text/quotes.

Cold scans advance physical byte/absolute-line checkpoints, never count a tail as
line zero. Source/root/session/path/binding and file incarnation/size/mtime qualify
reuse, with a bounded prefix recheck on growth. Incomplete records, oversized or
malformed evidence, incoherent stat/open/read/re-stat snapshots and truncated
registry coverage cannot manufacture fresh positive proof. Unknown remains unknown;
large/malformed sources may stay incomplete until a coherent new incarnation.

Per-peer faults cannot abort a healthy current transcript merge or the stored
history fallback. Existing IDs, full native text, reference aliases and previously
proved peer classification survive. Exact recipient/whole-input matching and
legacy60-second versus positively accepted24-hour windows stay unchanged. No
incomplete read proves pickup, cancellation or permission to resend.
