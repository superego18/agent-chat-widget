# Screen Map — agent-chat-widget + ui-review-page (shipped product, retrofit)

Status: Retrofit draft 2026-10-12 — awaiting owner verdicts

> **Layer position:** `state-model` → **`screen-map`** → `moment-spec` → `wireflow` → implementation
> **Retrofit note:** surfaces are read from the shipped widget, not designed first. All state and
> transition IDs refer to `product/state-model.md` (retrofit r1). Rows marked
> "(inferred — needs owner verdict)" are not confirmed by an owner message.

The widget is one panel layered over a host page. Only a few surfaces take over the task
(panel, pick mode, drafts sheet, reload cover, review page). The rest are **regions** inside
the panel. Both are listed so each region can be mapped to the states it exposes; the Kind
column says which is which.

---

## 0. Meta

| Field | Value |
|---|---|
| Version / date | retrofit r1 · 2026-10-12 |
| State-model scope / revision | `state-model.md` retrofit r1, §0 scope; §2.4 coverage ledger |
| Status | Draft (retrofit) |
| Flows covered | None yet — `flows.md` does not exist; all flow refs Pending |
| Linked decisions | None — `docs/adr/` holds only README |

---

## 1. Screen inventory

Kind: **Screen** = takes over the task; **Region** = part of a screen; **Overlay** = transient,
confirms or informs only.

| ID | Name | Kind | Purpose (one line) | Primary actor | Entered from | Serves flow |
|---|---|---|---|---|---|---|
| SC-00 | Host page (app or review page) with widget closed | Screen (external) | The owner's app under development; widget floats over it | Owner | External: bookmark, home-screen app (start URL carries access key), `?k=` LAN link, dev-server URL | Pending |
| SC-01 | Launcher "대화/피드백" + working dots + unread badge + peek toast | Region of SC-00 | Open the panel; see at a glance whether a session works, waits for approval or answered | Owner | SC-00 | Pending |
| SC-02 | Outer reload button ↻ (under launcher, hidden while panel open) | Region of SC-00 | Reload the page without opening the panel | Owner | SC-00 | Pending |
| SC-03 | Panel header: 닫기 (mobile), ↻, bell "알림", title "대화/피드백 · <context>", status line | Region of SC-P | Close, reload, notification entry; tells how the next message will be delivered | Owner | SC-P | Pending |
| SC-04 | Session tabs row (status dot, unread badge, peer-send arrow) | Region of SC-P | Pick which session to talk to | Owner | SC-P; notification tap | Pending |
| SC-05 | Message list: bubbles (user / agent / peer / held / cancelled / resent / drafts-origin), read marks, quote blocks, "여기부터 새 메시지" line, typing row, not-auto-delivered hint, link lines layer | Region of SC-P | Read the conversation; act on own messages (cancel, 보류로, interject toggle, resend, 답장, 참고) | Owner | SC-P | Pending |
| SC-06 | Hold area: "보류 N개" fold header + dashed hold bubbles with action row | Region of SC-P (bottom of SC-05) | Keep composed messages unsent until explicitly sent | Owner | SC-P | Pending |
| SC-07 | Compose row: textarea + clear ×, [보내기 / 끼워넣기], [보류 / ▤ 보관함]; category chips row ("전체 N", label chips, "+ 새 분류", "위치 찍기") | Region of SC-P | Write and route a message: send, interject, hold, stash under a label | Owner | SC-P | Pending |
| SC-08 | Reply / reference bar ("↩ 답장 · …" / "📎 참고 · …" + ×) | Region of SC-P (above SC-07) | Show what the next message replies to or references | Owner | SC-05 link or SC-09 pill | Pending |
| SC-09 | Selection pill "↩ 답장 \| 📎 참고" | Overlay over SC-P | Turn a selected passage into a partial reply/reference | Owner | Text selection in SC-05 | Pending |
| SC-10 | Location bar ("위치: …" + ×) | Region of SC-P (above SC-07) | Show the picked screen element attached to the next message | Owner | SC-11 | Pending |
| SC-11 | Pick mode: hint bar "찍을 곳을 누르세요" + [앱 화면 \| 대화창] + 취소, highlight box | Screen | Point at the element the message is about | Owner | SC-07 "위치 찍기"; drafts card "다시 찍기" | Pending |
| SC-12 | Drafts sheet ("보관함"): header + 닫기 ▾, recent sent/deleted (trash, 7 days), label groups with cards, footer (전체 checkbox + "선택한 N개 한 번에 보내기") | Screen (drop-up over SC-07) | Review, edit, relabel, retarget and batch-send stashed notes; restore sent/deleted | Owner | SC-07 "전체 N" chip / long-press label chip; toast "<label> 열기"; reload restore | Pending |
| SC-13 | Notification settings dialog: kind checkboxes, quiet-while-viewing, 시험 알림 / 알림 끄기 / 닫기 | Screen (popover) | Choose which pushes this device gets | Owner | SC-03 bell (when subscribed) | Pending |
| SC-14 | Reload cover: tinted full overlay, spinning ↻, message | Overlay (blocking) | Tell the owner a reload is coming / happening and not to touch | System | SC-02 / SC-03 ↻; agent `reload-widgets` | Pending |
| SC-15 | To-bottom button ↓ (indigo + count when unread answers below) | Region of SC-P | Jump back to the latest messages | Owner | SC-05 scrolled up >200 px | Pending |
| SC-16 | Toast pill (optional action: 되살리기 / "<label> 열기" / "<session> 열기") | Overlay | Confirm an action; offer undo or navigation | System | Any action | Pending |
| SC-17 | Review (comparison) page: header, auto-continue banner, status/count, items (before/after or options, verdict buttons, memo, legend), overall comment + 완료 | Screen | Rate UI changes per item and finish the round | Owner | External: URL from agent / "review page ready" push; same widget embedded (context 'review') | Pending |
| SC-18 | Review zoom dialog (fit/100/150/200%, pins with notes) | Screen (modal over SC-17) | Inspect a capture and pin notes | Owner | SC-17 image | Pending |
| SC-P | Panel (container for SC-03 … SC-10, SC-15) | Screen | Talk to agent sessions from inside the app | Owner | SC-01 launcher; peek toast; push notification tap; reload restore | Pending |

