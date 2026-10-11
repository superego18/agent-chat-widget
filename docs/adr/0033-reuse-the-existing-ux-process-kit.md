# ADR-0033 — Reuse the existing UX process kit

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted |
| Decided by | owner |
| Scope | whole project (process) |
| Proposed by | human |
| Evidence | #1515, #1517, #1530, #1531 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

The agent started designing a new process for requirements, tests and decision records (ADR-0034). The
owner stopped it (#1515): his own UX process kit may already cover this.

## Decision

The widget follows the existing `ai-native-ux-process` kit instead of a second, separate process.

## Rationale

Rationale stated as: "프로세스를 2개나 만들 필요는 없을 것 같아서" (#1517).

| Option | Why not |
|---|---|
| A new standalone process for this project | Duplicates the kit |
| Look for the process in the configuration repo | Wrong place; corrected to the kit repo, latest pushed version (#1530, #1531) |

## Consequences

This repo carries a local copy of the kit (ADR-0037) and follows its stages; the retrofit fills stages
0–5 and 7 for a product already at stage 8.

## Revisit when

The kit is merged into a broader UX skill set (owner's plan, #1492).
