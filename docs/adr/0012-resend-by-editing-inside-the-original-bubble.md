# ADR-0012 — Resend by editing inside the original bubble

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-03 |
| Proposed by | human |
| Evidence | #753, #766 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

The owner asked for a way to resend a message that seemed not to arrive, with light edits (#753). The
first build filled the main input with the old text.

## Decision

Resend opens the text for editing inside the original bubble and sends it as a new message tagged `다시 보냄`.

## Rationale

Rationale stated as: so it feels explicitly like resending — "명시적으로 다시 보내는 느낌이 나도록" (#766).

| Option | Why not |
|---|---|
| Refill the main input with the old text | Does not feel like an explicit resend; mixes with new typing (and the draft sync once wiped it, #755) |

## Consequences

The original message stays unchanged; the session is told which message was edited and resent.
In-bubble editing on iOS has a focus problem whose cause is still unknown (discovery LC-3).

## Revisit when

No planned revisit.
