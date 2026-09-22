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

/**
 * Take a key apart into the course, the lesson slug, and everything after.
 *
 * Most keys are `course/lesson-slug/content-item#ordinal`, with a suffix
 * naming the rule or the sub-finding. The course directory and the content
 * item id are stable; the slug is derived from the lesson title and moves
 * whenever somebody retitles a lesson.
 *
 * Returns null for the keys that are not of this shape — a language name, a
 * file path, a pair of lesson ids — which simply do not participate.
 *
 * @param {string} key
 */
function keyShape(key) {
  const match = /^([^/]+)\/([^/]+)\/(.+)$/.exec(String(key));
  if (!match) return null;
  return { course: match[1], slug: match[2], rest: match[3] };
}

/**
 * Tell a retitled lesson apart from a repaired one.
 *
 * An entry that matches no finding means one of two things, and they call
 * for opposite actions. Either the finding was repaired, and the entry should
 * be deleted; or the lesson was retitled, its slug changed, and the entry now
 * names an instance that no longer exists under that name while the finding
 * itself is still there and newly unexplained.
 *
 * Reporting both as "resolved, delete these" is worse than saying nothing.
 * Following that advice throws away a recorded decision, and the finding then
 * reappears as open for somebody to "fix" — which for an adjudicated case
 * means undoing a choice that was made deliberately. That has already nearly
 * happened once.
 *
 * The two are separable because only the slug moves. A content item id is
 * opaque and unique, so an unmatched entry whose course, item and ordinal all
 * equal those of an open finding of the same check is a rename, not a repair.
 *
 * @param {KnownIssue[]} unmatched  Entries matching nothing.
 * @param {{problem: string, key: string}[]} open  Findings nothing covers.
 * @returns {{renamed: {issue: KnownIssue, key: string, from: string, to: string}[],
 *            resolved: KnownIssue[]}}
 */
export function partitionUnmatched(unmatched, open) {
  const renamed = [];
  const resolved = [];

  for (const issue of unmatched) {
    const was = keyShape(issue.key);
    const now =
      was &&
      open.find((item) => {
        const shape = keyShape(item.key);
        return (
          item.problem === issue.problem &&
          shape &&
          shape.course === was.course &&
          shape.rest === was.rest &&
          shape.slug !== was.slug
        );
      });

    if (now) renamed.push({ issue, key: now.key, from: was.slug, to: keyShape(now.key).slug });
    else resolved.push(issue);
  }

  return { renamed, resolved };
}
