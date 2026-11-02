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

The browser composer and edited resends opt into `{ ack: 'stored' }`. This returns200
as soon as the message is persisted, possibly with a pending queue outcome. The response
does not prove provider acceptance or pickup; the bubble follows subsequent queue/read
updates. Other callers retain the bounded delivery-attempt response above. The browser
uses that durable response to clear the submitted composer and show its bubble together,
without waiting for a separate full poll. A pending local request is not rendered twice
from concurrent polling, and a late response cannot clear a different tab's draft.

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

## Managed RPC cleanup and host shutdown

The RPC operation has one absolute deadline (at most15 seconds), starting before
spawn/listen/connect/initialize. It is not reset per RPC or retried. Its exact
fulfilled/rejected result is independent of secondary cleanup errors. A five-second
cleanup observation may return the primary result while resources are still pending;
that is never a successful-close receipt.

Each createChatHandler owns one RPC cleanup owner. Actual child/socket/WebSocket/
server close subscriptions remain registered after caller return. Internal
cleanupSnapshot() contains only operation/resource identity, PID, closed flags and
sanitized categories. Idempotent shutdown() fences ingress, stops owned polling,
joins pending queue results and waits for the owned resource closes. Repeated calls
return the same promise. A process that has not closed remains owned; no timeout
may erase it or initiate another provider operation.

The standalone chat-server joins handler and HTTP shutdown before normal exit.
Its five-second pending log is observation only. Other embedding hosts must wire
this explicit API in their own approved source changes; merely closing HTTP or
calling process.exit does not satisfy the contract. Windows actual console-control
and real provider compatibility require independent evidence.

## Modal capability boundary

The widget consumes only the synchronous internal `uifb:sheet-host-offer` v1
contract: opaque owner/epoch references, explicit parentOwner, actual content with
mount===content, open/modal values and a first matching synchronous respond reply.
No role/ARIA/body-pointer/z-index heuristic grants ownership. The same host and
shadow tree move only before a recorded successful attach/update acknowledgement.
A refused acknowledgement rolls back only that attempt. Retiring/release replies
mean processed identity, not hiding cleanup or accessibility completion.

Unknown visible dialogs/Select portals, ambiguous chains, missed epochs, hidden
host/ancestors, lost native focus or insufficient space stop usable interoperability.
No external aria-hidden/inert removal or focus shim is allowed. Detached fallback
is explicitly degraded, not successful nested restoration. Actual BLOG capability,
React ref/hideOthers order, full CSS and native keyboard tests remain separate
source-owned acceptance gates; the old failed modal experiment is not a pass.

## Test boundaries

Run the portable library regressions with `npm test`. The external BLOG/Radix
contract is a separate integration gate, not an implicit dependency of that suite:

```sh
node --test --test-concurrency=1 tests/integration/blog-modal.test.mjs
```

It requires explicit `UIFB_BLOG_FIXTURE_ROOT` and `UIFB_MODAL_SOURCE_PINS`.
The pins must name the exact current immutable BLOG commit, working-source hashes
and installed dependency hashes; the actual Sheet must implement the v1 offer.
Missing pins or a changed source fail the integration gate. Portable tests alone
do not certify BLOG modal interoperability or actual provider/console control.
