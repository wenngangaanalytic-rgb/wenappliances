import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Bell, Check, ChevronDown, LoaderCircle, MessageSquare, RefreshCw, Search, Send, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from './supabaseClient';
import { emitChatActivity } from './chatActivity';

const MESSAGE_COLUMNS = 'id, created_at, sender_role, content, session_id, product_id, product_name, is_read, owner_id';
const MAX_MESSAGE_LENGTH = 2000;

const getThreadKey = (message) => `${message.session_id}::${message.product_id}`;

const sortMessages = (messages) => [...messages].sort((left, right) => (
  new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
));

const makeThread = (messages) => {
  const orderedMessages = sortMessages(messages);
  const latestMessage = orderedMessages[orderedMessages.length - 1];
  const firstMessage = orderedMessages[0];

  return {
    key: getThreadKey(firstMessage),
    sessionId: firstMessage.session_id,
    productId: firstMessage.product_id,
    productName: latestMessage.product_name || firstMessage.product_name || 'Unnamed product',
    ownerId: latestMessage.owner_id || firstMessage.owner_id,
    messages: orderedMessages,
    unreadCount: orderedMessages.filter((message) => message.sender_role === 'customer' && !message.is_read).length,
    lastMessageAt: latestMessage.created_at
  };
};

const buildThreads = (rows) => {
  const grouped = new Map();

  rows.forEach((message) => {
    if (!message.session_id || !message.product_id) return;
    const key = getThreadKey(message);
    const current = grouped.get(key) || [];
    grouped.set(key, [...current, message]);
  });

  return [...grouped.values()]
    .map(makeThread)
    .sort((left, right) => new Date(right.lastMessageAt).getTime() - new Date(left.lastMessageAt).getTime());
};

const appendToThread = (thread, message, markRead = false) => {
  if (thread.messages.some((currentMessage) => currentMessage.id === message.id)) return thread;

  const nextMessage = markRead ? { ...message, is_read: true } : message;
  const messages = sortMessages([...thread.messages, nextMessage]);
  return {
    ...thread,
    productName: nextMessage.product_name || thread.productName,
    ownerId: nextMessage.owner_id || thread.ownerId,
    messages,
    unreadCount: messages.filter((currentMessage) => currentMessage.sender_role === 'customer' && !currentMessage.is_read).length,
    lastMessageAt: messages[messages.length - 1].created_at
  };
};

