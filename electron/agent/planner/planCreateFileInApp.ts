import { join } from "node:path";

import type { WorldModel } from "../types.js";

import type { PlanStep } from "./planTypes.js";

import { getStableFocusTitles } from "../../focus/focusContext.js";

import {

  parseCreateFileInAppCommand,

  resolveEditorWorkspace,

  type CreateFileInAppIntent,

} from "../../automation/desktop/parseCreateFileInAppCommand.js";



export function isCreateFileInAppCommand(command?: string | null): boolean {

  return parseCreateFileInAppCommand(command) !== null;

}



function collectEditorTitles(world?: WorldModel | null): string[] {

  const titles: string[] = [];

  const seen = new Set<string>();

  const push = (raw?: string | null) => {

    const title = raw?.trim();

    if (!title || seen.has(title)) return;

    seen.add(title);

    titles.push(title);

  };

  push(world?.foreground?.windowTitle);

  push(world?.focusContext?.windowTitle);

  for (const title of getStableFocusTitles()) push(title);

  return titles;

}



/** Executable steps for create-file-in-editor (Cursor uses filesystem, others save dialog). */

export function planStepsForCreateFileInApp(

  intent: CreateFileInAppIntent,

  world?: WorldModel | null,

): PlanStep[] {

  const { filename, application: app } = intent;



  if (app === "cursor") {

    const workspace = resolveEditorWorkspace(collectEditorTitles(world));

    if (workspace) {

      const filePath = join(workspace, filename);

      return [

        {

          tool: "filesystem.write_file",

          args: { path: filePath, content: "", createDirs: true },

          reason: "create_file_cursor",

        },

        {

          tool: "desktop.focus_window",

          args: { app: "cursor" },

          reason: "focus_cursor",

        },

      ];

    }

  }



  return [

    {

      tool: "desktop.save_file",

      args: { filename, app },

      reason: "create_file_in_app",

    },

  ];

}


