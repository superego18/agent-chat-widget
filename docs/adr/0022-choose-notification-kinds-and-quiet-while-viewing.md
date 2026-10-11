# ADR-0022 — Notification kinds and quiet-while-viewing setting

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-04 |
| Proposed by | human |
| Evidence | #1175, #1177, #1336 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

After push worked, the owner wanted to choose when a notice arrives (#1175). The agent listed cases and
recommended only "work done", "approval needed" and "review page ready".

## Decision

Five kinds are on by default — session answer, work done, approval needed, review page ready, stalled
for 5 minutes — session-to-session messages are off, and "don't notify while I am viewing" is a per-device
setting the owner can turn on.

## Rationale

Rationale stated as: "1~5 켜고, 보고 있을 땐 안 보낼 수 있게 알림 설정에서 고를 수 있게 해줘" (#1177).

| Option | Why not |
|---|---|
| Agent's recommendation (three kinds only) | Owner wanted answers and stalls too |
| Always suppress while viewing (fixed rule) | Owner wanted it as a choice |

## Consequences

"Viewing" is a 15-second heartbeat while the panel is open and focused. The owner reported missing
notices while looking at another window (#1336); viewing now ends the moment the window loses focus.

## Revisit when

The owner finds a kind too noisy or missing in daily use.
