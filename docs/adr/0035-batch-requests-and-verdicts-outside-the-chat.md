# ADR-0035 — Batch requests and verdicts outside the chat

| Field | Value |
|---|---|
| Date | 2026-10-11 |
| Status | Accepted (not built yet) |
| Decided by | owner |
| Scope | J-02, J-05 (process) |
| Proposed by | human |
| Evidence | #1471, #1473, #1510, #1512, #1601, #1602, #1603 |

> Retrofit 2026-10-12: reconstructed from chat.

## Context

Requests piled up in the drafts box and were handled one message, one fix, one check at a time (#1471).
The agent read "the drafts box keeps piling up" as "empty it now"; the owner meant the ongoing flow (#1473).

## Decision

When current work ends, the agent surveys the drafts box and proposes bundles in a separate UI (not in
chat); the owner rearranges them; a matching view shows his items against the new tasks; each task is
verified separately; and findings that need verdicts come as one batched list.

## Rationale

Rationale stated as the owner's direction in #1510, accepted in #1512; batched review findings accepted with the stage-5 gate (#1601–#1603).

| Option | Why not |
|---|---|
| One request, one fix, one check in chat | Too much owner time for too little progress (#1471, #1475) |
| Triage today's backlog right away | Misread; the concern is the ongoing flow (#1473) |
| Batching inside the chat | Owner asked for a separate UI (#1510) |

## Consequences

The agent may run several agents in parallel per bundle (#1510). The bundling and matching UI does not
exist yet (part 3 open item O3).

## Revisit when

The bundling UI is built and used for one full batch.
