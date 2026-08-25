import { describe, expect, it } from "vitest";
import { getInventory } from "../../src/inventory.js";
import {
  REMEDIATION,
  collectWarnings,
  imageRepository,
} from "../../src/warnings.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

/**
 * Minimal command/output pair for exercising the rules.
 * @returns {import("../../src/warnings.js").WarnableBlock[]}
 */
function pair(commandCode, outputCode, { cmdImages = [], outImages = [] } = {}) {
  const command = {
    id: "cmd",
    code: commandCode,
    imageRefs: cmdImages,
    expectedOutput: ["out"],
    warnings: [],
    editorRef: "f.html:1:1",
    url: null,
  };
  const output = {
    id: "out",
    code: outputCode,
    imageRefs: outImages,
    expectedOutput: [],
    warnings: [],
    editorRef: "f.html:5:1",
    url: null,
  };
  return [command, output];
}

describe("imageRepository", () => {
  it("strips tags and digests", () => {
    expect(imageRepository("cgr.dev/chainguard/redis:7.0.10")).toBe(
      "cgr.dev/chainguard/redis",
    );
    expect(imageRepository(`cgr.dev/chainguard/redis@${DIGEST_A}`)).toBe(
      "cgr.dev/chainguard/redis",
    );
    expect(imageRepository(`cgr.dev/chainguard/redis:latest@${DIGEST_A}`)).toBe(
      "cgr.dev/chainguard/redis",
    );
  });
});

describe("digest-mismatch", () => {
  it("flags output that reports entirely different digests", () => {
    const warnings = collectWarnings(pair(`$ diff ${DIGEST_A}`, `Fetching ${DIGEST_B}`));
    expect(warnings.map((w) => w.rule)).toEqual(["digest-mismatch"]);
  });

  it("accepts output that echoes the pinned digest", () => {
    const warnings = collectWarnings(
      pair(`$ pull repo@${DIGEST_A}`, `Digest: ${DIGEST_A}`),
    );
    expect(warnings).toEqual([]);
  });

  it("accepts output listing extra digests alongside the pinned one", () => {
    // Layer and package digests routinely appear next to the image digest.
    const warnings = collectWarnings(
      pair(`$ pull repo@${DIGEST_A}`, `layer ${DIGEST_B}\nDigest: ${DIGEST_A}`),
    );
    expect(warnings).toEqual([]);
  });

  it("stays quiet when only one side names a digest", () => {
    expect(collectWarnings(pair("$ docker pull redis", `Digest: ${DIGEST_A}`))).toEqual([]);
    expect(collectWarnings(pair(`$ pull repo@${DIGEST_A}`, "done"))).toEqual([]);
  });
});

describe("image-mismatch", () => {
  it("flags output about a different image than the command used", () => {
    const warnings = collectWarnings(
      pair("$ scan nginx", "scanning redis", {
        cmdImages: ["cgr.dev/chainguard/nginx"],
        outImages: ["cgr.dev/chainguard/redis"],
      }),
    );
    expect(warnings.map((w) => w.rule)).toEqual(["image-mismatch"]);
  });

  it("accepts output naming the same repository at a different tag", () => {
    const warnings = collectWarnings(
      pair("$ scan nginx:latest", "scanned nginx:1.27", {
        cmdImages: ["cgr.dev/chainguard/nginx:latest"],
        outImages: ["cgr.dev/chainguard/nginx:1.27"],
      }),
    );
    expect(warnings.map((w) => w.rule)).not.toContain("image-mismatch");
  });
});

describe("tag-mismatch", () => {
  it("flags output showing a different tag for the same repository", () => {
    const warnings = collectWarnings(
      pair("$ run redis:7.0.10", "Starting cgr.dev/chainguard/redis:7.0.9", {
        cmdImages: ["cgr.dev/chainguard/redis:7.0.10"],
      }),
    );
    expect(warnings.map((w) => w.rule)).toContain("tag-mismatch");
  });

  it("accepts matching tags", () => {
    const warnings = collectWarnings(
      pair("$ run redis:7.0.10", "Starting cgr.dev/chainguard/redis:7.0.10", {
        cmdImages: ["cgr.dev/chainguard/redis:7.0.10"],
      }),
    );
    expect(warnings).toEqual([]);
  });
});

describe("warnings across the content", () => {
  const blocks = getInventory();
  const warnings = blocks.flatMap((b) => b.warnings);

  /** The budget itself is enforced from the shared catalogue in content-lint. */
  it("gives every rule that fires a remediation to offer", () => {
    for (const rule of new Set(warnings.map((w) => w.rule))) {
      expect(REMEDIATION[rule], `no remediation text for "${rule}"`).toBeTruthy();
    }
  });

  it("attaches every warning to a command that has output", () => {
    for (const block of blocks.filter((b) => b.warnings.length > 0)) {
      expect(block.kind, block.id).toBe("shell");
      expect(block.expectedOutput.length, block.id).toBeGreaterThan(0);
    }
  });

  it("gives every warning somewhere to go and look", () => {
    for (const warning of warnings) {
      expect(warning.editorRef, warning.rule).toMatch(/:\d+:\d+$/);
      expect(warning.message.length, warning.rule).toBeGreaterThan(0);
    }
  });
});
