/**
 * The catalogue of things that can be wrong with the content.
 *
 * Each entry states what it looks for, why it matters, and what to do about
 * it. Both the test suite and the CLI read this list, so a finding is described
 * once and a contributor sees the same wording whether it reaches them through
 * a failing test or `npm run inventory`.
 *
 * Only checks that can run offline live here. Registry and link checks need
 * the network, so they stay in the network tier.
 */
import path from "node:path";
import { anomalies, configFile, contentRoot, repoRoot } from "./config.js";
import { getInventory } from "./inventory.js";
import {
  checkContentPaths,
  findUnreferencedContentFiles,
} from "./integrity.js";
import { indexIssues, loadKnownIssues } from "./known-issues.js";
import { blockItem, style } from "./report.js";
import { REMEDIATION, warningItem } from "./warnings.js";

/**
 * @typedef {object} Problem
 * @property {string} id        Stable name, used to select a single check.
 * @property {string} title     What is wrong, read after a count.
 * @property {string} [why]     Why it matters.
 * @property {string} fix       What to do about it.
 * @property {"error"|"warning"} [severity]
 * @property {import("./report.js").ProblemItem[]} items     Open findings.
 * @property {any[]} accepted  Findings held by a known-issues entry.
 */

/** Label a block by language and identity. */
const labelled = (list) =>
  list.map((block) =>
    blockItem(
      block,
      `${style.heading(block.lang || "(no lang)")}  ${style.muted(block.id)}`,
    ),
  );

/** First non-blank line of a block, for recognizing it at a glance. */
const firstLine = (block) => {
  const line = block.code.split("\n").find((l) => l.trim()) ?? "";
  return line.length > 60 ? `${line.slice(0, 60)}...` : line;
};

const ANOMALY_HELP = {
  "missing-lang": {
    why: "Without data-lang the block cannot be classified, so it is never checked.",
    fix: 'Add a data-lang attribute, for example <pre data-lang="console">.',
  },
  "missing-code-element": {
    why:
      'The convention is <pre data-lang="..."><code>, and tooling that relies on ' +
      "the <code> child will miss this block.",
    fix: "Wrap the block contents in a <code> element.",
  },
  "unescaped-markup": {
    why:
      "<pre> is not a raw-text element, so an unescaped tag inside it is parsed " +
      "as real markup. A reader's browser drops it, and so would any extractor " +
      "reading textContent.",
    fix: "Escape the angle brackets as &lt; and &gt; in the lesson HTML.",
  },
};

/**
 * Every offline problem, whether or not it currently has any instances.
 *
 * Entries with no instances are kept rather than filtered out so the CLI can
 * show what is being checked, and so a budget that has been outgrown downward
 * is still visible.
 *
 * @param {ReturnType<typeof getInventory>} [blocks]
 * @returns {Problem[]}
 */
