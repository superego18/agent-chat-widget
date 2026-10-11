// 대화/피드백 알림용 서비스 워커. 화면 요청은 가로채지 않고(fetch 처리 없음) 푸시 알림만 띄운다.
// 대화창 서버·앱 프록시가 /__uifb/sw.js 로 내보내고, 위젯이 사용자가 알림을 켤 때 등록한다.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || '대화/피드백', {
    body: d.body || '',
    tag: d.tag || 'uifb',
    renotify: !d.silent, // 조용한 알림(다른 세션 작업 중)은 소리·진동 없이 같은 자리를 바꿔 끼운다
    silent: !!d.silent,
    icon: '/__uifb/icon-192.png',
    badge: '/__uifb/icon-192.png',
    data: { url: d.url || '/', session: d.session || null },
  }));
});

// 알림을 누르면 이미 열린 창이 있으면 그 창으로, 없으면 새로 연다.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  // 알림이 어느 세션 것인지 알려, 대화창이 그 세션 탭을 열게 한다(열린 창에는 메시지로, 새 창은 주소 끝 #uifb-tab= 으로).
  const session = e.notification.data && e.notification.data.session;
  const base = (e.notification.data && e.notification.data.url) || '/';
  const url = session ? base.split('#')[0] + '#uifb-tab=' + encodeURIComponent(session) : base;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) { if (session) c.postMessage({ type: 'uifb-open-tab', session }); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
