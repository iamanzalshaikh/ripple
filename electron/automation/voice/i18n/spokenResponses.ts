import type { SpokenLanguage } from "./spokenLanguage.js";
import { detectSpokenLanguage } from "./spokenLanguage.js";

type ResponseKey =
  | "not_found_prefix"
  | "not_found_examples_header"
  | "api_unavailable"
  | "missing_parent_folder"
  | "missing_parent_file"
  | "missing_parent_move"
  | "missing_parent_delete";

const MESSAGES: Record<SpokenLanguage, Record<ResponseKey, string>> = {
  english: {
    not_found_prefix: "I couldn't match that to a desktop action on your PC.",
    not_found_examples_header: "Try saying:",
    api_unavailable:
      "Full voice understanding needs OpenAI — sign in and set OPENAI_API_KEY on ripple-backend.",
    missing_parent_folder:
      "Which location — Downloads, Documents, or Desktop? Try: create folder in downloads named myproject",
    missing_parent_file:
      "Which location — Downloads, Documents, or Desktop? Try: create file in documents named notes.txt",
    missing_parent_move:
      "Which location? Try: move Invoice.pdf from downloads to desktop",
    missing_parent_delete:
      "Which folder? Try: delete temp.txt from downloads",
  },
  hinglish: {
    not_found_prefix: "Yeh command samajh nahi aayi — desktop action match nahi hua.",
    not_found_examples_header: "Aise bol ke dekho:",
    api_unavailable:
      "Poori voice samajh ke liye OpenAI chahiye — ripple-backend par sign in karo aur OPENAI_API_KEY set karo.",
    missing_parent_folder:
      "Kahan banana hai — Downloads, Documents, ya Desktop? Try: downloads mein folder banao naam myproject",
    missing_parent_file:
      "Kahan banana hai? Try: documents mein file banao naam notes.txt",
    missing_parent_move:
      "Kahan move karna hai? Try: Invoice.pdf downloads se desktop par move karo",
    missing_parent_delete:
      "Kis folder se delete? Try: temp.txt downloads se delete karo",
  },
  hindi: {
    not_found_prefix: "यह कमांड समझ नहीं आई — डेस्कटॉप पर कोई मैच नहीं मिला।",
    not_found_examples_header: "ऐसे बोलकर देखें:",
    api_unavailable:
      "पूरी आवाज़ समझने के लिए OpenAI चाहिए — ripple-backend पर साइन इन करें।",
    missing_parent_folder:
      "कहाँ बनाना है — Downloads, Documents, या Desktop? उदाहरण: downloads में folder बनाओ नाम myproject",
    missing_parent_file:
      "कहाँ बनाना है? उदाहरण: documents में file बनाओ नाम notes.txt",
    missing_parent_move:
      "कहाँ move करना है? उदाहरण: Invoice.pdf downloads से desktop पर",
    missing_parent_delete:
      "किस folder से delete? उदाहरण: temp.txt downloads से हटाओ",
  },
  urdu: {
    not_found_prefix: "Yeh command samajh nahi aayi — desktop action match nahi hua.",
    not_found_examples_header: "Aise bol ke dekhein:",
    api_unavailable:
      "Poori voice samajh ke liye OpenAI chahiye — ripple-backend par sign in karein.",
    missing_parent_folder:
      "Kahan banana hai — Downloads, Documents, ya Desktop? Try: downloads mein folder banao naam myproject",
    missing_parent_file:
      "Kahan banana hai? Try: documents mein file banao naam notes.txt",
    missing_parent_move:
      "Kahan move karna hai? Try: Invoice.pdf downloads se desktop par move karo",
    missing_parent_delete:
      "Kis folder se delete? Try: temp.txt downloads se delete karo",
  },
};

const EXAMPLES: Record<SpokenLanguage, string[]> = {
  english: [
    '"Download kholo" or "Open Downloads"',
    '"Create folder in downloads, name myproject"',
    '"Mera resume kholo" or "Open my resume"',
    '"VS Code kholo" or "Open Chrome"',
  ],
  hinglish: [
    '"Download kholo" ya "Open Downloads"',
    '"Downloads mein folder banao naam myproject"',
    '"Mera resume kholo"',
    '"VS Code kholo" ya "Chrome kholo"',
  ],
  hindi: [
    '"डाउनलोड खोलो"',
    '"Downloads में folder बनाओ नाम myproject"',
    '"मेरा रिज्यूमे खोलो"',
    '"VS Code खोलो"',
  ],
  urdu: [
    '"Download kholo" ya "ڈاؤنلوڈ کھولو"',
    '"Downloads mein folder banao"',
    '"Mera resume kholo" / "میرا ریزیوم کھولو"',
    '"VS Code kholo"',
  ],
};

function lang(command?: string | null): SpokenLanguage {
  return detectSpokenLanguage(command);
}

function msg(language: SpokenLanguage, key: ResponseKey): string {
  return MESSAGES[language][key];
}

export function spokenExamples(command?: string | null): string {
  const language = lang(command);
  return EXAMPLES[language].map((e) => `• ${e}`).join("\n");
}

export function spokenNotFound(command: string, detail?: string): string {
  const language = lang(command);
  const preview = command.trim().slice(0, 60);
  const prefix = detail
    ? detail
    : `${msg(language, "not_found_prefix")} "${preview}"`;
  return `${prefix}\n${msg(language, "not_found_examples_header")}\n${spokenExamples(command)}`;
}

export function spokenApiUnavailable(command?: string | null): string {
  const language = lang(command);
  return `${msg(language, "api_unavailable")}\n${msg(language, "not_found_examples_header")}\n${spokenExamples(command)}`;
}

export function spokenMissingParent(
  op: "folder" | "file" | "move" | "delete",
  command?: string | null,
): string {
  const language = lang(command);
  const key = `missing_parent_${op}` as ResponseKey;
  return msg(language, key);
}
