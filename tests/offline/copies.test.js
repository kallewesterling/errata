import { describe, expect, it } from "vitest";
import {
  collectDuplicationProblems,
  drifted,
  inSync,
  similarPairs,
  touchesCode,
} from "../../src/duplication.js";
import { getTexts } from "../../src/inventory.js";
import { applyKnownIssues } from "../../src/problems.js";
import { expectNone } from "../helpers.js";

/**
 * Lessons that are copies of each other.
 *
 * Nothing about drift fails here, deliberately. Courses in this content are
 * assembled from shared lessons, and a copy that differs is as likely to be
 * correct as not: a lesson written to stand alone opens differently from the
 * same lesson inside a learning path, and says "in this course" where its twin
 * says "in this module". Only a person can tell that apart from an edit that
 * missed one side, so the suite reports and leaves the judgement alone.
 *
 * The known-issues file is held to the usual standard even so. An entry that
 * no longer describes reality is a defect in the file, whatever it accepted.
 */
const docs = getTexts();
const pairs = similarPairs(docs);
const { problems, stale, resolved } = applyKnownIssues(
  collectDuplicationProblems(pairs),
);

describe("lessons that are copies of each other", () => {
  it("finds lessons long enough to compare", () => {
    expect(docs.length).toBeGreaterThan(0);
  });

  it("reports how many shared lessons are still in sync", () => {
    const together = inSync(pairs);
    console.log(
      `${together.length} lesson pair(s) are identical; ` +
        `${drifted(pairs).length} have drifted apart.`,
    );
    expect(together.length).toBeGreaterThanOrEqual(0);
  });

  /**
   * Loud because a command that differs between two copies of one lesson is
   * the case least likely to be intentional, and the most expensive to meet as
   * a reader. Still not a failure: a course can legitimately teach a simpler
   * form of a command than its more advanced twin.
   */
  it("names the copies whose commands disagree", () => {
    const risky = drifted(pairs).filter(touchesCode);
    for (const pair of risky) {
      console.log(
        `${pair.a.label}\n  and ${pair.b.label}\n  differ in a command ` +
          `(similarity ${pair.score.toFixed(3)}). Run \`npm run check:copies\`.`,
      );
    }
    expect(risky.length).toBeGreaterThanOrEqual(0);
  });

  it("has no known-issues entry whose lessons have since been edited", () => {
    expectNone(stale.length, {
      title: "known-issues entries that no longer match the content",
      why:
        "Each entry pins the text of both copies it accepted. These no longer " +
        "match, so somebody has edited one of the lessons since.",
      fix: "Re-read the pair, then update or remove the entry.",
      items: stale.map((s) => ({ summary: s.issue.key, details: [["note", s.issue.note]] })),
    });
  });

  it("has no known-issues entry for a pair that now agrees", () => {
    expectNone(resolved.length, {
      title: "known-issues entries for copies that are back in sync",
      why: "These accepted a drift that is no longer there.",
      fix: "Delete the entry.",
      items: resolved.map((issue) => ({
        summary: issue.key,
        details: [["note", issue.note]],
      })),
    });
  });
});

describe("the duplication catalogue", () => {
  it("describes every finding it can produce", () => {
    for (const problem of problems) {
      expect(problem.id, "every problem needs an id").toBeTruthy();
      expect(problem.title, `${problem.id} needs a title`).toBeTruthy();
      expect(problem.why, `${problem.id} needs an explanation`).toBeTruthy();
      expect(problem.fix, `${problem.id} needs a remediation`).toBeTruthy();
      expect(problem.severity, `${problem.id} must not fail a run`).toBe("warning");
    }
  });
});
