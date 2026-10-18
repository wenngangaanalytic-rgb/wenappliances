import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, LoaderCircle, WifiOff } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import toast from 'react-hot-toast';
import { supabase } from './supabaseClient';
import {
  configureNativeKeyboard,
  setNativeAdminStatusBar,
  watchNativeNetwork
} from './nativeAdmin';

export default function NativeAdminController({ active, currentRoute, theme }) {
  const [connectionStatus, setConnectionStatus] = useState('checking');
  const [isRetrying, setIsRetrying] = useState(false);
  const [isBannerDismissed, setIsBannerDismissed] = useState(false);
  const connectionStatusRef = useRef('checking');
  const nativeConnectedRef = useRef(null);
  const probePromiseRef = useRef(null);
  const isDashboard = currentRoute === '/' || currentRoute === '/dashboard';

  const publishConnectionStatus = useCallback((nextStatus) => {
    const previousStatus = connectionStatusRef.current;
    connectionStatusRef.current = nextStatus;
    setConnectionStatus(nextStatus);
    window.dispatchEvent(new CustomEvent('wen:admin-connection-status', { detail: { status: nextStatus } }));
    if ((previousStatus === 'offline' || previousStatus === 'degraded') && nextStatus === 'online') {
      setIsBannerDismissed(false);
      toast.success('Connection restored. Refreshing live admin data.');
      window.dispatchEvent(new CustomEvent('wen:admin-refresh'));
    } else if (previousStatus !== nextStatus) {
      setIsBannerDismissed(false);
    }
  }, []);

  const checkSupabaseConnection = useCallback(async (manual = false) => {
    if (probePromiseRef.current) return probePromiseRef.current;
    if (manual) setIsRetrying(true);
    if (!window.navigator.onLine) {
      publishConnectionStatus('offline');
      if (manual) setIsRetrying(false);
      return false;
    }

    let timeoutId;
    const probePromise = (async () => {
      try {
        const timeout = new Promise((resolve) => {
          timeoutId = window.setTimeout(() => resolve({ error: { status: 0, message: 'Supabase connectivity check timed out.' } }), 6000);
        });
        const probe = supabase.from('products').select('id').limit(1);
        const result = await Promise.race([probe, timeout]);
        const error = result?.error;
        const errorMessage = String(error?.message || '').toLowerCase();
        const transportFailure = Boolean(error) && (
          Number(error.status) >= 500
          || Number(error.status) === 0
          || /failed to fetch|network|timeout|connection|econn|aborted/i.test(errorMessage)
        );

        if (!transportFailure) publishConnectionStatus('online');
        else if (nativeConnectedRef.current === false) publishConnectionStatus('offline');
        else publishConnectionStatus('degraded');
        return !transportFailure;
      } catch (error) {
        console.warn('Supabase connectivity probe failed.', error);
        publishConnectionStatus(nativeConnectedRef.current === false ? 'offline' : 'degraded');
        return false;
      } finally {
        window.clearTimeout(timeoutId);
        probePromiseRef.current = null;
        if (manual) setIsRetrying(false);
      }
    })();
    probePromiseRef.current = probePromise;
    return probePromise;
  }, [publishConnectionStatus]);

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

    const onNetworkChange = (connected) => {
      nativeConnectedRef.current = connected;
      if (!window.navigator.onLine) publishConnectionStatus('offline');
      else void checkSupabaseConnection();
    };

    void checkSupabaseConnection();
    const refreshTimer = window.setInterval(() => void checkSupabaseConnection(), 30000);
    void watchNativeNetwork(onNetworkChange).then((nextCleanup) => {
      if (disposed) {
        void nextCleanup();
        return;
      }
      cleanup = nextCleanup;
    });

    return () => {
      disposed = true;
      void cleanup();
      window.clearInterval(refreshTimer);
    };
  }, [active, checkSupabaseConnection, publishConnectionStatus]);

  if (!active || !['offline', 'degraded'].includes(connectionStatus) || isBannerDismissed) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[250] flex justify-center px-3 pt-[env(safe-area-inset-top)]" role="status" aria-live="polite">
      <div className={`pointer-events-auto mt-2 flex max-w-xl flex-wrap items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold text-white shadow-lg ${connectionStatus === 'offline' ? 'border-red-300 bg-red-800' : 'border-[#C08457] bg-[#70442D]'}`}>
        {connectionStatus === 'offline' ? <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />}
        <span>{connectionStatus === 'offline' ? 'No internet connection' : 'Supabase is temporarily unreachable'}</span>
        <button type="button" onClick={() => void checkSupabaseConnection(true)} disabled={isRetrying} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-white/30 px-2.5 hover:bg-white/10 disabled:opacity-60">
          {isRetrying && <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          {isRetrying ? 'Checking…' : 'Retry'}
        </button>
        <button type="button" onClick={() => setIsBannerDismissed(true)} className="rounded-lg px-2 py-1 text-white/80 underline underline-offset-2 hover:text-white" aria-label="Dismiss connection notice">Dismiss</button>
      </div>
    </div>
  );
}
