import { Capacitor } from '@capacitor/core';

export const isNativePlatform = () => Capacitor.isNativePlatform();

export const triggerLightHaptic = async () => {
  if (!isNativePlatform()) return;

  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch (error) {
    console.warn('Admin haptic feedback is unavailable.', error);
  }
};

export const triggerSuccessHaptic = async () => {
  if (!isNativePlatform()) return;

  try {
    const { Haptics, NotificationType } = await import('@capacitor/haptics');
    await Haptics.notification({ type: NotificationType.Success });
  } catch (error) {
    console.warn('Admin success haptic feedback is unavailable.', error);
  }
};

export const configureNativeKeyboard = async () => {
  if (!isNativePlatform()) return;

  try {
    const { Keyboard, KeyboardResize } = await import('@capacitor/keyboard');
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native });
  } catch (error) {
    console.warn('Native keyboard resizing is unavailable.', error);
  }
};

export const setNativeAdminStatusBar = async (theme) => {
  if (!isNativePlatform()) return;

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    const isDark = theme === 'dark';
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setBackgroundColor({ color: isDark ? '#17191C' : '#F7F7F5' });
    await StatusBar.setStyle({ style: isDark ? Style.Light : Style.Dark });
  } catch (error) {
    console.warn('Native status-bar theming is unavailable.', error);
  }
};

export const watchNativeNetwork = async (onStatusChange) => {
  const handleBrowserOnline = () => onStatusChange(true);
  const handleBrowserOffline = () => onStatusChange(false);

  window.addEventListener('online', handleBrowserOnline);
  window.addEventListener('offline', handleBrowserOffline);
  onStatusChange(window.navigator.onLine);

  let nativeListener;
  if (isNativePlatform()) {
    try {
      const { Network } = await import('@capacitor/network');
      const currentStatus = await Network.getStatus();
      onStatusChange(currentStatus.connected);
      nativeListener = await Network.addListener('networkStatusChange', (status) => {
        onStatusChange(status.connected);
      });
    } catch (error) {
      console.warn('Native network monitoring is unavailable.', error);
    }
  }

  return async () => {
    window.removeEventListener('online', handleBrowserOnline);
    window.removeEventListener('offline', handleBrowserOffline);
    await nativeListener?.remove();
  };
};
