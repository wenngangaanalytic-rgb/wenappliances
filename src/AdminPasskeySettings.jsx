import { useEffect, useState } from 'react';
import { Fingerprint, KeyRound, ShieldCheck, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from './supabaseClient';

const supportsPasskeys = () => (
  typeof window !== 'undefined'
  && 'PublicKeyCredential' in window
  && typeof supabase.auth.registerPasskey === 'function'
);

const formatDate = (value) => {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleDateString();
};

export default function AdminPasskeySettings({ user }) {
  const [isOpen, setIsOpen] = useState(false);
  const [passkeys, setPasskeys] = useState([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const supported = supportsPasskeys();

  const loadPasskeys = async () => {
    if (!supported || user?.role !== 'SUPER_ADMIN') return;

    setLoading(true);
    setError('');
    const { data, error: listError } = await supabase.auth.passkey.list();
    if (listError) {
      setError(listError.message || 'Passkeys are not enabled for this project yet.');
    } else {
      setPasskeys(Array.isArray(data) ? data : []);
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadPasskeys();
  }, [supported, user?.role]);

  const registerPasskey = async () => {
    setWorking(true);
    setError('');

    const { error: registerError } = await supabase.auth.registerPasskey();
    if (registerError) {
      setError(registerError.message || 'Unable to register this device.');
      toast.error(registerError.message || 'Unable to register this device.');
    } else {
      toast.success('Device unlock added for Admin Wen.');
      await loadPasskeys();
    }

    setWorking(false);
  };

  const removePasskey = async (passkeyId) => {
    if (!window.confirm('Remove this device unlock? You can add it again later with your password.')) return;

    setWorking(true);
    const { error: deleteError } = await supabase.auth.passkey.delete({ passkeyId });
    if (deleteError) {
      toast.error(deleteError.message || 'Unable to remove this device unlock.');
    } else {
      toast.success('Device unlock removed.');
      await loadPasskeys();
    }
    setWorking(false);
  };

  if (user?.role !== 'SUPER_ADMIN') return null;

  return (
    <div className="relative">
      <button type="button" onClick={() => setIsOpen((current) => !current)} className="inline-flex items-center gap-2 rounded-lg border border-[#4A5568]/40 bg-[#24272A] px-2.5 py-2 text-[#F1F3EF] transition hover:bg-[#30343A]" aria-expanded={isOpen} aria-haspopup="dialog" title="Manage biometric unlock">
        <Fingerprint className="h-4 w-4 text-[#93C5FD]" aria-hidden="true" />
        <span className="hidden text-xs font-semibold sm:inline">Biometric unlock</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-12 z-[130] w-[min(23rem,calc(100vw-2rem))] rounded-2xl border border-[#4A5568]/50 bg-[#17191C] p-4 text-[#F1F3EF] shadow-2xl" role="dialog" aria-label="Biometric unlock settings">
          <button type="button" onClick={() => setIsOpen(false)} className="absolute right-3 top-3 rounded-md p-1 text-[#B8BAB7] hover:bg-[#24272A]" aria-label="Close biometric unlock settings"><X className="h-4 w-4" aria-hidden="true" /></button>
          <div className="flex items-start gap-3 pr-6">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-500/15 text-blue-300"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span>
            <div>
              <h2 className="font-semibold">Admin Wen device unlock</h2>
              <p className="mt-1 text-xs leading-5 text-[#B8BAB7]">Use Face ID, fingerprint, or your phone PIN after registering this device.</p>
            </div>
          </div>

          {!supported && <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">This browser or device does not support passkeys.</p>}
          {supported && error && <p className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-xs leading-5 text-red-200" role="alert">{error}</p>}

          {supported && <>
            <button type="button" onClick={registerPasskey} disabled={working || loading} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-blue-500 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50">
              {working ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
              {passkeys.length ? 'Add another device' : 'Register this device'}
            </button>

            <div className="mt-4 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#858884]">Registered devices</p>
              {loading && <p className="text-xs text-[#B8BAB7]">Loading secure devices...</p>}
              {!loading && passkeys.length === 0 && <p className="text-xs text-[#B8BAB7]">No device unlocks registered yet.</p>}
              {!loading && passkeys.map((passkey) => <div key={passkey.id} className="flex items-center justify-between gap-3 rounded-lg border border-[#4A5568]/40 bg-[#24272A] px-3 py-2"><div className="min-w-0"><p className="truncate text-xs font-semibold text-[#F1F3EF]">{passkey.friendly_name || 'This device'}</p><p className="text-[10px] text-[#858884]">Added {formatDate(passkey.created_at)}</p></div><button type="button" onClick={() => removePasskey(passkey.id)} disabled={working} className="rounded-md p-1.5 text-[#B8BAB7] hover:bg-red-400/10 hover:text-red-300 disabled:opacity-50" aria-label={`Remove ${passkey.friendly_name || 'this device'}`} title="Remove device unlock"><Trash2 className="h-4 w-4" aria-hidden="true" /></button></div>)}
            </div>
          </>}
        </div>
      )}
    </div>
  );
}
