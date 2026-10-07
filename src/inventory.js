import fs from "node:fs";
import path from "node:path";
import { duplication, primaryDomain, repoRoot, terminology } from "./config.js";
import { classify } from "./classify.js";
import { sentences, shingles, visibleText, words } from "./duplication.js";
import { extractBlocks, fingerprint } from "./extract.js";
import { extractInlineCode } from "./inline-code.js";
import { resolveContentFile } from "./integrity.js";
import { READER_FIELDS, lessonUrl, loadCourses } from "./mirror.js";
import { linkBlocks } from "./pairing.js";
import { findProseDefects } from "./prose-defects.js";
import { extractImages, extractLinks } from "./prose-links.js";
import { extractScriptEntities } from "./scripts.js";
import { compileTerms, findRetiredInSlug, findRetiredTerms } from "./terminology.js";
import { findTemplateValues, findUnwritten } from "./unwritten.js";
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

/**
 * @typedef {object} ScriptFinding
 * @property {string} id           Stable composite identity.
 * @property {string} fingerprint  Hash of the script body.
 * @property {string} entity       The entity exactly as written.
 * @property {string} context      Surrounding source, for recognizing it.
 * @property {import("./extract.js").SourceLocation} source
 * @property {string} editorRef
 * @property {string|null} url     Public lesson URL.
 * @property {{dir: string, id: string|null, title: string}} course
 * @property {{id: string, slug: string, title: string}} lesson
 * @property {{id: string, order: number}} contentItem
 */

/**
 * Build the inventory of HTML entities sitting inside inline `<script>`.
 *
 * Separate from the block inventory because a `<script>` is not a code block a
 * reader is meant to run: it is page machinery, and the defect in it is
 * invisible in the rendered lesson rather than wrong on the page.
 *
 * @returns {ScriptFinding[]}
 */
export function buildScriptInventory() {
  const found = [];

  for (const course of loadCourses()) {
    for (const lesson of course.lessons) {
      for (const item of lesson.content_items ?? []) {
        const absFile = resolveContentFile(course.absPath, item.file);
        if (!absFile) continue;

        const html = fs.readFileSync(absFile, "utf8");
        const relPath = path.relative(repoRoot, absFile);

        for (const raw of extractScriptEntities(html, relPath)) {
          found.push({
            id: `${course.dir}/${lesson.slug}/${item.id}#script${raw.ordinal}`,
            fingerprint: raw.fingerprint,
            entity: raw.entity,
            context: raw.context,
            source: raw.source,
            editorRef: `${relPath}:${raw.source.line}:${raw.source.column}`,
            url: lessonUrl(course, lesson),
            course: { dir: course.dir, id: course.id, title: course.title },
            lesson: { id: lesson.id, slug: lesson.slug, title: lesson.title },
            contentItem: { id: item.id, order: item.order },
          });
        }
      }
    }
  }

  return found;
}

let cachedScripts = null;
/** Memoized inventory of entities inside inline scripts. */
export function getScriptEntities() {
  cachedScripts ??= buildScriptInventory();
  return cachedScripts;
}

/**
 * @typedef {object} InlineCodeItem
 * @property {string} id           Stable composite identity.
 * @property {string} fingerprint  Hash of the element's text.
 * @property {string} text         The text a reader sees.
 * @property {import("./extract.js").SourceLocation} source
 * @property {string} editorRef
 * @property {string|null} url     Public lesson URL.
 * @property {{dir: string, id: string|null, title: string}} course
 * @property {{id: string, slug: string, title: string}} lesson
 * @property {{id: string, order: number}} contentItem
 */

/**
 * Build the inventory of `<code>` elements appearing in prose.
 *
 * Separate from the block inventory because the two differ on what counts as
 * well-formed: a block legitimately ends in a newline, and an inline element
 * does not.
 *
 * @returns {InlineCodeItem[]}
 */
