#!/usr/bin/env node
/**
 * Rename retired product names in lesson prose.
 *
 *   npm run fix:terminology                  rewrite them in place
 *   npm run fix:terminology -- --dry-run     show what would change
 *
 * The rewrite is deliberately narrow. It touches only open `retired-term`
 * findings in the prose of lesson HTML. Everything else is listed for a
 * person, with the reason:
 *
 *   - an accepted finding, which is a decision already made: usually a
 *     statement that is true as dated;
 *   - a name in code, because whether the new command is right is a question
 *     about the tool, not about the wording;
 *   - a course or lesson title or description, because Syncjar pushes titles
 *     only behind their own flag, and renaming one is a separate decision;
 *   - a published slug, which is never renamed, because every link to it
 *     would break.
 */
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "../src/config.js";
import { getTerminology } from "../src/inventory.js";
import { inspect } from "../src/problems.js";
import { setColorEnabled, style } from "../src/report.js";
import { applyRewrites, replacementFor } from "../src/terminology.js";

const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const dryRun = has("--dry-run");

if (has("--no-color")) setColorEnabled(false);
if (has("--color")) setColorEnabled(true);

const { retired, slugs } = getTerminology();
const { problems } = inspect();
const problem = problems.find((p) => p.id === "retired-term");
const open = new Set(problem?.items.map((item) => item.key));

/** @type {Map<string, (import("../src/terminology.js").Rewrite & {found: import("../src/inventory.js").RetiredTermItem})[]>} */
const byFile = new Map();
const left = { accepted: 0, code: 0, metadata: 0, markup: [], changed: [] };

for (const found of retired) {
  if (!open.has(found.id)) {
    left.accepted += 1;
    continue;
  }
  if (found.where === "code") {
    left.code += 1;
    continue;
  }
  if (found.where === "metadata" || !found.source) {
    left.metadata += 1;
    continue;
  }
  const replacement = replacementFor(found.match, found.term);
  if (replacement === null) {
    left.markup.push(found);
    continue;
  }
  if (!byFile.has(found.source.file)) byFile.set(found.source.file, []);
  byFile.get(found.source.file).push({
    offset: found.source.offset,
    match: found.match,
    replacement,
    found,
  });
}

/** The name as a reader sees it, for showing an edit in its sentence. */
const asRead = (html) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;|&#[xX][aA]0;/g, " ").replace(/\s+/g, " ").trim();

let edits = 0;
for (const [relFile, rewrites] of byFile) {
  const absFile = path.resolve(repoRoot, relFile);
  const result = applyRewrites(fs.readFileSync(absFile, "utf8"), rewrites);
  if (!dryRun && result.applied.length > 0) fs.writeFileSync(absFile, result.html);
  edits += result.applied.length;
  left.changed.push(...result.refused.map((edit) => edit.found));

  for (const { found, replacement } of result.applied) {
    const before = found.context;
    const after = before.replace(asRead(found.match), asRead(replacement));
    process.stdout.write(
      `${style.path(found.editorRef)}\n` +
        `  ${style.bad(`- ${before}`)}\n` +
        `  ${style.good(`+ ${after}`)}\n`,
    );
  }
}

const files = [...byFile.keys()].length;
const verb = dryRun ? "would rename" : "renamed";
process.stdout.write(
  `\n${style.good(`${verb} ${edits} retired name${edits === 1 ? "" : "s"} across ${files} file${files === 1 ? "" : "s"}`)}\n`,
);

const notes = [
  [left.accepted, "accepted in the known-issues file, so already decided"],
  [left.code, "in code, where the new command needs checking against the tool"],
  [left.metadata, "in a title or description, which Syncjar pushes separately"],
  [left.markup.length, "with markup between words that no longer line up with the new name"],
  [left.changed.length, "in a file that changed while this ran"],
  [slugs.length, "in a published slug, which is never renamed"],
];
const remaining = notes.filter(([count]) => count > 0);
if (remaining.length > 0) {
  process.stdout.write(`${style.muted("Left alone:")}\n`);
  for (const [count, why] of remaining) process.stdout.write(`  ${count} ${style.muted(why)}\n`);
}
for (const found of [...left.markup, ...left.changed]) {
  process.stdout.write(`  ${style.path(found.editorRef)}  ${style.muted(found.context)}\n`);
}
if (left.code + left.metadata + left.markup.length > 0) {
  process.stdout.write(
    style.muted("Run `npm run inventory -- --problems` to see each one.\n"),
  );
}
