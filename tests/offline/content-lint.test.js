import { describe, expect, it } from "vitest";
import { knownIssuesPath } from "../../src/config.js";
import { knownLangs } from "../../src/config.js";
import { getInventory } from "../../src/inventory.js";
import { inspect } from "../../src/problems.js";
import { style } from "../../src/report.js";
import { expectNone } from "../helpers.js";

const blocks = getInventory();
const { problems, stale, resolved, unknown } = inspect(blocks);

/**
 * The content checks are driven by the shared catalogue in src/problems.js, so
 * each one is described in a single place and a contributor sees the same
 * wording here as from `npm run inventory -- --problems`.
 *
 * Every check must come out clean. A finding that is understood and not yet
 * fixed is recorded in the known-issues file, which names the instance and
 * pins the content it was accepted against, so nothing is tolerated anonymously.
 */
describe("the content has no open problems", () => {
  for (const problem of problems) {
    const label = problem.accepted.length
      ? `has no ${problem.title} beyond the ${problem.accepted.length} accepted`
      : `has no ${problem.title}`;

    it(label, () => {
      expectNone(problem.items.length, {
        ...problem,
        accepted: problem.accepted.length,
      });
    });
  }
});

/**
 * The known-issues file has to describe reality or it is worse than nothing, so
 * an entry that no longer matches is a failure in its own right rather than a
 * silent no-op.
 */
describe("the known-issues file matches what is actually there", () => {
  it("has no entries whose block has since been edited", () => {
    expectNone(stale.length, {
      title: "known issues recorded against content that has since changed",
      why:
        "The block was edited after the issue was accepted, so the note may no " +
        "longer describe it. The finding has been reopened rather than held " +
        "against a version nobody has looked at since.",
      fix:
        "Re-read the block. If it is fixed, delete the entry; if the issue " +
        "remains, update the entry's fingerprint and note to match.",
      items: stale.map(({ issue, item, problem }) => ({
        summary: `${style.heading(problem)}  ${style.muted(issue.key)}`,
        details: [
          ["accepted", `${issue.fingerprint} on ${issue.added}`],
          ["now", String(item.fingerprint)],
        ],
        locations: item.locations,
      })),
    });
  });

  it("has no entries for findings that are already resolved", () => {
    expectNone(resolved.length, {
      title: "known issues that no longer match any finding",
      why:
        "The problem these entries describe is gone. Leaving them behind makes " +
        "the file read as though more is outstanding than really is.",
      fix: `Delete these entries from ${knownIssuesPath}.`,
      items: resolved.map((issue) => ({
        summary: `${style.heading(issue.problem)}  ${style.muted(issue.key)}`,
        details: [["accepted", issue.added]],
      })),
    });
  });

  it("has no entries naming a check that does not exist", () => {
    expectNone(unknown.length, {
      title: "known issues naming an unrecognized problem",
      why:
        "Nothing checks for this problem id, so the entry can never apply and " +
        "is most likely a typo or a renamed check.",
      fix:
        "Correct the problem id to one in src/problems.js, or delete the entry.",
      items: unknown.map((issue) => ({
        summary: `${style.bad(issue.problem)}  ${style.muted(issue.key)}`,
      })),
    });
  });
});

describe("the taxonomy covers what the content uses", () => {
  it("uses only languages that appear in the taxonomy", () => {
    const used = new Set(blocks.map((b) => b.lang).filter(Boolean));
    for (const lang of used) expect(knownLangs).toContain(lang);
  });
});
