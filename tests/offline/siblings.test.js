import { describe, expect, it } from "vitest";
import { collectSiblingProblems, fileOf, siblingIndex } from "../../src/siblings.js";

/** A pair of near-duplicate lessons, reduced to what these functions read. */
const pair = (fileA, fileB) => ({
  a: { editorRef: `${fileA}:1:1` },
  b: { editorRef: `${fileB}:1:1` },
});

/** A problem with findings in the given files. */
const problem = (id, openFiles, acceptedFiles = []) => ({
  id,
  category: /** @type {const} */ ("defect"),
  title: `the ${id} finding`,
  why: "because",
  fix: "fix it",
  items: openFiles.map((file) => ({
    key: `${file}#0`,
    fingerprint: "fp",
    locations: [{ editorRef: `${file}:1:1`, url: null }],
  })),
  accepted: acceptedFiles.map((file) => ({
    key: `${file}#0`,
    fingerprint: "fp",
    locations: [{ editorRef: `${file}:1:1`, url: null }],
  })),
});

const byId = (problems, id) => problems.find((p) => p.id === id).items;

describe("fileOf", () => {
  it("drops the line and column an editorRef carries", () => {
    expect(fileOf("courses/A/lessons/10/content-x.html:42:9")).toBe(
      "courses/A/lessons/10/content-x.html",
    );
  });

  it("leaves a bare path alone", () => {
    expect(fileOf("courses/A/details.json")).toBe("courses/A/details.json");
  });

  it("survives a missing ref", () => {
    expect(fileOf(undefined)).toBe("");
  });
});

describe("siblingIndex", () => {
  it("links both directions, so either copy can ask", () => {
    const index = siblingIndex([pair("a.html", "b.html")]);
    expect([...index.get("a.html")]).toEqual(["b.html"]);
    expect([...index.get("b.html")]).toEqual(["a.html"]);
  });

  it("collects every twin of a lesson copied three ways", () => {
    const index = siblingIndex([pair("a.html", "b.html"), pair("a.html", "c.html")]);
    expect([...index.get("a.html")].sort()).toEqual(["b.html", "c.html"]);
  });

  it("does not link a file to itself", () => {
    expect(siblingIndex([pair("a.html", "a.html")]).size).toBe(0);
  });
});

describe("collectSiblingProblems", () => {
  const pairs = [pair("a.html", "b.html")];

  // The case the request demonstrates: a repair landed in one copy and the
  // identical defect in the other was never touched.
  it("reports a finding present in one copy and not its twin", () => {
    const found = collectSiblingProblems([problem("promptless-shell", ["a.html"])], pairs);
    const uneven = byId(found, "uneven-copy");
    expect(uneven).toHaveLength(1);
    expect(uneven[0].details).toContainEqual(["but not in", "b.html"]);
  });

  it("reports a finding in both copies as one line, not two", () => {
    const found = collectSiblingProblems(
      [problem("promptless-shell", ["a.html", "b.html"])],
      pairs,
    );
    expect(byId(found, "shared-finding")).toHaveLength(1);
    expect(byId(found, "uneven-copy")).toHaveLength(0);
  });

  it("keys a shared finding the same way from either side", () => {
    const one = collectSiblingProblems(
      [problem("x", ["a.html", "b.html"])],
      [pair("a.html", "b.html")],
    );
    const other = collectSiblingProblems(
      [problem("x", ["b.html", "a.html"])],
      [pair("b.html", "a.html")],
    );
    expect(byId(one, "shared-finding")[0].key).toBe(byId(other, "shared-finding")[0].key);
  });

  // An entry in the known-issues file covers one instance, so accepting a
  // finding in one copy leaves its twin reported and unexplained.
  it("reports an acceptance that only half applies", () => {
    const found = collectSiblingProblems(
      [problem("promptless-shell", ["b.html"], ["a.html"])],
      pairs,
    );
    const half = byId(found, "half-accepted-copy");
    expect(half).toHaveLength(1);
    expect(half[0].details).toContainEqual(["still open in the copy", "b.html"]);
  });

  it("says nothing when the acceptance covers both copies", () => {
    const found = collectSiblingProblems(
      [problem("promptless-shell", [], ["a.html", "b.html"])],
      pairs,
    );
    expect(byId(found, "half-accepted-copy")).toHaveLength(0);
  });

  it("says nothing about a lesson with no twin", () => {
    const found = collectSiblingProblems([problem("x", ["lonely.html"])], pairs);
    for (const p of found) expect(p.items).toEqual([]);
  });

  it("keeps findings of different checks apart", () => {
    // Two different defects, one in each copy, is not a one-sided repair of
    // either: each is reported against its own check.
    const found = collectSiblingProblems(
      [problem("promptless-shell", ["a.html"]), problem("empty-blocks", ["b.html"])],
      pairs,
    );
    expect(byId(found, "uneven-copy")).toHaveLength(2);
    expect(byId(found, "shared-finding")).toHaveLength(0);
  });

  it("describes every finding it can produce", () => {
    for (const p of collectSiblingProblems([], [])) {
      expect(p.id, "every problem needs an id").toBeTruthy();
      expect(p.title, `${p.id} needs a title`).toBeTruthy();
      expect(p.why, `${p.id} needs an explanation`).toBeTruthy();
      expect(p.fix, `${p.id} needs a remediation`).toBeTruthy();
      expect(p.category, `${p.id} needs a category`).toBe("stale");
      expect(p.severity, `${p.id} must not fail a run`).toBe("warning");
    }
  });
});
