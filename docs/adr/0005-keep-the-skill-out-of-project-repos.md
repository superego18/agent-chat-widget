# ADR-0005 — Do not copy the skill into project repos

| Field | Value |
|---|---|
| Date | 2026-10-08 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-08 |
| Proposed by | human (then withdrawn) |
| Evidence | #391, #393 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

The owner asked to install the skill into the project repo as well (#391). The agent explained that a
committed copy would sit beside the shared install and raise which-copy-wins questions.

## Decision

The skill is not committed into project repos; projects use the shared install.

## Rationale

Rationale stated as: "아하 그럼 넣지 마" after hearing the copy and precedence implications (#393).

| Option | Why not |
|---|---|
| Commit a copy into each project | Two copies drift; unclear which one the agent loads |

## Consequences

Project and skill stay clearly separated. A project that needs a pinned version uses the standalone
repos as submodules (ADR-0036) rather than a pasted copy.

## Revisit when

A project must pin a widget version that the shared install cannot provide.
