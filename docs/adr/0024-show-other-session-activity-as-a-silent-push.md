# ADR-0024 — Show other sessions' activity as a silent push

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-04, J-06 |
| Proposed by | human |
| Evidence | #1447, #1449, #1458 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

While reading one session's tab, the owner wanted to see what another session was doing (#1447). The
agent recommended an in-chat status line and offered an in-chat toast.

## Decision

Another session's current activity arrives as the same kind of push notification used when the owner
is in another app, but silent (no sound or haptic), only while he is viewing the chat and only for
sessions in other tabs.

## Rationale

Rationale stated as: "다른 앱 보고 있을 때 받는 알림이랑 똑같은 종류로. 대신 햅틱없이 조용히" (#1449). Verified (#1458).

| Option | Why not |
|---|---|
| In-chat status line (agent's recommendation) | Not chosen |
| In-chat toast | Not chosen |

## Consequences

A separate "work" kind exists in the notification settings, throttled to one per 20 seconds. Tapping a
notice opens that session's tab (#1455).

## Revisit when

No planned revisit.
