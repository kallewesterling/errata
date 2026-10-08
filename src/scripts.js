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
import { parse as parseJs } from "acorn";
import { parseFragment } from "parse5";
import { fingerprint } from "./extract.js";
import { classifyHref } from "./prose-links.js";

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

/**
 * `type` values a browser runs as JavaScript. Anything else — JSON-LD, a
 * template, a data block — is inert text, and reading it as code would
 * report URLs no reader is ever sent to.
 */
const JS_TYPES = new Set(["", "text/javascript", "application/javascript", "module"]);

/**
 * @typedef {object} ScriptSite
 * @property {string} key        Which property held the URL.
 * @property {string} quote      The quote the literal was written in.
 * @property {string|null} group  The array the card sits in, or null when it
 *   sits in none. Two cards with the same group are siblings on the page.
 * @property {number} keyOffset  Where the property starts in the file, so a
 *   rewrite can check it is editing `key: "value"` and nothing else.
 */

/**
 * The value of a string literal, or null when it has no fixed value.
 *
 * A template literal counts only without expressions: `${base}/page` is built
 * at run time, and nothing here can say what it becomes.
 *
 * @param {any} node
 * @returns {{value: string, raw: string, quote: string}|null}
 */
function staticString(node) {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return { value: node.value, raw: node.raw.slice(1, -1), quote: node.raw[0] };
  }
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    const quasi = node.quasis[0].value;
    return { value: quasi.cooked ?? quasi.raw, raw: quasi.raw, quote: "`" };
  }
  return null;
}

/** The name of a non-computed property key, written bare or quoted. */
function keyName(property) {
  if (property.computed) return null;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal" && typeof property.key.value === "string") {
    return property.key.value;
  }
  return null;
}

/**
 * Every URL a resource widget renders as a link, from the inline scripts of
 * one lesson file.
 *
 * Some themes build cards from an object literal in an inline script and turn
 * each card's `link` into an `<a>`. The reader sees a link like any other,
 * but no `<a href>` exists in the file for a link check to find.
 *
 * Read with a JavaScript parser, because the comments are the hard part. A
 * content repository this was written against keeps a template object
 * commented out in 106 of its 583 widget scripts, with line comments inside
 * the block comment and beside the live cards. A regex would read the
 * template's placeholder as a link in every one of those files.
 *
 * The value is the string the script holds: JavaScript escapes are resolved,
 * HTML entities are not, because a script is raw text and nothing decodes
 * them on the way to the page (see the note at the top of this file).
 * A script that does not parse is skipped. It is broken in a way this cannot
 * describe, and a guess at its contents would be worse than nothing.
 *
 * @param {string} html
 * @param {string} relPath
 * @param {{keys: readonly string[], textKey: string}} options
 * @returns {(import("./prose-links.js").RawLink & {script: ScriptSite})[]}
 */
export function extractScriptLinks(html, relPath, { keys, textKey }) {
  const wanted = new Set(keys);
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true });
  const found = [];

  collectScripts(fragment).forEach((node, scriptOrdinal) => {
    const attrs = new Map((node.attrs ?? []).map((a) => [a.name, a.value]));
    const type = (attrs.get("type") ?? "").trim().toLowerCase();
    if (attrs.has("src") || !JS_TYPES.has(type)) return;

    const loc = node.sourceCodeLocation;
    const start = loc?.startTag?.endOffset;
    const end = loc?.endTag?.startOffset;
    if (start === undefined || end === undefined || end <= start) return;

    let program;
    try {
      program = parseJs(html.slice(start, end), {
        ecmaVersion: "latest",
        sourceType: type === "module" ? "module" : "script",
      });
    } catch {
      return;
    }

    let arrays = 0;
    const visit = (value, group) => {
      if (Array.isArray(value)) {
        for (const item of value) visit(item, group);
        return;
      }
      if (!value || typeof value !== "object" || typeof value.type !== "string") return;

      if (value.type === "ArrayExpression") {
        const own = `script${scriptOrdinal}:array${arrays++}`;
        for (const element of value.elements) visit(element, own);
        return;
      }

      if (value.type === "ObjectExpression") {
        const text = value.properties.find(
          (p) => p.type === "Property" && keyName(p) === textKey,
        );
        const label = text ? staticString(text.value)?.value ?? "" : "";

        for (const property of value.properties) {
          const key = property.type === "Property" ? keyName(property) : null;
          const literal = key !== null && wanted.has(key) ? staticString(property.value) : null;
          if (!literal) {
            visit(property, group);
            continue;
          }

          const offset = start + property.value.start;
          const before = html.slice(0, offset);
          const line = before.split("\n").length;
          found.push({
            url: literal.value,
            rawHref: literal.raw,
            attr: /** @type {const} */ ("script"),
            text: label.replace(/\s+/g, " ").trim(),
            scheme: classifyHref(literal.value),
            ordinal: 0,
            source: {
              file: relPath,
              line,
              column: offset - (before.lastIndexOf("\n") + 1) + 1,
              endLine: line,
              startOffset: offset,
              endOffset: start + property.value.end,
            },
            script: { key, quote: literal.quote, group, keyOffset: start + property.start },
          });
        }
        return;
      }

      for (const [field, child] of Object.entries(value)) {
        if (field !== "loc" && field !== "range") visit(child, group);
      }
    };
    visit(program, null);
  });

  return found
    .sort((a, b) => a.source.startOffset - b.source.startOffset)
    .map((link, ordinal) => ({ ...link, ordinal }));
}
