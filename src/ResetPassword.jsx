import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from './supabaseClient';

const SPECIAL_CHARACTER_PATTERN = /[!@#$%^&*(),.?":{}|<>[\]\\/'`~_+=;-]/;

const isExpiredResetError = (error) => {
  const message = `${error?.message || ''} ${error?.code || ''}`.toLowerCase();
  return /expired|invalid.*(token|otp|session)|token.*(expired|invalid)|otp|session missing|auth session missing/.test(message);
};

export default function ResetPassword({ navigate }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const validation = useMemo(() => ({
    hasMinimumLength: password.length >= 6,
    hasUppercase: /[A-Z]/.test(password),
    hasSpecialCharacter: SPECIAL_CHARACTER_PATTERN.test(password),
    passwordsMatch: password.length > 0 && password === confirmPassword
  }), [password, confirmPassword]);

  const isFormValid = !checkingSession
    && hasRecoverySession
    && validation.hasMinimumLength
    && validation.hasUppercase
    && validation.hasSpecialCharacter
    && validation.passwordsMatch;

  const goHome = () => {
    window.history.replaceState({}, document.title, window.location.pathname);
    navigate?.('/');
  };

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      setHasRecoverySession(Boolean(session));
      setCheckingSession(false);
    });

    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!isFormValid || loading) return;

    setError('');
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      if (isExpiredResetError(updateError)) {
        const expiredMessage = 'This password reset link has expired or is no longer valid. Please request a new reset link.';
        setError(expiredMessage);
        toast.error(expiredMessage);
      } else {
        setError(updateError.message || 'Unable to update your password.');
        toast.error(updateError.message || 'Unable to update your password.');
      }
      setLoading(false);
      return;
    }

    toast.success('Your password has been reset.');
    goHome();
    setLoading(false);
  };

  return (
    <section className="motion-fade-up mx-auto flex min-h-[70vh] max-w-lg items-center px-4 py-12 sm:px-6">
      <div className="w-full rounded-2xl border border-[#E5E4E0] bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#9C6644]/10 text-[#9C6644]"><LockKeyhole className="h-5 w-5" aria-hidden="true" /></div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-[#9C6644]">WenAppliances account</p>
            <h1 className="mt-1 text-2xl font-bold text-[#111214]">Reset your password</h1>
          </div>
        </div>

        {checkingSession ? <div className="mt-8 flex items-center gap-2 text-sm text-[#4A5568]"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking your secure reset link...</div> : !hasRecoverySession ? (
          <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            This reset link is missing or has expired. Request a new one from the account menu.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</div>}

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[#111214]">New Password</span>
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="new-password" aria-describedby="password-requirements" className="w-full rounded-lg border border-[#E5E4E0] px-3 py-2.5 pr-11 outline-none focus:border-[#9C6644] focus:ring-2 focus:ring-[#9C6644]/20" />
                <button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-[#4A5568] transition hover:bg-[#F4F3EF] hover:text-[#111214] focus:outline-none focus:ring-2 focus:ring-[#9C6644]/40" aria-label={showPassword ? 'Hide new password' : 'Show new password'} title={showPassword ? 'Hide new password' : 'Show new password'}>
                  {showPassword ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
                </button>
              </div>
            </label>

            <div id="password-requirements" className="rounded-lg bg-[#F4F3EF] p-3 text-xs text-[#4A5568]">
              <p className="font-semibold text-[#111214]">Password requirements</p>
              <ul className="mt-2 space-y-1">
                <li className={validation.hasMinimumLength ? 'text-emerald-700' : 'text-[#858884]'}>{validation.hasMinimumLength ? '✓' : '○'} At least 6 characters</li>
                <li className={validation.hasUppercase ? 'text-emerald-700' : 'text-[#858884]'}>{validation.hasUppercase ? '✓' : '○'} At least one uppercase letter</li>
                <li className={validation.hasSpecialCharacter ? 'text-emerald-700' : 'text-[#858884]'}>{validation.hasSpecialCharacter ? '✓' : '○'} At least one special character</li>
              </ul>
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[#111214]">Confirm Password</span>
              <div className="relative">
                <input type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required autoComplete="new-password" className="w-full rounded-lg border border-[#E5E4E0] px-3 py-2.5 pr-11 outline-none focus:border-[#9C6644] focus:ring-2 focus:ring-[#9C6644]/20" />
                <button type="button" onClick={() => setShowConfirmPassword((current) => !current)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-[#4A5568] transition hover:bg-[#F4F3EF] hover:text-[#111214] focus:outline-none focus:ring-2 focus:ring-[#9C6644]/40" aria-label={showConfirmPassword ? 'Hide confirmed password' : 'Show confirmed password'} title={showConfirmPassword ? 'Hide confirmed password' : 'Show confirmed password'}>
                  {showConfirmPassword ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
                </button>
              </div>
              {confirmPassword && !validation.passwordsMatch && <p className="mt-2 text-sm font-semibold text-red-700" role="alert">Passwords do not match</p>}
            </label>

            <button type="submit" disabled={!isFormValid || loading} className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-3 font-bold text-white transition-all duration-200 hover:-translate-y-1 hover:bg-gray-800 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none">
              {loading && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {loading ? 'Saving password...' : 'Save new password'}
            </button>
          </form>
        )}

        <button type="button" onClick={goHome} className="mt-6 w-full text-center text-sm font-semibold text-[#9C6644] hover:underline">Back to storefront</button>
      </div>
    </section>
  );
}
