/**
 * 120+ production cases — phases 3.5 through 4.7.
 * Regression matrix, not proof of infinite natural-language coverage.
 */
export type E2ECase = {
  id: string;
  phase: string;
  phrase: string;
  route: "desktop" | "whatsapp" | "youtube" | "none";
  kind?: string;
  tags?: string[];
};

const FILLERS = ["Bhai", "Yaar", "Sun", "Dekho", "Plz", "Bro", "Arre", "Please"] as const;

function dlCases(): E2ECase[] {
  const verbs = [
    "download kholo",
    "downloads kholo",
    "download kar do",
    "downloads khol do",
    "documents kholo",
    "desktop kholo",
  ] as const;
  return FILLERS.flatMap((f, fi) =>
    verbs.map((v, vi) => ({
      id: `dl-${fi}-${vi}`,
      phase: "4.7",
      phrase: `${f} ${v}`,
      route: "desktop" as const,
      kind: v.includes("document")
        ? "folder"
        : v.includes("desktop")
          ? "folder"
          : "folder",
      tags: ["hinglish", "folder", f.toLowerCase()],
    })),
  );
}

function resumeCases(): E2ECase[] {
  const forms = [
    "mera resume kholo",
    "meri resume dikhao",
    "mere resume open karo",
    "bhai mera resume kholo na",
    "open my resume",
    "show my resume",
    "find my resume",
  ] as const;
  return forms.map((p, i) => ({
    id: `resume-${i}`,
    phase: "4.5",
    phrase: p.charAt(0).toUpperCase() + p.slice(1),
    route: "desktop" as const,
    kind: "smart_search",
    tags: ["resume", "hinglish"],
  }));
}

function appCases(): E2ECase[] {
  const cmds = [
    ["Open calculator", "launch_app"],
    ["Launch notepad", "launch_app"],
    ["Start paint", "launch_app"],
    ["Open VS Code", "launch_app"],
    ["Bhai VS Code kholo", "launch_app"],
    ["Calculator kholo", "launch_app"],
    ["Notepad khol do", "launch_app"],
    ["VS Code chalu kar do", "launch_app"],
    ["Chrome band karo", "close_app"],
    ["Close chrome", "close_app"],
    ["Switch to VS Code", "switch_app"],
    ["Focus chrome", "switch_app"],
    ["Minimize all windows", "minimize_all"],
    ["कैलकुलेटर खोलो", "launch_app"],
  ] as const;
  return cmds.map(([phrase, kind], i) => ({
    id: `app-${i}`,
    phase: "4.1",
    phrase,
    route: "desktop" as const,
    kind,
    tags: ["app"],
  }));
}

function searchCases(): E2ECase[] {
  return [
    { id: "search-kal", phrase: "Kal wali pdf kholo", kind: "smart_search" },
    { id: "search-yesterday", phrase: "Yaar kal wali pdf dikhao", kind: "smart_search" },
    { id: "search-dr", phrase: "search Dr Fatima", kind: "smart_search" },
    { id: "search-last", phrase: "Open the last downloaded file", kind: "smart_search" },
    { id: "search-hi-resume", phrase: "मेरा रिज्यूमे खोलो", kind: "smart_search" },
    { id: "search-ur-resume", phrase: "میرا ریزیوم کھولو", kind: "smart_search" },
  ].map((c) => ({
    ...c,
    phase: "4.5",
    route: "desktop" as const,
    tags: ["search"],
  }));
}

function memoryCases(): E2ECase[] {
  const phrases = [
    ["Open it again", "recall_memory"],
    ["Same file again", "recall_memory"],
    ["Dubara kholo", "recall_memory"],
    ["Phir se open karo", "recall_memory"],
    ["फिर से खोलो", "recall_memory"],
    ["Woh project kholo", "recall_memory"],
    ["Open that project", "recall_memory"],
    ["Go back", "recall_memory"],
    ["Bring it back", "recall_memory"],
  ] as const;
  return phrases.map(([phrase, kind], i) => ({
    id: `mem-${i}`,
    phase: "4.6",
    phrase,
    route: "desktop" as const,
    kind,
    tags: ["memory"],
  }));
}

function fileOpCases(): E2ECase[] {
  return [
    { phrase: "Create folder called TestRipple", kind: "create_folder" },
    { phrase: "Delete temp.txt", kind: "delete_file" },
    { phrase: "Rename old.txt to new.txt", kind: "rename_file" },
    { phrase: "Move invoice.pdf to desktop", kind: "move_file" },
    { phrase: "OpenResume.pdf", kind: "file" },
    { phrase: "Downloads mein folder banao naam user", kind: "create_folder" },
    { phrase: "Downloads mein file banao naam todo.txt", kind: "create_file" },
    { phrase: "Create folder in downloads, name user", kind: "create_folder" },
    { phrase: "Delete temp.txt kar do", kind: "delete_file" },
    { phrase: "temp.txt delete karo", kind: "delete_file" },
    { phrase: "डाउनलोड में फोल्डर बनाओ, नाम user", kind: "create_folder" },
  ].map((c, i) => ({
    id: `fileop-${i}`,
    phase: "4.2",
    route: "desktop" as const,
    tags: ["fileop"],
    ...c,
  }));
}

