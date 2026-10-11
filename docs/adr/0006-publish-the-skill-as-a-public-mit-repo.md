# ADR-0006 — Publish the skill as a public MIT repo with its history

| Field | Value |
|---|---|
| Date | 2026-10-08 |
| Status | Accepted |
| Decided by | owner |
| Scope | whole project |
| Proposed by | human |
| Evidence | #401, #404, #411 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

The feedback skill lived inside the owner's private configuration repo. The owner wanted it as its own
repo, linkable as a submodule, keeping as much commit history as possible (#401).

## Decision

The skill becomes a public MIT-licensed repo with full commit history, author emails left as they are,
linked as a submodule from the owner's configuration repo rather than from the project.

## Rationale

| Option | Why not |
|---|---|
| Keep it private | Owner chose public (#401) |
| Rewrite author emails | "작성자 이메일 처리 따로 할 필요 없고" (#404) |
| Submodule in the project repo | Owner placed it in the configuration repo (#404); see ADR-0005 |
| Keep the leftover split copy folder | Deleted (#411) |

## Consequences

Everything committed is public: no private data, hostnames or keys in commits or docs (discovery C-3).
An access key once leaked into a local log through the URL (#458); keys are now stripped from URLs.

## Revisit when

No planned revisit.
