import { describe, expect, it } from "vitest";
import { scriptLinks } from "../../../src/config.js";
import { getLinks } from "../../../src/inventory.js";

/**
 * The clean fixture carries a resource widget in lesson 10 and does not set
 * `links.scriptLinks`, so this is the content repository that has never heard
 * of the option. Nothing it gets back may change.
 */
describe("a content repository without links.scriptLinks", () => {
  it("has the option off", () => {
    expect(scriptLinks).toBe(null);
  });

  it("gets no script links, though a widget script is there", () => {
    expect(getLinks().filter((link) => link.kind === "script-link")).toEqual([]);
    expect(getLinks().some((link) => link.url.includes("docs.example.com/install"))).toBe(false);
  });
});
