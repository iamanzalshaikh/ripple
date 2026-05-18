export function getRippleApi(): RippleApi {
  if (typeof window !== "undefined" && window.ripple) {
    return window.ripple;
  }
  throw new Error(
    "Ripple desktop API is not available. Run the app with: cd ripple-desktop && npm run dev (do not open localhost:5173 in a browser).",
  );
}

export function isElectron(): boolean {
  return typeof window !== "undefined" && Boolean(window.ripple);
}
