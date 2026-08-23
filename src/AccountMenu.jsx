import { useState } from 'react';
import { ClipboardList, Eye, EyeOff, KeyRound, LogIn, LogOut, UserRound, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from './supabaseClient';
import {
  CUSTOMER_PORTAL_ADMIN_MESSAGE,
  hasStrongCustomerPassword,
  isReservedSuperAdminEmail,
  isSuperAdminUser,
  STRONG_CUSTOMER_PASSWORD_MESSAGE
} from './authSecurity';

const initialForm = { name: '', email: '', password: '' };

export default function AccountMenu({ user, onTrackOrder, onMyOrders }) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState('signin');
  const [formData, setFormData] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const closeMenu = () => {
    setIsOpen(false);
    setFormData(initialForm);
    setMode('signin');
    setShowPassword(false);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);

    try {
      const email = formData.email.trim().toLowerCase();

      // The SUPER_ADMIN identity is reserved for the separate administrator
      // portal. Reject it before any customer Auth request is made.
      if (isReservedSuperAdminEmail(email)) {
        throw new Error(CUSTOMER_PORTAL_ADMIN_MESSAGE);
      }

      if (mode === 'signup' && !hasStrongCustomerPassword(formData.password)) {
        throw new Error(STRONG_CUSTOMER_PASSWORD_MESSAGE);
      }

      if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/?reset-password=1`
        });

        if (error) throw error;
        toast.success('Password reset instructions sent. Check your email.');
        setMode('signin');
        setFormData((current) => ({ ...current, password: '' }));
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password: formData.password,
          options: { data: { name: formData.name.trim() } }
        });

        if (error) throw error;

        // Defense in depth for any future administrator identity: never keep
        // an administrator session in the customer application.
        if (isSuperAdminUser(data.user)) {
          await supabase.auth.signOut();
          throw new Error(CUSTOMER_PORTAL_ADMIN_MESSAGE);
        }

        if (data.session) {
          toast.success('Your WenAppliances account is ready.');
          closeMenu();
        } else {
          toast.success('Account created. Check your email to confirm your account.');
          setMode('signin');
          setFormData((current) => ({ ...current, password: '' }));
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password: formData.password
        });

        if (error) throw error;

        const { data: verifiedUserData, error: verifiedUserError } = await supabase.auth.getUser();
        if (verifiedUserError) throw verifiedUserError;
        if (isSuperAdminUser(verifiedUserData.user)) {
          await supabase.auth.signOut();
          throw new Error(CUSTOMER_PORTAL_ADMIN_MESSAGE);
        }

        toast.success('Welcome back.');
        closeMenu();
      }
    } catch (authError) {
      toast.error(authError.message || 'Unable to complete account request.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) toast.error(error.message || 'Unable to sign out.');
    else toast.success('You have been signed out.');
    closeMenu();
  };

  return (
    <div className="relative z-50">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="relative rounded-full p-2 transition-colors hover:bg-[#E5E4E0]"
        aria-label={user ? 'Open account menu' : 'Create or sign in to an account'}
        aria-expanded={isOpen}
      >
        <UserRound className="h-5 w-5 text-[#4A5568]" />
      </button>

      {isOpen && (
        <div className="fixed inset-x-4 top-20 z-50 max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-2xl border border-[#E5E4E0] bg-white p-5 text-left shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:max-h-none sm:w-[min(92vw,360px)] sm:overflow-visible">
          <button type="button" onClick={closeMenu} className="absolute right-3 top-3 rounded-full p-1 text-[#858884] hover:bg-[#F4F3EF] hover:text-[#111214]" aria-label="Close account menu">
            <X className="h-4 w-4" />
          </button>

          {user ? (
            <div className="pt-1">
              <div className="flex items-center gap-3 border-b border-[#E5E4E0] pb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F4F3EF] font-bold text-[#9C6644]">{user.name?.charAt(0).toUpperCase() || 'U'}</div>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[#111214]">{user.name}</p>
                  <p className="truncate text-xs text-[#858884]">{user.email}</p>
                </div>
              </div>
              <button type="button" onClick={() => { onMyOrders?.(); closeMenu(); }} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#9C6644] px-3 py-2 text-sm font-semibold text-white hover:bg-[#8A5A3C]"><ClipboardList className="h-4 w-4" /> My orders</button>
              <button type="button" onClick={() => { onTrackOrder?.(); closeMenu(); }} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-[#E5E4E0] px-3 py-2 text-sm font-semibold text-[#4A5568] hover:bg-[#F4F3EF]">Track an order</button>
              <button type="button" onClick={handleSignOut} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-[#E5E4E0] px-3 py-2 text-sm font-semibold text-[#4A5568] hover:bg-[#F4F3EF]"><LogOut className="h-4 w-4" /> Sign out</button>
            </div>
          ) : (
            <div className="pt-1">
              <div className="mb-5 pr-5">
                <p className="text-sm font-semibold uppercase tracking-wider text-[#9C6644]">WenAppliances members</p>
                <h2 className="mt-1 text-xl font-bold text-[#111214]">{mode === 'signup' ? 'Create your account' : mode === 'reset' ? 'Reset your password' : 'Welcome back'}</h2>
                <p className="mt-1 text-xs text-[#4A5568]">{mode === 'reset' ? 'Enter your account email and we will send you a secure reset link.' : 'Account creation is optional and keeps your member details synced securely.'}</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3">
                {mode === 'signup' && <input name="name" value={formData.name} onChange={(event) => setFormData((current) => ({ ...current, name: event.target.value }))} required placeholder="Full name" autoComplete="name" className="w-full rounded-lg border border-[#E5E4E0] px-3 py-2 text-sm outline-none focus:border-[#9C6644]" />}
                <input name="email" type="email" value={formData.email} onChange={(event) => setFormData((current) => ({ ...current, email: event.target.value }))} required placeholder="Email address" autoComplete="email" className="w-full rounded-lg border border-[#E5E4E0] px-3 py-2 text-sm outline-none focus:border-[#9C6644]" />
                {mode !== 'reset' && <div className="relative">
                  <input name="password" type={showPassword ? 'text' : 'password'} minLength={mode === 'signup' ? 8 : 6} value={formData.password} onChange={(event) => setFormData((current) => ({ ...current, password: event.target.value }))} required placeholder="Password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} className="w-full rounded-lg border border-[#E5E4E0] px-3 py-2 pr-10 text-sm outline-none focus:border-[#9C6644]" />
                  <button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[#4A5568] hover:bg-[#F4F3EF] hover:text-[#111214]" aria-label={showPassword ? 'Hide password' : 'Show password'} title={showPassword ? 'Hide password' : 'Show password'}>
                    {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </div>}
                {mode === 'signup' && <p className="text-xs leading-5 text-[#4A5568]">Use 8+ characters with uppercase and lowercase letters, a number, and a special character.</p>}
                <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#9C6644] px-3 py-2.5 text-sm font-bold text-white hover:bg-[#8A5A3C] disabled:opacity-60">
                  {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : mode === 'reset' ? <KeyRound className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                  {mode === 'signup' ? 'Create optional account' : mode === 'reset' ? 'Send reset email' : 'Sign in'}
                </button>
              </form>

              {mode === 'signin' && <button type="button" onClick={() => { setMode('reset'); setShowPassword(false); setFormData((current) => ({ ...current, password: '' })); }} className="mt-4 w-full text-center text-xs font-semibold text-[#9C6644] hover:underline">Forgot password?</button>}
              {mode === 'reset' ? <button type="button" onClick={() => { setMode('signin'); setShowPassword(false); setFormData((current) => ({ ...current, password: '' })); }} className="mt-4 w-full text-center text-xs font-semibold text-[#9C6644] hover:underline">Back to sign in</button> : <button type="button" onClick={() => { setMode((current) => current === 'signup' ? 'signin' : 'signup'); setFormData(initialForm); setShowPassword(false); }} className="mt-4 w-full text-center text-xs font-semibold text-[#9C6644] hover:underline">
                {mode === 'signup' ? 'Already a member? Sign in' : 'New here? Create an account'}
              </button>}
              <button type="button" onClick={() => { onTrackOrder?.(); closeMenu(); }} className="mt-3 w-full text-center text-xs font-semibold text-[#4A5568] hover:text-[#9C6644] hover:underline">Track an existing order</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
