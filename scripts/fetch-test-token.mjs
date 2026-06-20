/**
 * Fetch JWT for live E2E tests using RIPPLE_TEST_EMAIL + RIPPLE_TEST_PASSWORD from .env
 * Usage: npm run test:fetch-token
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = process.env.VITE_API_URL ?? "http://127.0.0.1:3007/api/v1";

function loadDotEnv() {
  const path = join(root, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv();

async function tokenWorks(token) {
  const res = await fetch(`${API}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

const token = process.env.RIPPLE_TEST_TOKEN?.trim();
if (token && (await tokenWorks(token))) {
  console.log("RIPPLE_TEST_TOKEN is valid in .env (length %d)", token.length);
  process.exit(0);
}

const email = process.env.RIPPLE_TEST_EMAIL?.trim();
const password = process.env.RIPPLE_TEST_PASSWORD?.trim();

if (!email || !password) {
  console.error(`
Live E2E needs auth in ripple-desktop/.env:

  RIPPLE_TEST_EMAIL=your@email.com
  RIPPLE_TEST_PASSWORD=your-password

Then run: npm run test:fetch-token
`);
  process.exit(1);
}

const res = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});

const body = await res.json();
if (!res.ok) {
  console.error("Login failed:", res.status, JSON.stringify(body, null, 2));
  process.exit(1);
}

const jwt = body?.data?.token;
if (!jwt) {
  console.error("Login OK but no token in response");
  process.exit(1);
}

console.log("\nAdd this line to ripple-desktop/.env:\n");
console.log(`RIPPLE_TEST_TOKEN=${jwt}\n`);
