# ADR-0026 — Preserve in-progress work across reloads

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-07 |
| Proposed by | human |
| Evidence | #345, #1405, #1429, #1433, #1435, #1438 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

Typed text already survived reloads (#345). An attached reply or reference did not (#1405, #1429), nor
did a picked location. Reloads can happen without the owner wanting them.

## Decision

Everything the owner was in the middle of survives a reload: typed text, attached reply or reference,
picked location, in-bubble and hold edits with the cursor, and the drafts-box sheet with its checks and inputs.

## Rationale

Rationale stated as: "사용자가 원치 않게 새로고침될 수 있으니까 중간에 하던 것들은 무조건 보존해줘야지" (#1435); "텍스트 입력 상태이던 것들도" (#1438).

| Option | Why not |
|---|---|
| Preserve typed text only | Loses quotes, locations and edits on an unwanted reload |
| Decide case by case | Owner asked for unconditional preservation (#1435) |

## Consequences

State is split: some on the server (compose text, scroll position, folds), some per device in browser
storage (reply, location, edits, sheet). Only compose text and reference restore have automated tests.
Any new in-progress state must be added to the preserved set.

## Revisit when

No planned revisit.
