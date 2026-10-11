# ADR-0020 — Separate buttons and styles for Hold and Drafts box

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-02 |
| Proposed by | human |
| Evidence | #1134, #1136, #1137, #1143, #1243, #1244 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

One `나중에` button put notes into Hold; to reach the drafts box directly the agent added a long-press
to the same button (#1134).

## Decision

Hold and Drafts box get two separate, clearly named buttons — `보류` and `▤ 보관함` — each styled like its
destination (hold: dashed indigo; drafts box: beige box), including the buttons inside hold bubbles.

## Rationale

Rationale stated as: "버튼을 나누는 게 낫지 않아?", "버튼 명도 명확하게" (#1136, #1137); styles per destination (#1243, #1244).

| Option | Why not |
|---|---|
| One button, short press vs long press | Hidden gesture; distinct actions get distinct buttons (#1136) |
| Longer labels `보류하기` / `보관함 담기` | Shortened (#1143) |

## Consequences

"나중에" is retired as a term (GLOSSARY). The empty drafts box still mentions "나중에" — stale copy.

## Revisit when

No planned revisit.
