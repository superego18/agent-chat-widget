# ADR-0015 — Keep links faint until a message is tapped

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-03 |
| Proposed by | agent (option 1 of 3) |
| Evidence | #1043, #1045, #1049 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

Once every message had reply links, the lines made the screen busy: "화면을 복잡하게 만드네" (#1043).
The agent offered three options.

## Decision

Reply links are faint by default; tapping a message emphasizes only its own links.

## Rationale

Owner tried option 1 (#1045) and accepted it: "오케이 이걸로 됐다" (#1049).

| Option | Why not |
|---|---|
| Show links only for recent messages | Not chosen |
| A toggle button for links | Not chosen; adds a control |

## Consequences

Links stay available for every message without dominating the list.

## Revisit when

No planned revisit.
