import { createLinkedInPost } from "./createPost.js";
import { openLinkedInInBrowser, searchLinkedInPeople } from "./openLinkedIn.js";

export async function runLinkedInBatch(
  data?: Record<string, unknown>,
): Promise<string> {
  const kind = data?.linkedinKind;

  if (kind === "open") {
    return openLinkedInInBrowser();
  }

  if (kind === "search_people") {
    const query = typeof data?.query === "string" ? data.query.trim() : "";
    if (!query) throw new Error("LinkedIn people search query missing");
    return searchLinkedInPeople(query);
  }

  if (kind === "create_post") {
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    const publish = data?.publish === true;
    return createLinkedInPost({ text: text || undefined, publish });
  }

  throw new Error(`Unknown LinkedIn action: ${String(kind)}`);
}
