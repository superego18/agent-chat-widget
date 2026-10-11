# ADR-0023 — Send one notification per answer

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-04 |
| Proposed by | human (bug report) |
| Evidence | #1343, #1349 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

When a session finished with an answer, both the answer push and the work-done push carried the same
text, and the owner got two notices (#1343).

## Decision

One answer produces one notification: the work-done push is skipped when it would repeat an answer that was already pushed.

## Rationale

Rationale stated as: the owner reported the double notice as a bug ("뭔가 2번 왔어", #1343) and confirmed the fix (#1349).

| Option | Why not |
|---|---|
| Separate answer and work-done pushes for the same answer | Duplicate notice |

## Consequences

The server tracks which answers were pushed (in memory; grows unbounded — technical design, known risks).

## Revisit when

No planned revisit.
