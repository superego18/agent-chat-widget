# ADR-0013 — Interject only through an explicit button

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-02 |
| Proposed by | agent recommendation |
| Evidence | #786, #792, #794 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

The owner asked to push messages into a session while it works, as the terminal allows (#786). The first
build injected every message between tool calls. The owner asked whether he could choose when to
interject (#792).

## Decision

A plain Send waits until the session's work ends; Interject (`끼워넣기`) is a separate button, shown only
while a Claude Code session is working, that delivers between tool calls.

## Rationale

The owner chose the agent's recommended option: "너가 말한 방법" (#794).

| Option | Why not |
|---|---|
| Interject every message automatically (terminal-like) | Removes the owner's choice of when to interrupt (#792) |

## Consequences

An unread message can later be switched to or from Interject. Codex sessions have no Interject
(ADR-0003). The pending-state labels say when a message will be read.

## Revisit when

No planned revisit.
