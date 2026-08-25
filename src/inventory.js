import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./config.js";
import { classify } from "./classify.js";
import { extractBlocks, fingerprint } from "./extract.js";
import { resolveContentFile } from "./integrity.js";
import { lessonUrl, loadCourses } from "./mirror.js";
import { linkBlocks } from "./pairing.js";
import { extractImages, extractLinks } from "./prose-links.js";
import { collectWarnings } from "./warnings.js";

/**
 * @typedef {object} CodeBlock
 * @property {string} id           Stable composite identity.
 * @property {string} fingerprint  Hash of the normalized code.
 * @property {string} lang         The `data-lang` value, or "" when absent.
 * @property {string} kind         shell | output | config | source | unknown.
 * @property {string|null} parser  Config parser used, when applicable.
 * @property {import("./parse-config.js").ParseResult|null} parse
 * @property {string} code         Entity-decoded content.
 * @property {string} rawCode      Content exactly as it appears in the file.
 * @property {{commands: string[], output: string[], hasPrompt: boolean}|null} shell
 * @property {string[]} flags
 * @property {string[]} anomalies
 * @property {boolean} runnable
 * @property {string[]} imageRefs
 * @property {string[]} urls       Every URL appearing in the block.
 * @property {string[]} fetchUrls  URLs a command in the block would retrieve.
 * @property {import("./warnings.js").Warning[]} warnings
 *   Cross-reference inconsistencies between this command and its output.
 * @property {string[]} expectedOutput  Ids of output blocks this command produces.
 * @property {string|null} respondsTo   Id of the command this output belongs to.
 * @property {number|null} outputHops   Output blocks between this one and its command.
 * @property {import("./extract.js").SourceLocation} source
 * @property {string} editorRef    `path:line:column`, clickable in most editors.
 * @property {string|null} url     Public lesson URL, when known.
 * @property {{dir: string, id: string|null, title: string}} course
 * @property {{id: string, slug: string, title: string}} lesson
 * @property {{id: string, order: number}} contentItem
 */

/**
 * Build the block inventory for the whole content tree.
 *
 * Identity is deliberately split in two. `id` is a composite locator built
 * from course, lesson and content-item identifiers, which survives edits to
 * the surrounding prose; `fingerprint` hashes the code itself, so it changes
 * exactly when the block's content changes. Line numbers are recorded for
 * navigation only and are never used as identity.
 *
 * @returns {CodeBlock[]}
 */
export function buildInventory() {
  const blocks = [];

  for (const course of loadCourses()) {
    for (const lesson of course.lessons) {
      for (const item of lesson.content_items ?? []) {
        const absFile = resolveContentFile(course.absPath, item.file);
        if (!absFile) continue;

        const html = fs.readFileSync(absFile, "utf8");
        const relPath = path.relative(repoRoot, absFile);

        const itemBlocks = [];
        for (const raw of extractBlocks(html, relPath)) {
          const meta = classify(raw);
          itemBlocks.push({
            id: `${course.dir}/${lesson.slug}/${item.id}#${raw.ordinal}`,
            fingerprint: fingerprint(raw.code),
            lang: raw.lang,
            kind: meta.kind,
            parser: meta.parser,
            parse: meta.parse,
            code: raw.code,
            rawCode: raw.rawCode,
            shell: meta.shell,
            flags: meta.flags,
            anomalies: raw.anomalies,
            runnable: meta.runnable,
            imageRefs: meta.imageRefs,
            urls: meta.urls,
            fetchUrls: meta.fetchUrls,
            expectedOutput: [],
            respondsTo: null,
            outputHops: null,
            warnings: [],
            source: raw.source,
            editorRef: `${relPath}:${raw.source.line}:${raw.source.column}`,
            url: lessonUrl(course, lesson),
            course: { dir: course.dir, id: course.id, title: course.title },
            lesson: { id: lesson.id, slug: lesson.slug, title: lesson.title },
            contentItem: { id: item.id, order: item.order },
          });
        }

        // Pairing is scoped to the content item: a command and the output it
        // produces always live in the same lesson body.
        linkBlocks(itemBlocks);
        blocks.push(...itemBlocks);
      }
    }
  }

  collectWarnings(blocks);
  return blocks;
}

let cached = null;
/** Memoized inventory, so each test file does not re-parse 783 HTML files. */
export function getInventory() {
  cached ??= buildInventory();
  return cached;
}

/**
 * @typedef {object} ProseLink
 * @property {string} id           Stable composite identity.
 * @property {string} fingerprint  Hash of the URL, so an edited link expires
 *   any known-issues entry that accepted the old one.
 * @property {string} url
 * @property {string} rawHref
 * @property {"href"|"src"} attr
 * @property {"link"|"image"} kind  What the page does with it.
 * @property {string} text         Link or alt text, for recognizing it.
 * @property {import("./prose-links.js").RawLink["scheme"]} scheme
 * @property {import("./extract.js").SourceLocation} source
 * @property {string} editorRef
 * @property {string|null} lessonUrl  Public lesson URL the link appears on.
 * @property {{dir: string, id: string|null, title: string}} course
 * @property {{id: string, slug: string, title: string}} lesson
 * @property {{id: string, order: number}} contentItem
 */

/**
 * Build the inventory of everything lesson prose points at: `<a href>` and
 * `<img src>`.
 *
 * Kept separate from the block inventory rather than folded into it because
 * the two answer different questions and are checked by different tiers. An
 * occurrence is recorded per site: the same URL appearing in nine lessons is
 * nine entries here, and deduplication happens at check time so that one
 * network request can report back to every place that needs fixing.
 *
 * @returns {ProseLink[]}
 */
export function buildLinkInventory() {
  const found = [];

  for (const course of loadCourses()) {
    for (const lesson of course.lessons) {
      for (const item of lesson.content_items ?? []) {
        const absFile = resolveContentFile(course.absPath, item.file);
        if (!absFile) continue;

        const html = fs.readFileSync(absFile, "utf8");
        const relPath = path.relative(repoRoot, absFile);

        const kinds = /** @type {const} */ ([
          { kind: "link", raws: extractLinks(html, relPath) },
          { kind: "image", raws: extractImages(html, relPath) },
        ]);

        for (const { kind, raws } of kinds) {
          for (const raw of raws) {
            found.push({
              id: `${course.dir}/${lesson.slug}/${item.id}#${kind}${raw.ordinal}`,
              fingerprint: fingerprint(raw.url),
              url: raw.url,
              rawHref: raw.rawHref,
              attr: raw.attr,
              kind,
              text: raw.text,
              scheme: raw.scheme,
              source: raw.source,
              editorRef: `${relPath}:${raw.source.line}:${raw.source.column}`,
              lessonUrl: lessonUrl(course, lesson),
              course: { dir: course.dir, id: course.id, title: course.title },
              lesson: { id: lesson.id, slug: lesson.slug, title: lesson.title },
              contentItem: { id: item.id, order: item.order },
            });
          }
        }
      }
    }
  }

  return found;
}

let cachedLinks = null;
/** Memoized inventory of prose links and images. */
export function getLinks() {
  cachedLinks ??= buildLinkInventory();
  return cachedLinks;
}

/** Human-readable pointer used in assertion messages. */
export function describe(block) {
  return `${block.id}\n    ${block.editorRef}${block.url ? `\n    ${block.url}` : ""}`;
}
