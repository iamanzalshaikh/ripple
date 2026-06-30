import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { FocusContext } from "../../focus/focusContext.js";
import { searchIndexByName } from "../../storage/fileIndex.js";
import { getMemory, setMemory } from "../../storage/sessionMemory.js";
import { recordFileTouch } from "../../storage/recordFileTouch.js";
import { retrieveFileCandidates } from "../retriever/retriever.js";

/** Extract `report (1).pdf` from Edge/Chrome PDF tab titles. */
export function extractPdfNameFromWindowTitle(title: string): string | null {
  const t = title.trim();
  if (!t) return null;

  const patterns = [
    /([^\\/|"\n]+\.pdf)\s+(?:and\s+\d+\s+more\s+page|-\s+(?:Personal|Work|Microsoft\s+Edge|Google\s+Chrome))/i,
    /([^\\/|"\n]+\.pdf)\s*[-|–]\s+/i,
    /([^\\/|"\n]+\.pdf)\s*$/i,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }

  return null;
}

/** Local PDF path from `file:///` tab URL. */
export function extractPdfPathFromUrl(url?: string): string | null {
  if (!url?.trim()) return null;
  const raw = url.trim();
  if (!/^file:/i.test(raw)) return null;

  try {
    const decoded = decodeURIComponent(raw.replace(/^file:\/+/, ""));
    const path = decoded.replace(/\//g, "\\");
    if (path.toLowerCase().endsWith(".pdf") && existsSync(path)) {
      return path;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function isPdfViewerContext(ctx: FocusContext): boolean {
  if (extractPdfPathFromUrl(ctx.activeTabUrl)) return true;
  if (extractPdfNameFromWindowTitle(ctx.windowTitle)) return true;

  const p = ctx.processName.toLowerCase();
  if (
    (p === "msedge" || p === "chrome" || p === "firefox" || p === "brave") &&
    /\.pdf/i.test(ctx.windowTitle)
  ) {
    return true;
  }
  return p.includes("acrobat") || p.includes("acrord32");
}

function rememberViewedPdf(path: string, source: string): void {
  const normalized = path.trim();
  if (!normalized.toLowerCase().endsWith(".pdf")) return;

  const prev = getMemory("last_viewed_pdf");
  const now = String(Date.now());
  setMemory("last_viewed_pdf", normalized);
  setMemory("last_viewed_pdf_at", now);
  setMemory("last_pdf", normalized);
  setMemory("last_file", normalized);
  setMemory("last_opened_path", normalized);
  setMemory("last_opened_kind", "file");
  if (prev !== normalized) {
    recordFileTouch({
      path: normalized,
      command: `viewed pdf (${source})`,
      source: "open",
    });
  }
  console.info(
    `[ripple-desktop] memory last_viewed_pdf (${source}) → ${normalized}`,
  );
}

function pickBestPdfMatch(candidates: string[], pdfName: string): string | null {
  const want = pdfName.toLowerCase();
  const exact = candidates.find(
    (p) => basename(p).toLowerCase() === want,
  );
  if (exact) return exact;

  const stem = want.replace(/\.pdf$/i, "");
  const partial = candidates.find((p) => {
    const base = basename(p).toLowerCase();
    return base.includes(stem) || stem.includes(base.replace(/\.pdf$/i, ""));
  });
  return partial ?? candidates[0] ?? null;
}

export function findPdfOnDiskSync(pdfName: string): string | null {
  const token = pdfName.replace(/\.pdf$/i, "").trim();
  if (!token) return null;

  const indexed = searchIndexByName(token);
  const fromIndex = pickBestPdfMatch(indexed, pdfName);
  if (fromIndex && existsSync(fromIndex)) return fromIndex;

  const indexedFull = searchIndexByName(pdfName);
  const fromFull = pickBestPdfMatch(indexedFull, pdfName);
  if (fromFull && existsSync(fromFull)) return fromFull;

  return null;
}

export async function findPdfOnDiskAsync(pdfName: string): Promise<string | null> {
  const sync = findPdfOnDiskSync(pdfName);
  if (sync) return sync;

  const token = pdfName.replace(/\.pdf$/i, "").trim();
  const candidates = await retrieveFileCandidates({
    phrase: pdfName,
    token,
    extension: "pdf",
  });

  const paths = candidates.map((c) => c.path);
  const picked = pickBestPdfMatch(paths, pdfName);
  return picked && existsSync(picked) ? picked : null;
}

async function resolveAndRememberPdf(pdfName: string): Promise<void> {
  const path = await findPdfOnDiskAsync(pdfName);
  if (path) {
    setMemory("last_viewed_pdf_title", pdfName);
    rememberViewedPdf(path, "resolved");
  }
}

/** Update session memory when user views a PDF in browser / viewer. */
export function rememberPdfFromFocus(ctx: FocusContext): void {
  if (!isPdfViewerContext(ctx)) return;

  const fromUrl = extractPdfPathFromUrl(ctx.activeTabUrl);
  if (fromUrl) {
    rememberViewedPdf(fromUrl, "focus-url");
    return;
  }

  const pdfName = extractPdfNameFromWindowTitle(ctx.windowTitle);
  if (!pdfName) return;

  setMemory("last_viewed_pdf_title", pdfName);
  setMemory("last_viewed_pdf_at", String(Date.now()));

  const sync = findPdfOnDiskSync(pdfName);
  if (sync) {
    rememberViewedPdf(sync, "focus-title");
    return;
  }

  void resolveAndRememberPdf(pdfName);
}

/** Resolve which PDF path to open for recall:pdf — P8 long-term activity + history. */
export async function resolveLastPdfPath(
  ctx: FocusContext | null,
): Promise<string | null> {
  const { resolveLastOpenedByKind } = await import("./p8RecallResolver.js");
  return resolveLastOpenedByKind("pdf", ctx);
}
