# ADR-0019 — Stack holds as unsent bubbles at the chat bottom

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-02 |
| Proposed by | human |
| Evidence | #1121, #1122, #1124 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

The owner wanted to tell apart "much later" notes (drafts box) from a short wait before sending (#1121).
The agent proposed a single-slot hold bar above the input.

## Decision

Hold keeps any number of unsent notes stacked as dashed bubbles at the bottom of the chat, using the same
look as the earlier "hold at bottom" preview; nothing is sent until the owner sends it.

## Rationale

Rationale stated as: "여러 개 쌓고싶고 아까 취소 보류한 거랑 같은 ui" (#1124).

| Option | Why not |
|---|---|
| Single latest-only hold slot | Owner wants several (#1124) |
| Use the drafts box for both | Mixes short waits with long-term notes (#1121) |

## Consequences

Two places for deferred thoughts: Hold (short wait, in the chat) and Drafts box (by category).
Hold is not a queue; it waits for an explicit send (GLOSSARY "Avoid").

## Revisit when

No planned revisit.
