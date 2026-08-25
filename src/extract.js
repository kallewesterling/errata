import { createHash } from "node:crypto";
import { decodeHTML } from "entities";
import { parseFragment } from "parse5";

/**
 * @typedef {object} SourceLocation
 * @property {string} file        Path relative to the repo root.
 * @property {number} line        1-based line of the first line of code.
 * @property {number} column      1-based column of the first character of code.
 * @property {number} endLine
 * @property {number} startOffset Byte offset of the first character of code.
 * @property {number} endOffset
 */

/**
 * @typedef {object} RawBlock
 * @property {string} lang        The `data-lang` value, or "" when absent.
 * @property {string} code        Decoded block content.
 * @property {string} rawCode     Content exactly as it appears in the file.
 * @property {string[]} anomalies
 * @property {SourceLocation} source
 * @property {number} ordinal     0-based index of this block within its file.
 */

/** Collect every `<pre>` element in document order. */
function collectPreElements(node, out = []) {
  if (node.tagName === "pre") out.push(node);
  for (const child of node.childNodes ?? []) collectPreElements(child, out);
  return out;
}

function getAttr(node, name) {
  return node.attrs?.find((attr) => attr.name === name)?.value;
}

/**
 * True when the raw slice contains something a browser would parse as a tag.
 *
 * `<pre>` is not a raw-text element, so any unescaped `<tag>` inside it is
 * parsed as real markup and would be lost by a textContent-based extractor.
 * We keep the content but flag it, because it is a content bug either way.
 */
function hasUnescapedMarkup(rawCode) {
  return /<[a-zA-Z/][^>]*>/.test(rawCode);
}

/**
 * Extract every code block from one lesson HTML file.
 *
 * Blocks are located with a real HTML parser so that nesting and tag
 * boundaries are correct, but the content is taken as a raw substring of the
 * original source rather than from the parsed tree. Reading `textContent`
 * would discard anything inside the block that looks like a tag.
 *
 * @param {string} html      File contents.
 * @param {string} relPath   Path recorded in the source location.
 * @returns {RawBlock[]}
 */
export function extractBlocks(html, relPath) {
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true });
  const blocks = [];

  collectPreElements(fragment).forEach((pre, ordinal) => {
    const anomalies = [];
    const lang = getAttr(pre, "data-lang");
    if (lang === undefined) anomalies.push("missing-lang");

    const codeEl = (pre.childNodes ?? []).find((n) => n.tagName === "code");
    if (!codeEl) anomalies.push("missing-code-element");

    const host = codeEl ?? pre;
    const loc = host.sourceCodeLocation;
    // An unclosed <pre> or <code> leaves no end tag to slice against.
    if (!loc?.startTag || !loc?.endTag) {
      anomalies.push("unterminated-block");
      return;
    }

    let startOffset = loc.startTag.endOffset;
    const endOffset = loc.endTag.startOffset;
    let rawCode = html.slice(startOffset, endOffset);

    // HTML drops a single newline immediately following a <pre> start tag;
    // slicing raw text bypasses the parser, so apply the rule by hand.
    if (!codeEl && rawCode.startsWith("\n")) {
      rawCode = rawCode.slice(1);
      startOffset += 1;
    }

    if (hasUnescapedMarkup(rawCode)) anomalies.push("unescaped-markup");

    const before = html.slice(0, startOffset);
    const line = before.split("\n").length;
    const column = startOffset - (before.lastIndexOf("\n") + 1) + 1;

    blocks.push({
      lang: lang ?? "",
      code: decodeHTML(rawCode),
      rawCode,
      anomalies,
      ordinal,
      source: {
        file: relPath,
        line,
        column,
        endLine: line + rawCode.split("\n").length - 1,
        startOffset,
        endOffset,
      },
    });
  });

  return blocks;
}

/** Stable content fingerprint, insensitive to surrounding whitespace changes. */
export function fingerprint(code) {
  const normalized = code
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
  return `sha256:${createHash("sha256").update(normalized).digest("hex").slice(0, 16)}`;
}
