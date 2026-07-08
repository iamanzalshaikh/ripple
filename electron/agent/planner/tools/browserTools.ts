import { runWhatsAppBatch } from "../../../automation/adapters/whatsapp/runWhatsAppAction.js";
import { runWhatsAppMessageFlow } from "../../../automation/adapters/whatsapp/whatsappAdapter.js";
import { runYouTubeBatch } from "../../../automation/adapters/youtube/runYouTubeAction.js";
import { runLinkedInBatch } from "../../../automation/adapters/linkedin/runLinkedInAction.js";
import { executeReferentialSend } from "../../../automation/adapters/whatsapp/executeReferentialSend.js";
import { openGmailCompose } from "../../../automation/gmailComposeUrl.js";
import { sanitizeEmailAddress } from "../../../automation/emailParse.js";
import { openUrlWithTabResolver } from "../../../automation/browser/browserTabResolver.js";
import { buildBrowserSearchUrl } from "../../../automation/browser/parseBrowserWorkspaceSearch.js";
import {
  hasRegisteredTool,
  registerTool,
} from "../toolRegistry.js";
import type {
  ExecutableToolDefinition,
  RegisteredTool,
  ToolResult,
} from "../toolTypes.js";

function def(
  partial: Omit<ExecutableToolDefinition, "version" | "wave" | "since"> &
    Partial<Pick<ExecutableToolDefinition, "version" | "wave" | "since">>,
): ExecutableToolDefinition {
  return {
    version: "1.0.0",
    since: "P8.5",
    wave: 1,
    risk: "low",
    ...partial,
  };
}

