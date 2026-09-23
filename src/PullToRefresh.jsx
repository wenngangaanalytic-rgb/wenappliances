import { useRef, useState } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { triggerLightHaptic } from './nativeAdmin';

const REFRESH_THRESHOLD = 72;

export default function PullToRefresh({ children, onRefresh, className = '' }) {
  const containerRef = useRef(null);
  const startYRef = useRef(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleTouchStart = (event) => {
    if (isRefreshing || containerRef.current?.scrollTop > 0) return;
    startYRef.current = event.touches[0]?.clientY ?? null;
  };

  const handleTouchMove = (event) => {
    if (startYRef.current === null || isRefreshing || containerRef.current?.scrollTop > 0) return;
    const distance = Math.max(0, (event.touches[0]?.clientY ?? startYRef.current) - startYRef.current);
    if (distance <= 0) return;
    if (event.cancelable) event.preventDefault();
    setPullDistance(Math.min(distance, REFRESH_THRESHOLD * 1.5));
  };

  const handleTouchEnd = async () => {
    const shouldRefresh = pullDistance >= REFRESH_THRESHOLD;
    startYRef.current = null;
    setPullDistance(0);
    if (!shouldRefresh || isRefreshing) return;

    setIsRefreshing(true);
    void triggerLightHaptic();
    try {
      await onRefresh?.();
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative min-w-0 grow overflow-y-auto overscroll-contain ${className}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      style={{ touchAction: 'pan-y' }}
    >
      {(pullDistance > 0 || isRefreshing) && (
        <div className="pointer-events-none sticky top-0 z-30 flex h-0 justify-center overflow-visible" aria-hidden="true">
          <div
            className="mt-3 grid h-9 w-9 place-items-center rounded-full border border-[#c2a792] bg-white text-[#9C6644] shadow-md"
            style={{ transform: `translateY(${isRefreshing ? 12 : Math.min(pullDistance / 2, 36)}px)` }}
          >
            {isRefreshing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
