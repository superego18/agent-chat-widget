# Reliable Codex delivery

## Message outcomes

Queue availability, CLI acceptance and native pickup are separate facts. `watch.active`
with `via: 'queue'` means a local CLI is configured, not that a model is running or has
read a message. Consumers must not present it as a live watcher. Claude watcher semantics
are unchanged.

Normal `addChat()` remains synchronous and starts delivery for registered Codex targets.
The message retains its ID/CID and a persistent queue outcome. The HTTP chat endpoint
waits for that bounded attempt: accepted returns200; failed/unknown returns502 with the
saved message. A502 is not evidence that the message was lost or should be posted anew.

- `pending`: a CLI attempt is in flight.
- `accepted`: the CLI exited successfully; native pickup is not inferred.
- `failed`: the CLI reported failure; explicit same-message retry is available.
- `unknown`: timeout, process signal or interrupted server; the request may already have arrived.

Attempts have a15-second default deadline (`createChatHandler({ queueTimeoutMs })`).
A timeout tries to stop only the spawned CLI helper, not the target agent turn. Pending
records found on startup become unknown, never automatically redelivered. A stale helper
completion cannot overwrite a newer attempt. Unknown retry requires the owner's explicit
duplicate-risk confirmation, passed as `{ id, confirmUnknown: true }` to `/api/chat-retry`.
This is not an exactly-once transport guarantee.

## Pickup evidence

New queue messages carry a random receipt marker immediately after the feedback prefix.
Only an exact receipt in the registered target's native user-input rollout record at or
after sending marks that individual message as picked up in `delivered._at`. Assistant
replies, quoted markers, later message cursors and CLI exit alone do not qualify.
Pickup means supplied as native session input, not understood, implemented or approved.

Reading is bounded to the last4MiB with a16-file metadata cache. Missing/compacted/rotated
logs or older messages without markers leave pickup unconfirmed; they do not synthesize
a receipt or trigger redelivery. Actual active/approval state remains a separate concern.

## Embedding and Windows

Use normal `addChat()` for review-completion notifications so failure and retry use the
same durable path. `noQueue: true` deliberately bypasses it; advanced callers of
`queueText()` must handle its returned outcome themselves. Do not assume a synchronous
return proves successful delivery. No queue diagnostics expose raw prompts or stderr.

Windows launches a PATH-resolved native Codex executable or npm Node entrypoint without
PowerShell argument forwarding. Quotes, newlines, Unicode and backslashes are preserved.
OS/CLI argument-size limits can still fail; saved text adjustments are not silently cut.

## Optional proxy security

`app-proxy.mjs --loopback` binds127.0.0.1, including with `--lan` authentication for
Tailscale Serve. Without `--lan`, loopback mode rejects forwarded HTTP/WebSocket traffic
so a retained Serve mapping cannot expose it unauthenticated. `--strict-origin` checks
browser writes before rewriting their Origin for the upstream. Existing callers keep
their defaults; no Tailscale account, hostname, access key or project path is prescribed.
