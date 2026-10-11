# ADR-0008 — Compare UI on a generic page with live HTML

| Field | Value |
|---|---|
| Date | 2026-10-08 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-05 |
| Proposed by | human |
| Evidence | #541, #543, #544, #545 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

Choosing between the owner's and the agent's interaction proposals from screenshots did not convey
feel or animation (#541). The review page only knew before/after rounds.

## Decision

The review page ("comparison page", `비교 페이지`) compares any set of UIs — two proposals, someone
else's result against the current system, or before/after — using live HTML where feel matters; a
before/after comparison is one use, a review round.

## Rationale

| Option | Why not |
|---|---|
| Screenshot-only comparison | Cannot show animation or felt behavior (#541) |
| A page tied to before/after | Too narrow; "무엇을 비교하냐에 얽히지 않게" (#544) |

## Consequences

The page became the generic `ui-review-page` repo (ADR-0036). Verdicts flow back to chat (#561, #563).
The owner later found the comparison page inconvenient for real use-testing (#1510); see ADR-0034.

## Revisit when

Discovery DQ-10 (comparison page vs verifying on the real screen) gets a verdict.