const formatMessageTime = (value) => {
  if (!value) return '';
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

const formatDateHeading = (value) => {
  if (!value) return '';
  return new Date(value).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
};

const formatSessionLabel = (sessionId) => `User ${(sessionId || '').replace(/^chat-/i, '').slice(0, 4) || 'guest'}`;

const getRequestedThreadKey = () => {
  try {
    return new URLSearchParams(window.location.search).get('thread') || '';
  } catch {
    return '';
  }
};

export default function AdminProductChat() {
  const [threads, setThreads] = useState([]);
  const [activeThreadKey, setActiveThreadKey] = useState('');
  const [replyDraft, setReplyDraft] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [isOtherPartyTyping, setIsOtherPartyTyping] = useState(false);
  const [isThreadPickerOpen, setIsThreadPickerOpen] = useState(false);
  const [threadSearch, setThreadSearch] = useState('');
  const [isProductDetailsOpen, setIsProductDetailsOpen] = useState(false);
  const activeThreadKeyRef = useRef(activeThreadKey);
  const messagesEndRef = useRef(null);
  const replyInputRef = useRef(null);
  const typingChannelRef = useRef(null);
  const typingActiveRef = useRef(false);
  const typingStopTimeoutRef = useRef(null);
  const incomingTypingTimeoutRef = useRef(null);

  useEffect(() => {
    activeThreadKeyRef.current = activeThreadKey;
  }, [activeThreadKey]);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.key === activeThreadKey) || null,
    [activeThreadKey, threads]
  );

  const filteredThreads = useMemo(() => {
    const normalizedSearch = threadSearch.trim().toLowerCase();
    if (!normalizedSearch) return threads;
    return threads.filter((thread) => {
      const latestMessage = thread.messages[thread.messages.length - 1]?.content || '';
      return [thread.productName, thread.sessionId, latestMessage]
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    });
  }, [threadSearch, threads]);

  useEffect(() => {
    setIsProductDetailsOpen(false);
  }, [activeThreadKey]);

  useEffect(() => {
    emitChatActivity({
      isOpen: Boolean(activeThread),
      isAdmin: true,
      sessionId: activeThread?.sessionId,
      productId: activeThread?.productId
    });

    return () => emitChatActivity({
      isOpen: false,
      isAdmin: true,
      sessionId: activeThread?.sessionId,
      productId: activeThread?.productId
    });
  }, [activeThread?.key]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeThread?.messages, activeThreadKey, isOtherPartyTyping]);

  useEffect(() => {
    const input = replyInputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 128)}px`;
  }, [replyDraft]);

  useEffect(() => {
    if (!isThreadPickerOpen) return undefined;

    const handleEscape = (event) => {
      if (event.key === 'Escape') setIsThreadPickerOpen(false);
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isThreadPickerOpen]);

  useEffect(() => {
    const thread = activeThread;
    setIsOtherPartyTyping(false);
    typingActiveRef.current = false;
    if (typingStopTimeoutRef.current) clearTimeout(typingStopTimeoutRef.current);
    if (incomingTypingTimeoutRef.current) clearTimeout(incomingTypingTimeoutRef.current);

    if (!thread) {
      typingChannelRef.current = null;
      return undefined;
    }

    const channel = supabase
      .channel(`product-chat-${thread.sessionId}-${thread.productId}`)
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload?.sender_role !== 'customer') return;
        const typing = Boolean(payload.isTyping);
        setIsOtherPartyTyping(typing);
        if (incomingTypingTimeoutRef.current) clearTimeout(incomingTypingTimeoutRef.current);
        if (typing) {
          incomingTypingTimeoutRef.current = setTimeout(() => setIsOtherPartyTyping(false), 2200);
        }
      })
      .subscribe();

    typingChannelRef.current = channel;

    return () => {
      if (typingStopTimeoutRef.current) clearTimeout(typingStopTimeoutRef.current);
      if (incomingTypingTimeoutRef.current) clearTimeout(incomingTypingTimeoutRef.current);
      typingActiveRef.current = false;
      if (typingChannelRef.current === channel) typingChannelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [activeThread?.key]);

  const broadcastTyping = (isTyping) => {
    const channel = typingChannelRef.current;
    if (!channel) return;

    if (typingActiveRef.current !== isTyping) {
      typingActiveRef.current = isTyping;
      void channel.send({
        type: 'broadcast',
        event: 'typing',
        payload: { sender_role: 'admin', isTyping }
      });
    }

    if (typingStopTimeoutRef.current) clearTimeout(typingStopTimeoutRef.current);
    if (isTyping) {
      typingStopTimeoutRef.current = setTimeout(() => broadcastTyping(false), 1800);
    }
  };

  useEffect(() => {
    let active = true;

    const loadThreads = async () => {
      setIsLoading(true);
      setError('');

      const { data, error: fetchError } = await supabase
        .from('messages')
        .select(MESSAGE_COLUMNS)
        .order('created_at', { ascending: true });

      if (!active) return;

      if (fetchError) {
        setThreads([]);
        setError(fetchError.message || 'Unable to load product chats.');
        toast.error(fetchError.message || 'Unable to load product chats.');
      } else {
        const nextThreads = buildThreads(data ?? []);
        setThreads(nextThreads);
        const requestedThreadKey = getRequestedThreadKey();
        setActiveThreadKey((currentKey) => (
          requestedThreadKey && nextThreads.some((thread) => thread.key === requestedThreadKey)
            ? requestedThreadKey
            : currentKey && nextThreads.some((thread) => thread.key === currentKey)
              ? currentKey
            : nextThreads[0]?.key || ''
        ));
      }

      setIsLoading(false);
    };

    const handleRealtimeMessage = async (incomingMessage) => {
      if (!incomingMessage?.session_id || !incomingMessage?.product_id) return;

      const threadKey = getThreadKey(incomingMessage);
      const isCurrentThread = activeThreadKeyRef.current === threadKey;
      const shouldMarkRead = isCurrentThread && incomingMessage.sender_role === 'customer';

      setThreads((currentThreads) => {
        const existingThread = currentThreads.find((thread) => thread.key === threadKey);
        if (!existingThread) {
          const newThread = makeThread([shouldMarkRead ? { ...incomingMessage, is_read: true } : incomingMessage]);
          return [newThread, ...currentThreads];
        }

        const updatedThread = appendToThread(existingThread, incomingMessage, shouldMarkRead);
        return [updatedThread, ...currentThreads.filter((thread) => thread.key !== threadKey)]
          .sort((left, right) => new Date(right.lastMessageAt).getTime() - new Date(left.lastMessageAt).getTime());
      });

      if (shouldMarkRead) {
        const { error: updateError } = await supabase
          .from('messages')
          .update({ is_read: true })
          .eq('id', incomingMessage.id)
          .eq('session_id', incomingMessage.session_id)
          .eq('product_id', incomingMessage.product_id)
          .eq('sender_role', 'customer');

        if (updateError) console.warn('Could not mark incoming chat message as read.', updateError);
      }
    };

    loadThreads();

    const channel = supabase
      .channel(`admin-product-chat-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        ({ new: incomingMessage }) => { void handleRealtimeMessage(incomingMessage); }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  const markThreadRead = async (thread) => {
    setActiveThreadKey(thread.key);

    if (!thread.unreadCount) return;

    const { error: updateError } = await supabase
      .from('messages')
      .update({ is_read: true })
      .eq('session_id', thread.sessionId)
      .eq('product_id', thread.productId)
      .eq('sender_role', 'customer')
      .eq('is_read', false);

    if (updateError) {
      toast.error(updateError.message || 'Unable to mark this chat as read.');
      return;
    }

    setThreads((currentThreads) => currentThreads.map((currentThread) => {
      if (currentThread.key !== thread.key) return currentThread;
      return {
        ...currentThread,
        unreadCount: 0,
        messages: currentThread.messages.map((message) => (
          message.sender_role === 'customer' ? { ...message, is_read: true } : message
        ))
      };
    }));
  };

  const sendReply = async (event) => {
    event.preventDefault();
    const content = replyDraft.trim();
    if (!activeThread || !content || isSending) return;
    if (content.length > MAX_MESSAGE_LENGTH) {
      toast.error(`Please keep your reply under ${MAX_MESSAGE_LENGTH} characters.`);
      return;
    }

    broadcastTyping(false);
    setIsSending(true);
    try {
      const { data, error: insertError } = await supabase
        .from('messages')
        .insert({
          sender_role: 'admin',
          content,
          session_id: activeThread.sessionId,
          product_id: activeThread.productId,
          product_name: activeThread.productName,
          is_read: false,
          owner_id: activeThread.ownerId
        })
        .select(MESSAGE_COLUMNS)
        .single();

      if (insertError) throw insertError;

      if (data) {
        setThreads((currentThreads) => currentThreads.map((thread) => (
          thread.key === activeThread.key ? appendToThread(thread, data) : thread
        )));
      }
      setReplyDraft('');
    } catch (sendError) {
      toast.error(sendError?.message || 'Unable to send your reply.');
    } finally {
      setIsSending(false);
    }
  };

  const threadPickerOverlay = isThreadPickerOpen && typeof document !== 'undefined' && createPortal(
    <div className="fixed inset-0 z-[140] lg:hidden" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        onClick={() => setIsThreadPickerOpen(false)}
        aria-label="Close active thread picker"
      />
      <section
        className="admin-product-chat__picker absolute inset-x-3 bottom-3 flex max-h-[min(76dvh,560px)] flex-col overflow-hidden rounded-[2rem] border border-stone-200 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-thread-picker-title"
      >
         <header className="flex shrink-0 items-center justify-between border-b border-stone-200 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9C6644]">Customer support</p>
             <h2 id="admin-thread-picker-title" className="mt-1 text-lg font-semibold text-gray-900">Choose a conversation</h2>
          </div>
          <button
            type="button"
            onClick={() => setIsThreadPickerOpen(false)}
             className="rounded-full p-2 text-gray-500 transition hover:bg-stone-100 hover:text-gray-900"
            aria-label="Close conversation picker"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>
         <div className="min-h-0 grow overflow-y-auto overscroll-contain p-3" role="listbox" aria-label="Active product conversations">
           {filteredThreads.map((thread) => {
            const isSelected = activeThreadKey === thread.key;
            return (
              <button
                type="button"
                key={thread.key}
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  setIsThreadPickerOpen(false);
                  void markThreadRead(thread);
                }}
                 className={`admin-product-chat__picker-row mb-2 flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition last:mb-0 ${isSelected ? 'border-[#c2a792] bg-[#f5f5f7]' : 'border-stone-200 bg-white hover:border-[#c2a792] hover:bg-[#f5f5f7]'}`}
              >
                 <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${isSelected ? 'bg-[#c2a792] text-white' : 'bg-stone-100 text-stone-500'}`}>
                  {isSelected ? <Check className="h-4 w-4" aria-hidden="true" /> : <MessageSquare className="h-4 w-4" aria-hidden="true" />}
                </span>
                <span className="min-w-0 grow">
                   <span className="block truncate text-sm font-semibold text-gray-900">{thread.productName}</span>
                   <span className="mt-1 block text-xs text-gray-400">{formatSessionLabel(thread.sessionId)}</span>
                   <span className={`mt-1 block truncate text-xs ${thread.unreadCount > 0 ? 'font-medium text-gray-900' : 'text-gray-400'}`}>{thread.messages[thread.messages.length - 1]?.content || 'No messages yet'}</span>
                </span>
                {thread.unreadCount > 0 && (
                   <span className="inline-flex min-w-6 shrink-0 items-center justify-center rounded-full bg-[#c2a792] px-2 py-1 text-[10px] font-bold text-white" aria-label={`${thread.unreadCount} unread messages`}>
                    {thread.unreadCount > 9 ? '9+' : thread.unreadCount}
                  </span>
                )}
              </button>
            );
           })}
           {!filteredThreads.length && <p className="p-6 text-center text-sm text-gray-500">No matching conversations.</p>}
         </div>
      </section>
    </div>,
    document.body
  );

  return (
    <section className="admin-product-chat space-y-5" aria-labelledby="admin-product-chat-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-[#9C6644]">Customer support</p>
          <h1 id="admin-product-chat-title" className="mt-1 flex items-center gap-2 text-2xl font-bold text-gray-900"><MessageSquare className="h-6 w-6 text-[#9C6644]" /> Product chats</h1>
          <p className="mt-1 text-sm text-gray-500">Keep every product conversation separate and respond in real time.</p>
        </div>
        <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3.5 py-2 text-sm font-semibold text-gray-600 shadow-sm transition hover:border-[#c2a792] hover:text-gray-900"><RefreshCw className="h-4 w-4" /> Refresh</button>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">{error}</div>}

      {threads.length > 0 && (
        <div className="admin-product-chat__mobile-toolbar rounded-[1.5rem] border border-stone-200 bg-white p-4 shadow-sm lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9C6644]">Inbox</p>
              <h2 className="mt-1 text-lg font-semibold text-gray-900">Messages</h2>
            </div>
            {threads.some((thread) => thread.unreadCount > 0) && <Bell className="h-5 w-5 text-[#c2a792]" aria-label="Unread customer messages" />}
          </div>
          <label className="relative mt-3 block" htmlFor="admin-product-chat-search-mobile">
            <span className="sr-only">Search conversations</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <input id="admin-product-chat-search-mobile" type="search" value={threadSearch} onChange={(event) => setThreadSearch(event.target.value)} placeholder="Search messages" className="w-full rounded-full border-0 bg-[#F5F5F7] py-3 pl-11 pr-4 text-sm text-gray-900 outline-none ring-1 ring-inset ring-transparent transition placeholder:text-gray-400 focus:ring-[#c2a792]" />
          </label>
          <div className="mt-3 flex items-center gap-2">
            <button
              id="admin-product-chat-thread"
              type="button"
              onClick={() => setIsThreadPickerOpen(true)}
              className="admin-product-chat__thread-trigger flex min-w-0 grow items-center gap-3 rounded-2xl border border-[#c2a792] bg-[#F5F5F7] px-3.5 py-3 text-left text-sm text-gray-900 outline-none transition hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-[#c2a792]"
              aria-label="Select active product chat"
              aria-haspopup="listbox"
              aria-expanded={isThreadPickerOpen}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-stone-100 text-stone-500"><MessageSquare className="h-4 w-4" aria-hidden="true" /></span>
              <span className="min-w-0 grow">
                <span className="block truncate font-semibold">{activeThread?.productName || 'Choose a conversation'}</span>
                {activeThread && <span className="mt-0.5 block truncate text-xs text-gray-400">{formatSessionLabel(activeThread.sessionId)}</span>}
              </span>
              <ChevronDown className={`h-5 w-5 shrink-0 text-gray-500 transition-transform ${isThreadPickerOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {activeThread?.unreadCount > 0 && <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-[#c2a792] px-2 py-1 text-[10px] font-bold text-white" aria-label={`${activeThread.unreadCount} unread messages`}>{activeThread.unreadCount > 9 ? '9+' : activeThread.unreadCount}</span>}
          </div>
        </div>
      )}

      <div className="admin-product-chat__workspace grid h-[min(720px,calc(100dvh-14rem))] min-h-[460px] overflow-hidden rounded-[2rem] border border-stone-200 bg-white shadow-sm lg:h-[600px] lg:min-h-[600px] lg:grid-cols-[minmax(250px,31%)_1fr]">
        <aside className="admin-product-chat__list hidden min-h-0 flex-col border-b border-stone-200 lg:flex lg:border-b-0 lg:border-r" aria-label="Product chat threads">
          <div className="sticky top-0 z-10 shrink-0 border-b border-stone-200 bg-white px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9C6644]">Inbox</p>
                <h2 className="mt-1 text-lg font-semibold text-gray-900">Messages</h2>
                <p className="mt-1 text-xs text-gray-400">{threads.length} product conversation{threads.length === 1 ? '' : 's'}</p>
              </div>
              {threads.some((thread) => thread.unreadCount > 0) && <Bell className="h-5 w-5 text-[#c2a792]" aria-label="Unread customer messages" />}
            </div>
            <label className="relative mt-4 block" htmlFor="admin-product-chat-search">
              <span className="sr-only">Search conversations</span>
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
              <input id="admin-product-chat-search" type="search" value={threadSearch} onChange={(event) => setThreadSearch(event.target.value)} placeholder="Search messages" className="w-full rounded-full border-0 bg-[#F5F5F7] py-3 pl-11 pr-4 text-sm text-gray-900 outline-none ring-1 ring-inset ring-transparent transition placeholder:text-gray-400 focus:ring-[#c2a792]" />
            </label>
          </div>
          <div className="min-h-0 grow overflow-y-auto overscroll-contain">
            {isLoading && <div className="flex items-center justify-center gap-2 p-6 text-sm text-gray-500"><LoaderCircle className="h-4 w-4 animate-spin" /> Loading threads...</div>}
            {!isLoading && !threads.length && <p className="p-6 text-center text-sm text-gray-500">No product conversations yet.</p>}
            {!isLoading && !filteredThreads.length && threads.length > 0 && <p className="p-6 text-center text-sm text-gray-500">No matching conversations.</p>}
            {!isLoading && filteredThreads.map((thread) => {
              const latestMessage = thread.messages[thread.messages.length - 1];
              const isSelected = activeThreadKey === thread.key;
              return (
                <button
                  type="button"
                  key={thread.key}
                  onClick={() => { void markThreadRead(thread); }}
                  className={`admin-product-chat__thread-row flex w-full items-start gap-3 border-b border-stone-100 px-5 py-4 text-left transition hover:bg-[#F5F5F7] ${isSelected ? 'bg-[#F5F5F7]' : ''}`}
                  aria-pressed={isSelected}
                >
                  <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-stone-100 text-stone-500"><MessageSquare className="h-4 w-4" aria-hidden="true" />{thread.unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#c2a792] px-1 text-[9px] font-bold text-white" aria-label={`${thread.unreadCount} unread messages`}>{thread.unreadCount > 9 ? '9+' : thread.unreadCount}</span>}</span>
                  <span className="min-w-0 grow">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-gray-900">{thread.productName}</span>
                      <span className="shrink-0 text-[10px] text-gray-400">{formatMessageTime(thread.lastMessageAt)}</span>
                    </span>
                    <span className="mt-1 block truncate text-xs font-medium text-gray-500">{formatSessionLabel(thread.sessionId)}</span>
                    <span className={`mt-1 block truncate text-xs ${thread.unreadCount > 0 ? 'font-medium text-gray-900' : 'text-gray-400'}`}>{latestMessage?.content || 'No messages yet'}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="admin-product-chat__conversation flex min-h-0 min-w-0 flex-col bg-white">
          {!activeThread && (
            <div className="flex grow flex-col items-center justify-center gap-3 bg-[#F5F5F7] p-8 text-center text-sm text-gray-500"><span className="grid h-12 w-12 place-items-center rounded-full bg-stone-100 text-stone-500"><MessageSquare className="h-5 w-5" aria-hidden="true" /></span>Select a product chat to view the conversation.</div>
          )}
          {activeThread && (
            <>
              <header className="admin-product-chat__chat-header sticky top-0 z-20 flex shrink-0 items-center gap-3 border-b border-stone-200 bg-white px-4 py-3.5 sm:px-5">
                <button type="button" onClick={() => { setActiveThreadKey(''); setIsProductDetailsOpen(false); }} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-gray-500 transition hover:bg-[#F5F5F7] hover:text-gray-900" aria-label="Back to messages"><ArrowLeft className="h-5 w-5" aria-hidden="true" /></button>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-stone-100 text-stone-500"><MessageSquare className="h-4 w-4" aria-hidden="true" /></span>
                <div className="min-w-0 grow text-center">
                  <h2 className="truncate text-sm font-semibold text-gray-900">{formatSessionLabel(activeThread.sessionId)}</h2>
                  <button type="button" onClick={() => setIsProductDetailsOpen((open) => !open)} className="mx-auto mt-0.5 inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-gray-500 transition hover:bg-[#F5F5F7] hover:text-gray-900" aria-expanded={isProductDetailsOpen} aria-controls="admin-product-chat-product-details"><span className="truncate">{activeThread.productName}</span><ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${isProductDetailsOpen ? 'rotate-180' : ''}`} aria-hidden="true" /></button>
                </div>
                <button type="button" onClick={() => window.location.reload()} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-gray-400 transition hover:bg-[#F5F5F7] hover:text-gray-900" aria-label="Refresh chat"><RefreshCw className="h-4 w-4" aria-hidden="true" /></button>
              </header>

              {isProductDetailsOpen && <div id="admin-product-chat-product-details" className="admin-product-chat__product-details shrink-0 border-b border-stone-200 bg-stone-50 px-5 py-3 text-xs text-gray-500"><p className="font-semibold text-gray-900">{activeThread.productName}</p><p className="mt-1 break-all">Product ID: {activeThread.productId}</p><p className="mt-1">Customer: {formatSessionLabel(activeThread.sessionId)}</p></div>}

              <div className="admin-product-chat__messages min-h-0 grow space-y-4 overflow-y-auto overscroll-contain bg-gray-50/30 p-4 sm:p-5" aria-live="polite">
                <div className="flex justify-center"><span className="rounded-full bg-white px-3 py-1 text-[10px] font-medium text-gray-400 shadow-sm ring-1 ring-inset ring-stone-200">{formatDateHeading(activeThread.messages[0]?.created_at)}</span></div>
                {activeThread.messages.map((message) => {
                  const isCustomerMessage = message.sender_role === 'customer';
                  return (
                    <div key={message.id} className={`flex ${isCustomerMessage ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[85%] ${isCustomerMessage ? 'items-start' : 'items-end'} flex flex-col`}>
                        <div className={`rounded-2xl px-4 py-3 text-sm shadow-sm ${isCustomerMessage ? 'rounded-tl-sm border border-stone-200 bg-white text-gray-900' : 'rounded-tr-sm bg-stone-800 text-white'}`}>
                          <p className="whitespace-pre-wrap break-words">{message.content}</p>
                        </div>
                        <p className={`mt-1 text-[10px] ${isCustomerMessage ? 'admin-chat-customer-time text-left' : 'text-right text-gray-400'}`}>{formatMessageTime(message.created_at)}</p>
                      </div>
                    </div>
                  );
                })}
                {isOtherPartyTyping && (
                  <div className="flex justify-start" aria-live="polite">
                    <div className="admin-chat-typing inline-flex items-center gap-2 rounded-2xl rounded-tl-sm border border-stone-200 bg-white px-4 py-3 text-xs shadow-sm">
                      <span>Customer is typing</span>
                      <span className="inline-flex items-center gap-1" aria-hidden="true"><span className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-current" /><span className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-current" /><span className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-current" /></span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={sendReply} className="admin-product-chat__composer shrink-0 border-t border-stone-200 bg-white p-3 sm:p-4">
                <label htmlFor="admin-product-chat-reply" className="sr-only">Reply to customer</label>
                <div className="flex items-end gap-2 rounded-[1.5rem] bg-stone-100 p-1.5">
                  <textarea
                    id="admin-product-chat-reply"
                    ref={replyInputRef}
                    value={replyDraft}
                    onChange={(event) => {
                      setReplyDraft(event.target.value);
                      broadcastTyping(Boolean(event.target.value.trim()));
                    }}
                    onBlur={() => broadcastTyping(false)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        if (replyDraft.trim()) void sendReply(event);
                      }
                    }}
                    maxLength={MAX_MESSAGE_LENGTH}
                    rows="1"
                    placeholder="Write a reply..."
                    disabled={isSending}
                    className="admin-chat-textarea min-h-10 max-h-32 min-w-0 grow resize-none overflow-y-auto rounded-full border-0 bg-transparent px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:ring-0 disabled:opacity-60"
                  />
                  <button type="submit" disabled={isSending || !replyDraft.trim()} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#c2a792] text-white transition hover:bg-[#aa8d76] disabled:cursor-not-allowed disabled:bg-stone-300" aria-label="Send reply">
                    {isSending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </div>
                <p className="mt-1 text-center text-[10px] text-gray-400">Press Enter to send</p>
              </form>
            </>
          )}
        </main>
      </div>
      {threadPickerOverlay}
    </section>
  );
}
