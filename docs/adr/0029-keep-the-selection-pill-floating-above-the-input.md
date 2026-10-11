# ADR-0029 — Keep the selection pill floating above the input

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-03 |
| Proposed by | human (two corrections of the agent) |
| Evidence | #1255, #1257, #1259, #1263, #1265 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

The owner disliked the black floating "reply to selection" pill (#1255) and asked for shorter icon-and-text
labels coloured "like the drafts box" (#1257). The agent read this as buttons inside the message and moved
the actions there; then it used the beige drafts-box button colour.

## Decision

The selection pill stays a floating box above the input, labelled `↩ 답장 | 📎 참고`, in the light purple of
the toast shown when drafts are sent.

## Rationale

Corrections: "메시지 안 단추 말한 건 아니고 기존 방식으로" (#1259); "보관함 단추 말고 보관함에서 세션으로 내보냈을 때 뜨는 것이랑 같은 색상" (#1263). Accepted (#1265).

| Option | Why not |
|---|---|
| Action buttons inside the message | Misread of #1257; owner wanted the floating box (#1259) |
| Beige drafts-box button colour | Wrong reference; the toast colour was meant (#1263) |
| Original black pill with long labels | "ui 별로다" (#1255) |

## Consequences

Same concept, same look: the pill reuses an existing colour rather than a new one.

## Revisit when

No planned revisit.
