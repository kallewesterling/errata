#!/usr/bin/env node
/**
 * Check what lesson prose points at — links and images — and optionally repair
 * the safe ones.
 *
 *   npm run check:links                  check everything and report
 *   npm run check:links -- --owned       only domains we control
 *   npm run check:links -- --json        machine-readable, for CI
 *   npm run fix:links                    rewrite permanently moved links
 *   npm run fix:links -- --dry-run       show what would change
 *
 * The rewrite is deliberately narrow. It only touches links a check has just
 * confirmed are permanently moved, one-to-one, on a domain we control; every
 * other finding is reported for a person to deal with.
 */
import fs from "node:fs";
import path from "node:path";
import { isOwnedDomain, repoRoot } from "../src/config.js";
import { getLinks } from "../src/inventory.js";
import { checkUrls } from "../src/links.js";
import {
  checkableLinks,
  collectLinkProblems,
  judge,
  rewriteTarget,
  safeRewrites,
  uniqueUrls,
} from "../src/link-health.js";
import { formatProblem, setColorEnabled, style } from "../src/report.js";

const args = process.argv.slice(2);
const has = (name) => args.includes(name);

if (has("--no-color")) setColorEnabled(false);
if (has("--color")) setColorEnabled(true);

const links = getLinks();
let urls = uniqueUrls(links);
if (has("--owned")) urls = urls.filter(isOwnedDomain);

if (!has("--json")) {
  const sites = checkableLinks(links);
  const images = sites.filter((l) => l.kind === "image").length;
  process.stderr.write(
    `${style.muted(
      `Checking ${urls.length} unique URLs from ${sites.length - images} links ` +
        `and ${images} images...`,
    )}\n`,
  );
}

const results = await checkUrls(urls);
const verdicts = judge(results);
const problems = collectLinkProblems(verdicts, links).filter((p) => p.items.length > 0);

/**
 * Rewrite the confirmed-safe redirects in place.
 *
 * Replacement is done on the exact href text rather than by regenerating the
 * HTML, because these files are round-tripped to Skilljar and reserializing
 * them would produce a diff full of incidental markup changes that reviewers
 * cannot read past.
 */
function applyFixes({ dryRun }) {
  const moves = new Map(
    safeRewrites(verdicts).map((v) => [v.result.url, rewriteTarget(v.result)]),
  );
  if (moves.size === 0) return { files: 0, edits: 0 };

  const byFile = new Map();
  for (const link of checkableLinks(links)) {
    if (!moves.has(link.url)) continue;
    if (!byFile.has(link.source.file)) byFile.set(link.source.file, []);
    byFile.get(link.source.file).push(link);
  }

  let edits = 0;
  for (const [relFile, inFile] of byFile) {
    const absFile = path.resolve(repoRoot, relFile);
    let html = fs.readFileSync(absFile, "utf8");

    for (const link of inFile) {
      const to = moves.get(link.url);
      // Match the attribute rather than the bare URL so a URL that also appears
      // in prose text or inside a code block is left alone. The attribute name
      // comes from the occurrence, so an image is never edited as if it were a
      // link, and vice versa.
      const pattern = new RegExp(
        `(${link.attr}\\s*=\\s*["'])${link.rawHref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(["'])`,
        "g",
      );
      const updated = html.replace(pattern, `$1${to}$2`);
      if (updated !== html) {
        html = updated;
        edits += 1;
      }
    }

    if (!dryRun) fs.writeFileSync(absFile, html);
  }

  return { files: byFile.size, edits };
}

/**
 * A pull-request body describing what was changed and what was not.
 *
 * Built here rather than assembled from JSON in a workflow file so that the
 * wording lives with the checks it describes, and so it can be read without a
 * CI run.
 */
