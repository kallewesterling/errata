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

- A fixture lesson and tests pinning the six adjudicated cases — a container
  prompt, a `#` comment, a shebang script, a bare `#` on display, both output
  conventions, and backticks inside a `<pre>`. Each looks like a defect to a
  rule that has not been told otherwise, and each was settled once against
  real content. `docs/design.md` recorded two of the six; the other four
  existed only in the content repository's style guide, which errata does not
  read.

  `tests/offline/adjudications.test.js` asserts both that each rule stays
  quiet on the block it would have reported, and that the catalogue as a whole
  reports nothing from that lesson. The second assertion is the one that
  catches a rule nobody thought to exempt when adding it. Breaking the
  host-prompt pattern on purpose fails three of these tests, including that
  catch-all.

  `bash` returns to the fixture taxonomy, used by the shebang block.

- Six small checks, each measured against the content before and after its own
  repair pass. Together they find 51 sites before it and 4 after, and all four
  of those are real and still open.

  - `comment-in-block` — an HTML comment inside a `<pre>` (4 before, 2 after).
    The browser drops it, so it is either invisible instructions to the reader
    or a note that escaped review. One lesson shows a command followed by
    `<!-- TODO: insert output here -->`, so the reader gets an empty box while
    the prose below promises what they should see. Scoped to `<pre>`: 52 files
    carry a comment somewhere and outside a block that is ordinary.
  - `code-typography` — a curly quote, ellipsis character, dash or
    non-breaking space inside a code block (8, 0). A block gets pasted into a
    shell, so anything that survives the clipboard but not the shell is a
    defect; `&nbsp;` indentation in one lesson put U+00A0 into the reader's
    terminal. These characters are correct in prose, so this is also what
    checks that a typography pass skipped `<pre>` and `<code>`.
  - `mislabeled-dockerfile` — a block that opens with `FROM` but is not
    labelled `dockerfile` (20, 0). The test is that the block *opens* with it,
    which is what makes it safe: a SQL statement can put a `FROM` clause on its
    own line, and nothing that is not a Dockerfile begins with one.
  - `unused-lang` — a language in the taxonomy no block uses (0, 2). Inverted
    against the others, because normalizing `docker` to `dockerfile` is what
    left `docker` and `markup` permitted and unwritten. An unused alias is how
    a corpus ends up with two spellings for one language.
  - `markdown-in-prose` — backticks, bold or link syntax outside a code
    element (15, 0), reported once per file rather than once per occurrence.
    Backticks *inside* a `<pre>` are left alone: there they are command
    substitution, ASCII art or captured output.
  - `flattened-command` — a `<p>` or `<li>` carrying a long-form flag and its
    value, outside any code element (4, 0). Prose naming a tool is ordinary;
    prose carrying `--parent example.com` is a block that lost its `<pre>`.

  The prose checks work by blanking every `<pre>`, `<code>` and `<script>`
  region with the same number of spaces, so offsets survive and a finding still
  points at a real line and column.

- `prompted-output`, a check for an output line wearing a command prompt
  (`src/output-prefixes.js`). A `$` prefix means "type this", so output that
  picks one up invites a reader to run something that is not a command. The
  case that prompted it reads `$ fetch https://packages.wolfi.dev/...`, where
  `fetch` is what apk prints while it works.

  The evidence is a census of the corpus rather than a pattern, because no
  single-file rule can see this: a block with a prompt and mixed content is
  also the sanctioned convention where output follows the command inside one
  block, and `promptless-shell` looks for the opposite defect. A token that
  repeatedly heads an unprompted line elsewhere, and hardly ever heads a
  command, is an output prefix wherever it appears with a prompt in front.

  Thresholds were chosen by measuring against the content before and after its
  own repair pass. Requiring two output sightings rather than one is the knee:
  at one the rule reports a site that survived the repair, at two it reports
  exactly the two real defects and nothing else, and it stays there however far
  the command-sightings guard moves. Both findings are ones the content audit
  had already identified by hand — the `fetch` line, and a container prompt
  that had picked up a spurious `$`.

- `code-trailing-space`, a check for an inline `<code>` whose text ends in a
  space (`src/inline-code.js`, `src/residue.js`). There is no reason to write
  `<code>--parent </code>` unless something used to follow the flag. The rule
  is confined to inline `<code>`, because trailing whitespace inside
  `<pre><code>` is ordinary — a block that ends in a newline has it.

- `placeholder-residue`, a check for the destructive half of the placeholder
  problem (`src/residue.js`). The existing `unescaped-markup` anomaly catches a
  literal `<tag>` still sitting in a block. This catches the case where the
  parser already ate it and only the hole is left: `--parent  --ttl 30m`,
  `identity ""`, `--username ""`, `identity: `, `--github-repo='/.*'`.

  Rules were selected by measuring them against the content twice, before and
  after its own repair pass, on the principle that a rule worth having drops to
  near zero once the defects are fixed. Together the two checks find 17
  findings before the repair and 1 after, and that one is a genuine
  `short_description: ` nobody has filled in.

  Two rules are scoped rather than global, and the scope is most of what makes
  them work. Source blocks are excluded from the scan entirely, because
  `return ""` in Go and `print("".join(parts))` in Python are ordinary code
  while placeholder residue is a defect of command documentation. And
  `dangling-period` reads only output lines — an `ansi` block, or the
  unprompted lines of a `console` block. Applied everywhere it reported 53
  sites of which 2 were real, because a trailing `.` is how a build context and
  a copy destination are written: `docker build -t name .`,
  `COPY requirements.txt .`. Every one of those is a command or a Dockerfile.
  Confined to output, where a full stop ends a sentence rather than naming a
  directory, it reports the 2 and nothing else.

  Two narrowings came from the same measurement. `empty-key-value` requires the
  trailing space that separated key from value: `plugins:` introducing nested
  content is correct, and matching any key at a line end reported every parent
  key in every YAML block. Matching `key: ""` as well took it from 2 findings
  to 8 and added nothing real, because `source: ""` is an ordinary empty value.
  `eaten-before-slash` is anchored to a long-form flag, since matching any
  `= "/` reported every absolute path in a Terraform block.

  One shape from the request is not implemented: a subcommand missing its
  required argument cannot be recognized without knowing the command's
  signature. It is recorded in `src/residue.js` rather than dropped silently.

- `script-entity`, a check for HTML entities inside an inline `<script>`
  (`src/scripts.js`). A `<script>` is a raw-text element, so an entity in one is
  never decoded, and nothing downstream decodes it either — the resources widget
  sets its text with `textContent` and passes its link through `sanitizeUrl()`.
  The reader gets the five characters `&amp;` where an ampersand was meant.

  In a URL it is worse than cosmetic. Four YouTube links in the content carry
  `watch?v=...&amp;t=2691s`: the address still resolves, so every link check
  passes, while the timestamp the author linked to is dropped.

  The rule inverts at the `<script>` boundary, which is why this needs a tool.
  `&rsquo;` is correct in the prose of the same file, so an author applying the
  prose convention consistently is exactly how this gets written. Against the
  courses content the check finds 23 occurrences across 13 files — 12 `&rsquo;`,
  6 `&mdash;`, 5 `&amp;` — which matches a manual count made independently.

  Findings are fingerprinted against the whole script body rather than the
  single entity, so repairing one entity reopens the others in that script
  instead of leaving them accepted against a body that has changed.

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
