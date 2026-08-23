import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  canUseBrowserNotifications,
  getNotificationPermission,
  requestBrowserNotificationPermission,
  showOrderNotification
} from './browserNotifications';

const getDismissKey = (isAdmin) => `wenappliances:notifications-dismissed:${isAdmin ? 'admin' : 'customer'}`;

export default function OrderNotificationPrompt({ isAdmin = false, active = true }) {
  const [permission, setPermission] = useState(getNotificationPermission);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(getDismissKey(isAdmin)) === 'true');
    } catch {
      setDismissed(false);
    }
  }, [isAdmin]);

  if (!active || !canUseBrowserNotifications() || permission === 'granted' || dismissed) return null;

  const isBlocked = permission === 'denied';
  const accent = isAdmin ? 'blue' : 'copper';

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(getDismissKey(isAdmin), 'true');
    } catch {
      // Continue without persistence if browser storage is unavailable.
    }
  };

  const enable = async () => {
    const nextPermission = await requestBrowserNotificationPermission();
    setPermission(nextPermission);

    if (nextPermission === 'granted') {
      await showOrderNotification({
        title: isAdmin ? 'Admin Wen notifications enabled' : 'WenAppliances notifications enabled',
        body: isAdmin ? 'You will be alerted when a new order awaits confirmation.' : 'You will be alerted when your order is confirmed.',
        tag: `notifications-enabled-${isAdmin ? 'admin' : 'customer'}`,
        url: isAdmin ? '/orders' : '/track-order',
        icon: isAdmin ? '/admin-wen-logo.svg' : '/wenappliances-logo.svg'
      });
      dismiss();
      return;
    }

    if (nextPermission === 'denied') {
      toast.error('Notifications are blocked. Allow them in your browser site settings.');
    }
  };

  return (
    <aside className={`fixed bottom-4 left-4 z-[140] w-[min(24rem,calc(100vw-2rem))] rounded-2xl border p-4 shadow-2xl ${
      isAdmin ? 'border-blue-500/30 bg-[#111827] text-white' : 'border-[#D8B49A] bg-white text-[#111214]'
    }`} role="status" aria-live="polite">
      <button type="button" onClick={dismiss} className={`absolute right-2 top-2 rounded-md p-1 transition ${isAdmin ? 'text-slate-300 hover:bg-white/10' : 'text-[#858884] hover:bg-[#F4F3EF]'}`} aria-label="Dismiss notification prompt" title="Not now">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
      <div className="flex items-start gap-3 pr-5">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${isAdmin ? 'bg-blue-500/20 text-blue-300' : 'bg-[#9C6644]/10 text-[#9C6644]'}`}>
          <Bell className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="font-bold">{isAdmin ? 'New order alerts' : 'Order updates'}</p>
          <p className={`mt-1 text-xs ${isAdmin ? 'text-slate-300' : 'text-[#4A5568]'}`}>
            {isBlocked ? 'Notifications are blocked. Allow them in browser site settings.' : isAdmin ? 'Get a popup when a customer places an order.' : 'Get a popup when WenAppliances confirms your order.'}
          </p>
        </div>
      </div>
      {!isBlocked && <button type="button" onClick={enable} className={`mt-3 inline-flex w-full items-center justify-center rounded-lg px-3 py-2 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:shadow-lg ${accent === 'blue' ? 'bg-blue-600 hover:bg-blue-500' : 'bg-[#9C6644] hover:bg-[#8A5A3C]'}`}>
        Enable notifications
      </button>}
    </aside>
  );
}