function markdown() {
  const of = (name) => verdicts.filter((v) => v.verdict === name);
  const where = (url) =>
    [...new Set(
      checkableLinks(links)
        .filter((l) => l.url === url)
        .map((l) => l.source.file.replace(/^.*?courses\//, "")),
    )];

  const out = [];
  const fixed = safeRewrites(verdicts);

  if (fixed.length > 0) {
    out.push(
      `Rewrote **${fixed.length}** link${fixed.length === 1 ? "" : "s"} that answer with a permanent redirect.`,
      "",
      "Each destination is where the site itself says the page went, and any",
      "`#fragment` was carried across and confirmed to still exist. The",
      "sentences around these links were not touched, so it is worth reading",
      "the diff for wording that no longer matches where the link now goes.",
      "",
      "<details><summary>Links rewritten</summary>",
      "",
      "| From | To |",
      "| --- | --- |",
      ...fixed.map((v) => `| ${v.result.url} | ${rewriteTarget(v.result)} |`),
      "",
      "</details>",
      "",
    );
  }

  const imageUrls = new Set(
    checkableLinks(links)
      .filter((l) => l.kind === "image")
      .map((l) => l.url),
  );
  const isImage = (v) => imageUrls.has(v.result.url);

  const sections = [
    {
      list: of("dead").filter((v) => !isImage(v)),
      title: "Dead links, needing a person",
      blurb: "These return 404 or 410. Nothing automatic can know where they were meant to point.",
      row: (v) => `| ${v.result.url} | ${v.result.detail} | ${where(v.result.url).join("<br>")} |`,
      head: "| Link | Status | Appears in |",
    },
    {
      list: of("dead").filter(isImage),
      title: "Images that do not load",
      blurb:
        "These are `<img src>` targets, so the lesson renders with a hole in it rather than " +
        "with a link a reader can decline to follow. Usually the asset never reached the bucket.",
      row: (v) => `| ${v.result.url} | ${v.result.detail} | ${where(v.result.url).join("<br>")} |`,
      head: "| Image | Status | Appears in |",
    },
    {
      list: of("fragment"),
      title: "Links to a heading that no longer exists",
      blurb:
        "The page loads, so no status check catches these, but the `#anchor` matches nothing on it. " +
        "A reader lands at the top of the page instead of the section they were promised.",
      row: (v) => `| ${v.result.url} | ${where(v.result.url).join("<br>")} |`,
      head: "| Link | Appears in |",
    },
    {
      list: of("review"),
      title: "Redirects deliberately not applied",
      blurb:
        "These are permanent redirects that would lose meaning if followed blindly, " +
        "usually because the page was retired into a section index rather than moved.",
      row: (v) => `| ${v.result.url} | ${v.result.redirect.finalUrl} | ${v.reason} |`,
      head: "| Link | Redirects to | Why it was left alone |",
    },
  ];

  for (const section of sections) {
    if (section.list.length === 0) continue;
    out.push(
      `### ${section.title} (${section.list.length})`,
      "",
      section.blurb,
      "",
      section.head,
      section.head.replace(/[^|]+/g, " --- "),
      ...section.list.map(section.row),
      "",
    );
  }

  const counts = (name) => of(name).length;
  out.push(
    "---",
    "",
    `Checked ${results.length} unique URLs: ` +
      `${counts("ok")} healthy, ${counts("dead")} dead, ${counts("moved")} moved, ` +
      `${counts("review")} needing review, ${counts("fragment")} with a bad anchor, ` +
      `${counts("temporary")} temporarily redirected, ${counts("unreachable")} unreachable.`,
    "",
    "Generated by [errata](https://github.com/kallewesterling/errata).",
  );

  return out.join("\n");
}

if (has("--markdown")) {
  if (has("--fix")) applyFixes({ dryRun: false });
  process.stdout.write(`${markdown()}\n`);
  process.exit(0);
}

if (has("--json")) {
  const payload = {
    checked: results.length,
    verdicts: verdicts.map((v) => ({
      url: v.result.url,
      verdict: v.verdict,
      reason: v.reason ?? null,
      detail: v.result.detail,
      finalUrl: v.result.redirect?.finalUrl ?? null,
      fragment: v.result.fragment,
    })),
    counts: Object.fromEntries(
      ["dead", "moved", "review", "fragment", "temporary", "unreachable", "ok"].map((name) => [
        name,
        verdicts.filter((v) => v.verdict === name).length,
      ]),
    ),
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(0);
}

if (has("--fix") || has("--dry-run")) {
  const { files, edits } = applyFixes({ dryRun: has("--dry-run") });
  const verb = has("--dry-run") ? "would rewrite" : "rewrote";
  process.stdout.write(
    `${style.good(`${verb} ${edits} link${edits === 1 ? "" : "s"} across ${files} file${files === 1 ? "" : "s"}`)}\n`,
  );
}

const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : 10;
for (const problem of problems) {
  process.stdout.write(
    formatProblem({
      ...problem,
      accepted: problem.accepted?.length ?? 0,
      limit: limit === 0 ? Number.MAX_SAFE_INTEGER : limit,
    }),
  );
}

const counts = (name) => verdicts.filter((v) => v.verdict === name).length;
process.stdout.write(
  `\n${style.heading("Summary")}  ` +
    `${style.good(`${counts("ok")} healthy`)}, ` +
    `${style.bad(`${counts("dead")} dead`)}, ` +
    `${style.warn(`${counts("moved")} moved`)}, ` +
    `${style.warn(`${counts("review")} need review`)}, ` +
    `${style.bad(`${counts("fragment")} bad anchors`)}, ` +
    `${style.muted(`${counts("unreachable")} unreachable`)}\n`,
);

// Only findings a person must act on set the exit code. Redirects that are
// mechanically fixable do not, or the weekly run would fail forever on links
// the fixer is about to repair anyway.
const blocking = counts("dead") + counts("fragment");
process.exit(blocking > 0 ? 1 : 0);
