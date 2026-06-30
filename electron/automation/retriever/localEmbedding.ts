/**
 * P8b+ — local text embeddings (256-dim hashed n-gram vectors).
 * Pure TypeScript — no sqlite-vec native extension required on Windows.
 */

export const EMBEDDING_DIMS = 256;

function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function normalize(vec: Float32Array): void {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
}

/** Deterministic embedding for semantic similarity search. */
export function embedText(text: string, dims = EMBEDDING_DIMS): Float32Array {
  const vec = new Float32Array(dims);
  const lower = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!lower) return vec;

  const tokens = lower.split(/[^a-z0-9\u0900-\u097F\u0600-\u06FF]+/).filter((t) => t.length >= 2);
  const ngrams: string[] = [...tokens];

  for (let i = 0; i < tokens.length - 1; i++) {
    ngrams.push(`${tokens[i]} ${tokens[i + 1]}`);
  }

  const weight = 1 / Math.sqrt(Math.max(1, ngrams.length));
  for (const gram of ngrams) {
    const h1 = fnv1a(gram) % dims;
    const h2 = fnv1a(`${gram}#`) % dims;
    vec[h1] += weight;
    vec[h2] += weight * 0.5;
  }

  normalize(vec);
  return vec;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return Math.max(0, Math.min(1, dot));
}

export function embeddingToJson(vec: Float32Array): string {
  return JSON.stringify([...vec]);
}

export function embeddingFromJson(raw: string): Float32Array | null {
  try {
    const arr = JSON.parse(raw) as number[];
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return Float32Array.from(arr);
  } catch {
    return null;
  }
}