const BROWSER_TOOLS: RegisteredTool[] = [
  {
    definition: def({
      name: "browser.open_workspace",
      description:
        "Open a workspace URL in the active browser tab or default browser",
      category: "browser",
      priority: 95,
      cost: 4,
      idempotent: true,
      execution: { timeoutMs: 20_000 },
      argsSchema: {
        url: { type: "string", required: true },
        workspaceId: { type: "string" },
      },
      examples: ["open youtube", "open gmail"],
    }),
    execute: async (_ctx, args): Promise<ToolResult> => {
      const url = typeof args.url === "string" ? args.url.trim() : "";
      if (!url) {
        return { ok: false, error: "missing_arg:url" };
      }
      const workspaceId =
        typeof args.workspaceId === "string" ? args.workspaceId : undefined;
      try {
        const detail = await openUrlWithTabResolver(url, { workspaceId });
        return { ok: true, output: detail };
      } catch (e: unknown) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "open_workspace_failed",
        };
      }
    },
  },
  {
    definition: def({
      name: "browser.search_workspace",
      description:
        "Search the web in the active browser tab or default browser",
      category: "browser",
      priority: 94,
      cost: 4,
      idempotent: true,
      execution: { timeoutMs: 20_000 },
      argsSchema: {
        query: { type: "string", required: true },
        url: { type: "string" },
      },
      examples: ["search cats", "search for react hooks"],
    }),
    execute: async (_ctx, args): Promise<ToolResult> => {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) {
        return { ok: false, error: "missing_arg:query" };
      }
      const url =
        typeof args.url === "string" && args.url.trim()
          ? args.url.trim()
          : buildBrowserSearchUrl(query);
      try {
        const detail = await openUrlWithTabResolver(url, {
          workspaceId: "search",
        });
        return { ok: true, output: `Search ${query} — ${detail}` };
      } catch (e: unknown) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "search_workspace_failed",
        };
      }
    },
  },
  {
    definition: def({
      name: "browser.whatsapp.send",
      description: "Send or compose a WhatsApp message via extension adapter",
      category: "communication",
      priority: 96,
      cost: 6,
      permissions: ["messaging"],
      execution: { timeoutMs: 60_000 },
      argsSchema: {
        contact: { type: "string" },
        message: { type: "string" },
        send: { type: "boolean" },
        mode: { type: "string", enum: ["message", "compose", "open"] },
        rawCommand: { type: "string" },
      },
      examples: [
        "message noor hello",
        "open whatsapp",
        "search saaliq and say I will be back",
      ],
    }),
    execute: async (_ctx, args): Promise<ToolResult> => {
      const mode =
        typeof args.mode === "string" ? args.mode : ("message" as const);
      const rawCommand =
        typeof args.rawCommand === "string" ? args.rawCommand : "";
      const message = typeof args.message === "string" ? args.message : "";
      const contact =
        typeof args.contact === "string" ? args.contact : undefined;
      const send = args.send === true;

      try {
        if (mode === "open") {
          const detail = await runWhatsAppBatch({
            whatsappKind: "open",
            command: rawCommand,
          });
          return { ok: true, output: detail };
        }
        if (mode === "compose") {
          const detail = await runWhatsAppBatch({
            whatsappKind: "compose_message",
            text: message,
            send,
            command: rawCommand,
          });
          return { ok: true, output: detail };
        }
        if (mode === "referential_send") {
          const referentialMode =
            args.referentialMode === "message_again"
              ? "message_again"
              : "send_file";
          if (!contact?.trim()) {
            return { ok: false, error: "missing_arg:contact" };
          }
          const detail = await executeReferentialSend(
            {
              kind: "referential_send",
              contact,
              mode: referentialMode,
            },
            rawCommand,
          );
          return { ok: true, output: detail };
        }
        const detail = await runWhatsAppMessageFlow({
          text: message,
          recipient: contact,
          send,
          command: rawCommand,
        });
        return { ok: true, output: detail };
      } catch (e: unknown) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "whatsapp_send_failed",
        };
      }
    },
  },
  {
    definition: def({
      name: "browser.youtube.run",
      description: "Open, search, or play on YouTube via browser adapter",
      category: "browser",
      priority: 93,
      cost: 5,
      idempotent: true,
      execution: { timeoutMs: 45_000 },
      argsSchema: {
        kind: { type: "string", enum: ["open", "search", "play"], required: true },
        query: { type: "string" },
        rawCommand: { type: "string" },
      },
      examples: [
        "search react tutorial on youtube",
        "play arthur ghazi season 1 on youtube",
      ],
    }),
    execute: async (_ctx, args): Promise<ToolResult> => {
      const kind =
        typeof args.kind === "string" ? args.kind : ("search" as const);
      const query = typeof args.query === "string" ? args.query : "";
      const rawCommand =
        typeof args.rawCommand === "string" ? args.rawCommand : "";
      try {
        const detail = await runYouTubeBatch({
          youtubeKind: kind,
          query,
          command: rawCommand,
        });
        return { ok: true, output: detail };
      } catch (e: unknown) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "youtube_run_failed",
        };
      }
    },
  },
  {
    definition: def({
      name: "browser.gmail.compose",
      description: "Open Gmail compose with To, Subject, and Body pre-filled",
      category: "communication",
      priority: 92,
      cost: 5,
      permissions: ["messaging"],
      execution: { timeoutMs: 30_000 },
      argsSchema: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        rawCommand: { type: "string" },
      },
      examples: [
        "write mail to john@gmail.com about interview",
        "send email to salik at gmail.com",
      ],
    }),
    execute: async (_ctx, args): Promise<ToolResult> => {
      const toRaw = typeof args.to === "string" ? args.to.trim() : "";
      const subject =
        typeof args.subject === "string" ? args.subject.trim() : "";
      const body = typeof args.body === "string" ? args.body : "";
      try {
        const detail = await openGmailCompose({
          to: toRaw ? sanitizeEmailAddress(toRaw) : undefined,
          subject: subject || undefined,
          body,
        });
        return { ok: true, output: detail };
      } catch (e: unknown) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "gmail_compose_failed",
        };
      }
    },
  },
  {
    definition: def({
      name: "browser.linkedin.run",
      description: "Open, search people, or create post on LinkedIn",
      category: "communication",
      priority: 91,
      cost: 6,
      permissions: ["messaging"],
      execution: { timeoutMs: 60_000 },
      argsSchema: {
        kind: {
          type: "string",
          enum: ["open", "search_people", "create_post"],
          required: true,
        },
        query: { type: "string" },
        text: { type: "string" },
        publish: { type: "boolean" },
        rawCommand: { type: "string" },
      },
      examples: [
        "open linkedin",
        "search people named jasmine on linkedin",
        "create post on linkedin",
      ],
    }),
    execute: async (_ctx, args): Promise<ToolResult> => {
      const kind =
        typeof args.kind === "string" ? args.kind : ("open" as const);
      const query = typeof args.query === "string" ? args.query : "";
      const text = typeof args.text === "string" ? args.text : "";
      const publish = args.publish === true;
      const rawCommand =
        typeof args.rawCommand === "string" ? args.rawCommand : "";
      try {
        const detail = await runLinkedInBatch({
          linkedinKind: kind,
          query,
          text,
          publish,
          command: rawCommand,
        });
        return { ok: true, output: detail };
      } catch (e: unknown) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "linkedin_run_failed",
        };
      }
    },
  },
];

let browserToolsRegistered = false;

export function registerPhase1BrowserTools(): void {
  for (const tool of BROWSER_TOOLS) {
    if (!hasRegisteredTool(tool.definition.name)) {
      registerTool(tool);
    }
  }
  browserToolsRegistered = true;
}

export function listPhase1BrowserToolNames(): string[] {
  return BROWSER_TOOLS.map((t) => t.definition.name);
}

export function resetPhase1BrowserToolsForTests(): void {
  browserToolsRegistered = false;
}

export function phase1BrowserToolsRegistered(): boolean {
  return browserToolsRegistered;
}
