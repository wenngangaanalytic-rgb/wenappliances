import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from './supabaseClient';
import { showChatNotification } from './browserNotifications';

const saveFcmToken = async (userId, token) => {
  const normalizedToken = String(token || '').trim();
  if (!userId || !normalizedToken) return;

  const { error } = await supabase
    .from('members')
    .update({ fcm_token: normalizedToken })
    .eq('id', userId);

  if (error) throw error;
};

const getNotificationUrl = (userRole, data = {}) => {
  if (typeof data.url === 'string' && data.url.startsWith('/')) return data.url;

  const productId = encodeURIComponent(String(data.productId || ''));
  if (userRole === 'SUPER_ADMIN') {
    return `/chats?thread=${encodeURIComponent(String(data.chatId || ''))}`;
  }
  return productId ? `/product/${productId}?chat=1` : '/';
};

const showForegroundPush = async (userRole, notification) => {
  const data = notification?.data || {};
  const body = notification?.body || data.content || 'You have a new message.';
  const url = getNotificationUrl(userRole, data);

  await showChatNotification({
    isAdmin: userRole === 'SUPER_ADMIN',
    productName: data.productName || 'Product chat',
    content: body,
    tag: `fcm-${data.messageId || data.chatId || Date.now()}`,
    url,
    threadKey: data.chatId || data.productId,
    autoDismissAfterMs: 0
  });
};

export const registerNativePushNotifications = async ({ user }) => {
  if (!Capacitor.isNativePlatform() || !user?.id) return undefined;

  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const localPermission = await LocalNotifications.checkPermissions();
  if (localPermission.display !== 'granted') {
    await LocalNotifications.requestPermissions();
  }

  const permission = await PushNotifications.checkPermissions();
  const receivePermission = permission.receive === 'granted'
    ? permission.receive
    : (await PushNotifications.requestPermissions()).receive;

  if (receivePermission !== 'granted') {
    console.warn('Push notification permission was not granted.', receivePermission);
    return undefined;
  }

  const registrationHandle = await PushNotifications.addListener('registration', async ({ value }) => {
    try {
      await saveFcmToken(user.id, value);
    } catch (error) {
      console.warn('Could not save the FCM token.', error);
    }
  });

  const registrationErrorHandle = await PushNotifications.addListener('registrationError', (error) => {
    console.warn('FCM registration failed.', error);
  });

  const receivedHandle = await PushNotifications.addListener('pushNotificationReceived', (notification) => {
    void showForegroundPush(user.role, notification).catch((error) => {
      console.warn('Could not show the foreground push notification.', error);
    });
  });

  const actionHandle = await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const data = notification?.data || {};
    const url = getNotificationUrl(user.role, data);
    if (typeof window === 'undefined') return;
    const navigate = () => window.location.assign(url);
    if (document.readyState === 'complete') {
      navigate();
    } else {
      window.addEventListener('load', navigate, { once: true });
    }
  });

  // Register only after all listeners are attached so the first token event is
  // never lost on a freshly installed APK.
  await PushNotifications.register();

  return () => {
    void registrationHandle.remove();
    void registrationErrorHandle.remove();
    void receivedHandle.remove();
    void actionHandle.remove();
  };
};
