import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, MessageCircle, Send, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { chatSupabase } from './supabaseClient';
import { ensureChatIdentity, getChatSessionId } from './chatSession';
import { emitChatActivity } from './chatActivity';

const MAX_MESSAGE_LENGTH = 2000;

const appendUniqueMessage = (currentMessages, nextMessage) => {
  if (currentMessages.some((message) => message.id === nextMessage.id)) return currentMessages;

  return [...currentMessages, nextMessage].sort((left, right) => (
    new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  ));
};

const formatMessageTime = (value) => {
  if (!value) return '';
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

export default function ProductChatWidget({ productId, productName, inlineTrigger = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [messageDraft, setMessageDraft] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [sessionId, setSessionId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [isOtherPartyTyping, setIsOtherPartyTyping] = useState(false);
  const isOpenRef = useRef(isOpen);
  const messagesEndRef = useRef(null);
  const messageInputRef = useRef(null);
  const realtimeChannelRef = useRef(null);
  const typingActiveRef = useRef(false);
  const typingStopTimeoutRef = useRef(null);
  const incomingTypingTimeoutRef = useRef(null);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (!sessionId || !productId) return undefined;

    emitChatActivity({
      isOpen,
      isAdmin: false,
      sessionId,
      productId
    });

    return () => emitChatActivity({
      isOpen: false,
      isAdmin: false,
      sessionId,
      productId
    });
  }, [isOpen, productId, sessionId]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get('chat') === '1') setIsOpen(true);
  }, [productId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen, isOtherPartyTyping]);

  useEffect(() => {
    const input = messageInputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 128)}px`;
  }, [messageDraft]);

  useEffect(() => {
    if (!productId) return undefined;

    let cancelled = false;
    let channel;
    const currentSessionId = getChatSessionId();
    const currentProductId = String(productId);

    setSessionId(currentSessionId);
    setMessages([]);
    setUnreadCount(0);
    setIsOtherPartyTyping(false);
    setOwnerId('');
    setError('');
    setIsLoading(true);

    const loadProductChat = async () => {
      try {
        const chatUser = await ensureChatIdentity();
        if (cancelled) return;

        setOwnerId(chatUser.id);

        const { data, error: fetchError } = await chatSupabase
          .from('messages')
          .select('id, created_at, sender_role, content, session_id, product_id, product_name, is_read, owner_id')
          .eq('session_id', currentSessionId)
          .eq('product_id', currentProductId)
          .eq('owner_id', chatUser.id)
          .order('created_at', { ascending: true });

        if (fetchError) throw fetchError;
        if (cancelled) return;

        setMessages(data ?? []);

        channel = chatSupabase
          .channel(`product-chat-${currentSessionId}-${currentProductId}`)
          .on('broadcast', { event: 'typing' }, ({ payload }) => {
            if (payload?.sender_role !== 'admin') return;
            const typing = Boolean(payload.isTyping);
            setIsOtherPartyTyping(typing);
            if (incomingTypingTimeoutRef.current) clearTimeout(incomingTypingTimeoutRef.current);
            if (typing) {
              incomingTypingTimeoutRef.current = setTimeout(() => setIsOtherPartyTyping(false), 2200);
            }
          })
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'messages',
              filter: `session_id=eq.${currentSessionId}`
            },
            (payload) => {
              const incomingMessage = payload.new;

              // The Realtime filter scopes the browser session. Keep the
              // product and owner checks here as a second isolation barrier.
              if (
                String(incomingMessage.product_id) !== currentProductId
                || String(incomingMessage.owner_id) !== String(chatUser.id)
              ) return;

              setMessages((currentMessages) => appendUniqueMessage(currentMessages, incomingMessage));

              if (incomingMessage.sender_role === 'admin') {
                if (isOpenRef.current) {
                  void chatSupabase
                    .from('messages')
                    .update({ is_read: true })
                    .eq('id', incomingMessage.id)
                    .eq('owner_id', chatUser.id)
                    .eq('sender_role', 'admin');
                } else {
                  setUnreadCount((count) => count + 1);
                }
              }
            }
          )
          .subscribe();
        realtimeChannelRef.current = channel;
      } catch (loadError) {
        if (cancelled) return;
        const message = loadError?.message || 'Unable to load product chat.';
        setError(message);
        toast.error(message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadProductChat();

    return () => {
      cancelled = true;
      if (typingStopTimeoutRef.current) clearTimeout(typingStopTimeoutRef.current);
      if (incomingTypingTimeoutRef.current) clearTimeout(incomingTypingTimeoutRef.current);
      typingActiveRef.current = false;
      if (realtimeChannelRef.current === channel) realtimeChannelRef.current = null;
      if (channel) void chatSupabase.removeChannel(channel);
    };
  }, [productId]);

  useEffect(() => {
    if (!isOpen || !sessionId || !ownerId || !productId) return undefined;

    let cancelled = false;
    const markAdminMessagesRead = async () => {
      const { error: updateError } = await chatSupabase
        .from('messages')
        .update({ is_read: true })
        .eq('session_id', sessionId)
        .eq('product_id', String(productId))
        .eq('owner_id', ownerId)
        .eq('sender_role', 'admin')
        .eq('is_read', false);

      if (updateError || cancelled) return;
      setMessages((currentMessages) => currentMessages.map((message) => (
        message.sender_role === 'admin' ? { ...message, is_read: true } : message
      )));
    };

    markAdminMessagesRead();
    return () => {
      cancelled = true;
    };
  }, [isOpen, ownerId, productId, sessionId]);

  const toggleChat = () => {
    setIsOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) setUnreadCount(0);
      return nextOpen;
    });
  };

  const broadcastTyping = (isTyping) => {
    const channel = realtimeChannelRef.current;
    if (!channel) return;

    if (typingActiveRef.current !== isTyping) {
      typingActiveRef.current = isTyping;
      void channel.send({
        type: 'broadcast',
        event: 'typing',
        payload: { sender_role: 'customer', isTyping }
      });
    }

    if (typingStopTimeoutRef.current) clearTimeout(typingStopTimeoutRef.current);
    if (isTyping) {
      typingStopTimeoutRef.current = setTimeout(() => broadcastTyping(false), 1800);
    }
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    const content = messageDraft.trim();
    if (!content || !sessionId || !ownerId || isSending) return;
    if (content.length > MAX_MESSAGE_LENGTH) {
      toast.error(`Please keep your message under ${MAX_MESSAGE_LENGTH} characters.`);
      return;
    }

    broadcastTyping(false);
    setIsSending(true);
    try {
      const { data, error: insertError } = await chatSupabase
        .from('messages')
        .insert({
          sender_role: 'customer',
          content,
          session_id: sessionId,
          product_id: String(productId),
          product_name: String(productName || 'This product').trim().slice(0, 200),
          is_read: false,
          owner_id: ownerId
        })
        .select('id, created_at, sender_role, content, session_id, product_id, product_name, is_read, owner_id')
        .single();

      if (insertError) throw insertError;
      if (data) setMessages((currentMessages) => appendUniqueMessage(currentMessages, data));
      setMessageDraft('');
    } catch (sendError) {
      toast.error(sendError?.message || 'Unable to send your message.');
    } finally {
      setIsSending(false);
    }
  };

  const chatOverlay = isOpen && typeof document !== 'undefined' && createPortal(
    <>
          {inlineTrigger && (
            <button
              type="button"
              onClick={toggleChat}
              className="fixed inset-0 z-[68] bg-black/35 backdrop-blur-[1px]"
              aria-label="Close product chat"
            />
          )}
          <section id="product-chat-window" className={`flex h-[min(680px,calc(100dvh-2rem))] min-h-0 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] shrink-0 flex-col overflow-hidden rounded-2xl border border-[#E5E4E0] bg-white text-[#111214] shadow-2xl sm:w-[min(calc(100vw-2rem),500px)] ${inlineTrigger ? 'fixed left-1/2 top-1/2 z-[70] -translate-x-1/2 -translate-y-1/2' : 'fixed bottom-4 right-4 z-[70] sm:w-[min(calc(100vw-2rem),380px)]'}`} role="dialog" aria-modal="true" aria-label={`Chat about ${productName}`}>
          <header className="flex shrink-0 items-start justify-between gap-3 bg-[#111214] px-4 py-4 text-white">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#D8B49A]" aria-live="polite">
                <span>{isOtherPartyTyping ? 'Admin is typing' : 'WenAppliances support'}</span>
                {isOtherPartyTyping && (
                  <span className="inline-flex items-center gap-1" aria-hidden="true">
                    <span className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-current" />
                    <span className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-current" />
                    <span className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-current" />
                  </span>
                )}
              </p>
              <h2 className="mt-1 truncate text-base font-bold">Questions about {productName}?</h2>
            </div>
            <button type="button" onClick={toggleChat} className="rounded-lg p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white" aria-label="Close product chat">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </header>

          {isOtherPartyTyping && (
            <div className="flex shrink-0 items-center gap-2 border-b border-[#E5E4E0] bg-[#FFF9F4] px-4 py-2 text-xs font-semibold text-[#8A5A3C]" role="status" aria-live="polite">
              <span className="inline-flex items-center gap-1 rounded-full border border-[#D8B49A] bg-white px-2.5 py-1 shadow-sm">
                <span>Admin is typing</span>
                <span className="inline-flex items-center gap-1" aria-hidden="true">
                  <span className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-current" />
                  <span className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-current" />
                  <span className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-current" />
                </span>
              </span>
            </div>
          )}

          <div className="min-h-0 grow space-y-3 overflow-y-auto overscroll-contain bg-[#F8F7F4] p-4" aria-live="polite">
            {isLoading && (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-[#667085]"><LoaderCircle className="h-4 w-4 animate-spin" /> Loading chat...</div>
            )}
            {!isLoading && error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            {!isLoading && !error && messages.length === 0 && (
              <div className="rounded-xl border border-dashed border-[#D8D6CF] bg-white p-4 text-center text-sm text-[#667085]">
                Ask us anything about this appliance and we will get back to you.
              </div>
            )}
            {messages.map((message) => {
              const isCustomerMessage = message.sender_role === 'customer';
              return (
                <div key={message.id} className={`flex ${isCustomerMessage ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${isCustomerMessage ? 'rounded-br-md bg-[#111214] text-white' : 'rounded-bl-md border border-[#E5E4E0] bg-white text-[#344054]'}`}>
                    <p className="whitespace-pre-wrap break-words">{message.content}</p>
                    <p className={`mt-1 text-[10px] ${isCustomerMessage ? 'text-white/60' : 'text-[#98A2B3]'}`}>{formatMessageTime(message.created_at)}</p>
                  </div>
                </div>
              );
            })}
            {isOtherPartyTyping && (
              <div className="flex justify-start" aria-live="polite">
                <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-[#E5E4E0] bg-white px-3.5 py-2.5 text-xs text-[#667085] shadow-sm">
                  <span>Admin is typing</span>
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

          <form onSubmit={sendMessage} className="flex shrink-0 items-end gap-2 border-t border-[#E5E4E0] bg-white p-3">
            <label htmlFor="product-chat-message" className="sr-only">Message WenAppliances support</label>
            <div className="min-w-0 grow">
              <textarea
                id="product-chat-message"
                ref={messageInputRef}
                value={messageDraft}
                onChange={(event) => {
                  setMessageDraft(event.target.value);
                  broadcastTyping(Boolean(event.target.value.trim()));
                }}
                onBlur={() => broadcastTyping(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    if (messageDraft.trim()) void sendMessage(event);
                  }
                }}
                maxLength={MAX_MESSAGE_LENGTH}
                rows="1"
                placeholder="Write a question..."
                disabled={isLoading || Boolean(error) || isSending}
                className="max-h-32 min-h-10 w-full resize-none overflow-y-auto rounded-xl border border-[#E5E4E0] px-3 py-2 text-sm outline-none transition focus:border-[#9C6644] focus:ring-2 focus:ring-[#9C6644]/20 disabled:bg-[#F4F3EF]"
              />
              <p className="mt-1 px-1 text-[11px] text-[#667085]">Enter to send · Shift+Enter for a new line</p>
            </div>
            <button type="submit" disabled={isLoading || Boolean(error) || isSending || !messageDraft.trim()} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#9C6644] text-white transition hover:bg-[#8A5A3C] disabled:cursor-not-allowed disabled:opacity-50" aria-label="Send message">
              {isSending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            </button>
          </form>
          </section>
    </>,
    document.body
  );

  return (
    <>
      <div className={inlineTrigger ? 'relative inline-flex shrink-0 flex-col items-end' : 'fixed bottom-4 right-4 z-40 flex flex-col items-end'}>
      <button type="button" onClick={toggleChat} className={inlineTrigger ? 'inline-flex shrink-0 items-center gap-2 rounded-xl border border-[#9C6644] bg-[#9C6644] px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[#8A5A3C] hover:shadow-lg sm:px-4 sm:py-2.5 sm:text-sm' : 'relative grid h-14 w-14 place-items-center rounded-full bg-[#9C6644] text-white shadow-xl transition hover:bg-[#8A5A3C]'} aria-label={isOpen ? 'Close product chat' : 'Ask about product'} aria-expanded={isOpen} aria-controls="product-chat-window">
        {isOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <MessageCircle className="h-5 w-5" aria-hidden="true" />}
        {inlineTrigger && <span>{isOpen ? 'Close chat' : 'Ask about product'}</span>}
        {!inlineTrigger && !isOpen && unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white ring-2 ring-white" aria-label={`${unreadCount} unread chat messages`}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      </div>
      {chatOverlay}
    </>
  );
}
