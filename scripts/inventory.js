#!/usr/bin/env node
/**
 * Inspect the code-block inventory from the command line.
 *
 *   npm run inventory                    summary counts
 *   npm run inventory -- --json          full inventory as JSON on stdout
 *   npm run inventory -- --lang console  filter by data-lang
 *   npm run inventory -- --flag has-placeholder
 *   npm run inventory -- --anomalies     only blocks with anomalies
 *   npm run inventory -- --pairs         commands next to their expected output
 *   npm run inventory -- --warnings      cross-reference discrepancies
 *   npm run inventory -- --problems      every finding, with locations and fixes
 *   npm run inventory -- --problems --all      include findings within budget
 *   npm run inventory -- --problems --limit 0  do not truncate long lists
 */
import {
  checkContentPaths,
  findUnreferencedContentFiles,
} from "../src/integrity.js";
import { knownIssuesPath } from "../src/config.js";
import { buildInventory } from "../src/inventory.js";
import { accepted, inspect, open } from "../src/problems.js";
import { formatProblem, setColorEnabled, style } from "../src/report.js";
import { formatWarning } from "../src/warnings.js";

const args = process.argv.slice(2);
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};

if (args.includes("--no-color")) setColorEnabled(false);
if (args.includes("--color")) setColorEnabled(true);

let blocks = buildInventory();

const lang = flagValue("--lang");
if (lang) blocks = blocks.filter((b) => b.lang === lang);

const flag = flagValue("--flag");
if (flag) blocks = blocks.filter((b) => b.flags.includes(flag));

if (args.includes("--anomalies")) {
  blocks = blocks.filter((b) => b.anomalies.length > 0);
}

if (args.includes("--json")) {
  process.stdout.write(`${JSON.stringify(blocks, null, 2)}\n`);
  process.exit(0);
}

/**
 * The problem view is the one a content author wants: every finding, where it
 * is, and what to do about it. By default it shows only open findings, which is
 * what would fail the suite; --all adds the ones a known-issues entry is
 * holding, together with the note explaining why.
 */
if (args.includes("--problems")) {
  const { problems, stale, resolved, unknown, notes } = inspect(blocks);
  const failing = open(problems);
  const held = accepted(problems);
  const limitArg = flagValue("--limit");
  const limit = limitArg === null ? 10 : Number(limitArg) || Number.POSITIVE_INFINITY;

  for (const problem of failing) {
    process.stdout.write(
      formatProblem({ ...problem, accepted: problem.accepted.length, limit }),
    );
  }

  if (args.includes("--all")) {
    for (const problem of held) {
      process.stdout.write(
        formatProblem({
          ...problem,
          severity: "warning",
          limit,
          accepted: 0,
          items: problem.accepted.map((item) => ({
            ...item,
            details: [
              ...(item.details ?? []),
              ["accepted", item.issue.added],
              ["note", item.issue.note],
            ],
          })),
        }),
      );
    }
  }

  for (const { label, entries } of [
    { label: "recorded against content that has since changed", entries: stale.map((s) => s.issue) },
    { label: "no longer matching any finding", entries: resolved },
    { label: "naming a check that does not exist", entries: unknown },
  ]) {
    if (entries.length === 0) continue;
    process.stdout.write(
      formatProblem({
        title: `known issues ${label}`,
        why: `Listed in ${knownIssuesPath}.`,
        fix: "Re-read the block, then update or delete the entry.",
        limit,
        items: entries.map((issue) => ({
          summary: `${style.heading(issue.problem)}  ${style.muted(issue.key)}`,
          details: [["accepted", issue.added], ["note", issue.note]],
        })),
      }),
    );
  }

  if (args.includes("--all") && notes.length > 0) {
    process.stdout.write(
      formatProblem({
        severity: "warning",
        title: "recorded observations that no check covers",
        why:
          "Noticed by a person reading the lesson rather than found by a check, " +
          "and kept here so the knowledge survives to the next revision.",
        fix: "Act on these when the lesson is next revised, then delete the note.",
        limit,
        items: notes.map((note) => ({
          summary: style.heading(note.where),
          details: [["added", note.added], ["note", note.note]],
        })),
      }),
    );
  }

  const clean = problems.length - failing.length - held.length;
  console.log(
    `\n${failing.length} open, ${held.length} accepted as known issues, ` +
      `${clean} clean, ${notes.length} recorded observations.`,
  );
  if (!args.includes("--all") && (held.length > 0 || notes.length > 0)) {
    console.log(style.muted("Pass --all to see the accepted findings and notes."));
  }
  console.log(
    style.muted(
      "Registry and link checks need the network; run `npm run test:network`.",
    ),
  );
  const bad = failing.length + stale.length + resolved.length + unknown.length;
  process.exit(bad > 0 ? 1 : 0);
}

