/**
 * Phase 4.7 — Devanagari (Hindi) phrase → English slots for desktop NLU.
 */

import { containsDevanagari } from "./scriptDetect.js";

export { containsDevanagari };

const PHRASE_MAP: [RegExp, string][] = [
  [
    /क्रिएट\s+(?:नया|निव|नय)?\s*फोल्डर\s+इन\s+डाउनलोड\s+नेम\s+(.+)/gi,
    "create folder in downloads, named $1",
  ],
  [
    /क्रिएट\s+निव\s+फोल्डर\s*,?\s*नेम\s*,?\s*(.+?)\s*,?\s*इन\s+डाउनलोड/gi,
    "create folder in downloads, named $1",
  ],
  [
    /क्रिएट\s+करो\s+(?:एक\s+)?(?:new\s+)?(?:folder|फोल्डर)\s+डाउनलोड\s+में\s*,?\s*इसका\s+नाम\s+होना\s+चाहिए\s+(.+)/gi,
    "create folder in downloads, named $1",
  ],
  [
    /क्रिएट\s+करो\s+फोल्डर\s+डाउनलोड\s+में\s+नाम\s+(.+)/gi,
    "create folder in downloads, named $1",
  ],
  [
    /क्रिएट\s+(?:नया|निव)?\s*फोल्डर\s+इन\s+दस्तावेज़?\s+नेम\s+(.+)/gi,
    "create folder in documents, named $1",
  ],
  [
    /क्रिएट\s+(?:नया|निव)?\s*फोल्डर\s+इन\s+डेस्कटॉप\s+नेम\s+(.+)/gi,
    "create folder in desktop, named $1",
  ],
  [/डाउनलोड\s*खोलो/gi, "open downloads"],
  [/डाउनलोड\s*खोल/gi, "open downloads"],
  [/मेरा\s*फोल्डर\s*खोलो/gi, "open my folder"],
  [/मेरे\s*फोल्डर\s*खोलो/gi, "open my folder"],
  [/डाउनलोड\s*फोल्डर\s*खोलो/gi, "open downloads"],
  [/दस्तावेज़?\s*खोलो/gi, "open documents"],
  [/दस्तावेज\s*खोलो/gi, "open documents"],
  [/डेस्कटॉप\s*खोलो/gi, "open desktop"],
  [/डेस्कटॉप\s*खोल\s*करो/gi, "open desktop"],
  [/ओपन\s+डेस्क(?:\s*टॉप|\s*टोप)/gi, "open desktop"],
  [/ओपेन\s+डेस्क(?:\s*टॉप|\s*टोप)/gi, "open desktop"],
  // Whisper often emits अ+न+ज+ल (no halant); source regex had अ+न+्+ज+ल
  [/ओ(?:पन|दन)\s+(?:अंजल|अन्जल|अनजल)/gi, "open anzal"],
  [
    /ओ(?:पन|दन)\s+फोल्डर\s*,?\s*(.+?)\s*,?\s*इन\s+डाउनलोड/gi,
    "open folder $1 in downloads",
  ],
  [
    /ओ(?:पन|दन)\s+फोल्डर\s+(.+?)\s+इन\s+डाउनलोड/gi,
    "open folder $1 in downloads",
  ],
  [/ओ(?:पन|दन)\s+(.+?)\s+इन\s+डाउनलोड/gi, "open $1 in downloads"],
  [/फोल्ड़?वर्स/gi, "followers"],
  [/फॉलोअर्स/gi, "followers"],
  [/फोलोअर्स/gi, "followers"],
  [/वापस\s+लाओ/gi, "bring it back"],
  [/लाओ\s+वापस/gi, "bring it back"],
  [/ओ(?:पन|दन)\s+डाउनलोड/gi, "open downloads"],
  [/ओ(?:पन|दन)\s+डाउनलोड्स/gi, "open downloads"],
  [/अपने\s+सेटिंग(?:\s+अपने\s+सेटिंग)?/gi, "open settings"],
  [/सेटिंग(?:\s+सेटिंग)?\s*खोलो/gi, "open settings"],
  [/सेटिंग्स?\s+खोलो/gi, "open settings"],
  [/सेटिंग\s+खोल/gi, "open settings"],
  [/ब्लूटूथ\s+सेटिंग\s+खोलो/gi, "open bluetooth settings"],
  [/वाई\s*फाई\s+सेटिंग\s+खोलो/gi, "open wifi settings"],
  [/वाईफाई\s+सेटिंग\s+खोलो/gi, "open wifi settings"],
  [/डाउनलोड\s*में\s*फोल्डर\s*बनाओ\s*,?\s*नाम\s+(.+)/gi, "create folder in downloads, named $1"],
  [/डाउनलोड\s*में\s*फ़ाइल\s*बनाओ\s*,?\s*नाम\s+(.+)/gi, "create file in downloads, named $1"],
  [/डाउनलोड\s*में\s*फाइल\s*बनाओ\s*,?\s*नाम\s+(.+)/gi, "create file in downloads, named $1"],
  [/दस्तावेज़?\s*में\s*फोल्डर\s*बनाओ\s*,?\s*नाम\s+(.+)/gi, "create folder in documents, named $1"],
  [/Desktop\s*खोलो/gi, "open desktop"],
  [/Desktop\s*खोल\s*करो/gi, "open desktop"],
  [/मेरा\s*रिज्यूमे\s*खोलो/gi, "open my resume"],
  [/मेरी\s*रिज्यूमे\s*खोलो/gi, "open my resume"],
  [/मेरा\s*रिज्यूम\s*खोलो/gi, "open my resume"],
  [/कल\s*वाली\s*फाइल\s*दिखाओ/gi, "open yesterday file"],
  [/कल\s*वाली\s*पीडीएफ\s*खोलो/gi, "open yesterday pdf"],
  [/कल\s*की\s*पीडीएफ\s*खोलो/gi, "open yesterday pdf"],
  [/डाउनलोड\s*खोलो\s*और\s*मेरा\s*रिज्यूमे\s*खोलो/gi, "open downloads and open my resume"],
  [/डाउनलोड\s*खोलो\s*और\s*मेरा\s*रिज्यूम\s*खोलो/gi, "open downloads and open my resume"],
  [/अनजल\s*का\s*फाइल\s*लेंगे/gi, "open Anzal file"],
  [/अनजल\s*का\s*फाइल/gi, "open Anzal file"],
  [/सर्च\s*डॉक्टर\s*फातिमा/gi, "search Dr Fatima"],
  [/व्हाट्सएप\s*खोलो/gi, "open whatsapp"],
  [/व्हाट्सएप्प\s*खोलो/gi, "open whatsapp"],
  [/फिर\s*से\s*खोलो/gi, "open it again"],
  [/दोबारा\s*खोलो/gi, "open it again"],
  [/सेम\s*फोल्डर\s*अगेन/gi, "same folder again"],
  [/सेम\s*फाइल\s*अगेन/gi, "same file again"],
  [/वापस\s*जाओ/gi, "go back"],
  [/पिछली\s*फाइल\s*खोलो/gi, "open last file"],
  [/आखिरी\s*डाउनलोड\s*खोलो/gi, "open last downloaded file"],
  [/नोटपैड\s*खोलो/gi, "open notepad"],
  [/कैलकुलेटर\s*खोलो/gi, "open calculator"],
  [/वी\s*एस\s*कोड\s*खोलो/gi, "open vs code"],
  [/क्रोम\s*खोलो/gi, "open chrome"],
];

