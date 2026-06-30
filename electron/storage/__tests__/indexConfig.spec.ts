import { describe, expect, it, afterEach } from "vitest";
import {
  DEFAULT_SEARCH_ROOT_KEYS,
  getExtraSearchRoots,
  getSearchRootKeys,
  setExtraSearchRoots,
} from "../indexConfig.js";

describe("indexConfig P5", () => {
  afterEach(() => {
    setExtraSearchRoots([]);
  });

  it("defaults to downloads, documents, desktop", () => {
    expect(getSearchRootKeys()).toEqual([...DEFAULT_SEARCH_ROOT_KEYS]);
  });

  it("appends optional extra roots without removing defaults", () => {
    setExtraSearchRoots(["projects", "downloads"]);
    expect(getSearchRootKeys()).toEqual([
      "downloads",
      "documents",
      "desktop",
      "projects",
    ]);
    expect(getExtraSearchRoots()).toEqual(["projects", "downloads"]);
  });
});
