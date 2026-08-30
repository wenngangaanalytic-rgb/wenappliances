import { chatSupabase } from './supabaseClient';

export const CHAT_SESSION_KEY = 'chat_session_id';
export const CHAT_MESSAGE_COLUMNS = 'id, created_at, sender_role, content, session_id, product_id, product_name, is_read, owner_id';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const createUuid = () => {
  if (typeof window !== 'undefined' && typeof window.crypto?.randomUUID === 'function') return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.random() * 16 | 0;
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

export const getChatSessionId = () => {
  try {
    const storedId = window.localStorage.getItem(CHAT_SESSION_KEY);
    if (storedId && UUID_PATTERN.test(storedId)) return storedId;

    const newId = createUuid();
    window.localStorage.setItem(CHAT_SESSION_KEY, newId);
    return newId;
  } catch {
    return createUuid();
  }
};

export const ensureChatIdentity = async () => {
  const { data: sessionData } = await chatSupabase.auth.getSession();
  if (sessionData?.session?.user?.is_anonymous) return sessionData.session.user;

  if (sessionData?.session?.user) await chatSupabase.auth.signOut();

  const { data, error } = await chatSupabase.auth.signInAnonymously();
  if (error || !data?.user) {
    throw new Error('Chat is temporarily unavailable. Please try again shortly.');
  }

  return data.user;
};
