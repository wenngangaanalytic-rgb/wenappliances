import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, ChevronDown, LoaderCircle, MessageSquare, RefreshCw, Send, X } from 'lucide-react';
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
        className="absolute inset-x-3 bottom-3 flex max-h-[min(76dvh,560px)] flex-col overflow-hidden rounded-3xl border border-[#34383D] bg-[#17191C] shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-thread-picker-title"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-[#34383D] px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9C6644]">Customer support</p>
            <h2 id="admin-thread-picker-title" className="mt-1 text-lg font-semibold text-[#F1F3EF]">Choose a conversation</h2>
          </div>
          <button
            type="button"
            onClick={() => setIsThreadPickerOpen(false)}
            className="rounded-full p-2 text-[#B8BAB7] transition hover:bg-[#24272A] hover:text-[#F1F3EF]"
            aria-label="Close conversation picker"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 grow overflow-y-auto overscroll-contain p-3" role="listbox" aria-label="Active product conversations">
          {threads.map((thread) => {
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
                className={`mb-2 flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition last:mb-0 ${isSelected ? 'border-[#9C6644] bg-[#2A211D]' : 'border-[#34383D] bg-[#0B0B0C] hover:border-[#9C6644]/70 hover:bg-[#1D2023]'}`}
              >
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${isSelected ? 'bg-[#9C6644] text-white' : 'bg-[#24272A] text-[#858884]'}`}>
                  {isSelected ? <Check className="h-4 w-4" aria-hidden="true" /> : <MessageSquare className="h-4 w-4" aria-hidden="true" />}
                </span>
                <span className="min-w-0 grow">
                  <span className="block truncate text-sm font-semibold text-[#F1F3EF]">{thread.productName}</span>
                  <span className="mt-1 block text-xs text-[#858884]">{formatSessionLabel(thread.sessionId)}</span>
                  <span className="mt-1 block truncate text-xs text-[#B8BAB7]">{thread.messages[thread.messages.length - 1]?.content || 'No messages yet'}</span>
                </span>
                {thread.unreadCount > 0 && (
                  <span className="inline-flex min-w-6 shrink-0 items-center justify-center rounded-full bg-red-600 px-2 py-1 text-[10px] font-bold text-white" aria-label={`${thread.unreadCount} unread messages`}>
                    {thread.unreadCount > 9 ? '9+' : thread.unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>
    </div>,
    document.body
  );

  return (
    <section className="space-y-5" aria-labelledby="admin-product-chat-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-[#9C6644]">Customer support</p>
          <h1 id="admin-product-chat-title" className="mt-1 flex items-center gap-2 text-2xl font-bold text-[#F1F3EF]"><MessageSquare className="h-6 w-6 text-[#9C6644]" /> Product chats</h1>
          <p className="mt-1 text-sm text-[#858884]">Keep every product conversation separate and respond in real time.</p>
        </div>
        <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center gap-2 rounded-lg border border-[#4A5568]/50 bg-[#17191C] px-3 py-2 text-sm font-semibold text-[#B8BAB7] transition hover:border-[#9C6644] hover:text-[#F1F3EF]"><RefreshCw className="h-4 w-4" /> Refresh</button>
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300" role="alert">{error}</div>}

      {threads.length > 0 && (
        <div className="rounded-2xl border border-[#24272A] bg-[#17191C] p-3 shadow-xl lg:hidden">
          <label htmlFor="admin-product-chat-thread" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[#858884]">Active thread</label>
          <div className="flex items-center gap-2">
            <button
              id="admin-product-chat-thread"
              type="button"
              onClick={() => setIsThreadPickerOpen(true)}
              className="flex min-w-0 grow items-center gap-3 rounded-xl border border-[#9C6644] bg-[#0B0B0C] px-3 py-2.5 text-left text-sm text-[#F1F3EF] outline-none transition hover:bg-[#1D2023] focus-visible:ring-2 focus-visible:ring-[#D8B49A]"
              aria-label="Select active product chat"
              aria-haspopup="listbox"
              aria-expanded={isThreadPickerOpen}
            >
              <span className="min-w-0 grow">
                <span className="block truncate font-semibold">{activeThread?.productName || 'Choose a conversation'}</span>
                {activeThread && <span className="mt-0.5 block truncate text-xs text-[#858884]">{formatSessionLabel(activeThread.sessionId)}</span>}
              </span>
              <ChevronDown className={`h-5 w-5 shrink-0 text-[#B8BAB7] transition-transform ${isThreadPickerOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {activeThread?.unreadCount > 0 && <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-red-600 px-2 py-1 text-[10px] font-bold text-white" aria-label={`${activeThread.unreadCount} unread messages`}>{activeThread.unreadCount > 9 ? '9+' : activeThread.unreadCount}</span>}
          </div>
        </div>
      )}

      <div className="grid h-[min(680px,calc(100dvh-14rem))] min-h-[420px] overflow-hidden rounded-2xl border border-[#24272A] bg-[#17191C] shadow-xl lg:h-[560px] lg:min-h-[560px] lg:grid-cols-[minmax(220px,30%)_1fr]">
        <aside className="hidden min-h-0 flex-col border-b border-[#24272A] lg:flex lg:border-b-0 lg:border-r" aria-label="Product chat threads">
          <div className="flex shrink-0 items-center justify-between border-b border-[#24272A] px-4 py-4">
            <div>
              <h2 className="font-semibold text-[#F1F3EF]">Active threads</h2>
              <p className="mt-1 text-xs text-[#858884]">{threads.length} product conversation{threads.length === 1 ? '' : 's'}</p>
            </div>
            {threads.some((thread) => thread.unreadCount > 0) && <Bell className="h-4 w-4 text-red-400" aria-label="Unread customer messages" />}
          </div>
          <div className="min-h-0 grow overflow-y-auto overscroll-contain">
            {isLoading && <div className="flex items-center justify-center gap-2 p-6 text-sm text-[#858884]"><LoaderCircle className="h-4 w-4 animate-spin" /> Loading threads...</div>}
            {!isLoading && !threads.length && <p className="p-6 text-center text-sm text-[#858884]">No product conversations yet.</p>}
            {!isLoading && threads.map((thread) => (
              <button
                type="button"
                key={thread.key}
                onClick={() => { void markThreadRead(thread); }}
                className={`w-full border-b border-[#24272A] px-4 py-4 text-left transition-colors hover:bg-[#1D2023] ${activeThreadKey === thread.key ? 'bg-[#24272A]' : ''}`}
                aria-pressed={activeThreadKey === thread.key}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#F1F3EF]">{thread.productName}</p>
                    <p className="mt-1 truncate font-mono text-xs text-[#858884]">{formatSessionLabel(thread.sessionId)}</p>
                  </div>
                  {thread.unreadCount > 0 && <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white" aria-label={`${thread.unreadCount} unread messages`}>{thread.unreadCount > 9 ? '9+' : thread.unreadCount}</span>}
                </div>
                <p className="mt-2 truncate text-xs text-[#858884]">{thread.messages[thread.messages.length - 1]?.content}</p>
              </button>
            ))}
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col">
          {!activeThread && (
            <div className="flex grow items-center justify-center p-8 text-center text-sm text-[#858884]">Select a product chat to view the conversation.</div>
          )}
          {activeThread && (
            <>
              <header className="shrink-0 border-b border-[#24272A] px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#9C6644]">{activeThread.productName}</p>
                <h2 className="mt-1 font-mono text-sm font-semibold text-[#F1F3EF]">{formatSessionLabel(activeThread.sessionId)}</h2>
                <p className="mt-1 text-xs text-[#858884]">Product ID: {activeThread.productId}</p>
              </header>

              <div className="min-h-0 grow space-y-4 overflow-y-auto overscroll-contain bg-[#0B0B0C] p-5" aria-live="polite">
                {activeThread.messages.map((message) => {
                  const isCustomerMessage = message.sender_role === 'customer';
                  return (
                    <div key={message.id} className={`flex ${isCustomerMessage ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-sm ${isCustomerMessage ? 'rounded-bl-md border border-[#34383D] bg-[#24272A] text-[#F1F3EF]' : 'rounded-br-md bg-[#9C6644] text-white'}`}>
                        <p className="whitespace-pre-wrap break-words">{message.content}</p>
                        <p className={`mt-1 text-[10px] ${isCustomerMessage ? 'admin-chat-customer-time' : 'text-white/70'}`}>{formatMessageTime(message.created_at)}</p>
                      </div>
                    </div>
                  );
                })}
                {isOtherPartyTyping && (
                  <div className="flex justify-start" aria-live="polite">
                    <div className="admin-chat-typing inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-[#34383D] bg-[#24272A] px-4 py-3 text-xs">
                      <span>Customer is typing</span>
                      <span className="inline-flex items-center gap-1" aria-hidden="true">
                        <span className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-current" />
                        <span className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-current" />
                        <span className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-current" />
                      </span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={sendReply} className="flex shrink-0 items-end gap-3 border-t border-[#24272A] bg-[#17191C] p-4">
                <label htmlFor="admin-product-chat-reply" className="sr-only">Reply to customer</label>
                <div className="min-w-0 grow">
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
                    className="min-h-11 max-h-32 w-full resize-none overflow-y-auto rounded-xl border border-[#34383D] bg-[#0B0B0C] px-3 py-2 text-sm text-[#F1F3EF] outline-none transition focus:border-[#9C6644] disabled:opacity-60"
                  />
                  <p className="mt-1 px-1 text-[11px] text-[#858884]">Enter to send · Shift+Enter for a new line</p>
                </div>
                <button type="submit" disabled={isSending || !replyDraft.trim()} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#9C6644] text-white transition hover:bg-[#8A5A3C] disabled:cursor-not-allowed disabled:opacity-50" aria-label="Send reply">
                  {isSending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                </button>
              </form>
            </>
          )}
        </main>
      </div>
      {threadPickerOverlay}
    </section>
  );
}
