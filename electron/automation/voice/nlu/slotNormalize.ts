import { preprocessForNlu } from "./preprocess.js";

/**
 * P1 — canonical slot strings before file-op / planner parsers.
 */
export function slotNormalize(command: string): string {
  const { nlu } = preprocessForNlu(command);
  let s = nlu
    .replace(/\bname\s+is\b/gi, "named")
    .replace(/\bcall\s+it\b/gi, "named")
    .replace(/\bdownloads?\s+mein\b/gi, "in downloads")
    .replace(/\bdocuments?\s+mein\b/gi, "in documents")
    .replace(/\bdesktop\s+pe\b/gi, "in desktop")
    .replace(/\bdesktop\s+par\b/gi, "in desktop");

  // "create folder in downloads name user" → named
  s = s.replace(
    /\b(create\s+(?:a\s+)?(?:new\s+)?(?:folder|file|document)\s+in\s+(?:downloads?|documents?|desktop))\s+name\s+/gi,
    "$1, named ",
  );
  s = s.replace(/,\s*name\s+/gi, ", named ");
  s = s.replace(/\bname\s+(?=[A-Za-z0-9])/gi, "named ");

  // "in downloads create folder …" → canonical "create folder in downloads, …"
  s = s.replace(
    /\bin\s+(downloads?|documents?|desktop)\s*,?\s*(create\s+(?:a\s+)?(?:new\s+)?(?:folder|file|document)\s+)/gi,
    "$2 in $1, ",
  );

  return s.replace(/\s{2,}/g, " ").trim();
}
