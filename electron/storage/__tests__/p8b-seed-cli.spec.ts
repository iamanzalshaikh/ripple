import { describe, it } from "vitest";
import {
  P8B_VOICE_COMMANDS,
  probeP8bSearch,
  seedP8bTestData,
} from "../p8bTestSeed.js";

/** Run: npm run seed:p8b */
describe("P8b seed CLI", () => {
  it("seeds test memory and prints voice commands", () => {
    const data = seedP8bTestData();

    console.log("\n=== P8b SEED OK ===");
    console.log("Folder:", data.dir);
    console.log("Ahmed PDF:", data.ahmedPdf);
    console.log("Sarah PDF:", data.sarahPdf);
    console.log("Goa PDF:", data.goaPdf);
    console.log("Atlas attachment:", data.atlasAttachment);
    console.log("Ahmed attachment:", data.ahmedAttachment);

    console.log("\n=== PROBES ===");
    for (const phrase of P8B_VOICE_COMMANDS) {
      console.log(`\n"${phrase}"`);
      console.log(probeP8bSearch(phrase));
    }

    console.log("\n=== VOICE (Ctrl+Space in Ripple) ===");
    P8B_VOICE_COMMANDS.forEach((cmd, i) => {
      console.log(`${i + 1}. ${cmd}`);
    });
    console.log("========================\n");
  });
});
