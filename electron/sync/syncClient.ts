import { getAccessToken } from "../auth/tokenStore.js";
import {
  apiSyncPull,
  apiSyncPush,
  type SyncPullItem,
  type SyncPushItem,
} from "../services/api.js";
import {
  learnCorrection,
  listCorrections,
  removeCorrection,
} from "../storage/voiceCorrections.js";
import { learnSnippet, listSnippets, removeSnippet } from "../storage/snippets.js";
import {
  listStyleProfiles,
  removeStyleProfile,
  setStyleProfile,
  type StyleTone,
} from "../storage/styleProfiles.js";
import { getUserPreferences, updateUserPreference } from "../storage/userPreferences.js";
import { deleteNote, listNotes, upsertNoteFromSync } from "../storage/notes.js";

export type SyncKind = "dictionary" | "snippet" | "style" | "preference" | "note";

/**
 * P9.1.C — push on change. Fire-and-forget by design: a sync failure must
 * never block or fail the local action that triggered it (adding a
 * dictionary word must work identically whether or not you're online).
 * No-ops silently when logged out.
 */
export function pushSyncItemAsync(
  kind: SyncKind,
  key: string,
  payload: unknown,
  deleted = false,
): void {
  void (async () => {
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) return;
      const item: SyncPushItem = {
        kind,
        key,
        payload,
        deleted,
        updatedAt: new Date().toISOString(),
      };
      const res = await apiSyncPush(accessToken, [item]);
      if (!res.success) {
        console.warn(`[ripple-sync] push failed kind=${kind} key=${key}: ${res.message}`);
      }
    } catch (e: unknown) {
      console.warn(
        `[ripple-sync] push error kind=${kind} key=${key}:`,
        e instanceof Error ? e.message : e,
      );
    }
  })();
}

/**
 * Apply one pulled cloud item to local storage. Deliberately calls the
 * storage functions directly (not the IPC handlers) so applying a pull can
 * never re-trigger pushSyncItemAsync and loop.
 */
export function applyPulledItem(item: SyncPullItem): void {
  switch (item.kind as SyncKind) {
    case "dictionary": {
      const payload = item.payload as { canonicalForm?: string; source?: string } | null;
      if (item.deleted || !payload?.canonicalForm) {
        removeCorrection(item.key);
        return;
      }
      learnCorrection({
        spokenForm: item.key,
        canonicalForm: payload.canonicalForm,
        source: payload.source ?? "sync",
      });
      return;
    }
    case "snippet": {
      const payload = item.payload as { expansion?: string } | null;
      if (item.deleted || !payload?.expansion) {
        removeSnippet(item.key);
        return;
      }
      learnSnippet({ trigger: item.key, expansion: payload.expansion });
      return;
    }
    case "style": {
      const payload = item.payload as { tone?: StyleTone } | null;
      if (item.deleted || !payload?.tone) {
        removeStyleProfile(item.key);
        return;
      }
      setStyleProfile({ processName: item.key, tone: payload.tone });
      return;
    }
    case "preference": {
      const payload = item.payload as { value?: string } | null;
      if (!payload?.value) return;
      if (
        item.key === "language" ||
        item.key === "quiet_mode" ||
        item.key === "mic_device_id" ||
        item.key === "pipeline_layers" ||
        item.key === "meeting_consent"
      ) {
        updateUserPreference(item.key, payload.value);
      }
      return;
    }
    case "note": {
      const payload = item.payload as
        | { title?: string; body?: string; createdAt?: string }
        | null;
      if (item.deleted || !payload) {
        deleteNote(item.key);
        return;
      }
      // item.key is the note's id — cloud is authoritative for id on pull.
      upsertNoteFromSync({
        id: item.key,
        title: payload.title ?? "Untitled note",
        body: payload.body ?? "",
        createdAt: payload.createdAt ?? item.updatedAt,
        updatedAt: item.updatedAt,
      });
      return;
    }
    default:
      return;
  }
}

