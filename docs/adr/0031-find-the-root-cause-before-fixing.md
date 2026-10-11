# ADR-0031 — Find the root cause before fixing

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted |
| Decided by | owner |
| Scope | whole project (process) |
| Proposed by | human (correction of the agent) |
| Evidence | #1323, #1327 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

On iOS, pressing Resend moved focus to the main input instead of the edit box (#1323). The agent shipped
a patch that pulled focus back, without knowing why it moved.

## Decision

For a reported bug, the agent finds the cause before shipping a fix; a patch that only masks the symptom is not accepted.

## Rationale

Rationale stated as: "원인 파악해야될 것 같은디" (#1327).

| Option | Why not |
|---|---|
| Ship a symptom patch | Hides the cause; the bug returns elsewhere |

## Consequences

Temporary diagnostics may ship while a cause is investigated (`/api/diag` is still in the code; discovery
LC-3 open). Related constraint: measure real values instead of guessing (discovery C-9, #986).

## Revisit when

No planned revisit.
