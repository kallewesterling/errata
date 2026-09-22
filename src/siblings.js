/**
 * What a finding in one lesson implies about its near-duplicate twin.
 *
 * Courses here are assembled from shared lessons, and nothing in the
 * repository links the copies: no shared id, no include, no marker in the
 * files. So a repair lands in whichever copy the author had open, and the
 * other one keeps the defect. That is invisible from inside either file, and
 * it is invisible to every check that reads one file at a time.
 *
 * The copy census already knows which lessons are near-duplicates. Crossing
 * it with the findings turns every existing check into a cross-copy check,
 * without any check having to know that copies exist.
 *
 * Two questions are worth asking, and they call for different actions:
 *
 *   the twin does not have this finding   something is out of step: either a
 *                                         repair reached one side only, or
 *                                         the copies are diverging
 *   the twin has it too                   one repair is two edits, and
 *                                         forgetting the second is how this
 *                                         situation arose
 */
import { style } from "./report.js";

/**
 * The part of a pair this module reads.
 *
 * Declared structurally rather than as a `Pair` so the module states its own
 * inputs, and so a test can write a copy census by hand. Only the two
 * editorRefs matter here: which lessons are twins, not how alike they are.
 *
 * @typedef {object} SiblingPair
 * @property {{editorRef: string}} a
 * @property {{editorRef: string}} b
 */

/** Strip the `:line:column` an editorRef carries, leaving the file. */
export function fileOf(editorRef) {
  return String(editorRef ?? "").replace(/:\d+:\d+$/, "");
}

/**
 * Which files each file is a near-duplicate of.
 *
 * Built from every pair above the similarity threshold, identical pairs
 * included: two lessons that match exactly today are exactly the ones a
 * one-sided repair is about to separate.
 *
 * @param {SiblingPair[]} pairs
 * @returns {Map<string, Set<string>>}
 */
export function siblingIndex(pairs) {
  const index = new Map();

  const link = (from, to) => {
    if (from === to) return;
    if (!index.has(from)) index.set(from, new Set());
    index.get(from).add(to);
  };

  for (const pair of pairs) {
    const a = fileOf(pair.a.editorRef);
    const b = fileOf(pair.b.editorRef);
    link(a, b);
    link(b, a);
  }

  return index;
}

/** Every file a problem's items point at, mapped to one example item. */
function filesIn(items) {
  const files = new Map();
  for (const item of items) {
    for (const location of item.locations ?? []) {
      const file = fileOf(location.editorRef);
      if (!files.has(file)) files.set(file, item);
    }
  }
  return files;
}

/** Name a file the way a report should, without the checkout path. */
const label = (file) => file.split("/courses/").pop() ?? file;

/** Findings this module can emit, for validating known-issues entries. */
export const SIBLING_PROBLEM_IDS = Object.freeze([
  "uneven-copy",
  "shared-finding",
  "half-accepted-copy",
]);

/**
 * Cross the findings with the copy census.
 *
 * Must run after the known-issues file has been applied, because one of the
 * three questions is about what an acceptance covers.
 *
 * @param {import("./problems.js").Problem[]} problems  Already split into
 *   open and accepted.
 * @param {SiblingPair[]} pairs
 * @returns {import("./problems.js").Problem[]}
 */
export function collectSiblingProblems(problems, pairs) {
  const siblings = siblingIndex(pairs);
  const uneven = [];
  const shared = [];
  const halfAccepted = [];

  for (const problem of problems) {
    const open = filesIn(problem.items);
    const accepted = filesIn(problem.accepted ?? []);

    for (const [file, item] of open) {
      for (const twin of siblings.get(file) ?? []) {
        // Recorded once per pair, from the side that sorts first, so a
        // finding in both copies is one line rather than two.
        const both = open.has(twin);
        if (both && file > twin) continue;

        const entry = {
          summary: `${style.heading(problem.id)}  ${label(file)}`,
          key: `${problem.id} ${[file, twin].sort().join(" :: ")}`,
          fingerprint: item.fingerprint,
          details: [
            [both ? "and also in" : "but not in", label(twin)],
            ["finding", problem.title],
          ],
          locations: [{ editorRef: `${file}:1:1`, url: null }],
        };

        (both ? shared : uneven).push(entry);
      }
    }

    for (const [file, item] of accepted) {
      for (const twin of siblings.get(file) ?? []) {
        if (!open.has(twin)) continue;
        halfAccepted.push({
          summary: `${style.heading(problem.id)}  ${label(file)}`,
          key: `${problem.id} accepted ${[file, twin].sort().join(" :: ")}`,
          fingerprint: item.fingerprint,
          details: [
            ["accepted here", label(file)],
            ["still open in the copy", label(twin)],
            ["finding", problem.title],
          ],
          locations: [{ editorRef: `${file}:1:1`, url: null }],
        });
      }
    }
  }

  return [
    {
      id: "uneven-copy",
      category: /** @type {const} */ ("stale"),
      severity: "warning",
      title: "findings present in one copy of a lesson but not its twin",
      why:
        "These lessons are near-duplicates, and one of them has a finding " +
        "the other does not. Usually that means a repair reached one copy " +
        "and missed the other, which is invisible from inside either file " +
        "and invisible to every check that reads one file at a time.",
      fix:
        "Compare the two. If the copy without the finding was repaired, " +
        "apply the same repair here. If the difference is deliberate, the " +
        "lessons have genuinely diverged and are worth un-pairing.",
      items: uneven,
      accepted: [],
    },
    {
      id: "shared-finding",
      category: /** @type {const} */ ("stale"),
      severity: "warning",
      title: "findings that appear in both copies of a lesson",
      why:
        "Not an extra defect, and not double-counted: this is the same " +
        "finding in two places. It is worth knowing before the repair rather " +
        "than after, because fixing one copy and forgetting the other is " +
        "exactly how copies come apart.",
      fix: "Apply the repair to both copies in the same change.",
      items: shared,
      accepted: [],
    },
    {
      id: "half-accepted-copy",
      category: /** @type {const} */ ("stale"),
      severity: "warning",
      title: "findings accepted in one copy and still open in its twin",
      why:
        "An entry in the known-issues file covers one instance, so accepting " +
        "a finding in one copy leaves the identical finding in its twin " +
        "reported and unexplained. The acceptance is half-applied, and the " +
        "reason recorded for one copy is almost certainly the reason for both.",
      fix:
        "Either extend the acceptance to the copy, with the same reason, or " +
        "repair the copy. Leaving it half-applied means the next reader sees " +
        "a finding whose explanation is in a file they have no reason to open.",
      items: halfAccepted,
      accepted: [],
    },
  ];
}
