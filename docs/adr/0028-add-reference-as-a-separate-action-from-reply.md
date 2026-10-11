# ADR-0028 — Add Reference as a separate action from Reply

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-03 |
| Proposed by | human |
| Evidence | #1247, #1249, #1251 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

The owner wanted to quote a message as context without implying he was answering it (#1247). The agent
recommended a reply/reference toggle in the quote bar.

## Decision

Reference (`참고`) is its own button next to Reply (`답장`), for whole messages and selected parts, and the
agent receives it labelled as attached for reference, not as a reply.

## Rationale

Rationale stated as: "참고 버튼 따로" (#1251); partial reference too (#1249).

| Option | Why not |
|---|---|
| Toggle inside the reply bar (agent's recommendation) | Owner chose a separate button |

## Consequences

The reference bar and quote use a dashed style to differ from replies. Hold and drafts keep the
attachment (part 3 F30).

## Revisit when

No planned revisit.
