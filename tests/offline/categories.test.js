import { describe, expect, it } from "vitest";
import { CATEGORIES, CATEGORY_NAMES, isCategory } from "../../src/categories.js";
import { collectProblems } from "../../src/problems.js";
import { collectLinkProblems } from "../../src/link-health.js";
import { findTemplateValues, findUnwritten } from "../../src/unwritten.js";

describe("the category vocabulary", () => {
  it("names three kinds of work", () => {
    expect(CATEGORY_NAMES).toEqual(["defect", "stale", "unwritten"]);
  });

  it("explains each one, because the report prints the explanation", () => {
    for (const name of CATEGORY_NAMES) {
      expect(CATEGORIES[name].length, `${name} needs a description`).toBeGreaterThan(40);
    }
  });

  it("recognizes only those three", () => {
    expect(isCategory("defect")).toBe(true);
    expect(isCategory("warning")).toBe(false);
    expect(isCategory("")).toBe(false);
  });

  // The vocabulary is a closed set on purpose. A check that invents a fourth
  // would filter out of every report that asks for one of the three.
  it("does not inherit anything from Object.prototype", () => {
    expect(isCategory("toString")).toBe(false);
    expect(isCategory("constructor")).toBe(false);
  });
});

describe("every check declares what kind of work it needs", () => {
  // Link problems need verdicts to build items, but the catalogue entries
  // themselves exist whether or not anything was found.
  /** @type {[string, import("../../src/problems.js").Problem[]][]} */
  const catalogues = [
    ["offline", collectProblems()],
    ["links", collectLinkProblems([], [])],
  ];

  for (const [name, problems] of catalogues) {
    it(`the ${name} catalogue gives every problem a valid category`, () => {
      expect(problems.length).toBeGreaterThan(0);
      for (const problem of problems) {
        expect(
          isCategory(problem.category),
          `${problem.id} has category ${JSON.stringify(problem.category)}`,
        ).toBe(true);
      }
    });
  }

  it("keeps category and severity as separate questions", () => {
    // Severity says how loudly to report; category says who fixes it and with
    // what. Collapsing them would mean a stale link could never fail a run
    // and an unwritten lesson could never be merely noted.
    const problems = collectProblems();
    const byCategory = (category) => problems.filter((p) => p.category === category);

    expect(byCategory("defect").length).toBeGreaterThan(0);
    expect(byCategory("stale").length).toBeGreaterThan(0);
    expect(byCategory("unwritten").length).toBeGreaterThan(0);

    // A defect that is only a warning, which is the combination that proves
    // the two axes are independent rather than one relabelled.
    expect(
      problems.some((p) => p.category === "defect" && p.severity === "warning"),
    ).toBe(true);
  });
});

describe("findUnwritten", () => {
  const rules = (html, visible) => findUnwritten(html, visible).map((f) => f.rule);

  it("finds a body that is only a placeholder", () => {
    expect(rules("<p>Placeholder</p>", "Placeholder")).toContain("stub-body");
  });

  it("accepts the other words a draft uses", () => {
    for (const word of ["TBD", "TODO", "Coming soon", "Lorem ipsum dolor"]) {
      expect(rules(`<p>${word}</p>`, word), word).toContain("stub-body");
    }
  });

  // Bounded by length as well as wording, so a real lesson that happens to
  // open with the word is not swept up.
  it("leaves a lesson that says more than its first word alone", () => {
    const text =
      "Placeholder images are a real technique, and this lesson explains when to use one.";
    expect(rules(`<p>${text}</p>`, text)).not.toContain("stub-body");
  });

  it("finds an element holding only a comment", () => {
    expect(rules("<p><!-- Lead --></p>", "")).toContain("comment-only");
  });

  it("finds each one separately, because each is a gap of its own", () => {
    const html = "<p><!-- Lead --></p><p>Real prose.</p><p><!-- TODO: image --></p>";
    expect(rules(html, "Real prose.").filter((r) => r === "comment-only")).toHaveLength(2);
  });

  it("leaves an element with prose beside its comment alone", () => {
    expect(rules("<p><!-- note -->Real prose here.</p>", "Real prose here.")).toEqual([]);
  });

  it("leaves an ordinary lesson alone", () => {
    const text = "This lesson explains how to sign an artifact and verify the signature.";
    expect(rules(`<p>${text}</p>`, text)).toEqual([]);
  });
});

describe("findTemplateValues", () => {
  it("finds a value that is still its own template", () => {
    const found = findTemplateValues({ short_description: "{Short description}" });
    expect(found).toEqual([
      { path: "short_description", value: "{Short description}" },
    ]);
  });

  it("reports where it found it, so the report can name the field", () => {
    const found = findTemplateValues({ a: { b: ["x", "{Fill me in}"] } });
    expect(found[0].path).toBe("a.b.1");
  });

  // Walks the whole document rather than named fields: which key holds the
  // description is a property of one content repository.
  it("leaves real values alone", () => {
    expect(
      findTemplateValues({ title: "Signing artifacts", count: 3, ok: true }),
    ).toEqual([]);
  });

  it("does not mistake JSON or shell braces for a template", () => {
    expect(findTemplateValues({ a: "{}", b: '{"k": 1}', c: "${VERSION}" })).toEqual([]);
  });
});
