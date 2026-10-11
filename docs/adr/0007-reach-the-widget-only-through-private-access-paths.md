# ADR-0007 — Reach the widget from the phone only through private paths

| Field | Value |
|---|---|
| Date | 2026-10-08 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-01, J-04 |
| Proposed by | human / agent recommendation |
| Evidence | #430, #441, #443, #445, #617, #619, #621, #629 |

> Retrofit 2026-10-12: reconstructed from chat. Two verdicts on the same idea: LAN access first (2026-10-08), then the private tailnet (2026-10-09).

## Context

The owner wanted to keep developing from the phone, first on the same Wi-Fi or a phone hotspot (#441),
later anywhere over a mobile network (#617). The app and chat run on a development machine with no
public endpoint.

## Decision

Phone access goes through `--lan` mode with an access key on the local network, and through the owner's
private tailnet (Tailscale) when away; nothing is exposed through a public tunnel or public link.

## Rationale

| Option | Why not |
|---|---|
| No key, "only I know the address" (#441) | Accepted the key once told it was needed (#445) |
| Public tunnel (e.g. Cloudflare Tunnel) or public link | Exposes a development app publicly; agent advised against |
| Tailscale immediately (agent's first recommendation) | At first the owner preferred no change while the hotspot worked (#443); adopted later for outside use (#617–#621) after confirming it is open source (#619) |
| Self-hosted Headscale | Too heavy for one developer |

## Consequences

Push notifications need HTTPS, which the tailnet provides (ADR-0021). The access key travels as `?k=`
once, then as a 30-day HttpOnly cookie, and is stripped from the URL. No one else can reach the widget.

## Revisit when

Someone other than the owner needs access, or the tailnet becomes unavailable.
