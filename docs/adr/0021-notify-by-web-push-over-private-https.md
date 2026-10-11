# ADR-0021 — Notify by web push over private HTTPS

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-04 |
| Proposed by | agent recommendation |
| Evidence | #1155, #1157 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

The owner asked for phone and desktop notifications (#1155). Web push needs HTTPS, and the widget is
reachable only through private paths (ADR-0007).

## Decision

Notifications are standard web push to the installed home-screen app, served over HTTPS reachable only
inside the owner's private tailnet.

## Rationale

The owner approved the recommended option: "진행해줘" (#1157). The agent cited the existing no-public-exposure rule.

| Option | Why not |
|---|---|
| A public relay service (e.g. ntfy) | Sends content through a public service; conflicts with ADR-0007 |
| Desktop-only (Mac) notifications | Does not reach the phone |

## Consequences

iOS needs the home-screen install. VAPID keys and subscriptions live in local files; no third-party
account. Notification kinds: ADR-0022.

## Revisit when

Private HTTPS becomes unavailable, or a device must be notified outside the tailnet.
