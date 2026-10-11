# ADR-0004 — Use one shared chat widget module

| Field | Value |
|---|---|
| Date | 2026-10-08 |
| Status | Accepted |
| Decided by | owner |
| Scope | whole project |
| Proposed by | human |
| Evidence | #300, #305, #316 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

The app screen and the review page each had their own copy of the chat panel. A fix landed in one copy
and not the other (stale review-page copy, #78). The owner asked whether both screens run the same module (#300).

## Decision

Both surfaces load one shared chat widget module, and review-page behavior is split into shared served
files: "모듈화할 수 있는 부분은 최대한 모듈화해야돼" (#305, #316).

## Rationale

| Option | Why not |
|---|---|
| Keep two copies | Drift; fixes miss one surface |
| Keep review-page logic inside its template | Same drift problem; template should hold data only (#316) |

## Consequences

One fix reaches both surfaces. The shared module grew into one 2,397-line file (`assets/app-widget.js`),
which is now the main maintainability risk (see technical design).

## Revisit when

The widget file is split into modules; this decision then governs the split's boundaries.
