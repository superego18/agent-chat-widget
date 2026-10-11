# ADR-0009 — Order own messages by delivery time

| Field | Value |
|---|---|
| Date | 2026-10-09 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-01, J-03 |
| Proposed by | human |
| Evidence | #648 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

Messages sent while a session was busy appeared at their send time, above answers the session wrote
before it had read them. Rereading later, the conversation looked out of order.

## Decision

An own message is placed in the timeline at the moment the session picked it up, not when it was sent.

## Rationale

Rationale stated as: "아직 안 간 대화는 가는 시점에 맞춰서 … 순서 반영해줘야 내가 나중에 읽을 때 안 헷갈리겠다" (#648).

| Option | Why not |
|---|---|
| Order by send time | Rereading later is confusing: questions appear before the context the agent actually had |

## Consequences

A message sent while the agent is answering lands below that answer (#1386–#1390 explained this as intended).
Unread messages wait at the bottom until delivered (ADR-0010); "read time" is the real pickup moment (ADR-0011).

Not covered by this verdict (no owner decision yet):
- The code places a message at its send time when delivery came more than 1 hour after sending
  (commit 8dd79ba). The agent added this while fixing old messages being re-delivered (#1392–#1401).
- After that bug, the agent recommended switching to send order (#1389). The owner has not answered
  (discovery DQ-06).

## Revisit when

The owner answers DQ-06 or rules on the 1-hour fallback.
