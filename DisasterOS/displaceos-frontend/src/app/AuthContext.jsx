import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { refreshSession, setAccessToken } from '../api/client.js';
import { authApi } from '../api/services.js';

const AuthContext = createContext(null);

export const STAFF_ROLES = ['CAMP_MANAGER', 'RELIEF_COORDINATOR', 'INVENTORY_MANAGER', 'RESPONSE_TEAM', 'ADMIN'];

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authenticated | anonymous

  // Restore a session from the httpOnly refresh cookie on first load.
  useEffect(() => {
    let cancelled = false;
    refreshSession()
      .then(() => authApi.me())
      .then((me) => {
        if (!cancelled) {
          setUser(me);
          setStatus('authenticated');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('anonymous');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const finishLogin = useCallback(async (result) => {
    setAccessToken(result.accessToken);
    const me = await authApi.me();
    setUser(me);
    setStatus('authenticated');
    return me;
  }, []);

  const login = useCallback(async (email, password) => finishLogin(await authApi.login(email, password)), [finishLogin]);
  const register = useCallback(async (input) => finishLogin(await authApi.register(input)), [finishLogin]);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Even if the server is unreachable, forget the session locally.
    }
    setAccessToken(null);
    setUser(null);
    setStatus('anonymous');
    queryClient.clear();
  }, [queryClient]);

  const refreshUser = useCallback(async () => setUser(await authApi.me()), []);

  const value = useMemo(
    () => ({
      user,
      status,
      isStaff: Boolean(user && STAFF_ROLES.includes(user.role)),
      hasRole: (...roles) => Boolean(user && roles.includes(user.role)),
      login,
      register,
      logout,
      refreshUser,
      setUser,
    }),
    [user, status, login, register, logout, refreshUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
