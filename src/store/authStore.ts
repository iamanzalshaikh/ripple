import { create } from "zustand";
import { getRippleApi } from "../lib/rippleApi";

interface AuthState {
  loggedIn: boolean;
  loading: boolean;
  user: RippleUser | null;
  sessionId: string | null;
  error: string | null;
  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<boolean>;
  signup: (email: string, password: string, name?: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  loggedIn: false,
  loading: false,
  user: null,
  sessionId: null,
  error: null,

  hydrate: async () => {
    set({ loading: true, error: null });
    try {
      const res = await getRippleApi().getSession();
      set({
        loggedIn: res.loggedIn,
        user: res.user ?? null,
        sessionId: res.sessionId ?? null,
      });
    } catch (e: unknown) {
      set({
        error:
          e instanceof Error
            ? e.message
            : "Desktop API unavailable — use npm run dev in ripple-desktop",
      });
    } finally {
      set({ loading: false });
    }
  },

  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const res = await getRippleApi().login(email, password);
      if (!res.ok) {
        set({ error: res.message ?? "Login failed" });
        return false;
      }
      set({
        loggedIn: true,
        user: res.user ?? null,
        sessionId: res.sessionId ?? null,
      });
      return true;
    } catch (e: unknown) {
      set({
        error: e instanceof Error ? e.message : "Login failed",
      });
      return false;
    } finally {
      set({ loading: false });
    }
  },

  signup: async (email, password, name) => {
    set({ loading: true, error: null });
    try {
      const res = await getRippleApi().signup(email, password, name);
      if (!res.ok) {
        set({ error: res.message ?? "Signup failed" });
        return false;
      }
      set({
        loggedIn: true,
        user: res.user ?? null,
        sessionId: res.sessionId ?? null,
      });
      return true;
    } catch (e: unknown) {
      set({
        error: e instanceof Error ? e.message : "Signup failed",
      });
      return false;
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    try {
      await getRippleApi().logout();
    } catch {
      /* ignore */
    }
    set({ loggedIn: false, user: null, sessionId: null });
  },

  clearError: () => set({ error: null }),
}));
