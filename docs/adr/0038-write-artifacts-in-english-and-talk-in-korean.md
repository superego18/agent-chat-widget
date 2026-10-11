# ADR-0038 — Write artifacts in English, talk in Korean

| Field | Value |
|---|---|
| Date | 2026-10-12 |
| Status | Accepted |
| Decided by | owner (kit ADR 0002, 2026-09-21, applied to this repo) |
| Scope | whole project |
| Proposed by | prior art (kit) |
| Evidence | kit ADR 0002; #65; #1354 |

> Retrofit 2026-10-12: this repo adopts an unchanged kit decision; no new verdict is claimed.

## Context

This repo now holds a public UX record (ADR-0037). The kit already decided that all artifacts are
written in English and conversation with the owner stays Korean. The product's own UI and the agent's
messages in the chat panel are Korean.

## Decision

Artifacts here (decision records, product docs, code comments) are in English; conversation with the
owner and every agent message shown in the chat panel are in Korean.

## Rationale

| Option | Why not |
|---|---|
| Korean throughout | Blocks sharing and publication; terms drift from the English kit (kit ADR 0002) |
| Hybrid Korean prose, English labels | Drift without the readability benefit (kit ADR 0002) |
| English messages in the chat | The owner asked for Korean (#65); English progress notes leaking into the chat were a bug (#1354) |

## Consequences

Korean UI labels are quoted in Korean with an English gloss (GLOSSARY.md).

## Revisit when

No planned revisit.
