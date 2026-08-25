/**
 * Extraction of the links in lesson prose, as opposed to the URLs that appear
 * inside code blocks.
 *
 * These are two genuinely different populations. A URL in a code block is
 * usually data — an argument to curl, a registry host, an example endpoint —
 * and fetching all of them produces noise. An `<a href>` in prose is a promise
 * to the reader that there is something at the other end, so every one of them
 * is worth checking.
 */
import { parseFragment } from "parse5";

/**
 * @typedef {object} RawLink
 * @property {string} url      The href value, entity-decoded.
 * @property {string} rawHref  The href exactly as it appears in the file, which
 *   is what a rewriter has to match against the source.
 * @property {string} text     Link text, collapsed to a single line.
 * @property {"http"|"mailto"|"anchor"|"relative"|"other"} scheme
 * @property {number} ordinal  0-based index of this link within its file.
 * @property {import("./extract.js").SourceLocation} source
 */

/** Collect every `<a>` element in document order. */
function collectAnchors(node, out = []) {
  if (node.tagName === "a") out.push(node);
  for (const child of node.childNodes ?? []) collectAnchors(child, out);
  return out;
}

/** Concatenate the text a reader sees inside an element. */
function textOf(node, parts = []) {
  if (node.nodeName === "#text") parts.push(node.value);
  for (const child of node.childNodes ?? []) textOf(child, parts);
  return parts.join("");
}

/**
 * Classify an href by what checking it would even mean.
 *
 * Only `http` is fetchable. The rest are separated rather than lumped together
 * as "unchecked" so they can be handled on their own terms: an in-page anchor
 * is verifiable offline against the same document, whereas a mailto is not
 * verifiable at all.
 *
 * @param {string} href
 * @returns {RawLink["scheme"]}
 */
export function classifyHref(href) {
  const value = href.trim();
  if (/^https?:\/\//i.test(value)) return "http";
  if (/^mailto:/i.test(value)) return "mailto";
  if (value.startsWith("#")) return "anchor";
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return "other";
  return "relative";
}

/**
 * Recover an attribute's value exactly as written in the source.
 *
 * The parser decodes entities, so `attr.value` for `?a=1&amp;b=2` comes back
 * as `?a=1&b=2`. That decoded form is the right thing to fetch and the wrong
 * thing to search the file for, and a rewriter given it would quietly fail to
 * match every href containing an encoded character.
 *
 * @param {string} html
 * @param {{startOffset: number, endOffset: number}} location
 * @param {string} fallback
 */
function rawAttrValue(html, location, fallback) {
  const source = html.slice(location.startOffset, location.endOffset);
  const match = source.match(/=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))\s*$/);
  if (!match) return fallback;
  return match[1] ?? match[2] ?? match[3] ?? fallback;
}

/**
 * Extract every prose link from one lesson HTML file.
 *
 * Locations come from a real parser so a finding points at the exact line, but
 * the href itself is recovered from the source text, for the same reason code
 * block contents are: what the parser hands back has already been transformed.
 *
 * @param {string} html     File contents.
 * @param {string} relPath  Path recorded in the source location.
 * @returns {RawLink[]}
 */
export function extractLinks(html, relPath) {
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true });
  const links = [];

  collectAnchors(fragment).forEach((anchor, ordinal) => {
    const attr = anchor.attrs?.find((a) => a.name === "href");
    if (attr === undefined) return;

    // Prefer the attribute's own location so the column points at the href
    // rather than at the start of the tag.
    const loc = anchor.sourceCodeLocation;
    const at = loc?.attrs?.href ?? loc?.startTag ?? loc;
    if (!at) return;

    const before = html.slice(0, at.startOffset);
    links.push({
      url: attr.value,
      rawHref: rawAttrValue(html, at, attr.value),
      text: textOf(anchor).replace(/\s+/g, " ").trim(),
      scheme: classifyHref(attr.value),
      ordinal,
      source: {
        file: relPath,
        line: at.startLine ?? before.split("\n").length,
        column: at.startCol ?? at.startOffset - (before.lastIndexOf("\n") + 1) + 1,
        endLine: at.endLine ?? at.startLine ?? 0,
        startOffset: at.startOffset,
        endOffset: at.endOffset,
      },
    });
  });

  return links;
}
