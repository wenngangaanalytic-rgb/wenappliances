import { useEffect, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';

const CONSENT_KEY = 'wen-analytics-consent';

const readConsent = () => {
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : 'unknown';
  } catch {
    return 'unknown';
  }
};

export default function AnalyticsConsent() {
  const [consent, setConsent] = useState('unknown');

  useEffect(() => {
    setConsent(readConsent());
  }, []);

  const choose = (value) => {
    try {
      window.localStorage.setItem(CONSENT_KEY, value);
    } catch {
      // Keep the current session choice even when storage is unavailable.
    }
    setConsent(value);
  };

  return (
    <>
      {consent === 'granted' && <><Analytics /><SpeedInsights /></>}
      {consent === 'unknown' && (
        <aside className="fixed bottom-4 left-4 right-4 z-[100] mx-auto max-w-xl rounded-xl border border-[#E5E4E0] bg-white p-4 text-sm text-[#111214] shadow-xl" role="dialog" aria-label="Analytics preferences">
          <p className="font-semibold">Help us improve WenAppliances</p>
          <p className="mt-1 text-[#4A5568]">Choose whether to allow privacy-focused usage and performance analytics.</p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => choose('denied')} className="rounded-lg border border-[#C9C7C0] px-3 py-2 text-xs font-semibold text-[#4A5568] hover:bg-[#F4F3EF]">Decline</button>
            <button type="button" onClick={() => choose('granted')} className="rounded-lg bg-[#9C6644] px-3 py-2 text-xs font-semibold text-white hover:bg-[#8A5A3C]">Allow analytics</button>
          </div>
        </aside>
      )}
    </>
  );
}
