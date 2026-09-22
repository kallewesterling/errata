import { describe, expect, it } from "vitest";
import { collectProblems } from "../../src/problems.js";
import { getInventory } from "../../src/inventory.js";

/**
 * End-to-end coverage: a check reaches a report, not just a string.
 *
 * Every detector has unit tests over HTML written inline, and those are good
 * at what they do. Between a detector and a reported finding, though, sit the
 * inventory walk, the identity it builds, the fingerprint, the editorRef, the
 * lesson URL and the catalogue entry, and none of that is exercised by a test
 * that calls the detector directly. A check wired to the wrong inventory, or
 * building a key that collides, or never reaching `collectProblems` at all,
 * passes every unit test in the suite.
 *
 * So this runs against `tests/fixtures/dirty/`, a content repository built to
 * be broken in exactly known ways. It is its own vitest project because the
 * content a run checks is chosen by an environment variable read once, and
 * the rest of the suite needs the clean fixture.
 *
 * The clean fixture asserts silence; this one asserts noise, and asserts the
 * noise is exactly what was planted. A block tripping a second check by
 * accident fails `reports nothing beyond what was planted` rather than
 * passing quietly, which is what keeps the fixture a specimen.
 */

const problems = collectProblems();
const firing = problems.filter((problem) => problem.items.length > 0);
const count = (id) => problems.find((p) => p.id === id)?.items.length ?? 0;

/**
 * What the fixture is built to produce.
 *
 * Extending the fixture means adding a line here, which is the point: the
 * expected set is written down rather than inferred from whatever the code
 * happens to do today.
 */
const PLANTED = {
  "script-entity": 1,
  "code-trailing-space": 1,
  // Six shapes across five blocks: `--username ""` satisfies both the
  // flag rule and the bare-word rule, and rules are allowed to overlap.
  "placeholder-residue": 7,
  "prompted-output": 1,
  "comment-in-block": 1,
  // One block, two characters. Findings are keyed per character so that
  // fixing one does not silently accept the other.
  "code-typography": 2,
  "mislabeled-dockerfile": 1,
  "unused-lang": 1,
  "markdown-in-prose": 1,
  "flattened-command": 1,
  // A stub body, an element holding only a comment, and a metadata value
  // that is still its own template.
  "unwritten-content": 3,
};

describe("the dirty fixture reports what was planted in it", () => {
  for (const [id, expected] of Object.entries(PLANTED)) {
    it(`${id} reports ${expected}`, () => {
      expect(count(id)).toBe(expected);
    });
  }

  it("reports nothing beyond what was planted", () => {
    const unexpected = firing
      .filter((problem) => !Object.hasOwn(PLANTED, problem.id))
      .map((problem) => `${problem.id} (${problem.items.length})`);
    expect(unexpected).toEqual([]);
  });
});

describe("a finding carries enough to act on", () => {
  /** Every item of every firing check, with the check it came from. */
  const items = firing.flatMap((problem) =>
    problem.items.map((item) => ({ problem, item })),
  );

  it("has findings to inspect", () => {
    expect(items.length).toBe(Object.values(PLANTED).reduce((a, b) => a + b, 0));
  });

  it("names the instance, so a known-issues entry can cover one of them", () => {
    for (const { problem, item } of items) {
      expect(item.key, `${problem.id} needs a key`).toBeTruthy();
    }
  });

  it("gives every instance of a check a distinct key", () => {
    for (const problem of firing) {
      const keys = problem.items.map((item) => item.key);
      expect(new Set(keys).size, `${problem.id} has colliding keys`).toBe(keys.length);
    }
  });

  it("points at a file and line, except where there is no file to point at", () => {
    for (const { problem, item } of items) {
      // unused-lang is about the configuration rather than the content, so
      // it has nowhere in the content to point.
      if (problem.id === "unused-lang") continue;
      const location = item.locations?.[0];
      expect(location?.editorRef, `${problem.id} needs a location`).toMatch(
        /content-|\.json/,
      );
      expect(location.editorRef).toMatch(/:\d+:\d+$/);
    }
  });

  it("fingerprints the content it was found in, so an edit reopens it", () => {
    for (const { problem, item } of items) {
      if (problem.id === "unused-lang") continue;
      expect(item.fingerprint, `${problem.id} needs a fingerprint`).toBeTruthy();
    }
  });

  it("carries the public lesson URL for findings that live in a lesson", () => {
    const inLessons = items.filter(({ item }) =>
      item.locations?.[0]?.editorRef.includes("content-"),
    );
    expect(inLessons.length).toBeGreaterThan(0);
    for (const { problem, item } of inLessons) {
      expect(item.locations[0].url, `${problem.id} needs a lesson URL`).toContain(
        "courses.example.com/dirty-course",
      );
    }
  });
});

describe("the lesson that is only there for the corpus", () => {
  // prompted-output is a census over the whole content, so a single-lesson
  // fixture cannot express it: the evidence that `fetch` is output lives in
  // lesson 20 and the block misusing it lives in lesson 10.
  it("supplies the evidence without becoming a finding itself", () => {
    const second = getInventory().filter((b) => b.lesson.slug === "20-A-Second-Lesson");
    expect(second.length).toBeGreaterThan(0);

    const reported = firing.flatMap((problem) =>
      problem.items.filter((item) =>
        String(item.key ?? "").includes("20-A-Second-Lesson"),
      ),
    );
    expect(reported).toEqual([]);
  });
});
