import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import {
  configureNativeKeyboard,
  setNativeAdminStatusBar,
  watchNativeNetwork
} from './nativeAdmin';

export default function NativeAdminController({ active, currentRoute, theme }) {
  const [isOffline, setIsOffline] = useState(false);
  const isDashboard = currentRoute === '/' || currentRoute === '/dashboard';

  useEffect(() => {
    if (!active || !Capacitor.isNativePlatform()) return undefined;

    let disposed = false;
    let backButtonListener;

    void import('@capacitor/app').then(({ App }) => {
      if (disposed) return;

      App.addListener('backButton', ({ canGoBack }) => {
        const hasHistory = canGoBack || window.history.length > 1;
        if (!isDashboard && hasHistory) {
          window.history.back();
          return;
        }

        void App.exitApp();
      }).then((listener) => {
        if (disposed) {
          void listener.remove();
          return;
        }
        backButtonListener = listener;
      });
    }).catch((error) => {
      console.warn('Native back-button handling is unavailable.', error);
    });

    return () => {
      disposed = true;
      void backButtonListener?.remove();
    };
  }, [active, isDashboard]);

  useEffect(() => {
    if (!active) return undefined;
    void configureNativeKeyboard();
    void setNativeAdminStatusBar(theme);
    return undefined;
  }, [active, theme]);

  useEffect(() => {
    if (!active) return undefined;

    let disposed = false;
    let cleanup = () => {};

    void watchNativeNetwork(setIsOffline).then((nextCleanup) => {
      if (disposed) {
        void nextCleanup();
        return;
      }
      cleanup = nextCleanup;
    });

    return () => {
      disposed = true;
      void cleanup();
    };
  }, [active]);

  if (!active || !isOffline) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[250] flex justify-center px-3 pt-[env(safe-area-inset-top)]" role="status" aria-live="polite">
      <div className="pointer-events-auto mt-2 inline-flex items-center gap-2 rounded-full border border-red-300 bg-red-700 px-4 py-2 text-xs font-semibold text-white shadow-lg">
        <WifiOff className="h-4 w-4" aria-hidden="true" />
        <span>No internet connection</span>
      </div>
    </div>
  );
}
