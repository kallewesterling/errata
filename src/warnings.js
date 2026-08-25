/**
 * Cross-reference rules that compare a command against the output it is shown
 * to produce.
 *
 * These are warnings rather than failures. A hit is a genuine inconsistency in
 * the content, but occasionally an intentional one, so the suite reports them
 * and fails only when the count grows.
 *
 * Every rule here compares the content against itself, which keeps them
 * deterministic and offline. Rules that compare against the outside world live
 * in `drift.js`, because "the world moved on" is a different kind of claim.
 *
 * @typedef {object} Warning
 * @property {string} rule
 * @property {string} message
 * @property {string} blockId
 * @property {string} editorRef
 * @property {string|null} url
 */

const DIGEST = /sha256:[a-f0-9]{64}/g;

const unique = (text, re) => [...new Set([...text.matchAll(re)].map((m) => m[0]))];

/** Repository part of an image reference, without tag or digest. */
export function imageRepository(ref) {
  return ref.split("@")[0].replace(/:[^:/]+$/, "");
}

const short = (digest) => digest.slice(0, 19);

/**
 * A command that pins digests should be shown alongside output that mentions
 * at least one of them. When the two sets are completely disjoint, the output
 * was captured from a different run, and a reader following along sees
 * something other than what is printed.
 *
 * Requiring both sides to name digests and to share none of them keeps this
 * conservative: output that lists extra layer or package digests alongside the
 * pinned one does not trigger it.
 */
function digestMismatch(command, outputs) {
  const inCommand = unique(command.code, DIGEST);
  if (inCommand.length === 0) return null;

  const outputCode = outputs.map((o) => o.code).join("\n");
  const inOutput = unique(outputCode, DIGEST);
  if (inOutput.length === 0) return null;
  if (inCommand.some((d) => inOutput.includes(d))) return null;

  return {
    rule: "digest-mismatch",
    message:
      `Command pins ${inCommand.map(short).join(", ")} but its output reports ` +
      `${inOutput.slice(0, 2).map(short).join(", ")}. The output was captured ` +
      `from a different run.`,
  };
}

/**
 * Output that names container images should name the ones the command used.
 * A completely disjoint set usually means the sample was pasted from a
 * different lesson or an earlier version of the command.
 */
function imageMismatch(command, outputs) {
  const inCommand = new Set(command.imageRefs.map(imageRepository));
  if (inCommand.size === 0) return null;

  const inOutput = new Set(outputs.flatMap((o) => o.imageRefs).map(imageRepository));
  if (inOutput.size === 0) return null;
  if ([...inOutput].some((repo) => inCommand.has(repo))) return null;

  return {
    rule: "image-mismatch",
    message:
      `Command uses ${[...inCommand].join(", ")} but its output refers to ` +
      `${[...inOutput].join(", ")}.`,
  };
}

/**
 * A tag pinned in the command should match the tag echoed back in the output.
 * Only the repositories named by both sides are compared, so unrelated images
 * mentioned in passing are ignored.
 */
function tagMismatch(command, outputs) {
  const outputCode = outputs.map((o) => o.code).join("\n");

  for (const ref of command.imageRefs) {
    const tagged = /^([^@]+):([A-Za-z0-9._-]+)$/.exec(ref.split("@")[0]);
    if (!tagged) continue;
    const [, repo, tag] = tagged;

    const echoed = new RegExp(
      `${repo.replace(/[.\\/+*?()[\]{}|^$]/g, "\\$&")}:([A-Za-z0-9._-]+)`,
      "g",
    );
    for (const match of outputCode.matchAll(echoed)) {
      if (match[1] !== tag) {
        return {
          rule: "tag-mismatch",
          message: `Command uses ${repo}:${tag} but its output shows ${repo}:${match[1]}.`,
        };
      }
    }
  }
  return null;
}

const RULES = [digestMismatch, imageMismatch, tagMismatch];

/**
 * The fields the rules read. Kept narrower than `CodeBlock` so rules can be
 * tested without constructing a full inventory record.
 *
 * @typedef {object} WarnableBlock
 * @property {string} id
 * @property {string} code
 * @property {string[]} imageRefs
 * @property {string[]} expectedOutput
 * @property {Warning[]} warnings
 * @property {string} editorRef
 * @property {string|null} url
 */

/**
 * Run every rule over each command that has recorded output, attaching results
 * to the command block.
 *
 * @param {WarnableBlock[]} blocks
 * @returns {Warning[]}
 */
export function collectWarnings(blocks) {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const warnings = [];

  for (const command of blocks) {
    if (command.expectedOutput.length === 0) continue;
    const outputs = command.expectedOutput.map((id) => byId.get(id)).filter(Boolean);

    for (const rule of RULES) {
      const hit = rule(command, outputs);
      if (!hit) continue;
      const warning = {
        ...hit,
        blockId: command.id,
        editorRef: command.editorRef,
        url: command.url,
      };
      command.warnings.push(warning);
      warnings.push(warning);
    }
  }

  return warnings;
}

/** What to do about each rule, shown alongside its findings. */
export const REMEDIATION = {
  "digest-mismatch":
    "Re-run the command as written and paste its actual output, or update the " +
    "command to use the digests the output was captured against.",
  "image-mismatch":
    "Re-capture the output against the image the command uses, or correct the " +
    "command to name the image the output describes.",
  "tag-mismatch":
    "Align the tag in the command with the one in the output. If the lesson " +
    "deliberately shows an upgrade, make that explicit in the surrounding prose.",
};

/**
 * A `formatProblem` item for a warning.
 *
 * The rule forms part of the identity because one block can trip several rules
 * at once, and accepting a digest mismatch should not quietly accept a tag
 * mismatch found in the same place.
 */
export function warningItem(warning) {
  return {
    summary: `${warning.rule}  ${warning.message}`,
    key: `${warning.blockId}::${warning.rule}`,
    fingerprint: warning.fingerprint,
    locations: [{ editorRef: warning.editorRef, url: warning.url }],
  };
}

/** Format a warning for a test failure message or the CLI. */
export function formatWarning(warning) {
  return `[${warning.rule}] ${warning.blockId}\n    ${warning.message}\n    ${warning.editorRef}${
    warning.url ? `\n    ${warning.url}` : ""
  }`;
}
