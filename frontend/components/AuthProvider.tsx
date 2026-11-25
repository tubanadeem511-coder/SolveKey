"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../lib/api";
import type { AuthUser, LoginInput, RegisterInput } from "../lib/api";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  login: (input: LoginInput) => Promise<AuthUser>;
  register: (input: RegisterInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: (options?: { silent?: boolean }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const refresh = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true);
    const version = ++requestVersion.current;
    try {
      const session = await api.auth.session();
      if (version !== requestVersion.current) return;
      setUser(session.user);
      setError(null);
    } catch (reason) {
      if (version !== requestVersion.current) return;
      setError(messageOf(reason));
      console.error("Could not load the current SolveKey user", reason);
    } finally {
      if (!silent && version === requestVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (input: LoginInput) => {
    const version = ++requestVersion.current;
    try {
      const signedInUser = await api.auth.login(input);
      if (version === requestVersion.current) {
        setUser(signedInUser);
        setError(null);
      }
      return signedInUser;
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const version = ++requestVersion.current;
    try {
      const newUser = await api.auth.register(input);
      if (version === requestVersion.current) {
        setUser(newUser);
        setError(null);
      }
      return newUser;
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      await api.auth.logout();
      if (version === requestVersion.current) {
        setUser(null);
        setError(null);
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, error, login, register, logout, refresh }),
    [user, loading, error, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