export function collectProblems(blocks = getInventory()) {
  const outputs = blocks.filter((b) => b.kind === "output");
  const { caseMismatches, missing } = checkContentPaths();
  const warnings = blocks.flatMap((b) =>
    b.warnings.map((w) => ({ ...w, fingerprint: b.fingerprint })),
  );
  const warnedRules = [...new Set(warnings.map((w) => w.rule))];

  /** @type {Omit<Problem, "accepted">[]} */
  const problems = [
    {
      id: "unknown-lang",
      title: "blocks with an unrecognized data-lang",
      why:
        "Tests dispatch on the language, so an unknown value means the block " +
        "is never parsed or checked at all.",
      fix:
        "Correct the data-lang in the lesson HTML, or if the value is " +
        `legitimate add it to the languages map in ${configFile} with the ` +
        "right kind and parser.",
      items: labelled(blocks.filter((b) => b.flags.includes("unknown-lang"))),
    },
    {
      id: "empty-blocks",
      title: "empty code blocks",
      why: "An empty <pre> renders as a blank box and teaches nothing.",
      fix: "Add the missing code, or delete the block from the lesson HTML.",
      items: labelled(blocks.filter((b) => b.flags.includes("empty"))),
    },
    {
      id: "unterminated-block",
      title: "unterminated code blocks",
      why:
        "The block has no closing tag, so its extent cannot be determined and " +
        "its contents are skipped entirely.",
      fix: "Close the <pre> or <code> element in the lesson HTML.",
      items: labelled(
        blocks.filter((b) => b.anomalies.includes("unterminated-block")),
      ),
    },
    {
      id: "invalid-config",
      title: "config blocks that do not parse",
      why:
        "The block is neither valid nor a recognizable excerpt of a larger " +
        "document, so a reader who copies it gets the same error.",
      fix:
        "Correct the syntax in the lesson HTML. If the block is deliberately a " +
        "fragment, make that legible by including the enclosing braces or an " +
        "explicit ... marker.",
      items: blocks
        .filter((b) => b.parse?.status === "invalid")
        .map((block) =>
          blockItem(
            block,
            `${style.heading(block.lang)}  ${style.bad(block.parse.error)}`,
          ),
        ),
    },
    {
      id: "unchecked-config",
      title: "config blocks with no parser wired up",
      why: "The block is treated as configuration but nothing validates it.",
      fix:
        `Add a parser for this language to the languages map in ${configFile}, ` +
        "and a matching checker in src/parse-config.js.",
      items: labelled(blocks.filter((b) => b.kind === "config" && !b.parse)),
    },
    {
      id: "promptless-shell",
      title: "shell blocks with no prompt marker",
      why:
        "Without a prompt a reader cannot tell which lines to type and which " +
        "are output, and the extractor cannot split them either.",
      fix: 'Prefix each command with "$ ", matching the rest of the content.',
      items: labelled(
        blocks.filter((b) => b.kind === "shell" && b.flags.includes("no-prompt")),
      ),
    },
    {
      id: "commandless-runnable",
      title: "runnable blocks with no command",
      why: "The block is marked executable but nothing could be extracted to run.",
      fix: "Check the prompt splitting in src/classify.js against this block.",
      items: labelled(
        blocks.filter((b) => b.runnable && (b.shell?.commands.length ?? 0) === 0),
      ),
    },
    {
      id: "runnable-output",
      title: "output blocks marked runnable",
      why: "By convention ansi holds output only, which must never be executed.",
      fix: "Check the kind mapping and runnable rule in src/classify.js.",
      items: labelled(outputs.filter((b) => b.runnable)),
    },
    {
      id: "unpaired-output",
      title: "output blocks with no command to attach to",
      why:
        "An ansi block is the output of the command before it, but nothing " +
        "precedes these, so a reader cannot tell what produced them and the " +
        "content cannot be verified by running anything.",
      fix:
        "Add the command that produces this output in a preceding " +
        '<pre data-lang="console"> block. If the output belongs to a build ' +
        "driven by the config block above it, show the build command explicitly.",
      items: outputs
        .filter((b) => b.flags.includes("unpaired-output"))
        .map((block) => blockItem(block, style.muted(firstLine(block)))),
    },
    {
      id: "mislabeled-output",
      title: "blocks labelled as output that contain a command",
      why:
        'data-lang="ansi" means output only. These carry a shell prompt, ' +
        "usually a decorated one such as \u276f or \u279c rather than the $ used " +
        "elsewhere, so the command a reader needs to run is buried in a block " +
        "styled as a transcript.",
      fix:
        'Move the command into its own <pre data-lang="console"> block above ' +
        'the output, and use the "$ " prompt to match the rest of the content.',
      items: outputs
        .filter((b) => b.flags.includes("mislabeled-output"))
        .map((block) => blockItem(block, style.muted(firstLine(block)))),
    },
    {
      id: "cross-reference",
      severity: "warning",
      title: "commands whose recorded output contradicts them",
      why:
        "The output shown under this command was captured from a different " +
        "run, so a reader following along sees something other than what is " +
        "printed here.",
      fix:
        warnedRules
          .map((rule) => REMEDIATION[rule])
          .filter(Boolean)
          .join(" ") || "Re-capture the output against the command as written.",
      items: warnings.map(warningItem),
    },
    {
      id: "case-mismatched-paths",
      title: "content paths whose case does not match disk",
      why:
        "These resolve on macOS, whose filesystem is case-insensitive, and " +
        "fail on a case-sensitive filesystem such as a Linux CI runner, where " +
        "the lesson is skipped with no error at all.",
      fix:
        "Rename the directory on disk to match lessons-meta.json, or update " +
        "the metadata to match disk. They must agree exactly, including case.",
      items: caseMismatches.map((m) => ({
        summary: style.heading(m.course),
        key: `${m.course}/${m.declared}`,
        details: [
          ["declared", m.declared],
          ["on disk", m.actual],
        ],
      })),
    },
    {
      id: "missing-paths",
      title: "content files declared in metadata but absent from disk",
      why: "The lesson body cannot be loaded, so its code blocks are never tested.",
      fix:
        "Restore the missing file, or remove its entry from the course's " +
        "lessons-meta.json.",
      items: missing.map((m) => ({
        summary: style.heading(m.course),
        key: `${m.course}/${m.declared}`,
        details: [["declared", m.declared]],
      })),
    },
    {
      id: "unreferenced-files",
      title: "content files no metadata points at",
      why:
        "Nothing in lessons-meta.json refers to these files, so any code they " +
        "contain is never extracted or checked.",
      fix:
        "Add the file to the course's lessons-meta.json as a content item, or " +
        "delete it if it is left over.",
      // Keyed relative to the content root, because the known-issues file lives
      // with the content and must not encode where this checkout happens to sit.
      items: findUnreferencedContentFiles().map((file) => ({
        summary: style.path(file),
        key: path.relative(contentRoot, path.resolve(repoRoot, file)),
      })),
    },
  ];

  for (const anomaly of anomalies) {
    problems.push({
      id: `anomaly:${anomaly}`,
      title: `blocks with "${anomaly}"`,
      why: ANOMALY_HELP[anomaly]?.why,
      fix: ANOMALY_HELP[anomaly]?.fix ?? "Correct the block in the lesson HTML.",
      items: labelled(blocks.filter((b) => b.anomalies.includes(anomaly))),
    });
  }

  // `accepted` is filled in by `inspect`; seeding it here keeps every problem
  // the same shape whether or not the known-issues pass has run.
  return problems.map((problem) => ({ accepted: [], ...problem }));
}

