/**
 * Finding lessons that are copies of each other, and the places where those
 * copies have stopped agreeing.
 *
 * The point is not that content repeats. It repeats on purpose: whole courses
 * here are assembled from lessons that belong to other courses, so a check that
 * reported duplicates would be reporting dozens of editorial decisions. The
 * finding is the pair that used to match and no longer does, because that is
 * what an edit reaching one copy and missing the other looks like from outside.
 *
 * Nothing in here fails a run. Much of the drift is correct — a lesson written
 * to stand alone opens differently from the same lesson inside a learning path,
 * and says "in this course" where its twin says "in this module". Only a person
 * can tell that apart from a fix that landed in one place, so this reports the
 * difference and stops there.
 */
import crypto from "node:crypto";
import { parseFragment } from "parse5";
import { duplication } from "./config.js";
import { style } from "./report.js";

/**
 * @typedef {object} TextDoc
 * @property {string} id         Identity of the content item.
 * @property {string} label      Course and lesson, for reading in a report.
 * @property {string} course
 * @property {string} lesson
 * @property {string} editorRef
 * @property {string|null} lessonUrl
 * @property {string} text       Visible text, whitespace collapsed.
 * @property {string[]} sentences
 * @property {number} words
 * @property {Set<string>} shingles
 */

/**
 * @typedef {object} Pair
 * @property {TextDoc} a
 * @property {TextDoc} b
 * @property {number} score      Jaccard similarity of the shingle sets.
 * @property {string[]} onlyA    Sentences present in a and not in b.
 * @property {string[]} onlyB
 */

/**
 * Elements that end a line on the page.
 *
 * Without these the whole lesson collapses to one line, and a command with no
 * full stop after it runs into the sentence that follows. The report would
 * then show a rewritten paragraph and a changed command as a single blob.
 */
const BLOCK_ELEMENTS = new Set([
  "p", "pre", "div", "li", "tr", "blockquote", "section", "article",
  "h1", "h2", "h3", "h4", "h5", "h6", "br", "hr", "td", "th",
]);

/**
 * Text a reader actually sees.
 *
 * Script and style elements hold text as far as the parser is concerned, and
 * none of it is prose. Leaving them in does more than add noise here: the
 * related-resources widget in this content is a script that names sibling
 * courses, so it is different in every copy by design, and it would dominate
 * every comparison it took part in.
 *
 * @param {string} html
 * @param {Set<string>} ignore  Element names whose contents to skip.
 */
