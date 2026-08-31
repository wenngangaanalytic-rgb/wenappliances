import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

const TRACKED_ORDERS_KEY = 'wenappliances:notification-orders';
const NATIVE_PERMISSION_KEY = 'wenappliances:native-notification-permission';
const NATIVE_CHANNEL_ID = 'wenappliances-alerts';

const isNativeApp = () => Capacitor.isNativePlatform();

const rememberNativePermission = (permission) => {
  if (!isNativeApp() || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(NATIVE_PERMISSION_KEY, permission);
  } catch {
    // Continue without persisting the native permission state.
  }
};

let nativeChannelPromise;
let nativeActionListenerPromise;

const ensureNativeChannel = async () => {
  if (!isNativeApp() || Capacitor.getPlatform() !== 'android') return;
  if (!nativeChannelPromise) {
    nativeChannelPromise = LocalNotifications.createChannel({
      id: NATIVE_CHANNEL_ID,
      name: 'Wen Appliances alerts',
      description: 'New orders, cancellations, and customer chat messages.',
      importance: 4,
      visibility: 1,
      lights: true,
      lightColor: '#9C6644',
      vibration: true
    }).catch((error) => {
      nativeChannelPromise = undefined;
      throw error;
    });
  }
  await nativeChannelPromise;
};

const ensureNativeActionListener = async () => {
  if (!isNativeApp() || nativeActionListenerPromise) return;

  nativeActionListenerPromise = LocalNotifications.addListener(
    'localNotificationActionPerformed',
    ({ notification }) => {
      const url = notification?.extra?.url;
      if (typeof url === 'string' && url && typeof window !== 'undefined') {
        window.location.assign(url);
      }
    }
  );
  await nativeActionListenerPromise;
};

const makeNativeNotificationId = () => {
  const randomId = Math.floor(Math.random() * 2_000_000_000);
  return randomId || Date.now() % 2_000_000_000;
};

export const canUseBrowserNotifications = () =>
  isNativeApp() || (typeof window !== 'undefined' && 'Notification' in window);

export const isNativeNotificationApp = () => isNativeApp();

export const getNotificationPermission = () => {
  if (isNativeApp()) {
    try {
      return window.localStorage.getItem(NATIVE_PERMISSION_KEY) || 'default';
    } catch {
      return 'default';
    }
  }

  if (!canUseBrowserNotifications()) return 'unsupported';
  return Notification.permission;
};

export const requestBrowserNotificationPermission = async () => {
  if (isNativeApp()) {
    try {
      const current = await LocalNotifications.checkPermissions();
      if (current.display === 'granted') {
        rememberNativePermission('granted');
        return 'granted';
      }

      if (current.display !== 'prompt' && current.display !== 'prompt-with-rationale') {
        rememberNativePermission(current.display);
        return current.display;
      }

      const requested = await LocalNotifications.requestPermissions();
      rememberNativePermission(requested.display);
      return requested.display;
    } catch (error) {
      console.warn('Native notification permission unavailable:', error);
      rememberNativePermission('denied');
      return 'denied';
    }
  }

  if (!canUseBrowserNotifications()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;

  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
};

export const showOrderNotification = async ({
  title,
  body,
  tag,
  url = '/',
  icon = '/wen-icon.png',
  badge,
  threadKey,
  autoDismissAfterMs = 0
}) => {
  if (isNativeApp()) {
    try {
      const permission = await LocalNotifications.checkPermissions();
      rememberNativePermission(permission.display);
      if (permission.display !== 'granted') return false;

      await ensureNativeChannel();
      await ensureNativeActionListener();
      const notification = {
        id: makeNativeNotificationId(),
        title,
        body,
        autoCancel: true,
        ongoing: false,
        group: 'wenappliances-alerts',
        extra: { url, tag, threadKey },
        iconColor: '#9C6644'
      };

      if (Number.isFinite(badge)) notification.badge = Math.max(0, Math.floor(badge));
      if (Capacitor.getPlatform() === 'android') notification.channelId = NATIVE_CHANNEL_ID;
      await LocalNotifications.schedule({ notifications: [notification] });

      if (autoDismissAfterMs > 0 && threadKey) {
        window.setTimeout(() => {
          void clearNativeChatNotifications({ threadKey });
        }, autoDismissAfterMs);
      }
      return true;
    } catch (error) {
      console.warn('Native notification unavailable:', error);
      return false;
    }
  }

  if (!canUseBrowserNotifications() || Notification.permission !== 'granted') return false;

  const options = {
    body,
    icon,
    badge: icon,
    tag,
    renotify: true,
    silent: false,
    data: { url }
  };

  try {
    if ('serviceWorker' in navigator) {
      // getRegistration() resolves immediately when the storefront has no
      // service worker, allowing the native Notification fallback below.
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration?.showNotification) {
        await registration.showNotification(title, options);
        return true;
      }
    }
  } catch (error) {
    console.warn('Service-worker notification unavailable:', error);
  }

  try {
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      window.location.href = url;
      notification.close();
    };
    return true;
  } catch (error) {
    console.warn('Browser notification unavailable:', error);
    return false;
  }
};

export const showChatNotification = async ({
  isAdmin = false,
  productName,
  content,
  tag,
  url,
  badge,
  threadKey,
  autoDismissAfterMs = 0
}) => showOrderNotification({
  title: isAdmin ? 'New customer message' : `WenAppliances · ${productName || 'Product chat'}`,
  body: isAdmin
    ? `${productName || 'A customer'}: ${String(content || '').trim()}`
    : `A reply is waiting about ${productName || 'your product'}: ${String(content || '').trim()}`,
  tag,
  url,
  icon: '/wen-icon.png',
  badge,
  threadKey,
  autoDismissAfterMs
});

export const clearNativeChatNotifications = async ({ threadKey } = {}) => {
  if (!isNativeApp()) return;

  try {
    const { notifications = [] } = await LocalNotifications.getDeliveredNotifications();
    const ids = notifications
      .filter((notification) => !threadKey || notification?.extra?.threadKey === threadKey)
      .map((notification) => notification.id)
      .filter((id) => Number.isInteger(id));

    if (ids.length > 0) {
      await LocalNotifications.removeDeliveredNotificationsById({ ids });
    }
  } catch (error) {
    console.warn('Native notification cleanup unavailable:', error);
  }
};

export const rememberOrderForNotifications = (orderId, email) => {
  const normalizedId = String(orderId || '').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedId || !normalizedEmail || typeof window === 'undefined') return;

  try {
    const existing = getTrackedOrders();
    const next = [
      { id: normalizedId, email: normalizedEmail },
      ...existing.filter((order) => order.id !== normalizedId)
    ].slice(0, 20);
    window.localStorage.setItem(TRACKED_ORDERS_KEY, JSON.stringify(next));
  } catch {
    // Continue without local notification tracking if storage is unavailable.
  }
};

export const getTrackedOrders = () => {
  if (typeof window === 'undefined') return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(TRACKED_ORDERS_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((order) => order?.id && order?.email).map((order) => ({
      id: String(order.id),
      email: String(order.email).trim().toLowerCase()
    }));
  } catch {
    return [];
  }
};
