import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_INTERVAL_MS = 15000;
const MIN_MOVE_M = 40;
// Readings less precise than this are held back, unless nothing better arrives for a minute.
export const POOR_ACCURACY_M = 100;
const POOR_FALLBACK_MS = 60000;

function metres(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Continuous position sharing for a response team while a delivery is on the road.
// Starts only when the user switches it on, sends at most every 15 s (or after moving 40 m),
// and stops when switched off, when `enabled` becomes false or when the page is closed.
export function useLiveLocation(send, enabled) {
  const [sharing, setSharing] = useState(false);
  const [lastSentAt, setLastSentAt] = useState(null);
  const [lastAccuracy, setLastAccuracy] = useState(null);
  const [error, setError] = useState(null);
  const watchId = useRef(null);
  const last = useRef(null);
  const sendRef = useRef(send);
  sendRef.current = send;

  const stop = useCallback(() => {
    if (watchId.current != null) navigator.geolocation?.clearWatch(watchId.current);
    watchId.current = null;
    setSharing(false);
  }, []);

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setError('This device cannot share its location.');
      return;
    }
    setError(null);
    setSharing(true);
    watchId.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const accuracy = Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null;
        const p = { latitude: Math.round(pos.coords.latitude * 1e6) / 1e6, longitude: Math.round(pos.coords.longitude * 1e6) / 1e6, ...(accuracy ? { accuracyMeters: accuracy } : {}) };
        const now = Date.now();
        const prev = last.current;
        // Skip imprecise fixes (e.g. indoor or tower-only) while a better one sent recently is still current.
        if (accuracy && accuracy > POOR_ACCURACY_M && prev && now - prev.at < POOR_FALLBACK_MS) return;
        if (prev && now - prev.at < MIN_INTERVAL_MS && metres(prev, p) < MIN_MOVE_M) return;
        last.current = { ...p, at: now };
        try {
          await sendRef.current(p);
          setLastSentAt(new Date());
          setLastAccuracy(accuracy);
        } catch (err) {
          setError(err.message);
        }
      },
      (err) => {
        setError(err.code === 1 ? 'Location permission was not given, so live sharing has stopped.' : 'Your position could not be read. Live sharing has stopped.');
        stop();
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
    );
  }, [stop]);

  useEffect(() => {
    if (!enabled && sharing) stop();
  }, [enabled, sharing, stop]);
  useEffect(() => stop, [stop]);

  return { sharing, start, stop, lastSentAt, lastAccuracy, error };
}