export function buildInlineCodeInventory() {
  const found = [];

  for (const course of loadCourses()) {
    for (const lesson of course.lessons) {
      for (const item of lesson.content_items ?? []) {
        const absFile = resolveContentFile(course.absPath, item.file);
        if (!absFile) continue;

        const html = fs.readFileSync(absFile, "utf8");
        const relPath = path.relative(repoRoot, absFile);

        for (const raw of extractInlineCode(html, relPath)) {
          found.push({
            id: `${course.dir}/${lesson.slug}/${item.id}#code${raw.ordinal}`,
            fingerprint: fingerprint(raw.text),
            text: raw.text,
            source: raw.source,
            editorRef: `${relPath}:${raw.source.line}:${raw.source.column}`,
            url: lessonUrl(course, lesson),
            course: { dir: course.dir, id: course.id, title: course.title },
            lesson: { id: lesson.id, slug: lesson.slug, title: lesson.title },
            contentItem: { id: item.id, order: item.order },
          });
        }
      }
    }
  }

  return found;
}

let cachedInlineCode = null;
/** Memoized inventory of inline `<code>` elements. */
export function getInlineCode() {
  cachedInlineCode ??= buildInlineCodeInventory();
  return cachedInlineCode;
}

/**
 * Build the comparable-text inventory: one document per content item.
 *
 * Items shorter than the configured minimum are dropped rather than scored
 * low. A lesson that is a heading and one sentence matches its neighbours on
 * almost no evidence, and including them would fill the report with pairs that
 * are similar only because there is nothing much to be similar about.
 *
 * @returns {import("./duplication.js").TextDoc[]}
 */
export function buildTextInventory() {
  const docs = [];

  for (const course of loadCourses()) {
    for (const lesson of course.lessons) {
      for (const item of lesson.content_items ?? []) {
        const absFile = resolveContentFile(course.absPath, item.file);
        if (!absFile) continue;

        const relPath = path.relative(repoRoot, absFile);
        const text = visibleText(fs.readFileSync(absFile, "utf8"));
        const ws = words(text);
        if (ws.length < duplication.minWords) continue;

        docs.push({
          id: `${course.dir}/${lesson.slug}/${item.id}`,
          label: `${course.dir}/${lesson.slug}`,
          course: course.dir,
          lesson: lesson.slug,
          editorRef: `${relPath}:1:1`,
          lessonUrl: lessonUrl(course, lesson),
          text,
          sentences: sentences(text),
          words: ws.length,
          shingles: shingles(ws),
        });
      }
    }
  }

  return docs;
}

let cachedTexts = null;
/** Memoized comparable-text inventory. */
export function getTexts() {
  cachedTexts ??= buildTextInventory();
  return cachedTexts;
}

/** Human-readable pointer used in assertion messages. */
export function describe(block) {
  return `${block.id}\n    ${block.editorRef}${block.url ? `\n    ${block.url}` : ""}`;
}

/**
 * @typedef {object} ProseDefectItem
 * @property {string} id           Stable composite identity.
 * @property {string} fingerprint  Hash of the matched text.
 * @property {string} kind
 * @property {string} rule
 * @property {string} what
 * @property {string} match
 * @property {import("./extract.js").SourceLocation} source
 * @property {string} editorRef
 * @property {string|null} url
 */

/**
 * Build the inventory of markup that never rendered, and of commands that
 * lost their block.
 *
 * @returns {ProseDefectItem[]}
 */
export function buildProseDefectInventory() {
  const found = [];

  for (const course of loadCourses()) {
    for (const lesson of course.lessons) {
      for (const item of lesson.content_items ?? []) {
        const absFile = resolveContentFile(course.absPath, item.file);
        if (!absFile) continue;

        const html = fs.readFileSync(absFile, "utf8");
        const relPath = path.relative(repoRoot, absFile);

        for (const raw of findProseDefects(html, relPath)) {
          found.push({
            id: `${course.dir}/${lesson.slug}/${item.id}#prose${raw.ordinal}`,
            fingerprint: fingerprint(raw.match),
            kind: raw.kind,
            rule: raw.rule,
            what: raw.what,
            match: raw.match,
            source: raw.source,
            editorRef: `${relPath}:${raw.source.line}:${raw.source.column}`,
            url: lessonUrl(course, lesson),
          });
        }
      }
    }
  }

  return found;
}

