# agent-chat-widget

웹 앱 화면 위에 붙여, 작업 중인 AI 코딩 에이전트(Claude Code·Codex)와 대화하는 창입니다. 의존성 없이 Node 18+ 로 동작합니다.

[ui-feedback-loop](https://github.com/superego18/ui-feedback-loop) 스킬에서 떼어 낸 도구 부분입니다. 비교 페이지는 [ui-review-page](https://github.com/superego18/ui-review-page)에 있습니다.

## 할 수 있는 것

- **세션별 대화**: 세션 탭마다 대화하고, 터미널 대화도 함께 보임(Claude Code 훅, Codex 대화 기록)
- **작업 중에도 말 걸기**: 끼워넣기, 보내기 취소, 아직 안 읽힌 글을 보류로 돌리기, 읽힌 뒤 다시 보내기
- **답장·참고**: 메시지 전체나 고른 부분을 인용하고, 답과 질문을 선으로 잇기
- **보류·보관함**: 나중에 보낼 글을 대화창 아래(보류)나 분류별 보관함에 모았다가 보내기
- **화면 번호·값 바꾸기**: 보관함 글 중 지금 화면에 위치를 찍은 것을 앱 위에 번호로 보이기, 찍은 요소의 글자·크기·색·여백을 그 자리에서 바꿔 보고 바꾼 값을 함께 보내기
- **하던 것 보존**: 새로고침돼도 쓰던 글·붙인 인용·찍은 위치·고치던 글·커서가 남음
- **휴대폰 알림**: 답장·작업 끝·승인 필요 등(웹 푸시, 홈 화면 앱)
- **아무 앱에나 붙이기**: 앱 앞에 프록시를 세워 HTML 에 대화창을 넣음

## 구성

| 파일 | 하는 일 |
|---|---|
| `assets/app-widget.js` | 대화창(화면에 붙는 위젯) |
| `scripts/chat-handler.mjs` | 대화창 서버의 요청 처리(다른 서버에 붙여 쓸 수 있음) |
| `scripts/chat-server.mjs` | 대화창 서버를 혼자 띄우기 |
| `scripts/app-proxy.mjs` | 앱 앞에 서서 대화창을 넣는 프록시 |
| `scripts/register-session.mjs`·`hook-relay.mjs`·`install-hooks.mjs` | 에이전트 세션 등록과 대화·작업 상태 중계(Claude Code 훅) |
| `scripts/wait-review.mjs` | 세션이 대화창 메시지를 기다리는 감시 명령 |
| `scripts/reload-widgets.mjs` | 열린 대화창을 안내와 함께 새로고침 |
| `scripts/web-push.mjs`, `assets/sw.js` | 휴대폰 알림 |

## 빠르게 써 보기

```bash
node scripts/chat-server.mjs --dir .ui-feedback --port 4799
node scripts/app-proxy.mjs --app http://localhost:3000 --port 4798 --review http://localhost:4799 --dir .ui-feedback
```

그다음 `http://localhost:4798` 을 열면 앱 화면 왼쪽 아래에 `대화/피드백` 단추가 생깁니다. 세션 등록과 훅 설치는 ui-feedback-loop 의 SKILL.md 를 따릅니다.

## 시험

```bash
npm install   # 시험용 playwright-core 만 설치(설치된 크롬을 씀)
npm test      # 휴대폰 크기 크롬으로 대화창 핵심 흐름 시험
```

커밋할 때마다 시험이 저절로 돌게 하려면 저장소마다 한 번 `git config core.hooksPath .githooks` 를 실행합니다. 시험이 깨지면 커밋이 멈춥니다.

## 라이선스

MIT
