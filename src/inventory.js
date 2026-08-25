import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./config.js";
import { classify } from "./classify.js";
import { extractBlocks, fingerprint } from "./extract.js";
import { resolveContentFile } from "./integrity.js";
import { lessonUrl, loadCourses } from "./mirror.js";
import { linkBlocks } from "./pairing.js";
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

/** Human-readable pointer used in assertion messages. */
export function describe(block) {
  return `${block.id}\n    ${block.editorRef}${block.url ? `\n    ${block.url}` : ""}`;
}
