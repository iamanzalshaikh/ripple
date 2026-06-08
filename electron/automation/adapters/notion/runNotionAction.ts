import { isNotionFocused } from "../../../focus/focusContext.js";
import { delay } from "../../delay.js";
import {
  assertNotionReachable,
  createNotionPageAndPaste,
} from "./createPageAndPaste.js";
import {
  focusNotionWorkspace,
  openNotionInBrowser,
  shouldNavigateNotionInActiveTab,
} from "./openNotion.js";

async function ensureNotionOpen(): Promise<void> {
  if (!isNotionFocused()) {
    console.info("[ripple-desktop] Notion — opening browser (log in if prompted)");
    await openNotionInBrowser();
    await delay(3500);
  }
}

async function maybeOpenWorkspace(workspace?: string): Promise<string | null> {
  if (!workspace?.trim()) return null;
  await ensureNotionOpen();
  return focusNotionWorkspace(workspace.trim());
}

export async function runNotionBatch(
  data?: Record<string, unknown>,
): Promise<string> {
  const kind = data?.notionKind;
  const pasteClipboard = data?.pasteClipboard === true;
  const title = typeof data?.title === "string" ? data.title : undefined;
  const body = typeof data?.body === "string" ? data.body : undefined;
  const workspace =
    typeof data?.workspace === "string" ? data.workspace : undefined;

  if (kind === "open") {
    const ws = await maybeOpenWorkspace(workspace);
    if (ws) return ws;
    if (shouldNavigateNotionInActiveTab()) {
      return "Already in Notion — log in if you see a sign-in page";
    }
    console.info("[ripple-desktop] Notion — opening browser (log in if prompted)");
    return openNotionInBrowser();
  }

  if (kind === "create_page") {
    const steps: string[] = [];

    const wsStep = await maybeOpenWorkspace(workspace);
    if (wsStep) steps.push(wsStep);

    assertNotionReachable();

    const onNotion = isNotionFocused();
    const pageResult = await createNotionPageAndPaste(
      {
        pasteClipboard,
        title,
        body,
      },
      onNotion,
    );
    steps.push(pageResult);

    return steps.join(" → ");
  }

  throw new Error(`Unknown Notion action: ${String(kind)}`);
}