function systemCases(): E2ECase[] {
  return [
    { phrase: "Lock my PC", kind: "system_action" },
    { phrase: "Open settings", kind: "system_action" },
    { phrase: "Open bluetooth settings", kind: "system_action" },
    { phrase: "Bluetooth settings kholo", kind: "system_action" },
    { phrase: "Open setting", kind: "system_action" },
  ].map((c, i) => ({
    id: `sys-${i}`,
    phase: "4.4",
    route: "desktop" as const,
    tags: ["system"],
    ...c,
  }));
}

function compoundCases(): E2ECase[] {
  return [
    "Downloads kholo aur mera resume kholo",
    "Open downloads and open my resume",
    "Download karo aur open mera resume",
    "Download kholo and resume open karo mera",
    "Download kholo phir resume kholo",
  ].map((phrase, i) => ({
    id: `compound-${i}`,
    phase: "4.7",
    phrase,
    route: "desktop" as const,
    kind: "compound",
    tags: ["compound", "hinglish"],
  }));
}

function i18nFolderCases(): E2ECase[] {
  return [
    { phrase: "डाउनलोड खोलो", kind: "folder" },
    { phrase: "ڈاؤنلوڈ کھولو", kind: "folder" },
    { phrase: "Download kholo", kind: "folder" },
    { phrase: "Upon downloads", kind: "folder" },
    { phrase: "Open download", kind: "folder" },
    { phrase: "Upon documents", kind: "folder" },
    { phrase: "Download open for me", kind: "folder" },
  ].map((c, i) => ({
    id: `i18n-folder-${i}`,
    phase: "4.7",
    route: "desktop" as const,
    tags: ["i18n", "folder"],
    ...c,
  }));
}

function webAppCases(): E2ECase[] {
  return [
    { phrase: "Open YouTube", route: "desktop" as const, kind: "open_workspace" },
    { phrase: "Search YouTube for React hooks", route: "desktop" as const, kind: "smart_search" },
    { phrase: "Message Noor hello", route: "whatsapp" as const, kind: "workflow" },
    { phrase: "Open WhatsApp", route: "whatsapp" as const, kind: "workflow" },
    { phrase: "व्हाट्सएप खोलो", route: "whatsapp" as const, kind: "workflow" },
    { phrase: "Open gmail", route: "desktop" as const, kind: "open_workspace" },
  ].map((c, i) => ({
    id: `web-${i}`,
    phase: "3.5",
    tags: ["webapp"],
    ...c,
  }));
}

function whisperMishearCases(): E2ECase[] {
  return [
    { phrase: "Upon my downloads", kind: "folder" },
    { phrase: "Open desktop for me", kind: "folder" },
    { phrase: "Remember, work mode, open VS Code", kind: "remember_workflow" },
    { phrase: "Move, invoice.pdf to, desktop", kind: "move_file" },
    { phrase: "Search Ammi1 and say how are you", route: "whatsapp" as const, kind: "workflow" },
    { phrase: "search me one and say hello", route: "whatsapp" as const, kind: "workflow" },
    { phrase: "whats app", route: "none" as const },
  ].map((c, i) => ({
    id: `whisper-${i}`,
    phase: "4.7",
    route: ("route" in c ? c.route : "desktop") as E2ECase["route"],
    kind: "kind" in c ? c.kind : undefined,
    tags: ["whisper"],
    phrase: c.phrase,
  }));
}

function negativeCases(): E2ECase[] {
  const phrases = [
    "Tell me a joke",
    "What's the weather",
    "Write email to boss",
    "Hello",
    "Thanks",
    "asdf qwerty zxcv",
    "Write me a poem about cats",
    "Spotify switch karo",
    "Parso wali file",
  ];
  return phrases.map((phrase, i) => ({
    id: `neg-${i}`,
    phase: "4.7",
    phrase,
    route: "none" as const,
    tags: ["negative"],
  }));
}

const HINGLISH_FILLERS = [
  "Bhai",
  "Yaar",
  "Sun",
  "Dekho",
  "Plz",
  "Bro",
  "Arre",
  "Please",
  "Jaldi",
  "Ek kaam karo",
] as const;

const FOLDER_TARGETS = ["downloads", "documents", "desktop"] as const;

