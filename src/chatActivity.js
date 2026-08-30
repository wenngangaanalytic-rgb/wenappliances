export const CHAT_ACTIVITY_EVENT = 'wenappliances:chat-activity';

export const emitChatActivity = ({ isOpen, isAdmin, sessionId, productId }) => {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent(CHAT_ACTIVITY_EVENT, {
    detail: {
      isOpen: Boolean(isOpen),
      isAdmin: Boolean(isAdmin),
      sessionId: String(sessionId || ''),
      productId: String(productId || '')
    }
  }));
};

export const isActiveChat = (activity, message, isAdmin) => (
  Boolean(activity?.isOpen)
  && Boolean(activity?.isAdmin) === Boolean(isAdmin)
  && String(activity?.sessionId || '') === String(message?.session_id || '')
  && String(activity?.productId || '') === String(message?.product_id || '')
);
