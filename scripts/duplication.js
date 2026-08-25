#!/usr/bin/env node
/**
 * Report lessons that are copies of each other, and where those copies have
 * stopped agreeing.
 *
 *   npm run check:copies              drifted pairs, with the differences
 *   npm run check:copies -- --map     what a change here also changes
 *   npm run check:copies -- --all     include pairs that are still in sync
 *   npm run check:copies -- --json    machine-readable
 *
 * Never sets a failing exit code. Reuse is deliberate in this content and much
 * of the drift is deliberate too, so every finding here is a question for an
 * author rather than a defect.
 */
import { getInventory, getTexts } from "../src/inventory.js";
import {
  collectDuplicationProblems,
  drifted,
  inSync,
  normalizeCode,
  pairKey,
  sharedGroups,
  similarPairs,
  touchesCode,
  worthTracking,
} from "../src/duplication.js";
import { applyKnownIssues } from "../src/problems.js";
import { formatProblem, setColorEnabled, style } from "../src/report.js";

const args = process.argv.slice(2);
const has = (name) => args.includes(name);

if (has("--no-color")) setColorEnabled(false);
if (has("--color")) setColorEnabled(true);

const docs = getTexts();
const pairs = similarPairs(docs);
const apart = drifted(pairs);
const together = inSync(pairs);

/** Blocks carrying identical code in more than one course. */
const blockGroups = sharedGroups(
  getInventory().filter((b) => worthTracking(b.code)),
  (b) => normalizeCode(b.code),
  (b) => b.course.dir,
);

if (has("--json")) {
  process.stdout.write(
    `${JSON.stringify(
      {
        documents: docs.length,
        pairs: pairs.length,
        inSync: together.length,
        drifted: apart.length,
        driftedTouchingCode: apart.filter(touchesCode).length,
        sharedBlockGroups: blockGroups.length,
        drift: apart.map((p) => ({
          key: pairKey(p),
          score: Number(p.score.toFixed(4)),
          a: p.a.label,
          b: p.b.label,
          touchesCode: touchesCode(p),
          onlyA: p.onlyA,
          onlyB: p.onlyB,
        })),
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

if (has("--map")) {
  process.stdout.write(
    `${style.heading("Lessons carrying the same code")}\n` +
      `${style.muted("Editing one of these means editing the others.")}\n\n`,
  );
  for (const group of blockGroups.slice(0, has("--all") ? Infinity : 20)) {
    const first = group.group[0].code.split("\n")[0].slice(0, 88);
    process.stdout.write(`${style.warn(`${group.owners.length} courses`)}  ${first}\n`);
    for (const owner of group.owners) process.stdout.write(`      ${style.muted(owner)}\n`);
    process.stdout.write("\n");
  }
  process.stdout.write(
    `${style.heading("Summary")}  ${blockGroups.length} block texts appear in more than one course\n`,
  );
  process.exit(0);
}

const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : 10;
const { problems } = applyKnownIssues(
  collectDuplicationProblems(pairs, has("--all") ? blockGroups : []),
);

for (const problem of problems) {
  if (problem.items.length === 0) continue;
  process.stdout.write(
    formatProblem({
      ...problem,
      accepted: problem.accepted?.length ?? 0,
      limit: limit === 0 ? Number.MAX_SAFE_INTEGER : limit,
    }),
  );
}

if (has("--all") && together.length > 0) {
  process.stdout.write(
    `\n${style.heading("Copies still in sync")}  ` +
      `${style.good(`${together.length} pairs`)}\n`,
  );
  for (const pair of together.slice(0, 20)) {
    process.stdout.write(`  ${pair.a.label}\n  ${pair.b.label}\n\n`);
  }
}

process.stdout.write(
  `\n${style.heading("Summary")}  ` +
    `${docs.length} comparable lessons, ` +
    `${style.good(`${together.length} pairs in sync`)}, ` +
    `${style.warn(`${apart.length} drifted`)} ` +
    `(${style.bad(`${apart.filter(touchesCode).length} differ in a command`)}), ` +
    `${style.muted(`${blockGroups.length} shared code blocks`)}\n`,
);
