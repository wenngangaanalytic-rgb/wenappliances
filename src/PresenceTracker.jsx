import { useEffect } from 'react';
import { supabase } from './supabaseClient';

const CHANNEL_NAME = 'wenappliances:visitors';

const createGuestKey = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return `guest-${globalThis.crypto.randomUUID()}`;
  return `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export default function PresenceTracker({ user }) {
  useEffect(() => {
    const presenceKey = user?.id || createGuestKey();
    const channel = supabase.channel(CHANNEL_NAME, {
      config: { presence: { key: presenceKey } }
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({
          member_id: user?.id || null,
          online_at: new Date().toISOString()
        });
      }
    });

    return () => {
      channel.untrack().catch(() => undefined);
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  return null;
}
