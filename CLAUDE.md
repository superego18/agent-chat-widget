# CLAUDE.md — agent-chat-widget

Code for the chat panel attached to a web app for talking to coding agents, plus its
experience-design record (status, decisions, requirements, reviews) kept in the same public
repo: `product/`, `docs/adr/`, `reviews/`. The side-by-side review page lives in
`superego18/ui-review-page`; record its UX decisions here too. Everything here is public:
keep personal and company information out of every artifact.

- Conversation with the owner is in **Korean**. Artifacts are in **English** (kit ADR 0002).
- The UX process kit (`.claude/`, `templates/`, `CODING_STANDARDS.md`) is **copied** here from
  the private `superego18/ai-native-ux-process` at commit `0c05ba8` (kit ADR 0006: copy per
  project until validated). The copy is **git-ignored** because the kit is private: on another
  machine, copy those three paths from the kit repo before starting. Do not edit the copy here;
  fix the kit repo and copy again. Record the kit commit in this line when re-copying.
- Entry point: the `ux-process` skill. Read `product/STATUS.md` first.
- This is a **retrofit**: the product already exists and is in daily use. Earlier decisions
  were made in chat; the first job is to recover them as requirements, tests and ADRs
  before changing behavior further.
- Every behavior change must keep the automated tests green (`npm test`; the pre-commit
  hook runs them when `git config core.hooksPath .githooks` is set).
