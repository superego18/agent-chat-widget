# ADR-0011 — Read time is the actual pickup moment

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-01, J-03 |
| Proposed by | human (correction of the agent) |
| Evidence | #819, #821, #823, #825, #827, #829 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

An interjected message jumped below the agent's reply (#819). The cause was an ordering rule the agent
had invented (a 5-second rule). The owner had never asked for it and demanded the full list of such
rules (#821). Two compensating rules turned up: rule 4 (messages read during work count as read at
work-end time) and rule 5 (the 5-second rule).

## Decision

Rules 4 and 5 are deleted; a message's read time is the real moment the session picked it up.

## Rationale

Rationale stated as: "작업 중 읽으면 미루지 않고 딱 읽은 시간에 표시를 하는 것을 원하는데" (#823); "지워" (#829).

| Option | Why not |
|---|---|
| Keep rule 4 (read at work end) | Shows a time that is not when the message was read (#823) |
| Keep rule 5 (5-second rule) | Never requested; only patched symptoms of rule 4 (#827) |

## Consequences

Precedent: the agent does not add behavior rules the owner did not ask for, and lists them when asked
(discovery NG-5). The 1-hour fallback in ADR-0009 is such a rule and still needs a verdict.

## Revisit when

No planned revisit.
