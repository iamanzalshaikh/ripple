import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  getRetrieverSearchPaths,
  powershellSearchRootsLiteral,
  psEscapePath,
} from "../retriever/searchRoots.js";

const execFileAsync = promisify(execFile);

const MAX_DEPTH = 4;
const MAX_RESULTS = 15;
const SEARCH_TIMEOUT_MS = 25_000;

export type WindowsSearchOptions = {
  extension?: string;
  maxResults?: number;
};

function normalizeExtension(ext?: string): string | undefined {
  if (!ext?.trim()) return undefined;
  return ext.trim().replace(/^\./, "").toLowerCase();
}

/**
 * Windows Search Index via OLE DB (fast, OS-indexed files).
 * Scopes: user search roots from indexConfig (Downloads, Documents, Desktop, extras).
 */
export async function searchWindowsIndex(
  spoken: string,
  options: WindowsSearchOptions = {},
): Promise<string[]> {
  if (process.platform !== "win32") return [];

  const token = spoken.trim().toLowerCase();
  const extension = normalizeExtension(options.extension);
  const maxResults = options.maxResults ?? MAX_RESULTS;

  if (!token && !extension) return [];
  if (token && token.length < 2 && !extension) return [];

  const roots = getRetrieverSearchPaths();
  if (roots.length === 0) return [];

  const scopeClause = roots
    .map((p) => `SCOPE='file:${psEscapePath(p)}'`)
    .join(" OR ");

  const tok = psEscapePath(token || extension || "");
  const nameClause = token
    ? `System.FileName LIKE '%${tok}%'`
    : extension
      ? `System.FileName LIKE '%.${psEscapePath(extension)}'`
      : "System.FileName IS NOT NULL";

  const script = `
$scopeClause = "${scopeClause}"
$query = "SELECT TOP ${maxResults} System.ItemPathDisplay FROM SystemIndex WHERE ($scopeClause) AND ${nameClause} AND System.Search.Scope='Indexed'"
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
 * P5 — Windows shell search when index misses (shallow + limited depth).
 */
export async function searchWindowsShell(
  spoken: string,
  options: WindowsSearchOptions = {},
): Promise<string[]> {
  if (process.platform !== "win32") return [];

  const token = spoken.trim().toLowerCase();
  const extension = normalizeExtension(options.extension);
  const maxResults = options.maxResults ?? MAX_RESULTS;

  if (!token && !extension) return [];
  if (token && token.length < 2 && !extension) return [];

  const filter = token ? `*$token*` : `*.${extension}`;
  const tok = psEscapePath(token || extension || "");
  const rootsLiteral = powershellSearchRootsLiteral();

  const script = `
$token = '${tok}'
$filter = '${psEscapePath(filter)}'
$roots = @(${rootsLiteral})
$results = [System.Collections.Generic.List[string]]::new()
foreach ($root in $roots) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  $shallow = Get-ChildItem -LiteralPath $root -Filter $filter -File -ErrorAction SilentlyContinue
  foreach ($hit in $shallow) { $results.Add($hit.FullName) }
  if ($results.Count -ge ${maxResults}) { break }
  $deep = Get-ChildItem -LiteralPath $root -Recurse -Depth ${MAX_DEPTH} -Filter $filter -File -ErrorAction SilentlyContinue
  foreach ($hit in $deep) {
    if (-not $results.Contains($hit.FullName)) { $results.Add($hit.FullName) }
    if ($results.Count -ge ${maxResults}) { break }
  }
  if ($results.Count -ge ${maxResults}) { break }
}
$results | Select-Object -First ${maxResults}
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

/** Extension-only search for time-range queries without a filename token. */
export async function searchWindowsByExtension(
  extension: string,
): Promise<string[]> {
  const ext = normalizeExtension(extension);
  if (!ext) return [];

  const indexHits = await searchWindowsIndex("", { extension: ext });
  if (indexHits.length > 0) return indexHits;
  return searchWindowsShell("", { extension: ext });
}
