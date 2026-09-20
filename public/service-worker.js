const showPushNotification = (payload) => {
  const title = payload?.title || 'WenAppliances';
  const options = {
    body: payload?.body || 'You have a new update.',
    icon: payload?.icon || '/wen-icon.png',
    badge: payload?.badge || '/wen-icon.png',
    tag: payload?.tag || 'wenappliances-notification',
    renotify: true,
    data: { url: payload?.url || '/' }
  };

  return self.registration.showNotification(title, options);
};

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || 'You have a new update.' };
  }

  event.waitUntil(showPushNotification(payload));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existingClient = clients.find((client) => 'focus' in client);
      if (existingClient) {
        existingClient.navigate(targetUrl);
        return existingClient.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
