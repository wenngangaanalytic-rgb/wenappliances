import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, LoaderCircle, MessageSquare, RefreshCw, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from './supabaseClient';

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

export default function AdminProductChat() {
  const [threads, setThreads] = useState([]);
  const [activeThreadKey, setActiveThreadKey] = useState('');
  const [replyDraft, setReplyDraft] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const activeThreadKeyRef = useRef(activeThreadKey);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    activeThreadKeyRef.current = activeThreadKey;
  }, [activeThreadKey]);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.key === activeThreadKey) || null,
    [activeThreadKey, threads]
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeThread?.messages, activeThreadKey]);

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
        setActiveThreadKey((currentKey) => (
          currentKey && nextThreads.some((thread) => thread.key === currentKey)
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

      <div className="grid min-h-[560px] overflow-hidden rounded-2xl border border-[#24272A] bg-[#17191C] shadow-xl lg:grid-cols-[minmax(220px,30%)_1fr]">
        <aside className="border-b border-[#24272A] lg:border-b-0 lg:border-r" aria-label="Product chat threads">
          <div className="flex items-center justify-between border-b border-[#24272A] px-4 py-4">
            <div>
              <h2 className="font-semibold text-[#F1F3EF]">Active threads</h2>
              <p className="mt-1 text-xs text-[#858884]">{threads.length} product conversation{threads.length === 1 ? '' : 's'}</p>
            </div>
            {threads.some((thread) => thread.unreadCount > 0) && <Bell className="h-4 w-4 text-red-400" aria-label="Unread customer messages" />}
          </div>
          <div className="max-h-[300px] overflow-y-auto lg:max-h-[calc(100vh-280px)]">
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

        <main className="flex min-h-[560px] min-w-0 flex-col">
          {!activeThread && (
            <div className="flex grow items-center justify-center p-8 text-center text-sm text-[#858884]">Select a product chat to view the conversation.</div>
          )}
          {activeThread && (
            <>
              <header className="border-b border-[#24272A] px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#9C6644]">{activeThread.productName}</p>
                <h2 className="mt-1 font-mono text-sm font-semibold text-[#F1F3EF]">{formatSessionLabel(activeThread.sessionId)}</h2>
                <p className="mt-1 text-xs text-[#858884]">Product ID: {activeThread.productId}</p>
              </header>

              <div className="min-h-0 grow space-y-4 overflow-y-auto bg-[#0B0B0C] p-5" aria-live="polite">
                {activeThread.messages.map((message) => {
                  const isCustomerMessage = message.sender_role === 'customer';
                  return (
                    <div key={message.id} className={`flex ${isCustomerMessage ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-sm ${isCustomerMessage ? 'rounded-bl-md border border-[#34383D] bg-[#24272A] text-[#F1F3EF]' : 'rounded-br-md bg-[#9C6644] text-white'}`}>
                        <p className="whitespace-pre-wrap break-words">{message.content}</p>
                        <p className="mt-1 text-[10px] text-white/60">{formatMessageTime(message.created_at)}</p>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={sendReply} className="flex items-end gap-3 border-t border-[#24272A] bg-[#17191C] p-4">
                <label htmlFor="admin-product-chat-reply" className="sr-only">Reply to customer</label>
                <textarea id="admin-product-chat-reply" value={replyDraft} onChange={(event) => setReplyDraft(event.target.value)} maxLength={MAX_MESSAGE_LENGTH} rows="2" placeholder="Write a reply..." disabled={isSending} className="min-h-11 grow resize-y rounded-xl border border-[#34383D] bg-[#0B0B0C] px-3 py-2 text-sm text-[#F1F3EF] outline-none transition focus:border-[#9C6644] disabled:opacity-60" />
                <button type="submit" disabled={isSending || !replyDraft.trim()} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#9C6644] text-white transition hover:bg-[#8A5A3C] disabled:cursor-not-allowed disabled:opacity-50" aria-label="Send reply">
                  {isSending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                </button>
              </form>
            </>
          )}
        </main>
      </div>
    </section>
  );
}
