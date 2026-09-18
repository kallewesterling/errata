# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries for 0.1.0 were reconstructed from git history after the fact, so they
group related commits rather than listing each one. That version was never
tagged; it is the version `package.json` declared while the work landed.

## [Unreleased]

### Fixed

- The anchor check no longer reports a working GitHub link as broken
  (`src/links.js`). Markdown rendered through html-pipeline carries every
  heading id behind a `user-content-` prefix and resolves the bare fragment in
  the browser with a script, so a page serves `id="user-content-installation"`
  while the reader follows `#installation` and lands on the heading. Comparing
  the fragment with the ids on the page saw no match and called the link dead.
  In the 2026-09-13 run against `chainguard-dev/courses`, 7 of the 13
  missing-anchor findings were this, and nothing else. That is the most
  expensive mistake this tool can make: the courses repo pushes to Skilljar, so
  acting on the report would have replaced working links with different ones for
  no reason. `hasAnchor` now accepts the fragment either bare or prefixed.

  The rule is not keyed on the hostname, although GitHub is where it surfaced.
  The prefix belongs to the renderer rather than to the host — GitLab, Gitea and
  Gollum ship the same filter — so a host test would leave the same false
  positive in place everywhere else. Being wrong in the other direction needs a
  page carrying a `user-content-` id without the script that reads it.

  Skipping `github.com` outright was the other option and would have cost more
  than it saved. The same run found a genuine miss on that host, a
  `#known-implementations` section that really had been removed. The prefix rule
  keeps that finding and drops the seven false ones.

### Added

- Design notes on the prefix rule, and on telling a section index apart from a
  page whose body never arrived (`docs/design.md`). A page carrying almost no
  headings looks like a site that renders in the browser and is usually just an
  index: an `h1`, a sentence, and links to the children holding the material. A
  fragment into one of those is genuinely gone, because the page it sat on was
  split up, so the existing verdict is the right one.

## [0.1.0] — 2026-08-26

### Added

- Inventory of every `<pre data-lang="..."><code>` block in the lesson HTML,
  each tied to its source file, its line and column, and its public lesson URL.
  Blocks are located with a parser and then read as a raw substring, because
  `textContent` silently drops unescaped markup such as `<path_to_dockerfile>`.
- Offline checks: malformed blocks, config blocks that do not parse (JSON, YAML,
  Dockerfile, Terraform), and metadata paths in `lessons-meta.json` matching no
  file. Config blocks get a strict parse and then a fragment parse, since
  documentation quotes fragments constantly and about half the JSON blocks look
  broken without the second pass.
- Pairing of an `ansi` output block with the command it responds to, walking
  back through runs of consecutive output blocks. 115 of 116 output blocks pair.
- Warnings where a command and its recorded output contradict each other:
  `digest-mismatch`, `image-mismatch`, `tag-mismatch`. Each stays quiet unless
  both sides make a claim and the claims disagree.
- Network checks: container image references resolve, images needing a login are
  confined to the courses that teach with them, and pinned digests are reported
  by age rather than by whether they match the tag, which these continuously
  rebuilt images never do.
- Prose link and image checking (`npm run check:links`), covering the two
  failures a status-code check cannot see: a page that moved and answers 301,
  and a `#anchor` that no longer exists. Redirects are applied without a person
  only when the page keeps its own name and the destination is not an ancestor
  of another known page.
- `npm run fix:links` to apply the safe rewrites, carrying the fragment across
  so a repair does not quietly delete the `#section` the sentence promised.
- Duplicate-lesson drift detection (`npm run check:copies`). The courses are
  assembled from shared lessons, so repetition is the design and drift is the
  finding. Jaccard similarity over five-word shingles, with `<script>` elements
  excluded because the related-resources widget differs in every copy by design.
- `.errata.yaml`, recording each accepted finding with the check, the instance,
  a reason, a date and a fingerprint of the block. An edit to the block reopens
  the finding, so an entry cannot excuse content nobody has read since. Findings
  report as open, stale or resolved, and all three fail.
- `npm run inventory`, and `--problems` to print the catalog of what each check
  looks for, why it matters and what to do about it.
- CI running the offline tests on every pull request.
- Apache-2.0 license.

### Changed

- Errata carries no configuration at all. The settings describe one body of
  content — which registry hosts its images, which courses may use a private
  image, which domains it owns — so they live with that content as `errata.yaml`
  and ship here only as `errata.example.yaml`. The tool cannot run on its own,
  and fails at load time listing every path it searched. Validation is strict:
  an unknown key stops the run rather than taking a default, because a quiet
  default means the suite passes while it checks nothing.
- The known-issues file records named, dated findings instead of per-check
  counts. A count cannot say which instance was tolerated or why, and cannot see
  one instance repaired while another appears.
- Errata checks the images the HTML actually loads, not the entries in
  `course-images/image-manifest.json`. The manifest is a finished build
  artifact; authors keep editing the HTML through Skilljar, so the manifest
  cannot know about the first image added in the editor.
- `npm run check:links` supersedes the Syncjar script of the same name, which
  reads the same links out of a gitignored preview build, follows redirects
  without recording them, never fetches a page body, and passes a `timeout`
  option that its version of `node-fetch` ignores.
- The README is written in simplified English, with the reasoning behind each
  check split out into `docs/design.md`. Findings for a particular body of
  content live with that content, not here.
