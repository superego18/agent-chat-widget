// 대화/피드백 알림용 서비스 워커. 화면 요청은 가로채지 않고(fetch 처리 없음) 푸시 알림만 띄운다.
// 리뷰 서버·앱 프록시가 /__uifb/sw.js 로 내보내고, 위젯이 사용자가 알림을 켤 때 등록한다.

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
    data: { url: d.url || '/' },
  }));
});

// 알림을 누르면 이미 열린 창이 있으면 그 창으로, 없으면 새로 연다.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
