import type { ToolDefinition } from "./planTypes.js";

/** P8.5a — Wave 1 tool catalog (manifest source of truth). */
export const PLANNER_TOOLS: ToolDefinition[] = [
  {
    name: "desktop.type_text",
    description: "Type literal text into the focused text field",
    category: "desktop",
    wave: 1,
    argsSchema: {
      text: { type: "string", required: true },
      replaceAll: { type: "boolean" },
      prefocusKeys: { type: "string" },
    },
  },
  {
    name: "desktop.press_keys",
    description: "Send keyboard chords or key sequences (^a, ^c, {ENTER}, etc.)",
    category: "desktop",
    wave: 1,
    argsSchema: {
      keys: { type: "string" },
      sequence: { type: "array" },
    },
    requiresPermission: "clipboard",
  },
  {
    name: "desktop.copy",
    description: "Copy selection to clipboard (Ctrl+C)",
    category: "desktop",
    wave: 1,
    argsSchema: {},
    requiresPermission: "clipboard",
  },
  {
    name: "desktop.paste",
    description: "Paste clipboard into focused field (Ctrl+V)",
    category: "desktop",
    wave: 1,
    argsSchema: {},
    requiresPermission: "clipboard",
  },
  {
    name: "desktop.select_all",
    description: "Select all text in focused field (Ctrl+A)",
    category: "desktop",
    wave: 1,
    argsSchema: {},
  },
  {
    name: "desktop.mouse_click",
    description: "Click at screen coordinates or window center",
    category: "desktop",
    wave: 1,
    argsSchema: {
      x: { type: "number" },
      y: { type: "number" },
      double: { type: "boolean" },
    },
  },
  {
    name: "desktop.mouse_move",
    description: "Move mouse relative or absolute",
    category: "desktop",
    wave: 1,
    argsSchema: {
      x: { type: "number" },
      y: { type: "number" },
      deltaX: { type: "number" },
      deltaY: { type: "number" },
    },
  },
  {
    name: "desktop.mouse_scroll",
    description: "Scroll mouse wheel at position",
    category: "desktop",
    wave: 1,
    argsSchema: {
      direction: { type: "string", enum: ["up", "down"] },
      amount: { type: "number" },
    },
  },
  {
    name: "desktop.mouse_drag",
    description: "Drag mouse between points (draw shapes on canvas)",
    category: "desktop",
    wave: 1,
    argsSchema: {
      shape: { type: "string", enum: ["ellipse", "rect", "line"] },
      radius: { type: "number" },
      length: { type: "number" },
    },
  },
  {
    name: "desktop.launch_app",
    description: "Launch or focus a desktop application",
    category: "apps",
    wave: 1,
    argsSchema: {
      app: { type: "string", required: true },
    },
  },
  {
    name: "desktop.focus_window",
    description: "Bring a window to the foreground",
    category: "apps",
    wave: 1,
    argsSchema: {
      title: { type: "string" },
      hwnd: { type: "number" },
    },
  },
  {
    name: "desktop.close_window",
    description: "Close a window",
    category: "apps",
    wave: 1,
    argsSchema: {
      title: { type: "string" },
    },
  },
  {
    name: "desktop.save_file",
    description: "Save via Save dialog to a folder and filename",
    category: "desktop",
    wave: 1,
    argsSchema: {
      filename: { type: "string", required: true },
      folder: { type: "string" },
    },
  },
  {
    name: "memory.search",
    description: "Search semantic memory and file index",
    category: "memory",
    wave: 1,
    argsSchema: {
      query: { type: "string", required: true },
    },
  },
  {
    name: "browser.search",
    description: "Search in the active browser",
    category: "browser",
    wave: 1,
    argsSchema: {
      query: { type: "string", required: true },
    },
  },
  {
    name: "browser.open_workspace",
    description:
      "Open a workspace URL in the active browser tab or default browser",
    category: "browser",
    wave: 1,
    argsSchema: {
      url: { type: "string", required: true },
      workspaceId: { type: "string" },
    },
  },
  {
    name: "browser.search_workspace",
    description: "Search the web in the active browser tab or default browser",
    category: "browser",
    wave: 1,
    argsSchema: {
      query: { type: "string", required: true },
      url: { type: "string" },
    },
  },
  {
    name: "browser.whatsapp.send",
    description: "Send WhatsApp message via extension adapter",
    category: "communication",
    wave: 1,
    argsSchema: {
      contact: { type: "string" },
      // Required only when actually sending — see planValidator send-aware check.
      // Empty message is valid for "open this contact's chat" (search/navigate).
      message: { type: "string" },
    },
    requiresPermission: "messaging",
  },
  {
    name: "browser.youtube.run",
    description: "Open, search, or play on YouTube",
    category: "browser",
    wave: 1,
    argsSchema: {
      kind: { type: "string", required: true },
      query: { type: "string" },
      rawCommand: { type: "string" },
    },
  },
  {
    name: "browser.linkedin.run",
    description: "Open, search people, or create post on LinkedIn",
    category: "communication",
    wave: 1,
    argsSchema: {
      kind: { type: "string", required: true },
      query: { type: "string" },
      text: { type: "string" },
      publish: { type: "boolean" },
      rawCommand: { type: "string" },
    },
    requiresPermission: "messaging",
  },
  {
    name: "browser.gmail.compose",
    description: "Compose Gmail via extension adapter",
    category: "communication",
    wave: 1,
    argsSchema: {
      to: { type: "string" },
      subject: { type: "string" },
      body: { type: "string" },
      rawCommand: { type: "string" },
    },
    requiresPermission: "messaging",
  },
  {
    name: "system.clipboard.read",
    description: "Read clipboard text",
    category: "system",
    wave: 1,
    argsSchema: {},
    requiresPermission: "clipboard",
  },
  {
    name: "system.clipboard.write",
    description: "Write text to clipboard",
    category: "system",
    wave: 1,
    argsSchema: {
      text: { type: "string", required: true },
    },
    requiresPermission: "clipboard",
  },
  {
    name: "filesystem.delete",
    description: "Delete a file or folder",
    category: "desktop",
    wave: 2,
    argsSchema: {
      path: { type: "string" },
      sourceName: { type: "string" },
      parentFolder: { type: "string" },
    },
  },
  {
    name: "filesystem.create",
    description: "Create a new file",
    category: "desktop",
    wave: 2,
    argsSchema: {
      fileName: { type: "string", required: true },
      parentFolder: { type: "string", required: true },
    },
  },
  {
    name: "filesystem.create_folder",
    description: "Create a new folder",
    category: "desktop",
    wave: 2,
    argsSchema: {
      folderName: { type: "string", required: true },
      parentFolder: { type: "string", required: true },
    },
  },
  {
    name: "filesystem.rename",
    description: "Rename a file or folder",
    category: "desktop",
    wave: 2,
    argsSchema: {
      sourceName: { type: "string", required: true },
      newName: { type: "string", required: true },
      parentFolder: { type: "string" },
    },
  },
  {
    name: "filesystem.move",
    description: "Move a file or folder",
    category: "desktop",
    wave: 2,
    argsSchema: {
      sourceName: { type: "string", required: true },
      destinationFolder: { type: "string", required: true },
      parentFolder: { type: "string" },
    },
  },
  {
    name: "filesystem.open",
    description: "Open a file or folder",
    category: "desktop",
    wave: 2,
    argsSchema: {
      folder: { type: "string" },
      fileName: { type: "string" },
      itemName: { type: "string" },
      parentFolder: { type: "string" },
      path: { type: "string" },
    },
  },
  {
    name: "filesystem.list_directory",
    description: "List files in a folder",
    category: "desktop",
    wave: 2,
    argsSchema: {
      parentFolder: { type: "string", required: true },
      folder: { type: "string" },
      maxEntries: { type: "number" },
    },
  },
];

export const TOOL_MANIFEST_VERSION = "1.3.0";

export function getToolManifest(): {
  version: string;
  categories: Record<string, string[]>;
  tools: ToolDefinition[];
} {
  const categories: Record<string, string[]> = {};
  for (const tool of PLANNER_TOOLS) {
    if (!categories[tool.category]) categories[tool.category] = [];
    categories[tool.category].push(tool.name);
  }
  return {
    version: TOOL_MANIFEST_VERSION,
    categories,
    tools: PLANNER_TOOLS.filter((t) => t.wave <= 2),
  };
}

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return PLANNER_TOOLS.find((t) => t.name === name);
}

export function isKnownTool(name: string): boolean {
  return PLANNER_TOOLS.some((t) => t.name === name);
}