External entries (listed, not assumed):
- **Push notification tap** → SC-P on that session's tab (TR-71; `postMessage` or `#uifb-tab=`).
- **Home-screen app launch** → SC-00 via manifest start URL carrying the access key.
- **LAN link with `?k=`** → key cookie set, redirect strips key → SC-00.
- **Review page URL** (from agent message or "review page ready" push) → SC-17.
- **Page reload** (manual or agent `reload-widgets`) → SC-00 or SC-P per `__uifb_open`, with SC-12 restored if it was open (TR-57).
- **Terminal** (owner types in the agent's terminal) — not a screen, but marks answers read (TR-74) and shows the terminal message in SC-05.

---

## 2. Transitions

Navigation and same-screen edges only; async/system edges stay in `state-model.md` §2.2.

| TR refs | From SC / ST | To SC / ST | Event / guard reference | Flow / branch | Reversible? |
|---|---|---|---|---|---|
| TR-43 | SC-00 / ST-26 | SC-P / ST-27 | `state-model.md` §2.2 R7 (launcher, peek, restore) | Pending | back (TR-44) |
| TR-44 | SC-P / ST-27 | SC-00 / ST-26 | launcher / 닫기 | Pending | back (TR-43) |
| TR-71 | external (OS notification) | SC-P / ST-27 on that tab | §2.2 R10 | Pending | back |
| TR-45 | SC-04 / ST-27 | SC-04 / ST-27 (other tab) | tab switch; remote sync guard 5 s / 3 s | Pending | back |
| TR-46 | SC-07 / ST-27 | SC-11 / ST-28 | "위치 찍기" | Pending | back (TR-47 취소/Esc) |
| TR-47, TR-63 | SC-11 / ST-28 | SC-P / ST-27 + SC-10 / ST-40 | pick / Esc / 취소 | Pending | back |
| TR-26 ("다시 찍기") | SC-12 / ST-29 | SC-11 / ST-28 | re-pick from a draft card | Pending | back (inferred — needs owner verdict: returns to SC-12 or SC-P) |
| TR-48 | SC-07 / ST-27 | SC-12 / ST-29 | "전체 N" chip / long-press label 0.5 s; toast "<label> 열기" | Pending | back (TR-49) |
| TR-49 | SC-12 / ST-29 | SC-P / ST-27 | 닫기 ▾ / same chip / tap list / last item sent | Pending | back |
| TR-50 | SC-12 / ST-29 | SC-12 / ST-29 (other label) | tap other chip | Pending | back |
| TR-51 | SC-03 / ST-27 | SC-13 / ST-30 | bell when ST-43/ST-44 | Pending | back (TR-52) |
| TR-52 | SC-13 / ST-30 | SC-P / ST-27 | bell / 닫기 / 알림 끄기 | Pending | back |
| TR-65, TR-66 | SC-03 / ST-42 | SC-03 + SC-16 / ST-41 or ST-43 | bell when not subscribed | Pending | TR-67 |
| TR-53 | SC-02 or SC-03 / any | SC-14 / ST-32 | ↻ | Pending | no return during cover; work restored after (TR-57) |
| TR-54, TR-55, TR-56 | any / any | SC-14 / ST-31 → ST-32 | reload token changed; waits while editing/busy | Pending | no return during cover; work restored after |
| TR-57 | SC-14 / ST-32 | SC-00 / ST-26 or SC-P / ST-27 | reload completes | Pending | — |
| TR-58 | SC-05 / ST-33 | SC-08 / ST-35, ST-37 | 답장 / 참고 link | Pending | back (× TR-62) |
| TR-59 | SC-05 / ST-33 | SC-09 / ST-34 | text selected in a body | Pending | back (TR-61) |
| TR-60 | SC-09 / ST-34 | SC-08 / ST-36, ST-38 | pill action | Pending | back (×) |
| TR-11, TR-12, TR-13 | SC-05 / ST-03, ST-04, ST-06 | SC-05 / ST-06, ST-07 + SC-06 / ST-10 | cancel / 보류로 | Pending | **no return** for cancel (no un-cancel); 보류로 keeps the text in hold |
| TR-14, TR-15, TR-16 | SC-05 / ST-05 | SC-05 / ST-08 → ST-05 + new ST-03 | 다시 보내기 (read only) | Pending | back until sent |
| TR-17 … TR-24 | SC-07 / ST-01; SC-06 / ST-10, ST-11 | SC-06 / ST-10; SC-12 / ST-12; SC-05 / ST-03, ST-04 | hold, edit, delete, to drafts, send, interject | Pending | delete: undo toast + trash 7 days; send: no return once read |
| TR-25 | SC-07 / ST-01 | SC-12 (count) / ST-12 | ▤ 보관함 | Pending | delete + trash |
| TR-28 | SC-12 / ST-12, ST-13 | SC-05 / ST-03 + SC-12 trash / ST-14 | send single / label / selected | Pending | restore to drafts (TR-31); sent message itself can only be cancelled while unread |
| TR-72 | SC-05 / ST-46 | SC-01, SC-04, SC-15, SC-16 / ST-45 | new answer | Pending | — |
| TR-73 | SC-05 / ST-45 | SC-05 / ST-46 | fully visible | Pending | no return (no "mark unread") |
| — | SC-15 | SC-05 bottom | ↓ tap (W:1220) | Pending | back by scrolling |
| TR-75 | SC-17 / ST-47 | SC-17 / ST-47, ST-48 | verdict / memo | Pending | back (change verdict) |
| TR-76 | SC-17 / ST-47, ST-48 | SC-17 / ST-49 | 완료 | Pending | **no return** |
| TR-77 | SC-17 / ST-47, ST-48 | SC-17 (same) | 완료 fails | Pending | back (retry) |
| — | SC-17 | SC-18 | image click | Pending | back (close) |

---

## 3. Map

```text
external: bookmark / home-screen app / ?k= link
   -> [SC-00 host page / ST-26]
         |--TR-43 launcher|peek|restore--> [SC-P panel / ST-27] --TR-44--> SC-00
external: push tap --TR-71--> [SC-P / ST-27 @ tab]

[SC-P]
  SC-03 header --TR-51 [subscribed]--> [SC-13 notif settings / ST-30] --TR-52--> SC-P
  SC-03 / SC-02 ↻ --TR-53--> [SC-14 cover / ST-32] --TR-57--> SC-00 | SC-P (work restored)
  agent reload-widgets --TR-55 [editing|busy]--> [SC-14 / ST-31] --TR-56--> ST-32
                        --TR-54 [idle]--> ST-32
  SC-07 위치 찍기 --TR-46--> [SC-11 pick / ST-28] --TR-47/63--> SC-P + SC-10 (ST-40)
  SC-07 전체 / long-press --TR-48--> [SC-12 drafts sheet / ST-29] --TR-49--> SC-P
  SC-05 select text --TR-59--> SC-09 pill --TR-60--> SC-08 (ST-36/38)
  SC-05 답장|참고 --TR-58--> SC-08 (ST-35/37)

User message (in SC-05):
  ST-01 -TR-02-> ST-02 -TR-03-> ST-03 -TR-06 [not working]-> ST-05 -TR-14-> ST-08 -TR-16-> new ST-03 (ST-09)
                        \-TR-04 fail-> ST-01   ST-03 <-TR-09/10-> ST-04 -TR-08 hook-> ST-05
  ST-03|04 -TR-11-> ST-06 -TR-13-> ST-07     ST-03|04 -TR-12-> ST-07 (+ ST-10 in SC-06)

external: review URL / review-ready push -> [SC-17 / ST-47] -TR-75-> ST-48 -TR-76 (one-way)-> ST-49
```

No archify diagram yet (Pending).

---

## 4. Screen states

| Screen | Async sources | ST refs / regions and source conditions | Moment / coverage refs |
|---|---|---|---|
| SC-00 | S7 | ST-26; Unauthorized: LAN without key (state-model §9) | — |
| SC-01 | S1, S3 | ST-26; R5 ST-17…ST-19 (dots, amber for permission); R11 ST-45 (badge, title "(N)", peek 5 s) | TR-43, TR-72 |
| SC-02 | — | ST-26 only (hidden in ST-27); spins in ST-32 | TR-53 |
| SC-03 | S1, S4, S6 | Status line from R6 ST-22…ST-25; bell R10 ST-41…ST-44; ↻ ST-32 | TR-39…TR-42, TR-51, TR-53, TR-65…TR-67 |
| SC-04 | S1, S3, S4 | Per tab: R5 dot (busy pulse / watching green / off grey), ST-21 unknown, R11 badge, peer arrow | TR-33…TR-38, TR-45, TR-71 |
| SC-05 | S1, S2, S3, S9 | R1 ST-03…ST-09; R5 typing row ST-18/ST-19, stale ST-20; R6 ST-24 hint; R11 ST-45/ST-46; Empty: EM3 Pending; Offline: Pending (E10) | TR-06…TR-16, TR-58, TR-59, TR-72, TR-73 |
| SC-06 | S1, S2 | R2 ST-10, ST-11; fold flag | TR-17…TR-24 |
| SC-07 | S2, S5 | R1 ST-01, ST-02; 끼워넣기 visible only when target ST-18/ST-19; input disabled when no session (EM1); error toasts E1, E6 | TR-01…TR-05, TR-17, TR-25, TR-46, TR-48 |
| SC-08 | — | R8 ST-35…ST-38 (hidden in ST-33) | TR-58, TR-60, TR-62 |
| SC-09 | — | R8 ST-34 | TR-59…TR-61 |
| SC-10 | — | R9 ST-40 (hidden in ST-39) | TR-63, TR-64 |
| SC-11 | S10 | ST-28 (target app or widget) | TR-46, TR-47, TR-63 |
| SC-12 | S1, S2, S5 | ST-29; R3 ST-12, ST-13; R4 ST-14, ST-15; Empty EM2 (stale copy) | TR-25…TR-32, TR-48…TR-50 |
| SC-13 | S6 | ST-30; R10 ST-43/ST-44; error E8 | TR-51, TR-52, TR-67, TR-68 |
| SC-14 | S7 | ST-31 (waiting copy), ST-32 (reloading copy) | TR-53…TR-57 |
| SC-15 | S1 | ST-27 scrolled up; R11 ST-45 count | TR-72 |
| SC-16 | S2, S6 | Transient; carries undo (TR-21, TR-30) or open (TR-22, TR-25, TR-26) | — |
| SC-17 | S8, S4 | R12 ST-47…ST-49; auto-continue banner from R6; error E9; Empty EM5 Pending | TR-75…TR-77 |
| SC-18 | — | Local only | — |
| SC-P | all | ST-27; mobile full-screen; viewing heartbeat ST-44 | TR-43, TR-44, TR-69, TR-70 |

---

## 5. Dead ends and one-way doors

| Screen | Problem | Way out | Verdict |
|---|---|---|---|
| SC-14 reload cover | No control while shown; if the editing/busy wait never ends (ST-31), the cover stays (inferred — needs owner verdict) | Finish the edit; busy buttons unlock after 8 s | Pending |
| SC-05 cancel (TR-11) | Cancel cannot be undone | 보류로 (TR-13), then send from hold | Pending — owner chose "cancel stays a trace, no delete" (#1113-#1119) |
| SC-05 send to Codex (TR-07) | Delivered immediately; no cancel/interject | None | Pending |
| SC-05 read message | After ST-05 a message cannot be withdrawn | Resend corrected text (TR-16) | Pending |
| SC-17 완료 (TR-76) | Done is irreversible in the UI; reopening shows "이미 완료" | Tell the terminal "피드백 확인해" if work did not continue | Pending |
| SC-12 trash | Items vanish after 7 days (ST-16) without notice | Restore within 7 days | Pending |
| SC-05 / SC-03 watcher off (ST-24 via TR-41) | Messages wait indefinitely; only a hint shows | Owner asks the session in its terminal to restart the watcher | Pending — B22 part3 |
| SC-11 pick mode | Reload during pick drops pick mode (inferred — needs owner verdict) | Pick again | Pending |
| SC-00 LAN without key | Widget unreachable (inferred — needs owner verdict on what is shown) | Open the `?k=` link | Pending |

---

## 6. Navigation shape

| Question | Answer |
|---|---|
| What is always reachable? | SC-01 launcher and SC-02 ↻ on every host page; inside the panel: tabs, compose, ↻, bell |
| What is reachable only mid-task? | SC-09 pill (only with a selection), SC-08/SC-10 bars (only with an attachment), SC-11 pick, 끼워넣기 (only while target works), resend (only after read) |
| How deep does the deepest task go? | 3 levels: SC-00 → SC-P → SC-12 drafts sheet → SC-11 re-pick |
| Can the user tell where they are? | Panel title shows context ("대화/피드백 · <context>"); active tab highlighted; sheet header shows label. Pick mode shows hint bar. |
| Does browser back do what they expect? | Not handled — the widget has no history entries; back leaves the host page state (inferred — needs owner verdict) |

---

## 7. Coverage check

| Check | Yes? |
|---|---|
| Every flow in `flows.md` maps to ST/TR paths with SC/M context | No — `flows.md` missing |
| Every screen serves at least one flow | Pending (no flows) |
| Every screen is reachable | Yes — each SC has an entry in §1 |
| Every in-scope branch is accounted for | Pending (no flows) |
| Each TR guard has a modeled source | Yes, except S1 offline (E10) and hook failures (E11) |
| Every exception flow ends in recovery or an acknowledged dead end | No — §5 verdicts Pending |
| Every screen's applicable states are designed | No — Empty EM1/EM3/EM5 and Offline rows Pending |
| External entry points are listed | Yes — §1 |

`journey-agent` not run yet.

---

## 8. Freeze checklist

- [x] §1 inventory complete, including external entries
- [ ] §2 every transition has trigger and precondition — yes for listed rows; flow refs Pending
- [x] TR rows reference state-model authority
- [ ] §4 no screen is happy-path only — Offline/Empty Pending
- [ ] §5 every dead end has a verdict recorded
- [ ] §7 all checks Yes, or an ADR explains the No
- [ ] `journey-agent` review completed and findings resolved

---

## 9. Handoff

| ST/TR refs | SC refs | Moment spec candidate | Why |
|---|---|---|---|
| ST-03/ST-04, TR-06, TR-09, TR-11, TR-12 | SC-05 | Y | "Will it be read, when, and can I still take it back?" |
| TR-02 → TR-03 / TR-04 | SC-07 | Y | Waiting on the server; retry without duplicating |
| TR-53 … TR-57 | SC-14 | Y | Owner cannot act; trusts preservation |
| TR-59, TR-60 | SC-09 | Y | Selection behavior on iOS |
| TR-41 | SC-03, SC-05 | Y | Silent loss of auto-delivery |
| TR-76 | SC-17 | Y | One-way door |
| TR-48, TR-49 | SC-07, SC-12 | Y | Tap vs long-press on the same chip (D31/D34 part1) |
