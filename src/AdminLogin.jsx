import { useEffect, useState } from 'react';
import { Eye, EyeOff, Lock, Moon, Sun, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { isSuperAdminUser } from './authSecurity';

const MAX_FAILED_ATTEMPTS = 3;
const LOCKOUT_DURATION_SECONDS = 30;

export default function AdminLogin({ onAuthenticated, onClose, theme = 'light', toggleTheme }) {
  const routerNavigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const isLockedOut = lockoutSeconds > 0;

  useEffect(() => {
    if (!isLockedOut) return undefined;

    const intervalId = window.setInterval(() => {
      setLockoutSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isLockedOut]);

  useEffect(() => {
    if (lockoutSeconds === 0 && error.startsWith('Too many failed attempts')) {
      setError('');
    }
  }, [lockoutSeconds, error]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isLockedOut || isSubmitting) return;

    setIsSubmitting(true);
    setError('');

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    });

    if (signInError) {
      const nextFailedAttempts = failedAttempts + 1;

      if (nextFailedAttempts >= MAX_FAILED_ATTEMPTS) {
        setFailedAttempts(0);
        setLockoutSeconds(LOCKOUT_DURATION_SECONDS);
        setError(`Too many failed attempts. Try again in ${LOCKOUT_DURATION_SECONDS} seconds.`);
      } else {
        setFailedAttempts(nextFailedAttempts);
        setError(`${signInError.message} ${MAX_FAILED_ATTEMPTS - nextFailedAttempts} attempt(s) remaining.`);
      }

      setIsSubmitting(false);
      return;
    }

    // Re-read the authenticated user from Supabase before granting portal
    // access. Only app_metadata is trusted for authorization; user_metadata
    // can be edited by the user.
    const { data: verifiedUserData, error: verifiedUserError } = await supabase.auth.getUser();
    const verifiedUser = verifiedUserData?.user || data.user;

    if (verifiedUserError || !isSuperAdminUser(verifiedUser)) {
      await supabase.auth.signOut();
      const nextFailedAttempts = failedAttempts + 1;
      if (nextFailedAttempts >= MAX_FAILED_ATTEMPTS) {
        setFailedAttempts(0);
        setLockoutSeconds(LOCKOUT_DURATION_SECONDS);
        setError(`Too many failed attempts. Try again in ${LOCKOUT_DURATION_SECONDS} seconds.`);
      } else {
        setFailedAttempts(nextFailedAttempts);
        setError(`Administrator access is required. ${MAX_FAILED_ATTEMPTS - nextFailedAttempts} attempt(s) remaining.`);
      }
      setIsSubmitting(false);
      return;
    }

    setFailedAttempts(0);
    setLockoutSeconds(0);
    setIsSubmitting(false);
    onAuthenticated?.(data.session);
  };

  return (
    <main className="motion-fade-in relative flex min-h-screen min-h-[100dvh] w-full min-w-0 items-start justify-center overflow-x-hidden overflow-y-auto bg-[#F4F3EF] px-4 pb-6 pt-20 sm:items-center sm:py-10">
      {toggleTheme && (
        <button type="button" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} className="absolute right-4 top-4 inline-flex items-center gap-2 rounded-full border border-[#E5E4E0] bg-white p-2 text-xs font-semibold text-[#4A5568] transition hover:border-[#9C6644] hover:text-[#9C6644] lg:px-3 lg:py-2">
          {theme === 'dark' ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
          <span className="hidden lg:inline">{theme === 'dark' ? 'Light' : 'Dark'} theme</span>
        </button>
      )}
      <section className="motion-fade-up relative box-border w-full min-w-0 max-w-md rounded-2xl border border-[#E5E4E0] bg-white p-6 shadow-xl sm:p-8">
        <button type="button" onClick={() => { onClose?.(); routerNavigate('/'); }} aria-label="Close administrator sign in" title="Back to home catalog" className="absolute right-4 top-4 rounded-full p-2 text-[#4A5568] transition hover:bg-[#F4F3EF] hover:text-[#111214] focus:outline-none focus:ring-2 focus:ring-[#9C6644]/40">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="mb-8">
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[#2563EB]"><Lock className="h-4 w-4" aria-hidden="true" /> Admin Wen</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-[#111214]">Administrator sign in</h1>
          <p className="mt-2 text-sm text-[#4A5568]">Use your Supabase Auth administrator account.</p>
        </div>

        {error && <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert" aria-live="assertive">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="admin-email" className="mb-2 block text-sm font-semibold text-[#111214]">Email</label>
            <input id="admin-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required className="w-full rounded-lg border border-[#E5E4E0] px-3 py-2.5 outline-none transition focus:border-[#9C6644] focus:ring-2 focus:ring-[#9C6644]/20" />
          </div>

          <div>
            <label htmlFor="admin-password" className="mb-2 block text-sm font-semibold text-[#111214]">Password</label>
            <div className="relative">
              <input
                id="admin-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                className="w-full rounded-lg border border-[#E5E4E0] px-3 py-2.5 pr-11 outline-none transition focus:border-[#9C6644] focus:ring-2 focus:ring-[#9C6644]/20"
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-[#4A5568] transition hover:bg-[#F4F3EF] hover:text-[#111214] focus:outline-none focus:ring-2 focus:ring-[#9C6644]/40"
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {isLockedOut && <p className="rounded-lg bg-[#F4F3EF] p-3 text-center text-sm font-semibold text-[#4A5568]" role="status" aria-live="polite">Login locked. Try again in {lockoutSeconds} seconds.</p>}

          <button type="submit" disabled={isSubmitting || isLockedOut} className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-3 font-semibold text-white transition-all duration-200 hover:-translate-y-1 hover:bg-gray-800 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none">
            {isSubmitting && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />}
            {isSubmitting ? 'Signing in...' : isLockedOut ? `Locked for ${lockoutSeconds}s` : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
