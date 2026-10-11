# ADR-0014 — Link questions and answers with a tapered line

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-03 |
| Proposed by | human; style chosen on the review page |
| Evidence | #990, #996, #999, #1002, #1004, #1005, #1008, #1010, #1019, #1038, #1041 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

With several sessions and interleaved messages, the owner could not tell which answer belonged to which
message. A text reference ("↩ #N에 대한 답") was the first attempt.

## Decision

A reply link is a drawn curve from the earlier message to its answer, thick at the earlier end and
tapering toward the later one, coloured as a gradient between the two bubbles, on the receiving side's edge.

## Rationale

Chosen on the review page: "가늘어진 선이 좋은데 부하없는 방향. 연결해야하는 대화가 멀어져도 따라가기 가장 편함" (#1019).

| Option | Why not |
|---|---|
| Text reference "↩ #N" | "직관적이지 않아" (#996) |
| Right-angle bracket lines | "너무 단순하고 직각이라 생동감이 없다" (#999) |
| Dots at line ends | "점이 좀 어색한데" (#1002) |
| Group background, tap-only highlight, colour strip, last group only | Compared side by side (#1010); harder to follow across distance (#1019) |
| Line on the sender's edge | Owner asked to try the opposite side and kept it (#1038, #1041) |

## Consequences

Lines must stay cheap to draw ("부하없는"). Clutter is handled by ADR-0015, accuracy by ADR-0016,
overlapping lanes by ADR-0017.

## Revisit when

Drawing links causes visible lag on the phone.
