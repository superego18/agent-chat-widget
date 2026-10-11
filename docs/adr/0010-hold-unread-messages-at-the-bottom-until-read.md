# ADR-0010 — Hold unread messages at the bottom until read

| Field | Value |
|---|---|
| Date | 2026-10-09 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-01 |
| Proposed by | human |
| Evidence | #661, #666, #698 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

With ordering by delivery time (ADR-0009), an unread message has no final place yet. The first build
placed it right away at a guessed position.

## Decision

An own unread message floats at the bottom of the list (held message) and drops into its place in the
timeline when the session reads it.

## Rationale

Rationale stated as: the feeling of "아래에서 붙잡고 있는 느낌을 주다가 읽는 순간 떨어지는" (#661). Verified "잘되네" (#666).

| Option | Why not |
|---|---|
| Place unread messages at their position immediately | No visible difference between read and unread; the position is not yet known |

## Consequences

"Held message" (unread, waiting) is a different concept from Hold (unsent notes, ADR-0019); the glossary
keeps both terms apart.

## Revisit when

No planned revisit.
