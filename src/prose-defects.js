/**
 * Defects in lesson prose that belong to code: markup that never rendered,
 * and commands that lost their block.
 *
 * Both are the same mistake seen from opposite sides. An author writing in
 * Markdown habits produces `` `--platform` `` in an HTML file, and the reader
 * sees the backticks. An author pasting a command into a sentence produces an
 * invocation with no block around it, and the reader has nothing to copy.
 *
 * Everything here reads the prose only. The same characters inside a code
 * block are correct: a backtick in a `<pre>` is shell command substitution,
 * ASCII art, or captured tool output, and reporting those was settled against
 * once already.
 */

/**
 * Blank out every code region, preserving offsets.
 *
 * Replacing each region with the same number of spaces means every match
 * found afterwards still has its true offset in the original file, so a
 * finding can point at a real line and column without a second pass.
 *
 * `<pre>` is matched before its inner `<code>` because the scan runs left to
 * right and the outer element starts first, so the inner one is consumed with
 * it rather than needing separate handling.
 *
 * @param {string} html
 */
export function maskCode(html) {
  return html.replace(/<(pre|code|script)\b[\s\S]*?<\/\1>/gi, (match) =>
    " ".repeat(match.length),
  );
}

/**
 * Markdown syntax that an HTML file renders as itself.
 *
 * The backtick is the one that actually occurs: 58 pairs across 15 files,
 * heaviest in the two "Interpreting provenance metadata" lessons at 21 each,
 * where the reader saw a literal `` `--platform` ``. Bold and link syntax are
 * included because they are the same mistake and cost nothing to look for.
 * Neither occurs in the content, which is the evidence that they do not
 * misfire across 824 files rather than a reason to leave them out.
 */
const MARKDOWN = [
  { id: "backtick", pattern: /`/g, what: "a Markdown backtick, which renders as itself" },
  { id: "bold", pattern: /\*\*[^*\n]+\*\*/g, what: "Markdown bold, which renders as itself" },
  {
    id: "link",
    pattern: /\[[^\]\n]+\]\((?:https?:|\/)[^)\s]+\)/g,
    what: "a Markdown link, which renders as itself",
  },
];

/**
 * A long-form flag carrying a value, which is what distinguishes a command
 * from a sentence that merely names a tool.
 *
 * Prose mentioning `chainctl` is ordinary and common. Prose containing
 * `--parent example.com` is a block that lost its `<pre>`.
 */
const FLAG_IN_PROSE = /\s--[a-z][a-z0-9-]*(?:=|\s+[^\s<][^\s<]*)/i;

/** Elements whose text is prose a reader reads, rather than page furniture. */
const PROSE_ELEMENTS = /<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;

/**
 * @typedef {object} ProseDefect
 * @property {"markdown"|"flattened-command"} kind
 * @property {string} rule   Which pattern matched.
 * @property {string} what   Why it is a defect.
 * @property {string} match  The matched text, trimmed and shortened.
 * @property {number} ordinal
 * @property {import("./extract.js").SourceLocation} source
 */

/** Line and column of an offset, counted the way an editor counts them. */
function locate(html, offset, relPath) {
  const before = html.slice(0, offset);
  const line = before.split("\n").length;
  return {
    file: relPath,
    line,
    column: offset - (before.lastIndexOf("\n") + 1) + 1,
    endLine: line,
    startOffset: offset,
    endOffset: offset,
  };
}

/** Shorten a match to something that fits on a report line. */
const shorten = (text) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 70 ? `${flat.slice(0, 70)}...` : flat;
};

/**
 * Every prose defect in one lesson HTML file.
 *
 * @param {string} html
 * @param {string} relPath
 * @returns {ProseDefect[]}
 */
export function findProseDefects(html, relPath) {
  const prose = maskCode(html);
  /** @type {ProseDefect[]} */
  const found = [];

  for (const rule of MARKDOWN) {
    // At most one finding per rule per file. The heaviest file carries 21
    // backticks and they are one repair, not twenty-one.
    const match = prose.match(rule.pattern)?.[0];
    if (match === undefined) continue;
    const offset = prose.indexOf(match);
    found.push({
      kind: /** @type {const} */ ("markdown"),
      rule: rule.id,
      what: rule.what,
      match: shorten(match),
      ordinal: found.length,
      source: locate(html, offset, relPath),
    });
  }

  for (const element of prose.matchAll(PROSE_ELEMENTS)) {
    if (!FLAG_IN_PROSE.test(element[2])) continue;
    found.push({
      kind: /** @type {const} */ ("flattened-command"),
      rule: "flag-in-prose",
      what: "a long-form flag with a value, outside any code element",
      match: shorten(element[2]),
      ordinal: found.length,
      source: locate(html, element.index, relPath),
    });
  }

  return found;
}
