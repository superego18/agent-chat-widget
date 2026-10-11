# ADR-0037 — Keep the UX record public and the kit copy local

| Field | Value |
|---|---|
| Date | 2026-10-12 |
| Status | Accepted |
| Decided by | owner |
| Scope | whole project |
| Proposed by | human |
| Evidence | #1496, #1498, #1504, #1571, #1576, #1579, #1583, #1585, #1587, #1589 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

The UX record (status, decision records, product docs, reviews) needed a home. The owner first asked
whether publishing it was needed (#1496), then noted the development history is already public through
commits (#1498). The UX kit itself is private.

## Decision

The UX record lives in this public repo; the private kit copy (`.claude/`, `templates/`,
`CODING_STANDARDS.md`) stays on the local machine through `.gitignore`.

## Rationale

| Option | Why not |
|---|---|
| Record inside the kit repo as a second validation project (#1571) | Conflicted with a kit rule (agent flagged) |
| A separate private records repo "for now" (#1576) | Name too close to this repo (#1579); owner then placed it under this repo (#1583, #1585) |
| Hidden development branch plus public branch | Not possible on GitHub as wanted (#1585, #1587) |
| Publish the kit copy too | The kit is private; ignore it locally (#1589) |

## Consequences

On another machine the kit paths are copied from the kit repo before work. Records must hold no personal
or company information. Because the owner worried about volume (#1504), records cover only corrections,
rejected alternatives and precedents.

## Revisit when

The kit becomes public, or a single copy replaces per-project copies (kit ADR 0006).
