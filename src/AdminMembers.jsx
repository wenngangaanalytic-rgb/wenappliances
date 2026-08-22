import { useEffect, useState } from 'react';
import { Calendar, LoaderCircle, Mail, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from './supabaseClient';

const PRESENCE_CHANNEL = 'wenappliances:visitors';

export default function AdminMembers() {
  const [members, setMembers] = useState([]);
  const [onlineMemberIds, setOnlineMemberIds] = useState(new Set());
  const [onlineVisitorCount, setOnlineVisitorCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    const fetchMembers = () => supabase
      .from('members')
      .select('id, email, full_name, created_at')
      .order('created_at', { ascending: false })
      .limit(500);

    const loadMembers = async () => {
      try {
        let result = await fetchMembers();

        // A role added in Supabase Auth is not visible to an already-issued JWT.
        // Refresh once and retry only when the first request is denied by RLS.
        if (result.error?.code === '42501') {
          const { error: refreshError } = await supabase.auth.refreshSession();
          if (!refreshError) result = await fetchMembers();
        }

        const { data, error: fetchError } = result;

        if (!active) return;

        if (fetchError) {
          const message = fetchError.code === '42501'
            ? 'Your administrator session needs to be refreshed. Sign out and sign in again, then reopen Members.'
            : fetchError.message || 'Unable to load members.';
          setError(message);
          toast.error(message);
        } else {
          setMembers(Array.isArray(data) ? data : []);
          setError('');
        }
      } catch (loadError) {
        if (!active) return;
        const message = loadError.message || 'Unable to load members.';
        setError(message);
        toast.error(message);
      } finally {
        if (active) setLoading(false);
      }
    };

    loadMembers();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    let channel;

    const syncOnlineMembers = () => {
      try {
        const nextOnlineIds = new Set();
        const presenceState = typeof channel?.presenceState === 'function' ? channel.presenceState() : {};
        let visitorCount = 0;

        Object.values(presenceState || {}).forEach((presenceEntries) => {
          (Array.isArray(presenceEntries) ? presenceEntries : []).forEach((presence) => {
            visitorCount += 1;
            if (presence?.member_id) nextOnlineIds.add(presence.member_id);
          });
        });

        if (active) {
          setOnlineMemberIds(nextOnlineIds);
          setOnlineVisitorCount(visitorCount);
        }
      } catch (presenceError) {
        console.warn('Presence status unavailable:', presenceError);
      }
    };

    try {
      channel = supabase.channel(PRESENCE_CHANNEL, {
        config: { presence: { key: `admin-${Date.now()}` } }
      });

      channel.on('presence', { event: 'sync' }, syncOnlineMembers);
      channel.on('presence', { event: 'join' }, syncOnlineMembers);
      channel.on('presence', { event: 'leave' }, syncOnlineMembers);
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') syncOnlineMembers();
      });
    } catch (presenceError) {
      console.warn('Presence channel unavailable:', presenceError);
    }

    return () => {
      active = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  return (
    <section className="space-y-6" aria-labelledby="admin-members-title">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wider text-[#9C6644]">Community</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 id="admin-members-title" className="text-2xl font-bold tracking-tight text-[#F1F3EF]">Members</h1>
            <p className="mt-1 text-sm text-[#858884]">Optional customer accounts registered through the storefront.</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 text-xs font-semibold">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400" /> {onlineVisitorCount} visitors online</span>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#4A5568]/40 bg-[#24272A] px-3 py-1.5 text-[#B8BAB7]"><span className="h-2 w-2 rounded-full bg-[#9C6644]" /> {onlineMemberIds.size} members online</span>
          </div>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300" role="alert">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center rounded-xl border border-[#24272A] bg-[#17191C] p-16 text-[#858884]"><LoaderCircle className="mr-2 h-5 w-5 animate-spin" /> Loading members...</div>
      ) : members.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#4A5568] bg-[#17191C] p-12 text-center"><Users className="mx-auto h-10 w-10 text-[#858884]" /><h2 className="mt-4 text-lg font-semibold text-[#F1F3EF]">No members yet</h2><p className="mt-2 text-sm text-[#858884]">Customer accounts will appear here when someone signs up.</p></div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#24272A] bg-[#17191C] shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-[#0B0B0C] text-xs uppercase tracking-wider text-[#858884]"><tr><th className="px-5 py-4 font-medium">Member</th><th className="px-5 py-4 font-medium">Email</th><th className="px-5 py-4 font-medium">Joined</th><th className="px-5 py-4 text-right font-medium">Presence</th></tr></thead>
              <tbody className="divide-y divide-[#24272A]">
                {members.map((member) => {
                  const isOnline = onlineMemberIds.has(member.id);
                  return <tr key={member.id} className="hover:bg-[#1D2023]"><td className="px-5 py-4 font-semibold text-[#F1F3EF]">{member.full_name || 'Unnamed member'}</td><td className="px-5 py-4 text-[#B8BAB7]"><span className="flex items-center gap-2"><Mail className="h-4 w-4 text-[#9C6644]" /> {member.email}</span></td><td className="px-5 py-4 text-[#858884]"><span className="flex items-center gap-2"><Calendar className="h-4 w-4" /> {member.created_at ? new Date(member.created_at).toLocaleDateString() : '—'}</span></td><td className="px-5 py-4 text-right"><span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold ${isOnline ? 'bg-emerald-500/10 text-emerald-300' : 'bg-[#24272A] text-[#858884]'}`}><span className={`h-2 w-2 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-[#858884]'}`} /> {isOnline ? 'Online' : 'Offline'}</span></td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
