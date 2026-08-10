"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { get, post } from "@/lib/api";
import type { User } from "@/lib/types";
import { disconnectSocket } from "@/lib/socket";

interface AuthState {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<User | null>;
  login: (email: string, password: string) => Promise<User>;
  register: (username: string, email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await get<{ data: User }>("/auth/me");
      setUser(res.data);
      return res.data;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await post<{ data: User }>("/auth/login", { email, password });
    setUser(res.data);
    return res.data;
  }, []);

  const register = useCallback(
    async (username: string, email: string, password: string) => {
      const res = await post<{ data: User }>("/auth/register", {
        username,
        email,
        password,
      });
      setUser(res.data);
      return res.data;
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await post("/auth/logout");
    } catch {
      /* ignore */
    }
    disconnectSocket();
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, loading, refresh, login, register, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
