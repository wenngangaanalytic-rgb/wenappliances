import { useEffect } from 'react';
import { registerNativePushNotifications } from './pushNotifications';
import { Capacitor } from '@capacitor/core';
import { initializeNativeNotifications } from './browserNotifications';

export default function PushNotificationRegistration({ user, active = true }) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    void initializeNativeNotifications().catch((error) => {
      console.warn('Notification channel initialization failed.', error);
    });
  }, []);

  useEffect(() => {
    if (!active || !user?.id) return undefined;

    let disposed = false;
    let removeListeners;

    registerNativePushNotifications({ user })
      .then((cleanup) => {
        if (disposed) {
          cleanup?.();
          return;
        }
        removeListeners = cleanup;
      })
      .catch((error) => {
        console.warn('Native push notification registration unavailable.', error);
      });

    return () => {
      disposed = true;
      removeListeners?.();
    };
  }, [active, user?.id, user?.role]);

  return null;
}
