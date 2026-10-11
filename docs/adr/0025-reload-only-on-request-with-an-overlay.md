# ADR-0025 — Reload only on request, with an overlay

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-07 |
| Proposed by | human (correction of the agent) |
| Evidence | #1372, #1374, #1375, #1391 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

The agent added an automatic widget reload whenever the widget file changed. It fired in the middle of a
send: the send reported failure, then went out, and the text stayed in the input (#1372).

## Decision

The chat panel reloads only when the agent calls the reload tool (`reload-widgets.mjs`) or the owner
presses ↻, and every reload shows a full-screen "reloading, don't touch" overlay.

## Rationale

Rationale stated as: "자동 새로고침을 너가 원할 때만 하고 새로고침 중이라고 문구를 띄워줘야 내가 뭘 안 건들 것 같은데" (#1374); "새로고침을 뭔가 도구처럼 쓰는거지" (#1375); manual ↻ gets the same overlay (#1391).

| Option | Why not |
|---|---|
| Silent automatic reload on file change | Broke a send (#1372); the owner cannot know to stop typing |
| Reload without an overlay | Same problem |

## Consequences

After changing the widget, the agent must call the tool. The widget polls a reload token and waits
while the owner is editing or a send is in flight. Discovery NG-6.

## Revisit when

No planned revisit.
