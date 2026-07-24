import { useEffect, useState } from "react";
import { LoginPage } from "./pages/Login";
import { HomePage } from "./pages/Home";
import { OverlayPage } from "./pages/Overlay";
import { FirstRunPage } from "./pages/FirstRun";
import { useAuthStore } from "./store/authStore";
import { useSocketStore } from "./store/socketStore";

function firstRunKey(userId: string): string {
  return `ripple:first-run-seen:${userId}`;
}

function hasSeenFirstRun(userId: string): boolean {
  try {
    return window.localStorage.getItem(firstRunKey(userId)) === "1";
  } catch {
    return true; // fail open — never block the app on storage errors
  }
}

function markFirstRunSeen(userId: string): void {
  try {
    window.localStorage.setItem(firstRunKey(userId), "1");
  } catch {
    /* best-effort */
  }
}

const isOverlay =
  typeof window !== "undefined" &&
  (window.ripple?.isOverlay?.() ??
    new URLSearchParams(window.location.search).get("overlay") === "1");

export default function App() {
  const { loggedIn, user, sessionId, hydrate, loading } = useAuthStore();
  const bindSocketEvents = useSocketStore((s) => s.bindEvents);
  const [ready, setReady] = useState(isOverlay);
  const [firstRunDone, setFirstRunDone] = useState(false);

  useEffect(() => {
    if (isOverlay) {
      document.documentElement.classList.add("overlay-html");
      document.body.classList.add("overlay-shell");
    } else {
      document.body.classList.add("app-shell");
    }
    return () => {
      document.documentElement.classList.remove("overlay-html");
      document.body.classList.remove("overlay-shell", "app-shell");
    };
  }, []);

  useEffect(() => {
    if (isOverlay) return;
    hydrate().finally(() => setReady(true));
  }, [hydrate]);

  useEffect(() => {
    if (!loggedIn || isOverlay) return;
    return bindSocketEvents();
  }, [loggedIn, isOverlay, bindSocketEvents]);

  if (isOverlay) {
    return <OverlayPage />;
  }

  if (!ready || loading) {
    return (
      <div className="flex min-h-full items-center justify-center bg-zinc-950">
        <p className="text-sm text-zinc-400">Loading Ripple…</p>
      </div>
    );
  }

  if (!loggedIn) {
    return <LoginPage />;
  }

  if (!firstRunDone && !hasSeenFirstRun(user!.id)) {
    return (
      <FirstRunPage
        onDone={() => {
          markFirstRunSeen(user!.id);
          setFirstRunDone(true);
        }}
      />
    );
  }

  return <HomePage user={user!} sessionId={sessionId} />;
}