/**
 * Split every problem's findings into open and accepted, and audit the
 * known-issues file against what was actually found.
 *
 * An entry only holds while it still describes reality. If the block it names
 * has been edited its fingerprint no longer matches, so the finding reopens
 * and the entry is reported as stale; if the finding is gone entirely the entry
 * is reported as resolved and should be deleted. Neither state is silent,
 * which is what stops the file becoming a list of excuses nobody rereads.
 *
 * @param {ReturnType<typeof getInventory>} [blocks]
 */
export function inspect(blocks = getInventory()) {
  const problems = collectProblems(blocks);
  const { issues, notes } = loadKnownIssues();
  const index = indexIssues(issues);
  const matched = new Set();
  const stale = [];

  for (const problem of problems) {
    const open = [];
    const accepted = [];

    for (const item of problem.items) {
      const identity = `${problem.id}\u0000${item.key}`;
      const issue = item.key === undefined ? undefined : index.get(identity);

      if (!issue) {
        open.push(item);
        continue;
      }
      matched.add(identity);

      const drifted =
        issue.fingerprint !== undefined && issue.fingerprint !== item.fingerprint;
      if (drifted) {
        stale.push({ issue, item, problem: problem.id });
        open.push(item);
      } else {
        accepted.push({ ...item, issue });
      }
    }

    problem.items = open;
    problem.accepted = accepted;
  }

  const known = new Set(problems.map((p) => p.id));
  const resolved = issues.filter(
    (issue) =>
      known.has(issue.problem) && !matched.has(`${issue.problem}\u0000${issue.key}`),
  );
  const unknown = issues.filter((issue) => !known.has(issue.problem));

  return { problems, stale, resolved, unknown, notes };
}

/** Problems with findings nobody has accepted, which is what fails the suite. */
export const open = (problems) => problems.filter((p) => p.items.length > 0);

/** Problems whose every finding is held by a known-issues entry. */
export const accepted = (problems) =>
  problems.filter((p) => p.items.length === 0 && p.accepted?.length > 0);
