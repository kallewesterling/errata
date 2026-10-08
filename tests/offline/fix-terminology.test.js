import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repoRoot } from "../../src/config.js";

/**
 * `fix:terminology` end to end, on a copy of the dirty fixture.
 *
 * The script writes to the content, so it runs against a throwaway copy, and
 * the copy gets one thing the fixture does not have: a dated statement,
 * accepted in the known-issues file, in the same lesson as a name that is to
 * be renamed. The rewrite has to tell the two apart, which is the property a
 * content repository relies on before running it across a catalogue.
 */
const LESSON = "courses/Dirty-Course/lessons/40-Retired-Example-Images/content-dirtyitem40a.html";
const DATED = "<p>In 2025 these were called Example Images.</p>";

let root;
const run = (...flags) => {
  const base = { ...process.env };
  delete base.ERRATA_ROOT;
  return spawnSync(process.execPath, ["scripts/terminology.js", "--no-color", ...flags], {
    cwd: repoRoot,
    env: { ...base, ERRATA_CONFIG: path.join(root, "errata.config.yaml") },
    encoding: "utf8",
  });
};
const lesson = () => fs.readFileSync(path.join(root, LESSON), "utf8");

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "errata-fix-terms-"));
  fs.cpSync(path.join(repoRoot, "tests/fixtures/dirty"), root, { recursive: true });
  fs.appendFileSync(path.join(root, LESSON), `${DATED}\n`);
  fs.writeFileSync(
    path.join(root, ".errata-accepted.yaml"),
    [
      "issues:",
      "  - problem: retired-term",
      "    key: 'Dirty-Course/40-Retired-Example-Images/dirtyitem40a#term Example Images: In 2025 these were called Example Images.'",
      "    added: 2026-10-07",
      "    note: True as dated.",
      "notes: []",
      "",
    ].join("\n"),
  );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("fix:terminology", () => {
  it("shows the edit and writes nothing on a dry run", () => {
    const before = lesson();
    const result = run("--dry-run");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("- This lesson still calls the product Example Images,");
    expect(result.stdout).toContain("+ This lesson still calls the product Example Containers,");
    expect(result.stdout).toContain("would rename 1 retired name across 1 file");
    expect(lesson()).toBe(before);
  });

  it("says what it left alone, and why", () => {
    const { stdout } = run("--dry-run");
    expect(stdout).toContain("1 accepted in the known-issues file");
    expect(stdout).toContain("1 in code");
    expect(stdout).toContain("1 in a title or description");
    expect(stdout).toContain("1 in a published slug");
  });

  it("renames the open finding in the prose, and only that", () => {
    const before = lesson();
    const result = run("--fix");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("renamed 1 retired name across 1 file");

    const after = lesson();
    expect(after).toBe(
      before.replace("the product Example Images,", "the product Example Containers,"),
    );
    expect(after).toContain(DATED);
    expect(after).toContain("$ examplectl images list");
    expect(after).toContain("github.com/example-images/images");
  });

  it("finds nothing left to rename on a second run", () => {
    expect(run("--fix").stdout).toContain("renamed 0 retired names across 0 files");
  });
});
