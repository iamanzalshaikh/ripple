import { create } from "zustand";
import { getRippleApi } from "../lib/rippleApi";

export interface HistoryItem {
  id: string;
  command: string;
  intent: string;
  result: string | null;
  output_type: string;
  confidence: number;
  context_type: string | null;
  action_source: string | null;
  created_at: string;
}

interface HistoryState {
  items: HistoryItem[];
  total: number;
  page: number;
  limit: number;
  loading: boolean;
  error: string | null;
  intentFilter: string;
  fetch: (page?: number) => Promise<void>;
  setIntentFilter: (intent: string) => void;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  items: [],
  total: 0,
  page: 1,
  limit: 20,
  loading: false,
  error: null,
  intentFilter: "",

  setIntentFilter: (intent) => set({ intentFilter: intent }),

  fetch: async (page = 1) => {
    set({ loading: true, error: null });
    try {
      const res = await getRippleApi().getCommandHistory({
        page,
        limit: get().limit,
        sort: "latest",
        intent: get().intentFilter || undefined,
      });
      if (!res.ok) {
        set({ error: res.message ?? "Failed to load history", loading: false });
        return;
      }
      set({
        items: res.items ?? [],
        total: res.total ?? 0,
        page: res.page ?? page,
        loading: false,
      });
    } catch (e: unknown) {
      set({
        error: e instanceof Error ? e.message : "Failed to load history",
        loading: false,
      });
    }
  },
}));
