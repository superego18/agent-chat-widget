# ADR-0034 — Clarify requirements and test every change

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted |
| Decided by | owner |
| Scope | whole project (process) |
| Proposed by | human |
| Evidence | #1475, #1476, #1508, #1510, #1512 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

The owner felt a lot of his time went in for little progress (#1475). Asked to analyse the commits
(#1508), the agent found the owner was acting as the tester: guess-and-fix layout loops and missed
sibling cases he had to find himself.

## Decision

For every change, the requirement is clarified first, test cases are added for it, the tests run
automatically on every commit, and the agent checks its own change before handing it to the owner, who
then verifies on the real screen; past development is audited the same way before new work.

## Rationale

Rationale stated as the owner's direction in #1510, accepted with "응응 그렇게 해보자 … 이전 개발 내역들에 대해 제대로 전수 검사해서 다 쌓고 시작하자" (#1512).

| Option | Why not |
|---|---|
| The owner finds regressions by hand | His time goes into testing, not deciding (#1475, #1508) |
| Verify through the review page | "실제 화면에 비해 테스트해보기가 불편한게 … 진짜로 사용해보면서 테스트가 안 되니까" (#1510) |

## Consequences

A pre-commit hook runs the browser tests (needs `core.hooksPath` per machine). Only 7 tests exist; most
features are untested (technical design). This retrofit is the agreed audit.

## Revisit when

The test run becomes slow enough to block commits.
