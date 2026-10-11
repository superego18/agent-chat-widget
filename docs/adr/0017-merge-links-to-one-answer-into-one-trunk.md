# ADR-0017 — Merge links into the same answer into one trunk

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted |
| Decided by | owner |
| Scope | J-03 |
| Proposed by | human |
| Evidence | #1365, #1367, #1369 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

With many links, each took its own lane and lanes crept inward until they ran under the bubbles (#1365).
The agent offered capping lanes, shortening far links, or showing lines only on tap.

## Decision

Links that end at the same answer merge into one trunk instead of separate lanes.

## Rationale

Rationale stated as: "같은 대답으로 이어지는 건 다른 줄기를 타고 내려가게 할 필요는 없을 것 같은데" (#1369).

| Option | Why not |
|---|---|
| Cap the number of lanes | Not chosen; trunk merging removes the cause |
| Shorten far links | Not chosen |
| Show lines only on tap | Not chosen; links stay visible (ADR-0015) |

## Consequences

Fewer lanes. Fixed lane width and shortened far links remain unbuilt (part 3 open item O5).

## Revisit when

Lanes still push into bubbles with many sessions.
