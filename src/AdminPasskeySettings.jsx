import { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from './supabaseClient';
import { clearAdminPasskeyMarker, hasAdminPasskeyMarker, markAdminPasskeyRegistered } from './adminPasskeyState';

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
    if (user?.role !== 'SUPER_ADMIN') return;

    if (!supported) {
      setIsOpen(true);
      return;
    }

    setLoading(true);
    setError('');
    const { data, error: listError } = await supabase.auth.passkey.list();
    if (listError) {
      setError(listError.message || 'Passkeys are not enabled for this project yet.');
      setIsOpen(!hasAdminPasskeyMarker());
    } else {
      const registeredPasskeys = Array.isArray(data) ? data : [];
      setPasskeys(registeredPasskeys);
      // Keep the setup prompt present on every fresh admin session until at
      // least one device unlock has been registered.
      if (registeredPasskeys.length > 0) {
        markAdminPasskeyRegistered();
        setIsOpen(false);
      } else {
        clearAdminPasskeyMarker();
        setIsOpen(true);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadPasskeys();
  }, [supported, user?.role]);

  const registerPasskey = async () => {
    setWorking(true);
    setError('');
    if (typeof window !== 'undefined') window.__wenAdminPasskeyCeremony = true;

    try {
      const { error: registerError } = await supabase.auth.registerPasskey();
      if (registerError) {
        setError(registerError.message || 'Unable to register this device.');
        toast.error(registerError.message || 'Unable to register this device.');
      } else {
        markAdminPasskeyRegistered();
        toast.success('Device unlock added for Admin Wen.');
        setIsOpen(false);
        await loadPasskeys();
      }
    } catch (registerError) {
      setError(registerError.message || 'Unable to register this device.');
      toast.error(registerError.message || 'Unable to register this device.');
    } finally {
      if (typeof window !== 'undefined') window.__wenAdminPasskeyCeremony = false;
      setWorking(false);
    }
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

  if (user?.role !== 'SUPER_ADMIN' || !isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" role="presentation">
      <section className="relative max-h-[min(42rem,calc(100dvh-2rem))] w-full max-w-md overflow-y-auto rounded-2xl border border-[#4A5568]/50 bg-[#17191C] p-5 text-[#F1F3EF] shadow-2xl sm:p-6" role="dialog" aria-modal="true" aria-labelledby="admin-passkey-title">
        <button type="button" onClick={() => setIsOpen(false)} className="absolute right-3 top-3 rounded-md p-2 text-[#B8BAB7] transition hover:bg-[#24272A] hover:text-white" aria-label="Close device unlock setup" title="Close">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="flex items-start gap-3 pr-8">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-500/15 text-blue-300">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-300">Admin Wen security</p>
            <h2 id="admin-passkey-title" className="mt-1 break-words text-lg font-semibold">Add device unlock</h2>
            <p className="mt-2 break-words text-sm leading-6 text-[#B8BAB7]">Use Face ID, fingerprint, or your phone PIN each time you open Admin Wen.</p>
          </div>
        </div>

        {!supported && <p className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm leading-6 text-amber-200">This browser or device does not support passkeys. Use a recent version of Chrome, Safari, or Edge on a device with screen lock enabled.</p>}
        {supported && error && <p className="mt-5 break-words rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm leading-6 text-red-200" role="alert">{error}</p>}

        {supported && (
          <>
            <button type="button" onClick={registerPasskey} disabled={working || loading} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-blue-500 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50">
              {working ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
              {working ? 'Waiting for device unlock...' : 'Add fingerprint or Face ID'}
            </button>

            <div className="mt-5 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#858884]">Registered devices</p>
              {loading && <p className="text-xs text-[#B8BAB7]">Loading secure devices...</p>}
              {!loading && passkeys.length === 0 && <p className="text-xs leading-5 text-[#B8BAB7]">No device unlock is registered yet.</p>}
              {!loading && passkeys.map((passkey) => (
                <div key={passkey.id} className="flex items-center justify-between gap-3 rounded-lg border border-[#4A5568]/40 bg-[#24272A] px-3 py-2">
                  <div className="min-w-0">
                    <p className="break-words text-xs font-semibold text-[#F1F3EF]">{passkey.friendly_name || 'This device'}</p>
                    <p className="text-[10px] text-[#858884]">Added {formatDate(passkey.created_at)}</p>
                  </div>
                  <button type="button" onClick={() => removePasskey(passkey.id)} disabled={working} className="shrink-0 rounded-md p-1.5 text-[#B8BAB7] hover:bg-red-400/10 hover:text-red-300 disabled:opacity-50" aria-label={`Remove ${passkey.friendly_name || 'this device'}`} title="Remove device unlock">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
