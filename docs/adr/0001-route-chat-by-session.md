# ADR-0001 — Route chat by session

| Field | Value |
|---|---|
| Date | 2026-10-07 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-01, J-06 |
| Proposed by | human |
| Evidence | #11, #13, #22 |

> Retrofit 2026-10-12: reconstructed from chat. The verdict is the owner's, as given in the evidence messages.

## Context

The first chat let the owner pick a "fix target" (the app or the skill). In practice the owner runs
several agent sessions per project (a work session and a skill session), and what he wants is to
handle all of them from one screen: "나는 한 화면에서 모든 작업을 다 처리하려는 거야" (#11).

## Decision

Each registered session gets its own session tab, and a message goes only to the selected tab's session.

## Rationale

| Option | Why not |
|---|---|
| Route by fix target (app / skill) | Does not match how the work is split; the owner directs sessions, not targets (#11) |
| An extra "all sessions" tab | Built, then removed: "굳이 필요 없을 것 같아" (#22). Every send must still pick one session |

## Consequences

Each session has its own watcher, unread badge and status dot. One name maps to one session.
There is no combined view across sessions; peer messages and tab arrows (J-06) cover cross-session awareness.

## Revisit when

A project routinely runs more sessions than fit as tabs on a phone.
