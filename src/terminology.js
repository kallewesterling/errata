/**
 * Product names the content still uses after the product was renamed.
 *
 * Which words were retired is a fact about one catalogue, so the list lives in
 * the content repository's `terminology` setting and this module carries only
 * the mechanism. The mechanism is almost entirely about scope, because the
 * same string means different things in different places:
 *
 *   - In prose the reader sees a retired name, and it should be renamed.
 *   - In a code block it is usually an identifier. `chainguard-images` appears
 *     116 times inside code in the content this was written against, nearly
 *     all of it the GitHub organisation in a `cosign verify` certificate
 *     identity, which has to match what actually signed the artifact. Renaming
 *     it breaks every verification command in the catalogue. So code is left
 *     alone unless a term opts in with `alsoInCode`, for the rare case where a
 *     command really did change.
 *   - In a URL slug it is real residue, but rewriting a published slug breaks
 *     every existing link to it. That is reported as stale, never as
 *     something to edit.
 *
 * A statement that is dated, such as "in 2025 these were called Chainguard
 * Images", is correct and must survive. That needs no machinery here: it is
 * accepted in the known-issues file with the reason, like any other finding.
 *
 * Every scan blanks what it is not reading with a same-length filler, so each
 * match keeps its true offset in the file. A finding points at a real line and
 * column, and a rewrite can later replace exactly the characters matched.
 */
import { decodeHTML } from "entities";

/**
 * @typedef {object} Term
 * @property {string} from        The retired name.
 * @property {string} to          What it is called now.
 * @property {string} [since]     When it was renamed, for the report.
 * @property {boolean} [alsoInCode]  Report it inside code as well as prose.
 */

/**
 * @typedef {object} CompiledTerm
 * @property {Term} term
 * @property {RegExp} text  Matches the name in running text.
 * @property {RegExp} slug  Matches the name in its hyphenated URL form.
 */

/**
 * Whitespace as it appears in HTML source between two words of a name.
 *
 * The source wraps lines wherever the editor did, and a non-breaking space is
 * the usual way an author keeps a product name on one line, so all of these
 * stand for the space in the configured name.
 */
const GAP = String.raw`(?:\s|&nbsp;|&#160;|&#[xX][aA]0;)+`;

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Turn the configured terms into the patterns that find them.
 *
 * Matching ignores case, because "Chainguard images" is the same retired name
 * as "Chainguard Images". It is bounded by letters and digits on both sides,
 * so a singular term does not match inside its own plural: a catalogue that
 * renamed both lists both, which also keeps each one's replacement exact.
 *
 * @param {readonly Term[]} terms
 * @returns {CompiledTerm[]}
 */
export function compileTerms(terms) {
  return terms.map((term) => {
    const words = term.from.trim().split(/\s+/).map(escape);
    const slugForm = term.from.trim().toLowerCase().split(/\s+/).map(escape).join("-");
    return {
      term,
      text: new RegExp(String.raw`(?<![\p{L}\p{N}])${words.join(GAP)}(?![\p{L}\p{N}])`, "giu"),
      slug: new RegExp(String.raw`(?<![a-z0-9])${slugForm}(?![a-z0-9])`, "gi"),
    };
  });
}

/**
 * Two ways of blanking text, and the difference is the whole point.
 *
 * An inline tag is transparent: "Chainguard <strong>Images</strong>" reads as
 * the name, so the tag becomes spaces a name can span. Everything else that
 * is blanked becomes a wall. Without that, the prose between
 * `<code>chainctl</code>` and `<code>images diff</code>` in one sentence
 * blanks to spaces and the two code elements read as `chainctl images`, and
 * "a Chainguard <code>-dev</code> image" reads as "Chainguard image". Both
 * were found that way, in the content this was written against.
 *
 * Both keep the length of what they replace, so offsets survive either way.
 */
const blank = (match) => " ".repeat(match.length);
export const WALL = "\0";
const wall = (match) => WALL.repeat(match.length);

/** Elements whose content is code a reader copies. */
const CODE = /<(pre|code)\b[^>]*>([\s\S]*?)<\/\1>/gi;

/** Elements whose content no reader sees as text. */
const UNSEEN = /<(script|style)\b[\s\S]*?<\/\1>/gi;

const COMMENT = /<!--[\s\S]*?-->/g;

