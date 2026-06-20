import type { WellKnownFolder } from "../../desktop/parseDesktopCommand.js";
import type { NativeCommandIntent } from "../../desktop/parseNativeCommand.js";
import type { SmartSearchIntent } from "../../desktop/parseSmartSearchCommand.js";
import type { SystemActionId } from "../../desktop/systemActions.js";
import { resolveNativeApp } from "../../desktop/nativeAppRegistry.js";
import type { RecallTarget } from "../../desktop/parseSessionMemoryCommand.js";

export type DesktopIntentPlan = {
  action: string;
  entities: {
    folder?: WellKnownFolder;
    from_folder?: WellKnownFolder;
    to_folder?: WellKnownFolder;
    item_name?: string;
    file_token?: string;
    app_name?: string;
    new_name?: string;
    extension?: string;
    time?: "yesterday" | "today" | "last_week";
    recall_target?: RecallTarget | "workspace";
    system_action?: string;
  };
  confidence: number;
};

function systemActionId(raw?: string): SystemActionId | null {
  switch (raw) {
    case "lock":
      return "lock_pc";
    case "settings":
      return "open_settings";
    case "bluetooth":
      return "open_bluetooth_settings";
    case "network":
    case "wifi":
      return "open_network_settings";
    case "control_panel":
      return "open_control_panel";
    case "task_manager":
      return null;
    default:
      return null;
  }
}

function smartSearchFromEntities(
  e: DesktopIntentPlan["entities"],
): SmartSearchIntent | null {
  const token = e.file_token?.trim().toLowerCase();
  const ext = e.extension?.trim().toLowerCase();

  if (
    token === "download" ||
    token === "downloads" ||
    /\blast\s+download/i.test(token ?? "")
  ) {
    return {
      kind: "smart_search",
      query: { type: "last_downloaded" },
      label: "last_downloaded",
    };
  }

  if (e.time === "yesterday" && (ext === "pdf" || !token)) {
    return {
      kind: "smart_search",
      query: { type: "modified_yesterday", extension: ext || "pdf" },
      label: "yesterday_pdf",
    };
  }

  if (e.time === "today" && ext === "pdf") {
    return {
      kind: "smart_search",
      query: { type: "modified_today", extension: "pdf" },
      label: "today_pdf",
    };
  }

  if (e.time === "yesterday" && token) {
    return {
      kind: "smart_search",
      query: { type: "edited_yesterday", token },
      label: `edited_yesterday_${token}`,
    };
  }

  if (token) {
    return {
      kind: "smart_search",
      query: { type: "latest_token", token },
      label: `latest_${token.replace(/\s+/g, "_")}`,
    };
  }

  return null;
}

/** Map backend LLM desktop plan → local NativeCommandIntent. */
export function nativeIntentFromLlmPlan(
  plan: DesktopIntentPlan,
): NativeCommandIntent | null {
  const e = plan.entities;

  switch (plan.action) {
    case "open_folder":
      if (e.folder) return { kind: "folder", folder: e.folder };
      return null;

    case "open_file": {
      const smart = smartSearchFromEntities(e);
      if (smart) return smart;
      if (e.item_name) {
        if (e.from_folder) {
          return { kind: "item", name: e.item_name, parent: e.from_folder };
        }
        return { kind: "item", name: e.item_name };
      }
      if (e.file_token) {
        return smartSearchFromEntities({ file_token: e.file_token }) ?? {
          kind: "item",
          name: e.file_token,
          parent: e.from_folder,
        };
      }
      return null;
    }

    case "open_item":
      if (!e.item_name) return null;
      return {
        kind: "item",
        name: e.item_name,
        parent: e.from_folder ?? e.folder,
      };

    case "open_app": {
      const name = e.app_name?.trim();
      if (!name) return null;
      const app = resolveNativeApp(name);
      if (!app) return null;
      return { kind: "launch_app", app };
    }

    case "switch_app": {
      const name = e.app_name?.trim();
      if (!name) return null;
      const app = resolveNativeApp(name);
      if (!app) return null;
      return { kind: "switch_app", app };
    }

    case "close_app": {
      const name = e.app_name?.trim();
      if (!name) return null;
      const app = resolveNativeApp(name);
      if (!app) return null;
      return { kind: "close_app", app };
    }

    case "smart_search": {
      const smart = smartSearchFromEntities(e);
      return smart;
    }

    case "recall_last": {
      const target = (e.recall_target ?? "auto") as RecallTarget;
      return { kind: "recall_memory", target };
    }

    case "delete_file":
      if (!e.item_name) return null;
      return {
        kind: "delete_file",
        sourceName: e.item_name,
        parent: e.from_folder ?? e.folder,
      };

    case "rename_file":
      if (!e.item_name || !e.new_name) return null;
      return {
        kind: "rename_file",
        sourceName: e.item_name,
        newName: e.new_name,
        parent: e.from_folder ?? e.folder,
      };

    case "move_file":
      if (!e.item_name || !e.to_folder) return null;
      return {
        kind: "move_file",
        sourceName: e.item_name,
        destination: e.to_folder,
        parent: e.from_folder ?? e.folder,
      };

    case "create_folder":
      if (!e.item_name && !e.file_token) return null;
      return {
        kind: "create_folder",
        name: e.item_name ?? e.file_token ?? "New Folder",
        parent: e.from_folder ?? e.folder,
      };

    case "create_file":
      if (!e.item_name && !e.file_token) return null;
      return {
        kind: "create_file",
        name: e.item_name ?? e.file_token ?? "notes.txt",
        parent: e.from_folder ?? e.folder,
      };

    case "system_action": {
      if (e.system_action === "task_manager") {
        const app = resolveNativeApp("task manager");
        if (app) return { kind: "launch_app", app };
      }
      const action = systemActionId(e.system_action);
      if (!action) return null;
      return { kind: "system_action", action };
    }

    default:
      return null;
  }
}
