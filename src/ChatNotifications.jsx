import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Bell, BellRing, MessageCircle, Settings2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { chatSupabase, supabase } from './supabaseClient';
import { ensureChatIdentity, getChatSessionId } from './chatSession';
import {
  getNotificationPermission,
  requestBrowserNotificationPermission,
  showChatNotification
} from './browserNotifications';

const MESSAGE_COLUMNS = 'id, created_at, sender_role, content, session_id, product_id, product_name, is_read, owner_id';
const MAX_NOTIFICATION_ITEMS = 30;

const getThreadKey = (message) => `${message.session_id}::${message.product_id}`;

const getNotificationKey = (message, isAdmin) => (
  isAdmin ? getThreadKey(message) : String(message.product_id)
);

const formatNotificationTime = (value) => {
  if (!value) return '';
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

const makeNotification = (message, isAdmin, count = 1) => ({
  key: getNotificationKey(message, isAdmin),
  messageId: message.id,
  productId: String(message.product_id),
  productName: message.product_name || 'Product conversation',
  sessionId: message.session_id,
  content: message.content,
  createdAt: message.created_at,
  count,
  url: isAdmin
    ? `/chats?thread=${encodeURIComponent(getThreadKey(message))}`
    : `/product/${encodeURIComponent(message.product_id)}?chat=1`
});

const sortNotifications = (items) => [...items]
  .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
  .slice(0, MAX_NOTIFICATION_ITEMS);

const buildNotifications = (rows, isAdmin) => {
  const grouped = new Map();

  rows.forEach((message) => {
    const key = getNotificationKey(message, isAdmin);
    const current = grouped.get(key);
    grouped.set(key, current
      ? { ...makeNotification(message, isAdmin, current.count + 1) }
      : makeNotification(message, isAdmin));
  });

  return sortNotifications([...grouped.values()]);
};

const ChatNotificationContext = createContext(null);

export function ChatNotificationProvider({ isAdmin = false, active = true, children }) {
  const [notifications, setNotifications] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [permission, setPermission] = useState(getNotificationPermission);

  useEffect(() => {
    if (!active) {
      setNotifications([]);
      return undefined;
    }

    let cancelled = false;
    const client = isAdmin ? supabase : chatSupabase;
    const inboundRole = isAdmin ? 'customer' : 'admin';
    let ownerId = '';

    const refreshNotifications = async () => {
      let query = client
        .from('messages')
        .select(MESSAGE_COLUMNS)
        .eq('sender_role', inboundRole)
        .eq('is_read', false)
        .order('created_at', { ascending: false })
        .limit(200);

      if (!isAdmin) query = query.eq('owner_id', ownerId);

      const { data, error } = await query;
      if (cancelled) return;
      if (error) {
        setNotifications([]);
        return;
      }

      setNotifications(buildNotifications(data ?? [], isAdmin));
    };

    const start = async () => {
      if (!isAdmin) {
        ownerId = (await ensureChatIdentity()).id;
        if (cancelled) return;
      }

      await refreshNotifications();
      if (cancelled) return;

      const realtimeFilter = isAdmin
        ? 'sender_role=eq.customer'
        : `owner_id=eq.${ownerId}`;

      const channel = client
        .channel(`chat-notification-center-${isAdmin ? 'admin' : getChatSessionId()}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: realtimeFilter },
          ({ new: incomingMessage }) => {
            if (
              incomingMessage.sender_role !== inboundRole
              || (!isAdmin && String(incomingMessage.owner_id) !== String(ownerId))
            ) return;

            setNotifications((current) => {
              const key = getNotificationKey(incomingMessage, isAdmin);
              const existing = current.find((item) => item.key === key);
              const next = makeNotification(incomingMessage, isAdmin, (existing?.count || 0) + 1);
              return sortNotifications([next, ...current.filter((item) => item.key !== key)]);
            });

            void showChatNotification({
              isAdmin,
              productName: incomingMessage.product_name,
              content: incomingMessage.content,
              url: isAdmin
                ? `/chats?thread=${encodeURIComponent(getThreadKey(incomingMessage))}`
                : `/product/${encodeURIComponent(incomingMessage.product_id)}?chat=1`,
              tag: `chat-${isAdmin ? 'admin' : 'customer'}-${getNotificationKey(incomingMessage, isAdmin)}`
            });
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'messages', filter: realtimeFilter },
          ({ new: updatedMessage }) => {
            if (
              updatedMessage.sender_role !== inboundRole
              || (!isAdmin && String(updatedMessage.owner_id) !== String(ownerId))
            ) return;
            void refreshNotifications();
          }
        )
        .subscribe();

      return channel;
    };

    let channel;
    start()
      .then((createdChannel) => {
        if (cancelled) {
          if (createdChannel) client.removeChannel(createdChannel);
          return;
        }
        channel = createdChannel;
      })
      .catch((startError) => {
        if (!cancelled) {
          setNotifications([]);
          console.warn('Chat notification service unavailable.', startError);
        }
      });

    return () => {
      cancelled = true;
      if (channel) client.removeChannel(channel);
    };
  }, [active, isAdmin]);

  const value = useMemo(() => ({
    isAdmin,
    notifications,
    unreadCount: notifications.reduce((total, item) => total + item.count, 0),
    isOpen,
    permission,
    setIsOpen,
    setPermission,
    dismissNotification: (notification) => {
      setNotifications((current) => current.filter((item) => item.key !== notification.key));
    }
  }), [isAdmin, isOpen, notifications, permission]);

  return <ChatNotificationContext.Provider value={value}>{children}</ChatNotificationContext.Provider>;
}

export function ChatNotificationBell() {
  const notificationState = useContext(ChatNotificationContext);
  if (!notificationState) return null;

  const {
    isAdmin,
    notifications,
    unreadCount,
    isOpen,
    permission,
    setIsOpen,
    setPermission,
    dismissNotification
  } = notificationState;

  const enablePopups = async () => {
    const nextPermission = await requestBrowserNotificationPermission();
    setPermission(nextPermission);
    if (nextPermission === 'granted') toast.success('Chat pop-up notifications are enabled.');
    if (nextPermission === 'denied') toast.error('Notifications are blocked in your browser settings.');
  };

  const openNotification = (notification) => {
    dismissNotification(notification);
    setIsOpen(false);
    window.location.assign(notification.url);
  };

  return (
    <div className="relative z-[120]">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="relative inline-flex items-center justify-center rounded-full border border-[#E5E4E0] bg-white p-2 text-[#4A5568] transition hover:border-[#9C6644] hover:text-[#9C6644]"
        aria-label={unreadCount ? `Open notifications, ${unreadCount} unread` : 'Open notifications'}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        {unreadCount > 0 ? <BellRing className="h-5 w-5" aria-hidden="true" /> : <Bell className="h-5 w-5" aria-hidden="true" />}
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white ring-2 ring-white" aria-label={`${unreadCount} unread notifications`}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <section className={`absolute right-0 top-12 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border p-3 text-left shadow-2xl ${isAdmin ? 'border-[#34383D] bg-[#17191C] text-[#F1F3EF]' : 'border-[#E5E4E0] bg-white text-[#111214]'}`} role="dialog" aria-label="Notifications">
          <div className="flex items-center justify-between gap-3 border-b border-[#E5E4E0] pb-3 dark:border-[#34383D]">
            <div>
              <h2 className="font-bold">Notifications</h2>
              <p className="mt-0.5 text-xs text-[#858884]">{isAdmin ? 'Customer product chat updates' : 'Replies about products you asked about'}</p>
            </div>
            <button type="button" onClick={() => setIsOpen(false)} className="rounded-md p-1.5 text-[#858884] transition hover:bg-[#F4F3EF] hover:text-[#111214]" aria-label="Close notifications">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto py-2">
            {notifications.length === 0 && <p className="px-2 py-8 text-center text-sm text-[#858884]">No new chat notifications.</p>}
            {notifications.map((notification) => (
              <button
                type="button"
                key={notification.key}
                onClick={() => openNotification(notification)}
                className="flex w-full items-start gap-3 rounded-xl px-2 py-3 text-left transition hover:bg-[#F4F3EF] dark:hover:bg-[#24272A]"
              >
                <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${isAdmin ? 'bg-blue-500/15 text-blue-400' : 'bg-[#9C6644]/10 text-[#9C6644]'}`}>
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 grow">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{notification.productName}</span>
                    {notification.count > 1 && <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{notification.count > 9 ? '9+' : notification.count}</span>}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-[#667085]">{notification.content}</span>
                  <span className="mt-1 block text-[10px] text-[#98A2B3]">{formatNotificationTime(notification.createdAt)} · Open chat</span>
                </span>
              </button>
            ))}
          </div>

          {permission !== 'granted' && permission !== 'unsupported' && (
            <button type="button" onClick={enablePopups} className={`flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${isAdmin ? 'border-blue-500/30 text-blue-300 hover:bg-blue-500/10' : 'border-[#D8B49A] text-[#9C6644] hover:bg-[#F4F3EF]'}`}>
              <Settings2 className="h-3.5 w-3.5" aria-hidden="true" /> Enable chat pop-ups
            </button>
          )}
        </section>
      )}
    </div>
  );
}
