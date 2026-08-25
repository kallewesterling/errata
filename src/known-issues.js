/**
 * Content problems that are known, understood, and deliberately not fixed yet.
 *
 * This replaces the counts this project used to keep. A count says only how
 * many instances were tolerated, which makes three things impossible: knowing
 * which instance was accepted, knowing why, and noticing when one is fixed
 * while another regresses and the total stays put.
 *
 * An entry names the instance and pins the content it was accepted against, so
 * the record expires by itself. Edit the block and the fingerprint stops
 * matching, and the finding comes back for a fresh decision rather than
 * staying suppressed against content nobody has looked at since.
 *
 * The file lives with the content rather than here, because that is what it
 * describes. It is a dotfile at the content repository root, which keeps it
 * clear of any sync that walks the content directories themselves. Anything
 * recorded inside a lesson instead has to survive a round trip through the
 * publishing system's editor, which may rewrite the markup.
 */
import fs from "node:fs";
import { parse as parseYaml } from "yaml";
import { knownIssuesPath } from "./config.js";

const ENTRY_KEYS = new Set(["problem", "key", "fingerprint", "note", "added"]);
const NOTE_KEYS = new Set(["where", "note", "added"]);

/**
 * @typedef {object} KnownIssue
 * @property {string} problem      Problem id the entry excuses.
 * @property {string} key          Identity of the instance within that problem.
 * @property {string} [fingerprint] Content hash the acceptance was made against.
 * @property {string} note         Why it is not fixed, and what fixing it needs.
 * @property {string} added        ISO date the entry was made.
 */

/**
 * @typedef {object} ContentNote
 * @property {string} where  Where it applies, in whatever form is clearest.
 * @property {string} note   What was noticed.
 * @property {string} added  ISO date the observation was made.
 */

function fail(message) {
  throw new Error(`${knownIssuesPath}: ${message}`);
}

/** Accept a real date or an ISO string, and normalize to `YYYY-MM-DD`. */
function normalizeDate(value, at) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  fail(`${at}.added must be a date in YYYY-MM-DD form`);
}

/**
 * @param {any} raw
 * @returns {{ issues: KnownIssue[], notes: ContentNote[] }}
 */
export function validate(raw) {
  if (raw === null || raw === undefined) return { issues: [], notes: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    fail("expected a YAML mapping at the top level");
  }
  for (const key of Object.keys(raw)) {
    if (key !== "issues" && key !== "notes") {
      fail(`unknown setting "${key}". Expected "issues" or "notes"`);
    }
  }
  return { issues: validateIssues(raw.issues), notes: validateNotes(raw.notes) };
}

function validateIssues(raw) {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) fail("issues must be a list");

  const seen = new Set();
  return raw.map((entry, index) => {
    const at = `issues[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail(`${at} must be a mapping`);
    }
    for (const key of Object.keys(entry)) {
      if (!ENTRY_KEYS.has(key)) {
        fail(`unknown field "${at}.${key}". Expected one of: ${[...ENTRY_KEYS].join(", ")}`);
      }
    }
    for (const key of ["problem", "key", "note"]) {
      if (typeof entry[key] !== "string" || !entry[key].trim()) {
        fail(`${at}.${key} must be a non-empty string`);
      }
    }
    if (entry.fingerprint !== undefined && typeof entry.fingerprint !== "string") {
      fail(`${at}.fingerprint must be a string`);
    }

    const identity = `${entry.problem}\u0000${entry.key}`;
    if (seen.has(identity)) {
      fail(`${at} duplicates an earlier entry for ${entry.problem} / ${entry.key}`);
    }
    seen.add(identity);

    return {
      problem: entry.problem,
      key: entry.key,
      fingerprint: entry.fingerprint,
      note: entry.note.trim(),
      added: normalizeDate(entry.added, at),
    };
  });
}

/**
 * Observations no check produces.
 *
 * Some things are only visible to a person reading the lesson: a transcript
 * whose totals do not add up, prose that contradicts the command above it. They
 * cannot be suppressions, because there is no finding to suppress, but they are
 * exactly the knowledge that gets lost between revisions. They are recorded and
 * printed, and never fail anything.
 */
function validateNotes(raw) {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) fail("notes must be a list");

  return raw.map((entry, index) => {
    const at = `notes[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail(`${at} must be a mapping`);
    }
    for (const key of Object.keys(entry)) {
      if (!NOTE_KEYS.has(key)) {
        fail(`unknown field "${at}.${key}". Expected one of: ${[...NOTE_KEYS].join(", ")}`);
      }
    }
    for (const key of ["where", "note"]) {
      if (typeof entry[key] !== "string" || !entry[key].trim()) {
        fail(`${at}.${key} must be a non-empty string`);
      }
    }
    return {
      where: entry.where.trim(),
      note: entry.note.trim(),
      added: normalizeDate(entry.added, at),
    };
  });
}

/**
 * Read the known-issues file.
 *
 * A missing file means nothing is accepted, not that everything is. Every
 * recorded finding then resurfaces and the suite fails loudly, so a wrong path
 * cannot pass silently.
 *
 * @returns {{ issues: KnownIssue[], notes: ContentNote[] }}
 */
export function loadKnownIssues(file = knownIssuesPath) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { issues: [], notes: [] };
    throw err;
  }
  try {
    return validate(parseYaml(text));
  } catch (err) {
    if (err.message.startsWith(file)) throw err;
    fail(err.message);
  }
}

/** Index entries by problem id and instance key, for lookup during matching. */
export function indexIssues(issues) {
  const byIdentity = new Map();
  for (const issue of issues) {
    byIdentity.set(`${issue.problem}\u0000${issue.key}`, issue);
  }
  return byIdentity;
}