/** Tags that end one run of text and start another. */
const BLOCK_TAG =
  /<\/?(?:p|div|li|ul|ol|dl|dt|dd|h[1-6]|table|thead|tbody|tr|td|th|br|hr|blockquote|section|figure|figcaption|details|summary)\b[^>]*>/gi;

const TAG = /<[^>]*>/g;

/**
 * The text a reader sees as prose, with everything else blanked.
 *
 * Comments go first, because a comment can contain a tag-shaped string that
 * would otherwise end the tag pattern early.
 *
 * @param {string} html
 */
export function proseOf(html) {
  return html
    .replace(COMMENT, wall)
    .replace(UNSEEN, wall)
    .replace(CODE, wall)
    .replace(BLOCK_TAG, wall)
    .replace(TAG, blank);
}

/**
 * The text inside code elements, with everything else blanked.
 *
 * The inverse of `proseOf`. Markup inside a block, such as a highlighted span,
 * is transparent, so it reads the code as the reader sees it; each code
 * element is walled off from the next.
 *
 * @param {string} html
 */
export function codeOf(html) {
  const source = html.replace(COMMENT, wall).replace(UNSEEN, wall);
  let out = "";
  let last = 0;
  for (const match of source.matchAll(CODE)) {
    const inner = match[2];
    const start = match.index + match[0].indexOf(inner, match[0].indexOf(">") + 1);
    out += wall(source.slice(last, start)) + inner.replace(BLOCK_TAG, wall).replace(TAG, blank);
    last = start + inner.length;
  }
  return out + wall(source.slice(last));
}

/**
 * The words around a match, as a reader would quote them.
 *
 * Used as part of a finding's identity as well as for display, so it has to be
 * stable: it is cut at word boundaries and has its whitespace flattened, so
 * re-wrapping a paragraph does not change it.
 *
 * @param {string} text   The blanked text the match was found in.
 * @param {number} start
 * @param {number} end
 */
function contextOf(text, start, end) {
  const REACH = 40;
  // Never past a wall: the context is the run of text the name sits in, not
  // the paragraph that happens to follow it.
  const lo = text.lastIndexOf(WALL, start) + 1;
  const hi = text.indexOf(WALL, end) === -1 ? text.length : text.indexOf(WALL, end);
  let from = Math.max(lo, start - REACH);
  let to = Math.min(hi, end + REACH);
  if (from > lo) from = Math.min(text.indexOf(" ", from) + 1 || start, start);
  if (to < hi) to = Math.max(text.lastIndexOf(" ", to), end);
  return decodeHTML(text.slice(from, to)).replace(/\s+/g, " ").trim();
}

/**
 * @typedef {object} RetiredTerm
 * @property {Term} term
 * @property {"prose"|"code"} where
 * @property {string} match    The text as it stands in the file.
 * @property {number} offset   Where the match starts in the file.
 * @property {string} context  The words around it, flattened.
 */

/**
 * Every retired name in a piece of HTML.
 *
 * Prose always; code only for the terms that ask for it.
 *
 * @param {string} html
 * @param {CompiledTerm[]} compiled
 * @returns {RetiredTerm[]}
 */
export function findRetiredTerms(html, compiled) {
  if (compiled.length === 0) return [];
  /** @type {{where: "prose"|"code", text: string}[]} */
  const regions = [{ where: "prose", text: proseOf(html) }];
  if (compiled.some((c) => c.term.alsoInCode)) {
    regions.push({ where: "code", text: codeOf(html) });
  }

  const found = [];
  for (const { where, text } of regions) {
    for (const { term, text: pattern } of compiled) {
      if (where === "code" && !term.alsoInCode) continue;
      for (const m of text.matchAll(pattern)) {
        found.push({
          term,
          where,
          match: html.slice(m.index, m.index + m[0].length),
          offset: m.index,
          context: contextOf(text, m.index, m.index + m[0].length),
        });
      }
    }
  }
  return found.sort((a, b) => a.offset - b.offset);
}

/**
 * The retired names inside one URL slug.
 *
 * @param {string} slug
 * @param {CompiledTerm[]} compiled
 * @returns {{term: Term, match: string}[]}
 */
export function findRetiredInSlug(slug, compiled) {
  return compiled.flatMap(({ term, slug: pattern }) =>
    [...slug.matchAll(pattern)].map((m) => ({ term, match: m[0] })),
  );
}
