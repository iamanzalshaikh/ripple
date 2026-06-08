import { queryInstagramComposerFromExtension } from "../../../bridge/nativeMessagingBridge.js";

/** Text already typed in the open Instagram DM box. */
export async function readInstagramComposerText(): Promise<string | null> {
  try {
    return await queryInstagramComposerFromExtension();
  } catch {
    return null;
  }
}
