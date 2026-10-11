# ADR-0002 — Keep the chat watcher always on

| Field | Value |
|---|---|
| Date | 2026-10-08 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-01 |
| Proposed by | human |
| Evidence | #141, #144, #147, #187 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

The watcher (`wait-review.mjs`) had a 30-minute limit, so the owner had to go back to a terminal to
re-arm it. He questioned whether a watcher was needed at all — the session should simply wake when he
sends (#144). A Claude Code session cannot be woken from outside, so some watcher is required.

## Decision

The watcher runs with no time limit, so a message from the chat panel reaches the session without a terminal step.

## Rationale

Rationale stated as: the owner wants the session to wake and answer whenever he sends (#144).

| Option | Why not |
|---|---|
| Time-limited watcher (30 min) | Forces manual re-arming from a terminal |
| Restart the watcher from a Stop hook | Not chosen; the owner accepted removing the limit instead (#147) |

## Consequences

The agent must re-arm the watcher after every reply; forgetting it stalls the conversation (#1521, #1522).
The watcher still stops when the session closes or the computer sleeps (discovery LC-1, open).

## Revisit when

Claude Code offers a supported way to wake an idle session from outside, or LC-1 gets a verdict.
