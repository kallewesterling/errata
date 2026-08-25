/**
 * Extraction of what lesson prose points at, as opposed to the URLs that
 * appear inside code blocks.
 *
 * These are genuinely different populations. A URL in a code block is usually
 * data — an argument to curl, a registry host, an example endpoint — and
 * fetching all of them produces noise. An `<a href>` is a promise to the
 * reader that there is something at the other end, and an `<img src>` is a
 * page element that visibly breaks when it is wrong, so both are worth
 * checking on every occurrence.
 */
import { parseFragment } from "parse5";

/**
 * @typedef {object} RawLink
 * @property {string} url      The attribute value, entity-decoded.
 * @property {string} rawHref  The value exactly as it appears in the file,
 *   which is what a rewriter has to match against the source.
 * @property {"href"|"src"} attr  Which attribute carried it, so a rewriter
 *   edits the right one.
 * @property {string} text     Link text or alt text, on a single line.
 * @property {"http"|"mailto"|"anchor"|"relative"|"other"} scheme
 * @property {number} ordinal  0-based index within its file, per kind.
 * @property {import("./extract.js").SourceLocation} source
 */

/** Collect every element with the given tag name, in document order. */
function collectByTag(node, tagName, out = []) {
  if (node.tagName === tagName) out.push(node);
  for (const child of node.childNodes ?? []) collectByTag(child, tagName, out);
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
 * Extract every URL-bearing element of one kind from a lesson HTML file.
 *
 * Locations come from a real parser so a finding points at the exact line, but
 * the attribute itself is recovered from the source text, for the same reason
 * code block contents are: what the parser hands back has already been
 * transformed.
 *
 * @param {string} html      File contents.
 * @param {string} relPath   Path recorded in the source location.
 * @param {string} tagName   Element to collect, `a` or `img`.
 * @param {string} attrName  Attribute holding the URL, `href` or `src`.
 * @param {(node: any) => string} describe  Human label for the element.
 * @returns {RawLink[]}
 */
function extract(html, relPath, tagName, attrName, describe) {
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true });
  const found = [];

  collectByTag(fragment, tagName).forEach((node, ordinal) => {
    const attr = node.attrs?.find((a) => a.name === attrName);
    if (attr === undefined) return;

    // Prefer the attribute's own location so the column points at the URL
    // rather than at the start of the tag.
    const loc = node.sourceCodeLocation;
    const at = loc?.attrs?.[attrName] ?? loc?.startTag ?? loc;
    if (!at) return;

    const before = html.slice(0, at.startOffset);
    found.push({
      url: attr.value,
      rawHref: rawAttrValue(html, at, attr.value),
      attr: attrName,
      text: describe(node),
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

  return found;
}

/**
 * Every `<a href>` in a lesson.
 * @param {string} html
 * @param {string} relPath
 * @returns {RawLink[]}
 */
export function extractLinks(html, relPath) {
  return extract(html, relPath, "a", "href", (node) =>
    textOf(node).replace(/\s+/g, " ").trim(),
  );
}

/**
 * Every `<img src>` in a lesson.
 *
 * The alt text stands in for link text, because it is the only thing naming
 * the image in a report — and an image with neither alt text nor a working
 * source is doubly invisible to a reader.
 *
 * @param {string} html
 * @param {string} relPath
 * @returns {RawLink[]}
 */
export function extractImages(html, relPath) {
  return extract(html, relPath, "img", "src", (node) =>
    (node.attrs?.find((a) => a.name === "alt")?.value ?? "").replace(/\s+/g, " ").trim(),
  );
}