let cachedProse = null;
/** Memoized inventory of prose defects. */
export function getProseDefects() {
  cachedProse ??= buildProseDefectInventory();
  return cachedProse;
}

/**
 * @typedef {object} UnwrittenItem
 * @property {string} id
 * @property {string} fingerprint
 * @property {string} rule
 * @property {string} what
 * @property {string} match
 * @property {string} editorRef
 * @property {string|null} url
 */

/**
 * Build the inventory of content nobody has written yet.
 *
 * Covers both lesson bodies and the course metadata beside them, because a
 * course whose description is still `{Short description}` is unfinished in
 * exactly the same way as a lesson whose body is still `Placeholder`.
 *
 * @returns {UnwrittenItem[]}
 */
export function buildUnwrittenInventory() {
  const found = [];

  for (const course of loadCourses()) {
    for (const metaFile of ["details.json", "published.json"]) {
      const absFile = path.join(course.absPath, metaFile);
      if (!fs.existsSync(absFile)) continue;

      const relPath = path.relative(repoRoot, absFile);
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(absFile, "utf8"));
      } catch {
        // Malformed metadata is somebody else's finding, not this one's.
        continue;
      }

      for (const template of findTemplateValues(parsed)) {
        found.push({
          id: `${course.dir}/${metaFile}#${template.path}`,
          fingerprint: fingerprint(template.value),
          rule: "template-value",
          what: "a metadata value that is still its own template",
          match: `${template.path}: ${template.value}`,
          editorRef: `${relPath}:1:1`,
          url: null,
        });
      }
    }

    for (const lesson of course.lessons) {
      for (const item of lesson.content_items ?? []) {
        const absFile = resolveContentFile(course.absPath, item.file);
        if (!absFile) continue;

        const html = fs.readFileSync(absFile, "utf8");
        const relPath = path.relative(repoRoot, absFile);

        for (const raw of findUnwritten(html, visibleText(html))) {
          found.push({
            id: `${course.dir}/${lesson.slug}/${item.id}#unwritten${raw.ordinal}`,
            fingerprint: fingerprint(raw.match),
            rule: raw.rule,
            what: raw.what,
            match: raw.match,
            editorRef: `${relPath}:1:1`,
            url: lessonUrl(course, lesson),
          });
        }
      }
    }
  }

  return found;
}

let cachedUnwritten = null;
/** Memoized inventory of unfinished content. */
export function getUnwritten() {
  cachedUnwritten ??= buildUnwrittenInventory();
  return cachedUnwritten;
}

/**
 * @typedef {object} RetiredTermItem
 * @property {string} id           Where it is, then the term and the words around it.
 * @property {string} fingerprint
 * @property {import("./terminology.js").Term} term
 * @property {"prose"|"code"|"metadata"} where
 * @property {string} match
 * @property {string} context
 * @property {string} editorRef
 * @property {string|null} url
 */

/**
 * @typedef {object} RetiredSlugItem
 * @property {string} id
 * @property {string} fingerprint
 * @property {import("./terminology.js").Term} term
 * @property {string} slug
 * @property {string} editorRef
 * @property {string|null} url
 */

/** Line and column of an offset, counted the way an editor counts them. */
function lineAndColumn(text, offset) {
  const before = text.slice(0, offset);
  return {
    line: before.split("\n").length,
    column: offset - (before.lastIndexOf("\n") + 1) + 1,
  };
}

/**
 * Build the inventory of retired product names.
 *
 * Two populations, reported apart because they want opposite handling. Text
 * a reader sees — lesson prose, course and lesson titles and descriptions,
 * and code for a term that asks — is to be renamed. A published slug is
 * residue that has to stay, because renaming it breaks every link to it.
 *
 * `course-urls.json` is not read for slugs. It is an index built from the
 * same `published.json` slug, so reading both reports one URL twice.
 *
 * A text finding is identified by the words around it rather than by its
 * position among the others. The renames are mechanical and many, and the
 * acceptances few: a dated statement such as "in 2025 these were called
 * Chainguard Images". Identity by ordinal would shift every acceptance after
 * the first occurrence somebody fixed, and the known-issues file would then
 * call a deliberate decision resolved. Identity by context leaves it where it
 * is, and reads as the sentence it accepts.
 *
 * @returns {{retired: RetiredTermItem[], slugs: RetiredSlugItem[]}}
 */
