import { useCallback, useState } from 'react';

// Browser GPS is requested ONLY when `request()` is called from a user action (e.g. "Use my location").
// Nothing is requested on page load.
export function useGeolocation() {
  const [state, setState] = useState({ status: 'idle', position: null, error: null });

  const request = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState({ status: 'unsupported', position: null, error: 'This browser cannot share location. Please choose your location manually.' });
      return;
    }
    setState((s) => ({ ...s, status: 'locating', error: null }));
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setState({
          status: 'ready',
          position: {
            latitude: Math.round(pos.coords.latitude * 1e6) / 1e6,
            longitude: Math.round(pos.coords.longitude * 1e6) / 1e6,
            accuracyMeters: Math.round(pos.coords.accuracy),
          },
          error: null,
        }),
      (err) =>
        setState({
          status: err.code === 1 ? 'denied' : 'error',
          position: null,
          error:
            err.code === 1
              ? 'Location permission was not given. That is fine — choose your location manually below.'
              : 'Your location could not be found. Please choose it manually below.',
        }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }, []);

  const reset = useCallback(() => setState({ status: 'idle', position: null, error: null }), []);
  return { ...state, request, reset };
}
