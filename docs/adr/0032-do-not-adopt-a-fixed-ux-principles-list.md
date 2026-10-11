# ADR-0032 — Do not adopt a fixed list of UX principles

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Rejected |
| Decided by | owner |
| Scope | whole project (process) |
| Proposed by | agent |
| Evidence | #1486, #1488, #1510 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

After a long day of small fixes, the agent proposed writing down a list of chat UX principles so it
could decide more on its own. The owner felt the chat's careful UX came from his own involvement and was
wary of handing it over (#1486).

## Decision

Rejected: a fixed, up-front list of UX principles. Principles are instead drawn out of clarified
requirements as they come up (#1510, ADR-0034).

## Rationale

Rationale stated as: "원칙을 세워버리면 내가 놓쳐버린 원칙들을 계속 찾아야하고, 원칙도 상황마다 다르게 적용되는 건데" (#1488).

| Option | Why not |
|---|---|
| Fixed principles list (the proposal) | Missed principles need constant hunting; principles apply differently per situation |

## Consequences

Precedents live in ADRs with their context instead of a rule list (discovery NG-8).

## Revisit when

Requirements-derived principles start to repeat across many ADRs and the owner asks for a summary.
