# ADR-0003 — Reach Codex sessions through `codex queue`

| Field | Value |
|---|---|
| Date | 2026-10-08 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-01, J-06 |
| Proposed by | human (correction of the agent) |
| Evidence | #194, #196, #201, #216 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

The owner asked whether Codex sessions could be watched and chatted with (#194). The agent answered that
Codex could not be woken. The owner doubted this and asked for a thorough web search first (#196). The
search found `codex queue`.

## Decision

Codex sessions are reachable from the chat panel: messages are queued with `codex queue` and counted as
delivered at once, and Codex answers are read from its transcript.

## Rationale

| Option | Why not |
|---|---|
| Accept "Codex cannot be reached" | Wrong; based on too little research (#196) |
| A Claude-style watcher for Codex | Not needed; the queue delivers directly |

## Consequences

Codex messages have no cancel or interject (they are delivered immediately). Answers depend on parsing
Codex's internal transcript format. Precedent: research before telling the owner something is impossible.

## Revisit when

Codex gains hooks, or its transcript format changes.
