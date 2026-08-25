import { beforeAll, describe, expect, it } from "vitest";
import { driftBudget, staleImageDays } from "../../src/config.js";
import { checkDriftAll, pinnedRefs } from "../../src/drift.js";
import { getInventory } from "../../src/inventory.js";
import { style } from "../../src/report.js";
import { expectWithinBudget } from "../helpers.js";

/**
 * Compares digests pinned in the content against the registry.
 *
 * These are warnings: pinning an old image is sometimes deliberate, and the
 * images rebuild continuously so every pin is behind its tag within days.
 * Age is what carries the signal, so the report is ranked by it.
 */
const blocks = getInventory();
const refs = pinnedRefs(blocks);

/** Which lessons pin a given reference, so a warning points somewhere. */
function mentions(ref) {
  return blocks
    .filter((b) => b.imageRefs.includes(ref))
    .map((b) => ({ editorRef: b.editorRef, url: b.url }));
}

describe("digest pins", () => {
  /** @type {import("../../src/drift.js").DriftResult[]} */
  let results;

  beforeAll(async () => {
    results = await checkDriftAll(refs);
  }, 300_000);

  it("finds digest-pinned references to check", () => {
    expect(refs.length).toBeGreaterThan(0);
  });

  it("keeps stale pins under the ceiling", () => {
    const stale = results
      .filter((r) => r.status === "stale")
      .sort((a, b) => b.ageDays - a.ageDays);

    expectWithinBudget(stale.length, driftBudget.staleImageRefs, {
      severity: "warning",
      title: `digest pins older than ${staleImageDays} days`,
      why:
        "The prose around a pinned digest describes that build: its package " +
        "versions, its CVE counts, its sample output. Once the pin is this " +
        "old, a reader pulling the image today sees something different. " +
        "Ordered oldest first.",
      items: stale.map((r) => ({
        summary: `${style.warn(`${r.ageDays} days old`)}  ${style.muted(
          `built ${r.created.toISOString().slice(0, 10)}`,
        )}`,
        details: [["image", r.ref]],
        locations: mentions(r.ref),
      })),
      fix:
        "Re-capture the example against a current image and update both the " +
        "digest and the surrounding output. If the lesson pins an old image " +
        "deliberately, to diff it against a newer one, say so in the prose so " +
        "the age reads as intentional.",
    });
  });

  it("summarizes how far behind each pin is", () => {
    const tally = new Map();
    for (const r of results) tally.set(r.status, (tally.get(r.status) ?? 0) + 1);
    console.log(
      `Digest pins: ${[...tally].map(([k, v]) => `${k}=${v}`).join(" ")}`,
    );

    const aged = results
      .filter((r) => r.ageDays !== null)
      .sort((a, b) => b.ageDays - a.ageDays);
    if (aged.length > 0) {
      console.log(
        `Oldest pins:\n${aged
          .slice(0, 5)
          .map((r) => `  ${String(r.ageDays).padStart(5)}d  ${r.ref}`)
          .join("\n")}`,
      );
    }
    expect(results.length).toBe(refs.length);
  });

  it("reports every pin as resolvable or explicitly unknown", () => {
    // A pin that no longer resolves at all is a hard break, caught by the
    // reference tests; here it would surface as an unexplained status.
    for (const result of results) {
      expect(["current", "behind", "stale", "unknown"]).toContain(result.status);
      if (result.status === "unknown") {
        expect(result.detail.length, result.ref).toBeGreaterThan(0);
      }
    }
  });
});
