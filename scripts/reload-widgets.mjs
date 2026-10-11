#!/usr/bin/env node
// 열려 있는 대화창(앱 화면·비교 페이지)을 새로고침시킨다. 위젯(assets/app-widget.js)을 고친 뒤 세션이 원할 때 부른다.
// 대화창은 "새로 고치는 중이에요" 안내를 띄운 뒤 새로고침한다(보내는 중·말풍선을 고치는 중이면 끝날 때까지 기다림).
// 사용: node reload-widgets.mjs [--port 4799]
const i = process.argv.indexOf('--port');
const port = i > 0 ? process.argv[i + 1] : '4799';
const r = await fetch(`http://127.0.0.1:${port}/api/reload-widgets`, { method: 'POST' }).catch((e) => ({ ok: false, statusText: e.message }));
console.log(r.ok ? '대화창 새로고침을 요청했습니다(5초 안에 반영).' : `실패: ${r.statusText}`);
process.exit(r.ok ? 0 : 1);
