# Glossary — agent-chat-widget + ui-review-page

Status: Retrofit draft 2026-10-12 — awaiting owner verdicts

> Retrofit: reconstructed from chat #ids and the UI as of 2026-10-12.
> "UI label" is the text exactly as shown on screen (Korean). `N`, `<name>` and `<label>`
> stand for values filled in at run time. Use the English term in docs, code comments and ADRs.
> Terms marked "(inferred — needs owner verdict)" were named by the agent, not the owner.

## Core concepts

| English term | UI label | Meaning | Evidence |
|---|---|---|---|
| Chat panel | `대화창`; launcher button `대화/피드백` | The panel attached to the app (or review page) for talking to sessions | #20, #300 |
| Launcher | `대화/피드백` | Bottom-left button that opens/closes the chat panel; shows working dots and unread badge | #20, #28, #1096 |
| Session | `세션` (each tab shows the session's name) | One registered coding-agent conversation (Claude Code or Codex). One tab per session | #11, #13 |
| Session tab | (the session name) | Tab in the panel header; sending goes only to the selected tab's session | #11 |
| Owner | — | The developer using the panel. Avoid "user" when it could mean an end user of the app (inferred — needs owner verdict) | — |
| Watcher | not shown in the panel; owner and agent say `감시` / `대화 감시` in chat (command: `wait-review.mjs`) | Background command a session runs to pick up chat messages; while it runs, messages are delivered automatically | #141, #144, #424 |
| Delivered / Read | `읽음` | The session actually picked the message up. Read time is the real pickup moment, no compensating rules | #605, #823–#829 |
| Unread (own message) | `안 읽음`, `안 읽음(곧 읽음)`, `안 읽음(작업 중이라 끝나면 읽음)`, `안 읽음(다음 단계에서 바로 읽음)` | Sent but not picked up; the suffix says when it will be | #605, #842 |
| Held message | (no label; floats at bottom with animation) | Own unread message kept at the bottom of the list, dropping into place when read. Not the same as Hold | #661 |
| Delivery hint | `<name>에게 전달하는 중…`, `<name>이(가) 읽고 답하는 중…`, `자동으로 전달되지 않습니다. …` | Line under the last own message explaining delivery | #42, #605 |
| Mode line | `<name>에게 보냅니다. 바로 전달됩니다.` (one of several states) | Header status line for the selected session | Term name (inferred — needs owner verdict) |
| Stale working | `N분째 그대로예요. 답이 안 오면 터미널을 확인해 주세요` | Session has shown the same working status for 5+ minutes | agent-initiated (part 2 F8) |
| New-messages line | `여기부터 새 메시지` | Marks where unread answers start | #55 |
| Source tag | `터미널`, `앱`, `비교 페이지`, `답장`, `세션끼리`, with ` · 모바일` / ` · 데스크톱` | Where a message was written and on which device class (by width) | #489, #491, #492 |
| Session-to-session message (peer message) | `세션끼리` | Message one session sent to another, shown as dashed amber bubble | #700 |
| Location pick | `위치 찍기`; target switch `앱 화면` / `대화창`; hint `찍을 곳을 누르세요`; `취소` | Pointing at an element so the message carries its URL, selector and text | #248, #636–#642 |
| Location status | `위치 그대로`, `화면이 바뀜 · 다시 찍기 권장`, `다른 화면 · <url>` | Whether a saved pick still matches the screen | #248, #250 |

## Sending

| English term | UI label | Meaning | Evidence |
|---|---|---|---|
| Send | `보내기` | Send now; if the session is working, it is read when the work ends | #792 |
| Interject | `끼워넣기` / `끼워넣기 취소` | Deliver between the agent's tool calls while it works; shown only while the session is working. Can be toggled on an unread message | #786, #792, #1051 |
| Cancel send | `보내기 취소`; mark `보내기 취소함` | Stop an unread message from being delivered; it stays as a struck-through trace | #832, #1117 |
| Move to hold | `보류로` | Put an unread or cancelled message into Hold (cancels it if unread) | #1231, #1407 |
| Resend | `다시 보내기`; new message tagged `다시 보냄` | Edit a read message inside its bubble and send it again as a new message | #753, #766, #1411 |
| Clear input | `×` (title `입력칸 비우기`) | Empty the input and its synced draft | #758 |
| Busy state | `↻` spinning on the button | Waiting for the server to accept; re-pressable after a timeout | #1270, #1297 |

## Reply and reference

| English term | UI label | Meaning | Evidence |
|---|---|---|---|
| Reply | `답장`; bar `↩ 답장 · …` | Quote a message (whole or part) as the thing being answered | #737 |
| Reference | `참고`; bar `📎 참고 · …` | Attach a message as context only, not as a reply | #1247, #1251 |
| Selection pill | `↩ 답장` / `📎 참고` (floating above the input) | Appears when text inside a message body is selected | #877, #1257, #1351 |
| Partial quote | `고른 부분` (e.g. `↩ <name>의 고른 부분: "…"`) | Reply to a selected part; part highlighted yellow in the original | #868, #877, #1032 |
| Whole reply | `전체 답장` (e.g. `↩ <name>에게 전체 답장: …`) | Reply to the whole message | #1032 |
| Expand / Collapse | `펼치기` / `접기` | Show the full quote or draft text, or clamp to 4 lines | #884, #891, #981 |
| Go to original | `원문으로` | Scroll to and outline the quoted message | #891, #897 |
| Reply link | (drawn line, no label) | Tapered line from a question to its answer; faint until the message is tapped | #990–#1049 |
| Reply target marker | `<re N>` (agent-side, hidden from the owner) | Prefix the agent writes so the link is exact | #1088, #1090 |

## Hold and drafts box

| English term | UI label | Meaning | Evidence |
|---|---|---|---|
| Hold | `보류`; group header `보류 N개`; bubble tag `보류 · 아직 안 보냄` | Unsent notes stacked as dashed bubbles at the bottom of the chat until sent | #1121, #1124, #1143 |
| Hold actions | `수정`, `저장`, `수정 취소`, `지우기`, `▤ 보관함`, `끼워넣기`, `보내기` | Edit, save, cancel edit, delete, move to drafts box, interject, send | #1227–#1239, #1306 |
| Drafts box | `보관함` (button shows `▤ 보관함`); sheet title `보관함 · 전체 N개` / `보관함 · <label>` | Categorized store of notes to send later, as a drop-up sheet | #246, #513, #1143 |
| Category (label) | `분류`; select `분류: <label>`; tag `보관함 › <label>` | Group within the drafts box, kept per session | #373, #533, #866 |
| Uncategorized | `미분류` | Draft with no category | #500 |
| All chip | `전체` / `전체 N` | Opens the whole drafts box | #947, #949 |
| New category | `+ 새 분류` | Create a category inline | #501, #947 |
| Category chip | (category name) | Tap = choose save-to category; long press = open that category's sheet | #567, #571, #573 |
| Send this | `이것만 보내기` | Send one draft | #246 |
| Send category | `이 분류 모두 보내기` | Send a whole category as one numbered message | #373 |
| Send selected | `선택한 것 보내기` / `선택한 N개 한 번에 보내기` | Send checked drafts combined | #246 |
| Show / Re-pick location | `위치 보기` / `다시 찍기` | View or update the draft's saved location | #248 |
| Recently sent/deleted | `최근 보낸 것·지운 것` (7 days) | Trash section at top of the drafts box | #908, #921 |
| Restore | `다시 담기` | Put a recent item back into the drafts box or hold | #908 |
| Undo (toast) | `되살리기` | Undo a delete from the toast | #908 |
| Open destination (toast) | `<label> 열기` / `<session> 열기` | Toast action after moving an item | #971–#976 |
| Close sheet | `닫기 ▾` | Close the drafts sheet | #573 |

Note: the empty drafts box still says `"나중에"를 누르면` — stale copy; the button is now `보관함` (code.md §5).

## Notifications and reload

| English term | UI label | Meaning | Evidence |
|---|---|---|---|
| Notifications | `🔕 알림` (off) / `🔔 알림` (on) | Web push to phone/desktop | #1155, #1157 |
| Notification kinds | `세션 답장`, `작업 끝남`, `승인 필요`, `비교 페이지 준비`, `오래 멈춤(5분 그대로)`, `세션끼리 메시지`, `다른 세션 작업 중(대화창을 보는 동안, 조용히)` | Per-device toggles | #1175, #1177, #1449 |
| Test / Turn off | `시험 알림` / `알림 끄기` | Send a test push / unsubscribe this device | #1175 |
| Peek | (preview bubble above launcher) | 5-second preview of a new answer while the panel is closed | #45 |
| Reload | `↻`; cover `대화창을 새로 고치는 중이에요 · 잠시 손대지 마세요` | Manual or agent-invoked reload, always announced | #1181, #1374, #1391 |
| Jump to bottom | `↓` (with count when answers are below) | Scroll to newest | #932, #1317 |
| Close panel (mobile) | `닫기` | Close the full-screen panel | #462 |

## Review page (ui-review-page)

| English term | UI label | Meaning | Evidence |
|---|---|---|---|
| Review page | `비교 페이지` (formerly `리뷰`) | Side-by-side rating page for UI changes or options. Owner's term is "comparison page"; English name follows the repo. Pick one English term (inferred — needs owner verdict) | #543–#545, #581 |
| Round | (round number in data, e.g. `r<round>`) | One batch of UI changes reviewed together | #543 |
| Before / After | `전` / `후` | Paired screenshots of one change | #543 |
| Verdict | `좋음`, `수정 필요`, `되돌리기` (or option names such as `다른 방향`) | Per-item rating | #561 |
| Overall comment | `전체 의견` | Free text for the whole round | — |
| Done | `평가 완료 표시` | Marks the round finished; verdicts go to chat and wake the session | #218–#223, #561 |
| Auto-continue | `자동 이어가기 켜짐` / `자동 이어가기 꺼짐` | Whether a watcher will pick up "done" | #218 |
| Zoom / Pins | `맞춤`, `100%`, `150%`, `200%`; pin note `이 위치에 대한 의견` | Inspect a capture and leave notes on spots | #226 |
| Number boxes | (numbered marks on captures) | Boxes linking a capture region to a change line | #226, #229, #579 |

## Avoid

| Avoid | Use | Why |
|---|---|---|
| `리뷰` in UI | `비교 페이지` | Renamed everywhere (#581, #589, #602) |
| `나중에` | `보류` or `보관함` | Old single button split into two (#1134–#1143) |
| "Archive" | Drafts box | Earlier English notes used "archive" for 보관함; one term only (inferred — needs owner verdict) |
| "Queue" for hold | Hold | Hold is not delivered in order; it waits for an explicit send |
