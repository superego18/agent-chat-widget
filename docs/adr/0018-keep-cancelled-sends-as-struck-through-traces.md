# ADR-0018 — Keep a cancelled send as a struck-through trace

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-02 |
| Proposed by | human |
| Evidence | #1105, #1109, #1113, #1115, #1117, #1119 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

The owner first asked what a cancelled send could become: removed, kept, held at the bottom, or put back
for later (#1105), and saw previews of six options (#1109). He then asked which ones conflict with
existing logic and for a minimal set (#1113, #1115). The agent proposed adding a delete.

## Decision

A cancelled send stays in the history as a struck-through trace that can be resent later; there is no delete.

## Rationale

Rationale stated as: "최소 구성을 생각해보자" (#1115); "지우기는 하지 않으려고" (#1119).

| Option | Why not |
|---|---|
| Delete (with undo toast) | Owner declined (#1117, #1119) |
| A menu of outcomes on every cancel | Not minimal (#1115) |
| A default outcome setting (hold, back to input, to drafts box) | Not minimal (#1115) |

## Consequences

The history shows what was cancelled. Moving a cancelled message to Hold was later added as an explicit
action (`보류로`), not an automatic outcome.

## Revisit when

Cancelled traces clutter the history in daily use.