export function buildTerminologyInventory() {
  const compiled = compileTerms(terminology);
  /** @type {RetiredTermItem[]} */
  const retired = [];
  /** @type {RetiredSlugItem[]} */
  const slugs = [];
  if (compiled.length === 0) return { retired, slugs };

  const seen = new Map();
  /** Keep two identical sentences in one file from sharing a key. */
  const unique = (id) => {
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    return n === 1 ? id : `${id} (${n})`;
  };

  const report = (base, found, where, editorRef, url) => {
    retired.push({
      id: unique(`${base} ${found.term.from}: ${found.context}`),
      fingerprint: fingerprint(found.context),
      term: found.term,
      where,
      match: found.match,
      context: found.context,
      editorRef,
      url,
    });
  };

  /** The line in a JSON file where a field's value sits. */
  const lineInJson = (raw, value) => {
    const at = raw.indexOf(JSON.stringify(value));
    return at < 0 ? 1 : lineAndColumn(raw, at).line;
  };

  for (const course of loadCourses()) {
    const readRaw = (name) => {
      const file = path.join(course.absPath, name);
      return fs.existsSync(file)
        ? { rel: path.relative(repoRoot, file), raw: fs.readFileSync(file, "utf8") }
        : null;
    };

    const details = readRaw("details.json");
    for (const field of READER_FIELDS["details.json"]) {
      const value = course.details[field];
      if (typeof value !== "string" || !details) continue;
      const ref = `${details.rel}:${lineInJson(details.raw, value)}:1`;
      for (const found of findRetiredTerms(value, compiled)) {
        report(`${course.dir}/details.json#${field}`, found, "metadata", ref, course.url);
      }
    }

    const published = readRaw("published.json");
    for (const [domain, slug] of Object.entries(course.slugs)) {
      for (const found of findRetiredInSlug(slug, compiled)) {
        slugs.push({
          id: `${course.dir}/published.json#domains.${domain}.slug ${found.term.from}`,
          fingerprint: fingerprint(slug),
          term: found.term,
          slug,
          editorRef: `${published?.rel}:${published ? lineInJson(published.raw, slug) : 1}:1`,
          url: domain === primaryDomain ? course.url : null,
        });
      }
    }

    const meta = readRaw("lessons-meta.json");
    for (const lesson of course.lessons) {
      const url = lessonUrl(course, lesson);
      const base = `${course.dir}/${lesson.slug}/${lesson.id}`;

      for (const field of READER_FIELDS["lessons-meta.json"]) {
        const value = lesson[field];
        if (typeof value !== "string" || !value || !meta) continue;
        const ref = `${meta.rel}:${lineInJson(meta.raw, value)}:1`;
        for (const found of findRetiredTerms(value, compiled)) {
          report(`${base}#${field}`, found, "metadata", ref, url);
        }
      }

      for (const found of findRetiredInSlug(lesson.slug, compiled)) {
        slugs.push({
          id: `${base}#slug ${found.term.from}`,
          fingerprint: fingerprint(lesson.slug),
          term: found.term,
          slug: lesson.slug,
          editorRef: `${meta?.rel}:${meta ? lineInJson(meta.raw, lesson.slug) : 1}:1`,
          url,
        });
      }

      for (const item of lesson.content_items ?? []) {
        const absFile = resolveContentFile(course.absPath, item.file);
        if (!absFile) continue;

        const html = fs.readFileSync(absFile, "utf8");
        const relPath = path.relative(repoRoot, absFile);

        for (const found of findRetiredTerms(html, compiled)) {
          const { line, column } = lineAndColumn(html, found.offset);
          report(
            `${course.dir}/${lesson.slug}/${item.id}#term`,
            found,
            found.where,
            `${relPath}:${line}:${column}`,
            url,
          );
        }
      }
    }
  }

  return { retired, slugs };
}

let cachedTerminology = null;
/** Memoized inventory of retired product names. */
export function getTerminology() {
  cachedTerminology ??= buildTerminologyInventory();
  return cachedTerminology;
}
