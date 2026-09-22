/**
 * Extraction of the `<code>` elements that sit in prose rather than in a block.
 *
 * These are a different population from the contents of a `<pre>`, and the
 * difference matters for one rule in particular. Trailing whitespace inside
 * `<pre><code>` is ordinary — a block that ends with a newline has it — while
 * an inline `<code>` ending in a space has no innocent explanation. Checking
 * the two together would mean either losing the rule or reporting every block
 * that ends in a newline.
 *
 * Text comes from the parsed tree rather than the source, which is the
 * opposite of what `src/extract.js` does and is deliberate. A `<code>` in
 * prose is not raw text, so the browser decodes its entities and drops any
 * unescaped tag inside it. What the tree holds is therefore what the reader
 * gets, and what the reader gets is the thing being checked.
 */
import { parseFragment } from "parse5";

/**
 * Collect every `<code>` that is not inside a `<pre>`, in document order.
 *
 * @param {any} node
 * @param {any[]} out
 * @param {boolean} insidePre
 */
function collectInlineCode(node, out = [], insidePre = false) {
  if (node.tagName === "code" && !insidePre) out.push(node);
  const nowInsidePre = insidePre || node.tagName === "pre";
  for (const child of node.childNodes ?? []) {
    collectInlineCode(child, out, nowInsidePre);
  }
  return out;
}

/** Concatenate the text a reader sees inside an element. */
function textOf(node, parts = []) {
  if (node.nodeName === "#text") parts.push(node.value);
  for (const child of node.childNodes ?? []) textOf(child, parts);
  return parts.join("");
}

/**
 * @typedef {object} InlineCode
 * @property {string} text     The text a reader sees, exactly as stored.
 * @property {number} ordinal  0-based index within its file.
 * @property {import("./extract.js").SourceLocation} source
 */

/**
 * Every inline `<code>` in one lesson HTML file.
 *
 * @param {string} html
 * @param {string} relPath
 * @returns {InlineCode[]}
 */
export function extractInlineCode(html, relPath) {
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true });
  const found = [];

  collectInlineCode(fragment).forEach((node, ordinal) => {
    const loc = node.sourceCodeLocation;
    if (!loc) return;

    const before = html.slice(0, loc.startOffset);
    found.push({
      text: textOf(node),
      ordinal,
      source: {
        file: relPath,
        line: loc.startLine ?? before.split("\n").length,
        column: loc.startCol ?? loc.startOffset - (before.lastIndexOf("\n") + 1) + 1,
        endLine: loc.endLine ?? loc.startLine ?? 0,
        startOffset: loc.startOffset,
        endOffset: loc.endOffset,
      },
    });
  });

  return found;
}
