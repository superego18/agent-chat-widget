# ADR-0027 — Wait for the server before showing a send

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-01, J-02 |
| Proposed by | human (correction of the agent) |
| Evidence | #1267, #1268, #1270, #1271, #1275 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

After Send the input cleared but the bubble appeared late, and sometimes the sent text came back into
the input (#1267, #1268). The agent's fix showed the bubble before the server answered (optimistic send).

## Decision

Every button that sends to the server waits for the server to accept, showing a spinning ↻; the input
clears only after acceptance; after a timeout the button can be pressed again, and a client id (cid)
keeps retries from creating duplicates.

## Rationale

Rationale stated as: "서버 답은 기다려야 하는 거 아냐?" (#1270); "그 상태로 안 보내질 수도 있으니까 다시 … 보낼 수 있도록 … 다른 버튼 들도 마찬가지고" (#1271); applies to interject, drafts, category send and resend too (#1275).

| Option | Why not |
|---|---|
| Optimistic bubble before the server answers | Shows success for a send that may fail (discovery NG-4) |

## Consequences

The unlock timeout is 8 seconds. Covered by the "slow server retry creates one message" test.

## Revisit when

No planned revisit.