/** Extra Hinglish folder open variants — GPT long tail when fast path misses tone. */
function hinglishFolderToneCases(): E2ECase[] {
  const verbs = [
    "kholo",
    "khol do",
    "open karo",
    "dikhao",
    "le aao",
  ] as const;
  const cases: E2ECase[] = [];
  let n = 0;
  for (const filler of HINGLISH_FILLERS) {
    for (const folder of FOLDER_TARGETS) {
      for (const verb of verbs) {
        cases.push({
          id: `tone-folder-${n++}`,
          phase: "4.7",
          phrase: `${filler} ${folder} ${verb}`,
          route: "desktop",
          kind: "folder",
          tags: ["hinglish", "folder", "tone", "gpt-fallback"],
        });
      }
    }
  }
  return cases;
}

/** Hinglish file-op phrasing — many miss fast path; GPT + slots handle. */
function hinglishFileOpToneCases(): E2ECase[] {
  const templates = [
    ["downloads mein folder banao naam ripple", "create_folder"],
    ["documents mein file banao naam notes.txt", "create_file"],
    ["desktop pe folder banao test", "create_folder"],
    ["temp.txt delete karo downloads se", "delete_file"],
    ["invoice.pdf ko desktop pe move karo", "move_file"],
    ["old.txt ka naam new.txt kar do", "rename_file"],
    ["downloads se Anzal delete kar do", "delete_file"],
    ["folder banao downloads mein naam alpha", "create_folder"],
    ["file banao documents mein todo.txt", "create_file"],
  ] as const;
  const cases: E2ECase[] = [];
  let n = 0;
  for (const filler of HINGLISH_FILLERS.slice(0, 6)) {
    for (const [body, kind] of templates) {
      cases.push({
        id: `tone-fileop-${n++}`,
        phase: "4.2",
        phrase: `${filler} ${body}`,
        route: "desktop",
        kind,
        tags: ["hinglish", "fileop", "gpt-fallback"],
      });
    }
  }
  return cases;
}

/** Resume / search tone variants. */
function searchToneCases(): E2ECase[] {
  const forms = [
    "mera resume dikhao",
    "resume kholo na",
    "latest pdf dikhao",
    "kal wali file kholo",
    "aakhri download dikhao",
    "my invoice open karo",
    "show my cv",
    "find latest resume",
  ] as const;
  const cases: E2ECase[] = [];
  let n = 0;
  for (const filler of HINGLISH_FILLERS.slice(0, 5)) {
    for (const body of forms) {
      cases.push({
        id: `tone-search-${n++}`,
        phase: "4.5",
        phrase: `${filler} ${body}`,
        route: "desktop",
        kind: "smart_search",
        tags: ["search", "hinglish", "gpt-fallback"],
      });
    }
  }
  return cases;
}

/** App launch Hinglish tone. */
function appToneCases(): E2ECase[] {
  const apps = [
    ["calculator kholo", "launch_app"],
    ["notepad chalu karo", "launch_app"],
    ["chrome band karo", "close_app"],
    ["vscode pe switch karo", "switch_app"],
    ["paint kholo jaldi", "launch_app"],
  ] as const;
  const cases: E2ECase[] = [];
  let n = 0;
  for (const filler of HINGLISH_FILLERS.slice(0, 4)) {
    for (const [body, kind] of apps) {
      cases.push({
        id: `tone-app-${n++}`,
        phase: "4.1",
        phrase: `${filler} ${body}`,
        route: "desktop",
        kind,
        tags: ["app", "hinglish"],
      });
    }
  }
  return cases;
}

/** Recall / dubara tone. */
function recallToneCases(): E2ECase[] {
  const forms = [
    "dubara kholo",
    "phir se kholo",
    "same file again",
    "woh file phir kholo",
  ] as const;
  const cases: E2ECase[] = [];
  let n = 0;
  for (const filler of HINGLISH_FILLERS.slice(0, 5)) {
    for (const body of forms) {
      cases.push({
        id: `tone-recall-${n++}`,
        phase: "4.6",
        phrase: `${filler} ${body}`,
        route: "desktop",
        kind: "recall_memory",
        tags: ["memory", "hinglish"],
      });
    }
  }
  return cases;
}

export const PRODUCTION_E2E_MATRIX: E2ECase[] = [
  ...dlCases(),
  ...resumeCases(),
  ...appCases(),
  ...searchCases(),
  ...memoryCases(),
  ...fileOpCases(),
  ...systemCases(),
  ...compoundCases(),
  ...i18nFolderCases(),
  ...webAppCases(),
  ...whisperMishearCases(),
  ...negativeCases(),
  ...hinglishFolderToneCases(),
  ...hinglishFileOpToneCases(),
  ...searchToneCases(),
  ...appToneCases(),
  ...recallToneCases(),
];

export const MATRIX_STATS = {
  total: PRODUCTION_E2E_MATRIX.length,
  byPhase: PRODUCTION_E2E_MATRIX.reduce(
    (acc, c) => {
      acc[c.phase] = (acc[c.phase] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  ),
};