if (args.includes("--warnings")) {
  const warnings = blocks.flatMap((b) => b.warnings);
  if (warnings.length === 0) {
    console.log("No cross-reference warnings.");
  } else {
    console.log(`${warnings.length} cross-reference warning(s):\n`);
    for (const w of warnings) console.log(`${formatWarning(w)}\n`);
  }
  console.log(
    "Digest staleness is checked against the registry; run `npm run test:network`.",
  );
  process.exit(0);
}

if (args.includes("--pairs")) {
  const all = buildInventory();
  const byId = new Map(all.map((b) => [b.id, b]));
  const preview = (code, n) =>
    code
      .split("\n")
      .slice(0, n)
      .map((l) => `      ${l.slice(0, 100)}`)
      .join("\n");

  for (const command of blocks.filter((b) => b.expectedOutput.length > 0)) {
    console.log(`\n${command.id}\n  ${command.editorRef}`);
    console.log(`  command:\n${preview(command.code, 4)}`);
    for (const id of command.expectedOutput) {
      console.log(`  output (${byId.get(id).lang}):\n${preview(byId.get(id).code, 4)}`);
    }
  }
  process.exit(0);
}

const tally = (key) => {
  const counts = new Map();
  for (const block of blocks) {
    for (const value of Array.isArray(block[key]) ? block[key] : [block[key]]) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
};

const table = (rows) =>
  rows.map(([k, v]) => `  ${String(v).padStart(5)}  ${k || "(none)"}`).join("\n");

console.log(`Code blocks: ${blocks.length}`);
console.log(`Courses:     ${new Set(blocks.map((b) => b.course.dir)).size}`);
console.log(`Files:       ${new Set(blocks.map((b) => b.source.file)).size}`);
console.log(`\nBy data-lang:\n${table(tally("lang"))}`);
console.log(`\nBy kind:\n${table(tally("kind"))}`);
console.log(`\nBy flag:\n${table(tally("flags"))}`);

const anomalies = tally("anomalies").filter(([k]) => k !== undefined);
if (anomalies.length) console.log(`\nAnomalies:\n${table(anomalies)}`);

const parseStatus = blocks.filter((b) => b.parse);
if (parseStatus.length) {
  const counts = new Map();
  for (const b of parseStatus) {
    counts.set(b.parse.status, (counts.get(b.parse.status) ?? 0) + 1);
  }
  console.log(`\nConfig block parse status:\n${table([...counts])}`);
}

const outputs = blocks.filter((b) => b.kind === "output");
if (outputs.length) {
  const paired = outputs.filter((b) => b.respondsTo);
  console.log(
    `\nOutput blocks: ${outputs.length}` +
      `\n  paired with a command: ${paired.length}` +
      `\n    via a run of output: ${outputs.filter((b) => b.outputHops > 0).length}` +
      `\n  unpaired:              ${outputs.length - paired.length}` +
      `\n  containing a command:  ${outputs.filter((b) => b.flags.includes("mislabeled-output")).length}`,
  );
  console.log(
    `Commands with expected output: ${blocks.filter((b) => b.expectedOutput.length > 0).length}`,
  );
}

const runnable = blocks.filter((b) => b.runnable);
const commands = runnable.reduce((n, b) => n + (b.shell?.commands.length ?? 0), 0);
console.log(`\nRunnable shell blocks: ${runnable.length} (${commands} commands)`);
console.log(
  `Digest-pinned image refs:      ${new Set(blocks.flatMap((b) => b.imageRefs).filter((r) => r.includes("@sha256:"))).size}` +
    ` (age checked by the network tier)`,
);
console.log(`Distinct image refs:   ${new Set(blocks.flatMap((b) => b.imageRefs)).size}`);
console.log(`Fetched URLs:          ${new Set(blocks.flatMap((b) => b.fetchUrls)).size}`);

const { caseMismatches, missing, total } = checkContentPaths();
const orphans = findUnreferencedContentFiles();
console.log(`\nContent paths declared in metadata: ${total}`);
console.log(`  case mismatches:     ${caseMismatches.length}`);
console.log(`  missing from disk:   ${missing.length}`);
console.log(`  unreferenced files:  ${orphans.length}`);

/**
 * The summary stays a summary. Anything that needs a location and a fix is one
 * flag away, in a format that says what to do about it.
 */
const { problems: inspected } = inspect(blocks);
const failing = open(inspected);
const held = accepted(inspected);
console.log(
  `\nProblems: ${failing.length} open, ${held.length} accepted as known issues.`,
);
for (const problem of [...failing, ...held]) {
  const count = problem.items.length || problem.accepted.length;
  const mark = problem.items.length > 0 ? style.bad("x") : style.warn("!");
  console.log(`  ${mark} ${String(count).padStart(7)}  ${problem.title}`);
}
console.log(
  style.muted("\nRun with --problems for locations and remediation."),
);
