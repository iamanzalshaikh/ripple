import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const MAX_DEPTH = 4;
const MAX_RESULTS = 15;
const SEARCH_TIMEOUT_MS = 25_000;

function psEscape(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Windows Search Index via OLE DB (fast, OS-indexed files).
 */
export async function searchWindowsIndex(spoken: string): Promise<string[]> {
  if (process.platform !== "win32") return [];

  const token = spoken.trim().toLowerCase();
  if (!token || token.length < 2) return [];

  const dl = psEscape(join(homedir(), "Downloads"));
  const doc = psEscape(join(homedir(), "Documents"));
  const desk = psEscape(join(homedir(), "Desktop"));
  const tok = psEscape(token);

  const script = `
$token = '${tok}'
$scopes = @(
  "file:${dl}",
  "file:${doc}",
  "file:${desk}"
)
$scopeClause = ($scopes | ForEach-Object { "SCOPE='$_'" }) -join ' OR '
$query = "SELECT TOP ${MAX_RESULTS} System.ItemPathDisplay FROM SystemIndex WHERE ($scopeClause) AND System.FileName LIKE '%$token%' AND System.Search.Scope='Indexed'"
try {
  $conn = New-Object -ComObject ADODB.Connection
  $conn.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")
  $rs = $conn.Execute($query)
  $out = [System.Collections.Generic.List[string]]::new()
  while (-not $rs.EOF) {
    $val = $rs.Fields.Item(0).Value
    if ($val) { $out.Add([string]$val) }
    $rs.MoveNext()
  }
  $rs.Close()
  $conn.Close()
  $out
} catch {
  @()
}
`;

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 12_000, maxBuffer: 2 * 1024 * 1024 },
    );

    return stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 2);
  } catch {
    return [];
  }
}

/**
 * Phase P5 — Windows shell search fallback when index misses.
 */
export async function searchWindowsShell(spoken: string): Promise<string[]> {
  if (process.platform !== "win32") return [];

  const token = spoken.trim().toLowerCase();
  if (!token || token.length < 2) return [];

  const dl = psEscape(join(homedir(), "Downloads"));
  const doc = psEscape(join(homedir(), "Documents"));
  const desk = psEscape(join(homedir(), "Desktop"));
  const tok = psEscape(token);

  const script = `
$token = '${tok}'
$roots = @('${dl}','${doc}','${desk}')
$results = [System.Collections.Generic.List[string]]::new()
foreach ($root in $roots) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  $shallow = Get-ChildItem -LiteralPath $root -Filter "*$token*" -File -ErrorAction SilentlyContinue
  foreach ($hit in $shallow) { $results.Add($hit.FullName) }
  if ($results.Count -ge ${MAX_RESULTS}) { break }
  $deep = Get-ChildItem -LiteralPath $root -Recurse -Depth ${MAX_DEPTH} -Filter "*$token*" -File -ErrorAction SilentlyContinue
  foreach ($hit in $deep) {
    if (-not $results.Contains($hit.FullName)) { $results.Add($hit.FullName) }
    if ($results.Count -ge ${MAX_RESULTS}) { break }
  }
  if ($results.Count -ge ${MAX_RESULTS}) { break }
}
$results | Select-Object -First ${MAX_RESULTS}
`;

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: SEARCH_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 },
    );

    return stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 2);
  } catch (e: unknown) {
    console.warn(
      "[ripple-desktop] Windows shell search failed:",
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}
