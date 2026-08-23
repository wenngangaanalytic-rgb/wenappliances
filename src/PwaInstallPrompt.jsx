import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

export default function PwaInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isStandalone) return undefined;

    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  if (!installPrompt || dismissed) return null;

  const installApp = async () => {
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  return (
    <aside
      className="fixed bottom-4 left-4 right-4 z-[70] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-[#9C6644]/30 bg-white p-4 text-[#111214] shadow-2xl dark:border-[#9C6644]/50 dark:bg-[#1C1F22] dark:text-white sm:left-auto sm:right-6"
      role="dialog"
      aria-label="Install WenAppliances"
    >
      <img src="/wenappliances-logo.svg" alt="" className="h-11 w-11 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="font-bold">Install WenAppliances</p>
        <p className="mt-0.5 text-xs text-[#687487] dark:text-[#B8B8B8]">Launch the store quickly from your home screen.</p>
      </div>
      <button
        type="button"
        onClick={installApp}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#9C6644] px-3 py-2 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:bg-[#875437] hover:shadow-lg"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        Install
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss install prompt"
        className="rounded-md p-1.5 text-[#687487] transition hover:bg-black/5 hover:text-[#111214] dark:hover:bg-white/10 dark:hover:text-white"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </aside>
  );
}
