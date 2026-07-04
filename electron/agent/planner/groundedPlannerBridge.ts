import { preprocessForNlu } from "../../automation/voice/nlu/preprocess.js";

import { tryGroundedLookup } from "../../automation/planner/planExecute.js";

import type { CommandResultPayload } from "../../automation/types.js";



export type GroundedPlannerResult =

  | { kind: "payload"; payload: CommandResultPayload; source: string }

  | { kind: "clarify"; question: string; options: string[] };



/** Graph / retriever ladder before GPT — folded into P8.5 pipeline. */

export async function tryGroundedPlannerResult(

  command: string,

): Promise<GroundedPlannerResult | null> {

  const trimmed = command.trim();

  if (!trimmed) return null;

  const { nlu } = preprocessForNlu(trimmed);

  const grounded = await tryGroundedLookup(trimmed, nlu);

  if (grounded?.kind === "payload") {

    console.info(`[ripple-p85] grounded hit source=${grounded.source}`);

    return {

      kind: "payload",

      payload: grounded.payload,

      source: grounded.source,

    };

  }

  if (grounded?.kind === "clarify") {

    console.info("[ripple-p85] grounded clarify");

    return {

      kind: "clarify",

      question: grounded.question,

      options: grounded.candidates.map((c) => c.label),

    };

  }

  return null;

}



/** @deprecated Use tryGroundedPlannerResult */

export async function tryGroundedDesktopPayload(

  command: string,

): Promise<CommandResultPayload | null> {

  const result = await tryGroundedPlannerResult(command);

  return result?.kind === "payload" ? result.payload : null;

}