/** Full pull (no `since`) — used at login. Cloud is source of truth for this step. */
export async function pullAndApplySync(): Promise<{ ok: boolean; applied: number }> {
  try {
    const accessToken = await getAccessToken();
    if (!accessToken) return { ok: false, applied: 0 };
    const res = await apiSyncPull(accessToken);
    if (!res.success) {
      console.warn(`[ripple-sync] pull failed: ${res.message}`);
      return { ok: false, applied: 0 };
    }
    for (const item of res.data.items) {
      try {
        applyPulledItem(item);
      } catch (e: unknown) {
        console.warn(
          `[ripple-sync] apply failed kind=${item.kind} key=${item.key}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
    console.info(`[ripple-sync] pull applied ${res.data.items.length} item(s)`);
    return { ok: true, applied: res.data.items.length };
  } catch (e: unknown) {
    console.warn("[ripple-sync] pull error:", e instanceof Error ? e.message : e);
    return { ok: false, applied: 0 };
  }
}

/**
 * Push everything currently on this device, once. Needed because a device
 * may already have local dictionary/snippets/styles/prefs from *before* this
 * login — pushSyncItemAsync only fires on *future* changes, so without this
 * a fresh login would never upload pre-existing local-only data.
 */
async function pushAllLocalState(accessToken: string): Promise<void> {
  const items: SyncPushItem[] = [];

  for (const c of listCorrections(500)) {
    items.push({
      kind: "dictionary",
      key: c.spokenForm,
      payload: { canonicalForm: c.canonicalForm, source: c.source },
      updatedAt: c.updatedAt,
    });
  }
  for (const s of listSnippets(500)) {
    items.push({
      kind: "snippet",
      key: s.trigger,
      payload: { expansion: s.expansion },
      updatedAt: s.updatedAt,
    });
  }
  for (const st of listStyleProfiles()) {
    items.push({
      kind: "style",
      key: st.processName,
      payload: { tone: st.tone },
      updatedAt: st.updatedAt,
    });
  }
  for (const n of listNotes(500)) {
    items.push({
      kind: "note",
      key: n.id,
      payload: { title: n.title, body: n.body, createdAt: n.createdAt },
      updatedAt: n.updatedAt,
    });
  }
  const prefs = getUserPreferences();
  const prefsUpdatedAt = prefs.updatedAt ?? new Date().toISOString();
  if (prefs.language) {
    items.push({
      kind: "preference",
      key: "language",
      payload: { value: prefs.language },
      updatedAt: prefsUpdatedAt,
    });
  }
  if (prefs.quietMode) {
    items.push({
      kind: "preference",
      key: "quiet_mode",
      payload: { value: prefs.quietMode },
      updatedAt: prefsUpdatedAt,
    });
  }
  if (prefs.pipelineLayers) {
    items.push({
      kind: "preference",
      key: "pipeline_layers",
      payload: { value: prefs.pipelineLayers },
      updatedAt: prefsUpdatedAt,
    });
  }
  if (prefs.meetingConsent) {
    items.push({
      kind: "preference",
      key: "meeting_consent",
      payload: { value: prefs.meetingConsent },
      updatedAt: prefsUpdatedAt,
    });
  }

  if (items.length === 0) return;
  try {
    const res = await apiSyncPush(accessToken, items);
    if (res.success) {
      console.info(
        `[ripple-sync] initial push: ${res.data.applied} applied, ${res.data.skipped} skipped (older than cloud)`,
      );
    } else {
      console.warn(`[ripple-sync] initial push failed: ${res.message}`);
    }
  } catch (e: unknown) {
    console.warn("[ripple-sync] initial push error:", e instanceof Error ? e.message : e);
  }
}

/**
 * P9.1.C — orchestrates login-time sync. Push-then-pull, not pull-then-push:
 * pushing first lets the server's last-write-wins logic weigh this device's
 * pre-existing local data against whatever's already in the cloud: pulling
 * first would overwrite local state before push ever got to read it,
 * silently discarding genuine local-only edits.
 */
export async function runLoginSync(): Promise<void> {
  const accessToken = await getAccessToken();
  if (!accessToken) return;
  await pushAllLocalState(accessToken);
  await pullAndApplySync();
}
