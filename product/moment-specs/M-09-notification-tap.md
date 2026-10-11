# M-09 — Receiving a notification and tapping it

Status: Retrofit draft 2026-10-12 — awaiting owner verdicts

> Retrofit: reconstructed from the shipped widget, service worker, chat handler and the
> development chat. Code refs: `W` = `assets/app-widget.js`, `SW` = `assets/sw.js`,
> `H` = `scripts/chat-handler.mjs`. `#N` = chat message. Korean strings exact as shipped,
> with English gloss. "(inferred — needs owner verdict)" = no owner message.

---

## 0. Meta

| Field | Value |
|---|---|
| Moment ID | `M-09` |
| Name | Getting told that a session needs me, and landing in its tab |
| Source | ST-43 / ST-44 (push on, not viewing / viewing); TR-69, TR-70 (viewing heartbeat), TR-71 (tap), TR-43 (panel opens); push triggers TR-33…TR-37, TR-72 |
| Journey | J-04 stages 2-4; J-06 stage 1 (other session's activity). F-09; B-118…B-135, B-201 (`flows.md`) |
| Screens | External: OS notification. Then SC-P on that session's tab (SC-04), SC-05 at the first unread. Setup in SC-03 bell and SC-13 settings |
| Model scope / revision | `state-model.md` retrofit r1 |
| Review evidence | No automated push test (code.md §6). Owner verified: no missed pushes after leaving the panel (#1340, #1342), no double push (#1349), quiet other-session push (#1458), tap opens that tab (#1463) |
| Trigger | A push arrives on phone or desktop: answer, work done, approval needed, review page ready, stalled 5 min, session-to-session message, or (quiet) another session's current activity |
| Exit | Tap → existing window focused (or a new one opened) → panel open on that session's tab at the first unread. Or the notice is ignored/dismissed |
| Linked decisions | ADR-0021 (web push over private HTTPS), ADR-0022 (kinds and quiet while viewing), ADR-0023 (one push per answer), ADR-0024 (other-session activity as a silent push). Owner evidence: private HTTPS + web push (D6 part 3, #1157); kinds 1-5 on, peer off, "quiet while viewing" as a setting (D7 part 3, #1175, #1177); other-session activity as a silent push (D19 part 3, #1447, #1449); tap opens that tab (#1455) |
| Inherited UX contracts | None |
| Status | Draft (retrofit) |

---

## 1. The four questions

### 1.1 What does the user intend here?

Know, without watching, when a session wants him — and with one tap be in the right
conversation, at the right place, ready to answer.

### 1.2 What might the user not know?

- Which session the notice is about (title starts with the session name).
- That settings are per device, and "quiet while viewing" stops pushes on a device while the panel is open and focused.
- That "other session working" notices are silent and replace each other (one per session, at most every 20 s).
- On iPhone, that pushes only work from the home-screen app.

### 1.3 What might make the user anxious?

- Missing a notice (B14 part 3, #1336) or getting it twice (B15 part 3, #1343).
- Tapping and landing in the wrong tab (B21 part 3, #1455).
- Being buzzed about other sessions while working with one (#1449).
- "Approval needed" — the session is blocked until he acts.

### 1.4 What feedback must the system give?

| Feedback ID / branch | Information needed | Control / result / indicator and placement | ST/TR refs | Visible copy IDs or None + reason | Accessible state / announcement |
|---|---|---|---|---|---|
| FB-01 / B1 | Who and what happened | OS notification: title = session + event, body = answer text / tool detail | push kinds | C-01…C-07 | OS-provided |
| FB-02 / B1 | Take me there | Tap → focus the existing window and switch the panel to that tab (message from the service worker), or open `…#uifb-tab=<id>` | TR-71 → ST-27 | None — landing is the result | Panel opens; focus not moved to input on touch |
| FB-03 / B1 | Where to start reading | First-unread scroll and `여기부터 새 메시지` line (M-08) | TR-43 | M-08 C-03 | — |
| FB-04 / B2 | Quiet activity of another session | Silent notice, replaced in place per session; only on devices viewing a different tab | `work` kind, TR-69 | C-07 | OS silent |
| FB-05 / B5 | Turning notifications on | Bell → permission → test push; toast result | TR-65, TR-66 | C-09, C-10 | Toast `role="status"` |
| FB-06 / B2 | Choose kinds | Settings popover: checkbox per kind, quiet toggle, test, turn off | TR-68 | C-11, C-12 | Checkboxes; dialog `aria-label` `알림 설정` |

---

## 2. Attention and effort

| Question | Answer |
|---|---|
| Where is the user's attention? | Elsewhere (another app, another window, phone locked) |
| Holding in head? | Nothing — the notice carries the session and the gist |
| Must decide | Whether to tap now |
| System knows but asks anyway | Nothing |
| How long here? | Seconds |

---

## 3. Branches available at this moment

| # | Branch type | Candidate | ST / TR refs | Verdict | ADR |
|---|---|---|---|---|---|
| B1 | Main path | Answer / done / approval / stale push → tap → that tab | TR-71, TR-43 | Built, verified (#1463); Pending verdict | — |
| B2 | Alternate action | Quiet `work` notice for another session while viewing; peer notice (off by default); review-ready notice | `work`, `peer`, `review` kinds | Built (#1458); review/peer tap targets Pending (G1, G2) | — |
| B3 | Cancel / back out | Dismiss in the OS; turn kinds off; `알림 끄기` | TR-67, TR-68 | Built; Pending | — |
| B4 | Undo | N/A | — | N/A | — |
| B5 | Error / failure | Enable fails → toast with raw error (E8); subscription expired (404/410) → removed silently | TR-65, TR-67 | Built; Pending | — |
| B6 | Wait | Done push waits 3 s after Stop to include the last answer; deduped against the answer push | TR-36 | Built (#1349) | — |
| B7 | Empty | No subscribed device or all viewing → nothing sent (server log only) | H:131 | Built | — |
| B8 | Unauthorized | Insecure context / unsupported / iOS not installed → explanatory toast | TR-65 | Built; unverified | — |
| B9 | Interrupted | Tap when no window open → new window at the start URL with `#uifb-tab=`; LAN key cookie needed (inferred) | SW:22-32 | Built; Pending | — |
| B10 | Repeat / concurrent | Same tag replaces earlier notice; `work` throttled to one per 20 s per session; stale once per stuck state | H:148-177 | Built; Pending | — |

---

## 4. Copy as currently shipped

| Slot | Korean text (exact) | English gloss | Source |
|---|---|---|---|
| C-01 Answer | title `<name> 답장`, body = answer text | "<name> replied" | H:295 |
| C-02 Work done | title `<name> 작업 끝`, body = last answer or `하던 일을 마쳤습니다` | "<name> finished" / "Finished what it was doing" | H:164 |
| C-03 Approval | title `<name> 승인 필요`, body = detail or `터미널에서 승인을 기다리는 중` | "<name> needs approval" / "Waiting for approval in the terminal" | H:157 |
| C-04 Stalled | title `<name> 오래 멈춤`, body `"<detail>" 상태가 5분 넘게 그대로예요` | "<name> stalled" / "'<detail>' has not changed for over 5 minutes" | H:175 |
| C-05 Review ready | title `비교 페이지 준비`, body `<page title> — 평가할 차례예요` | "Comparison page ready" / "<title> — your turn to rate" | H:186 |
| C-06 Peer | title `<A> → <B>`, body = message text | "<A> → <B>" | H:226 |
| C-07 Other session working (silent) | title `<name> 작업 중`, body = tool detail | "<name> working" | H:154 |
| C-08 Test | title `대화/피드백`, body `알림이 잘 옵니다.` | "Chat/Feedback" / "Notifications are working." | H:690 |
| C-09 Bell | `🔕 알림` / `🔔 알림` (title `알림 켜기·설정`) | "🔕 Notifications" / "🔔 Notifications" (tooltip "Turn on / settings") | W:306, W:2214 |
| C-10 Enable toasts | `✓ 알림을 켰어요. 시험 알림을 보냈어요` / `알림 권한이 꺼져 있어요(설정에서 허용해 주세요)` / `https:// 주소로 열어야 알림을 켤 수 있어요` / `사파리 공유 → 홈 화면에 추가한 앱에서 켜 주세요` / `이 브라우저는 알림을 지원하지 않아요` / `알림을 켜지 못했어요: <error>` | "✓ Notifications on. Sent a test." / "Notification permission is off (allow it in Settings)" / "Open via an https:// address to turn notifications on" / "Turn them on in the app added via Safari Share → Add to Home Screen" / "This browser doesn't support notifications" / "Couldn't turn notifications on: <error>" | W:2273-2289 |
| C-11 Settings heading and kinds | `이 기기에 알림 받을 때`; `세션 답장`, `작업 끝남`, `승인 필요`, `비교 페이지 준비`, `오래 멈춤(5분 그대로)`, `세션끼리 메시지`, `다른 세션 작업 중(대화창을 보는 동안, 조용히)`; `대화창을 보고 있을 땐 보내지 않기` | "Notify this device when"; "Session reply", "Work finished", "Approval needed", "Comparison page ready", "Stalled (unchanged 5 min)", "Session-to-session message", "Another session working (while viewing the chat, silently)"; "Don't send while I'm viewing the chat" | W:2217-2237 |
| C-12 Settings actions | `시험 알림` → toast `시험 알림을 보냈어요`; `알림 끄기` → toast `알림을 껐어요`; `닫기` | "Test notification" → "Sent a test notification"; "Turn off" → "Notifications off"; "Close" | W:2241-2249 |

---

## 5. Timing

- Viewing heartbeat every 15 s; "not viewing" sent at once on blur, hidden, panel close or pagehide; server treats viewing as stale after 30 s.
- Done push 3 s after Stop; `work` at most every 20 s per session; stale check every 60 s, once per stuck state.
- Review-ready push 1.5 s after the page file appears.

## 6. Failure and recovery

| Failure | What the owner sees | Recovery | Evidence |
|---|---|---|---|
| Session in the notice no longer registered | Tap focuses the window; no tab switch, no message (W:2382) | Pick a tab by hand | inferred |
| Subscription expired | Notices stop; bell shows on until next check (inferred) | Turn on again | H:138-142 |
| Enable fails | Raw error appended to the toast | Retry | E8 |

## 7. Reversibility contract

| Question | Answer |
|---|---|
| Reversible? | Yes — settings and subscription are per device and can be changed or turned off |
| Warned before committing? | N/A |
| Preserved if they leave? | Settings in push-subs.json per device |
| Where does work live? | Server (push-subs.json) |

Done criteria and stage 6 wireflow: not met; stage 6 skipped by owner choice (part 3 M13).

---

## 8. Gaps (needs owner verdict)

- **G1** The review-ready push carries no session and no page URL, so tapping it focuses or opens the app root, not the comparison page (inferred from H:186 and SW:24-27).
- **G2** The peer push carries no session, so tapping it does not switch to either session's tab (inferred from H:226).
- **G3** The quiet `work` kind is on by default (`PUSH_DEFAULTS.work: true`), while the owner's recorded choice listed kinds 1-5 on and peer off (#1177). It was added later (#1449). Confirm the default.
- **G4** C-10's last form shows the raw exception text (E8).
- **G5** If the session in a notice is gone, the tap gives no explanation.
- **G6** Push behaviour has no automated test. Owner-verified paths (#1340-#1463) can regress silently.

---

## Evidence

#45, #1155-#1180, #1336-#1349, #1447-#1463; W:2195-2292, W:2378-2392; SW:7-33; H:113-190, H:226, H:290-296, H:690-717.