const WORD_MAP: [RegExp, string][] = [
  [/\bक्रिएट\b/gu, "create"],
  [/\bक्रेट\b/gu, "create"],
  [/\bक्रियेट\b/gu, "create"],
  [/\bनिव\b/gu, "new"],
  [/\bनया\b/gu, "new"],
  [/\bनय\b/gu, "new"],
  [/\bइन\b/gu, "in"],
  [/\bनेम\b/gu, "named"],
  [/\bहोना\s+चाहिए\b/gu, ""],
  [/\bइसका\b/gu, ""],
  [/\bकरो\b/gu, ""],
  [/\bकर\s*दो\b/gu, ""],
  [/\bखोलो\b/gu, "open"],
  [/\bखोल\b/gu, "open"],
  [/\bदिखाओ\b/gu, "show"],
  [/\bदिखा\b/gu, "show"],
  [/\bभेजो\b/gu, "send"],
  [/\bभेज\s*दो\b/gu, "send"],
  [/\bमेरा\b/gu, "my"],
  [/\bमेरी\b/gu, "my"],
  [/\bमेरे\b/gu, "my"],
  [/\bऔर\b/gu, "and"],
  [/\bकल\b/gu, "yesterday"],
  [/\bआज\b/gu, "today"],
  [/\bफाइल\b/gu, "file"],
  [/\bफ़ाइल\b/gu, "file"],
  [/\bफोल्डर\b/gu, "folder"],
  [/\bरिज्यूमे\b/gu, "resume"],
  [/\bरिज्यूम\b/gu, "resume"],
  [/\bडाउनलोड\b/gu, "downloads"],
  [/\bडाउनलोड्स\b/gu, "downloads"],
  [/\bडॉक्टर\b/gu, "Dr"],
  [/\bसर्च\b/gu, "search"],
  [/\bव्हाट्सएप\b/gu, "whatsapp"],
  [/\bव्हाट्सएप्प\b/gu, "whatsapp"],
  [/\bनोटपैड\b/gu, "notepad"],
  [/\bकैलकुलेटर\b/gu, "calculator"],
  [/\bक्रोम\b/gu, "chrome"],
  [/\bदोबारा\b/gu, "again"],
  [/\bफिर\s*से\b/gu, "again"],
  [/\bपिछली\b/gu, "last"],
  [/\bआखिरी\b/gu, "last"],
  [/\bदस्तावेज़?\b/gu, "documents"],
  [/\bडेस्कटॉप\b/gu, "desktop"],
  [/\bओपन\b/gu, "open"],
  [/\bओपेन\b/gu, "open"],
  [/\bओदन\b/gu, "open"],
  [/\bसेटिंग\b/gu, "settings"],
  [/\bसेटिंग्स\b/gu, "settings"],
  [/\bब्लूटूथ\b/gu, "bluetooth"],
  [/\bवाईफाई\b/gu, "wifi"],
  [/\bवाई\s*फाई\b/gu, "wifi"],
  [/\bमें\b/gu, "in"],
  [/\bनाम\b/gu, "named"],
  [/\bबनाओ\b/gu, "create"],
  [/\bबना\s*दो\b/gu, "create"],
  [/\bहैलो\b/gu, "hello"],
  [/\bनमस्ते\b/gu, "hello"],
];

export function normalizeHindi(text: string): string {
  if (!containsDevanagari(text)) return text;

  let s = text.trim().replace(/\s+/g, " ");
  for (const [re, rep] of PHRASE_MAP) {
    s = s.replace(re, rep);
  }
  for (const [re, rep] of WORD_MAP) {
    s = s.replace(re, rep);
  }

  s = s.replace(/\s+and\s+open\s+my\s+resume/gi, " and open my resume");
  s = s.replace(/\bshow\s+my\b/gi, "open my");

  if (s.length > 0) {
    s = s.charAt(0).toUpperCase() + s.slice(1);
  }
  return s.replace(/\s{2,}/g, " ").trim();
}
