import { describe, it } from "vitest";
import { probeP8bSearch, seedP8bTestData } from "../p8bTestSeed.js";

/** Run: npm run seed:p8b */
describe("P8b seed CLI", () => {
  it("seeds test memory and prints voice commands", () => {
    const data = seedP8bTestData();
    const ahmed = probeP8bSearch("Open PDF I discussed with Ahmed");
    const sarah = probeP8bSearch("that thing Sarah sent");

    console.log("\n=== P8b SEED OK ===");
    console.log("Folder:", data.dir);
    console.log("Ahmed PDF:", data.ahmedPdf);
    console.log("Sarah PDF:", data.sarahPdf);
    console.log("Goa PDF:", data.goaPdf);
    console.log("\nProbe Ahmed:", ahmed);
    console.log("Probe Sarah:", sarah);
    console.log("\n=== VOICE (Ctrl+Space in Ripple) ===");
    console.log("1. Open PDF I discussed with Ahmed");
    console.log("2. Open that thing Sarah sent");
    console.log("3. Remember my Goa trip was March 15 2025");
    console.log("4. Open pdf before my Goa trip");
    console.log("========================\n");
  });
});
