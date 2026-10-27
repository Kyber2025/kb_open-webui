import { useEffect, useRef } from 'react';

/** Re-read shared records while either credential dialog is visible. */
export function useKeyRefresh(refresh: () => Promise<void>, paused: boolean) {
  const current = useRef({ refresh, paused });
  current.current = { refresh, paused };
  useEffect(() => {
    let inFlight = false;
    async function tick() {
      if (inFlight || current.current.paused || document.visibilityState !== 'visible') return;
      inFlight = true;
      try { await current.current.refresh(); } finally { inFlight = false; }
    }
    const timer = window.setInterval(() => void tick(), 15000);
    window.addEventListener('focus', tick);
    window.addEventListener('gateway-updated', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
      window.removeEventListener('gateway-updated', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
}
