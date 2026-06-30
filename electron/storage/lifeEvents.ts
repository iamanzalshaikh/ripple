import { getRippleDb } from "./rippleDb.js";

export type LifeEvent = {
  id: number;
  label: string;
  topic: string;
  eventAt: string;
  endAt: string | null;
  tags: string[];
  createdAt: string;
};

function ensureTable(): void {
  getRippleDb();
}

export function upsertLifeEvent(args: {
  label: string;
  topic: string;
  eventAt: string;
  endAt?: string | null;
  tags?: string[];
}): LifeEvent {
  ensureTable();
  const now = new Date().toISOString();
  const label = args.label.trim().slice(0, 200);
  const topic = args.topic.trim().toLowerCase().slice(0, 200);
  const tagsJson = JSON.stringify(args.tags ?? []);

  const existing = getRippleDb()
    .prepare(`SELECT id FROM life_events WHERE topic = ? LIMIT 1`)
    .get(topic) as { id: number } | undefined;

  if (existing) {
    getRippleDb()
      .prepare(
        `UPDATE life_events SET label = ?, event_at = ?, end_at = ?, tags = ?, created_at = ?
         WHERE id = ?`,
      )
      .run(label, args.eventAt, args.endAt ?? null, tagsJson, now, existing.id);
    return getLifeEventById(existing.id)!;
  }

  const result = getRippleDb()
    .prepare(
      `INSERT INTO life_events (label, topic, event_at, end_at, tags, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(label, topic, args.eventAt, args.endAt ?? null, tagsJson, now);

  return getLifeEventById(Number(result.lastInsertRowid))!;
}

function getLifeEventById(id: number): LifeEvent | null {
  const row = getRippleDb()
    .prepare(
      `SELECT id, label, topic, event_at, end_at, tags, created_at
       FROM life_events WHERE id = ?`,
    )
    .get(id) as
    | {
        id: number;
        label: string;
        topic: string;
        event_at: string;
        end_at: string | null;
        tags: string;
        created_at: string;
      }
    | undefined;

  if (!row) return null;
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags) as string[];
    if (!Array.isArray(tags)) tags = [];
  } catch {
    tags = [];
  }

  return {
    id: row.id,
    label: row.label,
    topic: row.topic,
    eventAt: row.event_at,
    endAt: row.end_at,
    tags,
    createdAt: row.created_at,
  };
}

/** Match "goa trip" from "before my Goa trip" or topic phrase. */
export function findLifeEventByTopicPhrase(phrase: string): LifeEvent | null {
  ensureTable();
  const needles = topicNeedlesFromPhrase(phrase);
  if (needles.length === 0) return null;

  const rows = getRippleDb()
    .prepare(`SELECT id, label, topic, event_at, end_at, tags, created_at FROM life_events`)
    .all() as Array<{
    id: number;
    label: string;
    topic: string;
    event_at: string;
    end_at: string | null;
    tags: string;
    created_at: string;
  }>;

  let best: { event: LifeEvent; score: number } | null = null;

  for (const row of rows) {
    const topic = row.topic.toLowerCase();
    const label = row.label.toLowerCase();
    let score = 0;
    for (const n of needles) {
      if (topic.includes(n) || label.includes(n)) score += 2;
      if (topic === n || label === n) score += 3;
    }
    if (score === 0) continue;
    const event = getLifeEventById(row.id);
    if (!event) continue;
    if (!best || score > best.score) best = { event, score };
  }

  return best?.event ?? null;
}

function topicNeedlesFromPhrase(phrase: string): string[] {
  const lower = phrase.trim().toLowerCase();
  const out = new Set<string>();

  const beforeMy = lower.match(/\bbefore\s+my\s+(.+?)\s*$/);
  if (beforeMy?.[1]) {
    const topic = beforeMy[1].replace(/\b(trip|vacation|wedding|meeting)\s*$/i, "").trim();
    if (topic) out.add(topic);
    out.add(beforeMy[1].trim());
  }

  for (const word of lower.split(/\s+/)) {
    const w = word.replace(/[^a-z0-9]/gi, "");
    if (w.length >= 3) out.add(w);
  }

  return [...out];
}

/** ISO window: everything before the life event start. */
export function windowBeforeLifeEvent(event: LifeEvent): {
  startMs: number;
  endMs: number;
} {
  const endMs = new Date(event.eventAt).getTime();
  const startMs = endMs - 365 * 24 * 60 * 60 * 1000;
  return { startMs, endMs };
}

export function listLifeEvents(limit = 50): LifeEvent[] {
  ensureTable();
  const rows = getRippleDb()
    .prepare(
      `SELECT id FROM life_events ORDER BY event_at DESC LIMIT ?`,
    )
    .all(limit) as Array<{ id: number }>;

  return rows.map((r) => getLifeEventById(r.id)!).filter(Boolean);
}

export function clearLifeEvents(): void {
  ensureTable();
  getRippleDb().exec(`DELETE FROM life_events`);
}
