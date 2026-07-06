/**
 * Stop stale Ripple dev servers (Vite 5173/5174, CDP 9333) and child Electron.
 * Usage: node scripts/stop-dev.mjs
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORTS = [5173, 5174, 9333];

function ps(command) {
  return new Promise((resolve) => {
    const child = spawn("powershell", ["-NoProfile", "-Command", command], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      out += d.toString();
    });
    child.on("close", () => resolve(out.trim()));
  });
}

async function killPort(port) {
  const script = `
    $killed = @()
    Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique |
      ForEach-Object {
        if ($_ -and $_ -ne 0) {
          Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
          $killed += $_
        }
      }
    if ($killed.Count) { $killed -join ',' } else { '' }
  `;
  const pids = await ps(script);
  if (pids) {
    console.log(`[stop-dev] port ${port} → stopped PID(s) ${pids}`);
    return Number(pids.split(",")[0]) || 0;
  }
  return 0;
}

async function killRippleElectron() {
  const script = `
    $root = '${ROOT.replace(/'/g, "''")}'
    Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine -like "*$root*" } |
      ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        $_.ProcessId
      }
  `;
  const out = await ps(script);
  if (out) {
    console.log(`[stop-dev] electron → stopped PID(s) ${out.replace(/\s+/g, ", ")}`);
  }
}

async function main() {
  console.log("[stop-dev] Stopping stale Ripple dev processes…");
  for (const port of PORTS) {
    await killPort(port);
  }
  await killRippleElectron();
  await new Promise((r) => setTimeout(r, 800));
  console.log("[stop-dev] Done. Run: npm run dev");
}

main().catch((e) => {
  console.error("[stop-dev] error:", e);
  process.exit(1);
});