export function visibleText(html, ignore = duplication.ignoreElements) {
  const out = [];
  const walk = (node) => {
    if (ignore.has(node.nodeName)) return;
    if (node.nodeName === "#text") out.push(node.value);
    for (const child of node.childNodes ?? []) walk(child);
    if (BLOCK_ELEMENTS.has(node.nodeName)) out.push("\n");
  };
  walk(parseFragment(html));
  return out
    .join(" ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Reduce text to the tokens worth comparing.
 *
 * Case and punctuation are dropped because a copy that differs only in those
 * is the same copy, and keeping them would rank a curly apostrophe as drift.
 *
 * @param {string} text
 */
export function words(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/**
 * Overlapping word n-grams.
 *
 * Comparing bags of single words would call any two lessons about CVEs
 * identical, since they draw on the same vocabulary. Comparing whole documents
 * would miss anything but an exact copy. An n-gram is the middle: five words in
 * the same order rarely coincide, and a small edit only disturbs the few
 * shingles that overlap it.
 *
 * @param {string[]} ws
 * @param {number} n
 */
export function shingles(ws, n = duplication.shingleSize) {
  const out = new Set();
  for (let i = 0; i + n <= ws.length; i++) out.add(ws.slice(i, i + n).join(" "));
  return out;
}

/**
 * Jaccard similarity: shared shingles over total distinct shingles.
 *
 * @param {Set<string>} a
 * @param {Set<string>} b
 */
export function similarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const s of small) if (large.has(s)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Split into the units an author edits in.
 *
 * Reporting differing shingles would be unreadable, because one changed word
 * disturbs five of them. Sentences are what somebody actually rewrote.
 *
 * @param {string} text
 */
export function sentences(text) {
  return text
    .split(/(?<=[.:!?])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 15);
}

/** Sentence key for comparison, so punctuation and case do not count as drift. */
const key = (s) => words(s).join(" ");

/**
 * Every pair of documents at or above the threshold.
 *
 * Compared exhaustively. That is quadratic, and at this size — a few hundred
 * documents, so a couple of hundred thousand set intersections — it runs in
 * about a second. MinHash and LSH are the usual answer to this shape of
 * problem and would only add a sampling error to hide.
 *
 * @param {TextDoc[]} docs
 * @param {number} threshold
 * @returns {Pair[]}
 */
export function similarPairs(docs, threshold = duplication.threshold) {
  const pairs = [];

  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const score = similarity(docs[i].shingles, docs[j].shingles);
      if (score < threshold) continue;

      const inB = new Set(docs[j].sentences.map(key));
      const inA = new Set(docs[i].sentences.map(key));
      pairs.push({
        a: docs[i],
        b: docs[j],
        score,
        onlyA: docs[i].sentences.filter((s) => !inB.has(key(s))),
        onlyB: docs[j].sentences.filter((s) => !inA.has(key(s))),
      });
    }
  }

  return pairs.sort((x, y) => y.score - x.score);
}

/** Pairs that match exactly, which is the healthy state for a shared lesson. */
export const inSync = (pairs) => pairs.filter((p) => p.score === 1);

/** Pairs that were the same and no longer are. */
export const drifted = (pairs) =>
  pairs.filter((p) => p.score < 1 && (p.onlyA.length > 0 || p.onlyB.length > 0));

/**
 * Identity of a pair, stable regardless of which side is found first.
 *
 * @param {Pair} pair
 */
export function pairKey(pair) {
  return [pair.a.id, pair.b.id].sort().join(" :: ");
}

/**
 * Fingerprint of both sides together, so accepting a drift expires as soon as
 * either copy is edited — including when somebody fixes it.
 *
 * @param {Pair} pair
 */
export function pairFingerprint(pair) {
  const [x, y] = [pair.a, pair.b].sort((p, q) => (p.id < q.id ? -1 : 1));
  return crypto
    .createHash("sha256")
    .update(`${words(x.text).join(" ")}\u0000${words(y.text).join(" ")}`)
    .digest("hex")
    .slice(0, 16);
}

/** A sentence that is a shell command, which raises the stakes of a drift. */
const looksExecutable = (s) => /^\s*[$#]\s+\S/.test(s);

/**
 * Whether a drift touches something executable rather than only wording.
 *
 * @param {Pair} pair
 */
export function touchesCode(pair) {
  return [...pair.onlyA, ...pair.onlyB].some(looksExecutable);
}

/** Code with whitespace-only differences removed, for grouping. */
export function normalizeCode(code) {
  return code
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Whether a shared block is worth tracking across courses.
 *
 * `$ apk update` appears in four courses and it does not matter: there is no
 * version, path or flag in it to get out of step, and nobody fixing one would
 * need to think about the others. A block earns a place on the map by carrying
 * detail that can rot — more than one line, or one long enough to hold a URL
 * or a pinned version.
 *
 * @param {string} code
 */
export function worthTracking(code) {
  const normalized = normalizeCode(code);
  if (normalized.length === 0) return false;
  return normalized.includes("\n") || normalized.length >= 40;
}

/**
 * Group items by a normalized value, keeping only groups with more than one
 * distinct owner. This is the linkage map: what a change here also changes.
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} valueOf   What makes two items the same.
 * @param {(item: T) => string} ownerOf   What makes two items separate places.
 */
export function sharedGroups(items, valueOf, ownerOf) {
  const groups = new Map();
  for (const item of items) {
    const k = valueOf(item);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(item);
  }

  return [...groups.entries()]
    .map(([value, group]) => ({
      value,
      group,
      owners: [...new Set(group.map(ownerOf))],
    }))
    .filter((g) => g.owners.length > 1)
    .sort((x, y) => y.owners.length - x.owners.length);
}

/** Every finding this module can emit, for validating known-issues entries. */
export const DUPLICATION_PROBLEM_IDS = Object.freeze([
  "drifted-copy",
  "shared-code-block",
]);

/**
 * Build the problem list for duplication.
 *
 * Both entries are warnings and neither sets an exit code. The drift report is
 * a question for an author, not a defect, and the linkage map is not a finding
 * at all — it is the answer to "if I change this, where else must I change it",
 * which is the thing that is genuinely hard to know by hand.
 *
 * @param {Pair[]} pairs
 * @param {ReturnType<typeof sharedGroups>} blockGroups
 * @returns {import("./problems.js").Problem[]}
 */
export function collectDuplicationProblems(pairs, blockGroups = []) {
  const apart = drifted(pairs);

  const item = (pair) => {
    const lines = [
      ...pair.onlyA.slice(0, 3).map((s) => ["only in the first", s]),
      ...pair.onlyB.slice(0, 3).map((s) => ["only in the second", s]),
    ];
    return {
      summary:
        `${style.warn(pair.score.toFixed(3))}  ${pair.a.label}\n` +
        `${" ".repeat(9)}${pair.b.label}` +
        (touchesCode(pair) ? `  ${style.bad("differs in a command")}` : ""),
      key: pairKey(pair),
      fingerprint: pairFingerprint(pair),
      details: lines,
      locations: [
        { editorRef: pair.a.editorRef, url: pair.a.lessonUrl },
        { editorRef: pair.b.editorRef, url: pair.b.lessonUrl },
      ],
    };
  };

  return [
    {
      id: "drifted-copy",
      severity: "warning",
      title: "lessons that are copies of each other but no longer match",
      why:
        "Courses here are assembled from shared lessons, so a copy is normal " +
        "and a copy that stopped matching its twin is not. It usually means an " +
        "edit reached one of them and missed the other, which is invisible " +
        "from inside either file.",
      fix:
        "Read the differing sentences. Some are deliberate, because a lesson " +
        "written to stand alone opens differently from the same lesson inside " +
        "a path. If a difference is not deliberate, apply it to both, then " +
        "record the pair in the known-issues file if it should stay apart.",
      items: apart.map(item),
      accepted: [],
    },
    {
      id: "shared-code-block",
      severity: "warning",
      title: "code blocks that appear in more than one course",
      why:
        "Not a defect. This is the answer to a question that is otherwise " +
        "very hard to ask: if this command is wrong, where else is it wrong? " +
        "Every fix to one of these needs applying to all of them.",
      fix:
        "Nothing to do. Consult it before editing a shared block, and after " +
        "editing one, to see the other places carrying the same text.",
      items: blockGroups.map((g) => ({
        summary: `${style.warn(`${g.owners.length} courses`)}  ${g.group[0].code.split("\n")[0].slice(0, 90)}`,
        key: `shared-block:${g.group[0].fingerprint}`,
        fingerprint: g.group[0].fingerprint,
        details: g.owners.slice(0, 6).map((o) => ["appears in", o]),
        locations: g.group.slice(0, 6).map((b) => ({
          editorRef: b.editorRef,
          url: b.url,
        })),
      })),
      accepted: [],
    },
  ];
}
