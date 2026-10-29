# Session continuity

The widget owns its conversation and draft state. A provider session is its current execution target, not the only copy of its conversation.

- Native Codex messages are copied to `transcript-history/<sessionId>.json` when read. Stored copies remain readable after the provider rollout is removed or the review server restarts. Message IDs, full text and timestamps are retained; tool outputs are excluded.
- Same-name registration moves chat ownership, drafts (including trash and holds), compose state, preferences, read evidence, peer mappings and copied native history to the new target. It preserves message IDs, quote references, message bodies and queue outcomes. Nothing is automatically resent.
- Changed widget stores and registrations are backed up under `session-migrations/` before changing ownership. Keep this directory private, like the rest of `.ui-feedback/`.
- Stop the review server before replacing a session, then register the new one and restart with the correct provider profile. The owned runtime guard refuses migration while it is running. Other hosts must follow the same sequence.
- Keep the provider history until it has been copied and verified. Data removed before any widget copy exists cannot be recovered. Local widget data also needs a backup if it must survive deletion of this project or a disk failure.

Verification: `node --test tests/session-replacement.test.mjs tests/transcript-history.test.mjs tests/history-widget.test.mjs` uses synthetic provider files, including deletion and replacement. It never removes a real provider transcript.
