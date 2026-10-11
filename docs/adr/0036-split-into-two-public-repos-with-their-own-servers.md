# ADR-0036 — Split into two public repos, each with its own server

| Field | Value |
|---|---|
| Date | 2026-10-12 |
| Status | Accepted |
| Decided by | owner |
| Scope | whole project, J-08 |
| Proposed by | human |
| Evidence | #1538, #1539, #1541, #1542, #1545, #1547 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

The chat panel and the review page lived inside one feedback skill repo. The owner wanted the
functional parts usable as submodules on their own (#1538).

## Decision

The functional parts become two standalone public repos used as submodules — `agent-chat-widget` (widget,
chat server, session hooks, app proxy, push) and `ui-review-page` (review page with its own server) — with
their git history carried over.

## Rationale

Rationale stated as: the agent's two-repo grouping chosen (#1541); "깃 커밋도 잘 떼가고" (#1542);
"서버를 떼내야 명확히 분리되지 않을까?" (#1545); owner account, public, these names (#1547).

| Option | Why not |
|---|---|
| One tool repo | Owner chose the two-repo split (#1541) |
| Review page reusing the chat server | Not a clean separation (#1545) |
| Private repos | Owner chose public (#1547) |

## Consequences

Each repo runs alone. The combined server that wires "review done" into chat and the Codex queue is in
neither repo (discovery LC-6). `ui-review-page` has no tests yet. Another machine must pull and set the
hooks path per repo.

## Revisit when

An adopter needs the combined setup, or the split forces duplicate code.
