/**
 * Extraction of the inline `<script>` elements in lesson HTML.
 *
 * A `<script>` is a raw-text element, so an HTML entity written inside one is
 * never decoded. Nothing downstream decodes it either: the resources widget
 * sets `title` and `description` with `textContent` and passes `link` through
 * `sanitizeUrl()` into `href`, and neither path touches an entity. An `&amp;`
 * written in a JS string literal reaches the reader as five characters.
 *
 * The damage is worst in a URL. A YouTube link carrying `watch?v=...&amp;t=2691s`
 * still resolves, so every link check passes it, and the timestamp the author
 * meant to link to is silently dropped.
 *
 * The rule inverts at the `<script>` boundary. `&rsquo;` is correct in the
 * prose of the same file and a defect inside the script, so an author applying
 * the prose convention consistently is exactly how this gets written. That is
 * why it needs a tool rather than a careful reader.
 */
import { parseFragment } from "parse5";
import { fingerprint } from "./extract.js";

/**
 * What counts as an entity here.
 *
 * Named entities are what the content actually carries. The numeric and hex
 * forms are included because they are the same defect spelled differently, and
 * a check that caught only the named form would send an author to replace
 * `&amp;` with `&#38;` and call it fixed.
 */
const ENTITY = /&(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#[xX][0-9a-fA-F]+);/g;

/** How much of the surrounding source to quote when naming a finding. */
const CONTEXT_SPAN = 40;

/** Collect every `<script>` element, in document order. */
function collectScripts(node, out = []) {
  if (node.tagName === "script") out.push(node);
  for (const child of node.childNodes ?? []) collectScripts(child, out);
  return out;
}

/**
 * The source either side of a match, flattened onto one line.
 *
 * A bare `&amp;` names nothing a reader can act on; the URL it sits in does.
 *
 * @param {string} body
 * @param {number} index
 */
function contextAround(body, index) {
  const from = Math.max(0, index - CONTEXT_SPAN);
  const to = Math.min(body.length, index + CONTEXT_SPAN);
  const text = body.slice(from, to).replace(/\s+/g, " ").trim();
  return `${from > 0 ? "..." : ""}${text}${to < body.length ? "..." : ""}`;
}

/**
 * @typedef {object} ScriptEntity
 * @property {string} entity       The entity exactly as written.
 * @property {string} context      Surrounding source, for recognizing it.
 * @property {string} fingerprint  Hash of the whole script body, so editing
 *   the script reopens every finding in it rather than only the edited one.
 * @property {number} scriptOrdinal  0-based index of the script in its file.
 * @property {number} ordinal        0-based index of the finding in its file.
 * @property {import("./extract.js").SourceLocation} source
 */

/**
 * Every HTML entity inside an inline `<script>` in one lesson file.
 *
 * Located with a parser and then read out of the source text, for the same
 * reason code blocks are: the parser is right about where the script starts
 * and ends, and the source is the only place the entity still exists as the
 * author typed it.
 *
 * @param {string} html
 * @param {string} relPath
 * @returns {ScriptEntity[]}
 */
export function extractScriptEntities(html, relPath) {
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true });
  const found = [];

  collectScripts(fragment).forEach((node, scriptOrdinal) => {
    const loc = node.sourceCodeLocation;
    const start = loc?.startTag?.endOffset;
    const end = loc?.endTag?.startOffset;
    // A `<script src>` has no body here to check, and an unclosed one has no
    // determinable extent. Neither is this check's finding to report.
    if (start === undefined || end === undefined || end <= start) return;

    const body = html.slice(start, end);
    const hash = fingerprint(body);

    for (const match of body.matchAll(ENTITY)) {
      const offset = start + match.index;
      const before = html.slice(0, offset);
      const lineStart = before.lastIndexOf("\n") + 1;

      found.push({
        entity: match[0],
        context: contextAround(body, match.index),
        fingerprint: hash,
        scriptOrdinal,
        ordinal: found.length,
        source: {
          file: relPath,
          line: before.split("\n").length,
          column: offset - lineStart + 1,
          endLine: before.split("\n").length,
          startOffset: offset,
          endOffset: offset + match[0].length,
        },
      });
    }
  });

  return found;
}
