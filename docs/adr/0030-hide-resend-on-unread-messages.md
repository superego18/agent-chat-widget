# ADR-0030 — Hide Resend on unread messages

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-02, J-03 |
| Proposed by | human |
| Evidence | #1407, #1410, #1411 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

Unread own messages showed Resend next to Cancel send. The owner also asked to move an unread message
straight to Hold (#1407, #1410).

## Decision

An unread own message offers Cancel send and Move to hold (`보류로`, which also cancels it); Resend appears
only after the session has read it.

## Rationale

Rationale stated as: "아직 너가 안 읽은 것은 취소할 수 있는데 다시 보내기 불필요할 것 같은데" (#1411).

| Option | Why not |
|---|---|
| Show Resend on unread messages | Unnecessary; the message can still be cancelled or changed |

## Consequences

Covered by the "unread has cancel/hold, resend only after read" test.

## Revisit when

No planned revisit.
