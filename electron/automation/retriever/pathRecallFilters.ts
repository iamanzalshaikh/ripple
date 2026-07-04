/** Paths that must never win semantic / graph / cache recall. */
export function isJunkRecallPath(path: string): boolean {
  const lower = path.toLowerCase().replace(/\\/g, "/");
  return (
    /\/\.git\//.test(lower) ||
    /\/hooks\//.test(lower) ||
    /\.sample$/i.test(lower) ||
    /node_modules/.test(lower) ||
    /\/test-results\//.test(lower) ||
    /e2e-frontend/.test(lower) ||
    /playwright-report/.test(lower)
  );
}
