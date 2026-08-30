const TRACKED_ORDERS_KEY = 'wenappliances:notification-orders';

export const canUseBrowserNotifications = () =>
  typeof window !== 'undefined' && 'Notification' in window;

export const getNotificationPermission = () => {
  if (!canUseBrowserNotifications()) return 'unsupported';
  return Notification.permission;
};

export const requestBrowserNotificationPermission = async () => {
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
  icon = '/wen-icon.png'
}) => {
  if (!canUseBrowserNotifications() || Notification.permission !== 'granted') return false;

  const options = {
    body,
    icon,
    badge: icon,
    tag,
    renotify: true,
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
  url
}) => showOrderNotification({
  title: isAdmin ? 'New customer message' : `WenAppliances · ${productName || 'Product chat'}`,
  body: isAdmin
    ? `${productName || 'A customer'}: ${String(content || '').trim()}`
    : `A reply is waiting about ${productName || 'your product'}: ${String(content || '').trim()}`,
  tag,
  url,
  icon: '/wen-icon.png'
});

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
