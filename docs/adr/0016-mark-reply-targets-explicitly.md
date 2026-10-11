# ADR-0016 — Mark reply targets explicitly

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-03 |
| Proposed by | agent, on owner's question |
| Evidence | #1088, #1090 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

The owner asked how agent answers were matched to his messages (#1088). The match was a guess from
delivery order.

## Decision

The agent prefixes each answer with a reply target marker `<re N>`; the server strips it and the widget
links exactly those messages.

## Rationale

Rationale stated as: "그걸 보려고 하는 거니까" — the links exist to show exactly this (#1090).

| Option | Why not |
|---|---|
| Guess from delivery order only | Wrong links defeat the purpose of the feature |

## Consequences

Accuracy depends on the agent writing the marker. When it is missing, the widget still falls back to
the order guess (technical design, known risks).

## Revisit when

Agents often omit the marker, or the fallback produces wrong links in use.
