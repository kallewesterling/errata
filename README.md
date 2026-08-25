# errata

Finds errors in the code examples inside published course content, and keeps a dated record of the ones not yet fixed.

An *erratum* is a mistake in something already published, which is what these are: the courses are live, the code in them was correct when it was written, and some of it no longer is. The tool reads every `<pre data-lang="..."><code>` block, links it back to its source file and public URL, and checks what can be checked — that a transcript agrees with the command above it, that a config block parses, that a pinned image still resolves.

It runs alongside [Syncjar](https://github.com/kallewesterling/syncjar), which is what puts the content in git in the first place.

Course content stores code as `<pre data-lang="{language}"><code>…</code></pre>`. This tool builds an inventory of those blocks — each one tied to its course, lesson, file, and line — and then runs assertions over that inventory.

## Quick start

```bash
npm install
npm test              # offline tier, ~1s, no network
npm run test:network  # network tier: registry and link checks
npm run test:all      # both
npm run inventory     # summary of what was found
```

## Configuration

Everything tunable lives in [`errata.yaml`](errata.yaml): content root, language taxonomy, the stale-image threshold, and the private image allowlist. `src/config.js` only loads and validates it.

Which findings are currently accepted is a separate question, kept in `.errata.yaml` at the content root rather than here, for the reasons in [Known issues are named and dated](#known-issues-are-named-and-dated-not-counted).

Validation is strict on purpose. Both files are edited by hand, and a mistyped key that silently defaulted would let the suite pass while checking nothing, so unknown settings, unknown keys, negative ceilings and unknown language kinds all fail at load with the file path in the message. A known-issues entry with no explanation is rejected outright: nothing is accepted without a reason.

```bash
ERRATA_CONFIG=/path/to/config.yaml npm test   # use a different config
ERRATA_ROOT=/path/to/courses npm test         # override just the content root
```

### Private image allowlist

Most courses should only reference images a reader can pull anonymously. A private image anywhere else usually means a sample was pasted from internal material, and the reader hits a 401.

`privateImages.allowedCourses` lists the courses that legitimately teach against private or customer-scoped images. Any course not listed fails the network tier, naming the image and the line:

```yaml
privateImages:
  allowedCourses:
    # Builds and pulls yq from the package repository while teaching packaging.
    - Build-Your-First-Chainguard-Container
```

The allowlist is checked in both directions — a course listed here that no longer references a private image also fails, so entries don't outlive their reason.

## Design

### Extraction and testing are separate layers

`src/` builds the inventory; `tests/` asserts over it. The two change for different reasons — extraction changes when the source HTML changes, tests change when you decide what "correct" means — and keeping them apart stops every new test from re-parsing HTML.

### Blocks are located with a parser, captured as raw text

`src/extract.js` uses parse5 with `sourceCodeLocationInfo` to find each `<pre>`, then takes the code as a raw substring of the original file between the start-tag and end-tag offsets.

Reading `textContent` instead would be wrong. `<pre>` is not an HTML raw-text element, so unescaped markup inside a block is parsed as real markup and disappears:

```
source:      <pre data-lang="dockerfile"><code>dfc <path_to_dockerfile></code></pre>
textContent: "dfc "                    ← the argument is gone
raw slice:   "dfc <path_to_dockerfile>"
```

The content contains exactly this case, so the parser gives correct block boundaries and line numbers while the raw slice gives byte-faithful content.

### Identity and location are different things

Every block carries three ways to refer to it, because they answer different questions:

| Field | Answers | Stable when |
|---|---|---|
| `id` | which block is this | prose around it is edited |
| `fingerprint` | did the code change | whitespace-only edits |
| `editorRef` / `url` | where do I go to fix it | — |

`id` is a composite locator (`course-dir/lesson-slug/content-item-id#ordinal`) built from `lessons-meta.json`, so it survives edits elsewhere in the file. `fingerprint` hashes the normalized code, so it changes exactly when the block's content does. Line numbers are recorded for navigation only and are never used as identity, since any edit above a block renumbers it.

### `kind` drives tests, not `data-lang`

`console` and `ansi` are both terminal text, but only one is meant to be run. `src/config.js` maps each `data-lang` onto a `kind` — `shell`, `output`, `config`, or `source` — and tests dispatch on that. Blocks also carry advisory flags (`has-placeholder`, `multi-command`, `elided`, `excerpt`, `has-image-ref`) rather than being filtered out, so nothing becomes invisible.

### `ansi` blocks are paired with the command that produced them

Content uses `data-lang="ansi"` by convention for the output of the preceding command, with explanatory prose in between. Treating those 120 blocks as isolated text throws that relationship away, so `src/pairing.js` links them: an output block gets `respondsTo`, and the command gets `expectedOutput`.

A single command's output is often split across several `ansi` blocks, so the search walks back through a run of consecutive output blocks to reach the command at its head. 114 of 120 output blocks pair, 23 of them through such a run.

```
$ cosign verify ... cgr.dev/chainguard/pytorch | jq     ← command
Verification for cgr.dev/chainguard/pytorch:latest --   ← expectedOutput
```

Pairing is scoped to the content item, since a command and its output always live in the same lesson body. It is also what makes an execution tier possible later: a command with recorded expected output is a test case, whereas a command alone is only a syntax check.

The convention doubles as a lint. Because `ansi` means output, a prompt inside one means the block is mislabelled — see `mislabeled-output` below.

### Excerpts are not errors

Documentation quotes fragments constantly: one element of an array, the body of an object, output abbreviated with `...`. Those cannot parse strictly and are correct as written. `src/parse-config.js` gives each config block a strict pass, then a fragment pass, and only reports `invalid` when it is neither. Without this, roughly half the JSON blocks look broken.

### Only URLs that get fetched are liveness-checked

Most URLs inside code blocks are data, not links — OIDC issuer identities, SBOM document namespaces, APK repository roots, API endpoints in sample output. Fetching them produces confident-looking false positives. The network tier checks only URLs passed to a fetching command, and skips `localhost`.

The same applies to image references: the registry host also serves its own HTTP API and the Chainguard Libraries endpoints, so `src/classify.js` filters those out before anything is resolved.

### Discrepancies are warnings, and severity is a separate axis

Pairing makes a third class of problem detectable: a command whose recorded output contradicts it. Those are reported as warnings, because a hit is a genuine inconsistency but occasionally an intentional one.

Blocks therefore carry three separate things, which are easy to conflate but shouldn't be:

| Field | Means | Example |
|---|---|---|
| `anomalies` | the HTML itself is malformed | `<pre>` with no `<code>` child |
| `flags` | neutral description | `has-placeholder`, `multi-command` |
| `warnings` | probably a content bug, possibly deliberate | output contradicts its command |

`src/warnings.js` holds the offline rules, which compare the content against itself and so are deterministic: `digest-mismatch`, `image-mismatch`, `tag-mismatch`. Each is written to stay quiet unless both sides make a claim and the claims disagree — output listing extra layer digests alongside the pinned one does not trigger anything.

### Staleness is measured in age, not in difference

`src/drift.js` compares digests pinned in the content against the registry. The obvious check — is this pin still what the tag serves — turns out to be worthless here: these images rebuild continuously, so **21 of 23 pins are behind their tag**, and being behind says nothing at all.

What carries signal is *how far* behind. `src/registry.js` reads the build date from the image config blob, so a pin can be reported as "built 2023-05-12, 1201 days old" rather than a meaningless boolean. Anything past `staleImageDays` (one year) is flagged, and the report is ranked by age so the worst offenders come first.

This is a warning rather than a failure for a second reason beyond intent: a few lessons pin an old image deliberately, to demonstrate a diff against a newer one. A pin that stops resolving *entirely* is a different matter and fails in the reference tests.

### Known issues are named and dated, not counted

The suite was switched on against content that already had problems. The first version of this held each one at a count and failed if the count grew, which turned out to be the wrong shape. A number says only how many instances were tolerated. It cannot say which instance, or why, and it cannot notice when one is fixed while another regresses and the total stays put.

Instead, `.errata.yaml` at the **content** repository root records each accepted finding individually: which check, which instance, why it is not fixed, and when that was decided. Every check must otherwise come out clean.

The part that makes this maintain itself is the fingerprint. An entry pins the hash of the block it was accepted against, so editing that block reopens the finding rather than leaving it excused against content nobody has looked at since. Three states are reported and all three fail:

| State | Meaning |
|---|---|
| open | A finding nothing accounts for |
| stale | The block changed after the entry was written, so the note may no longer describe it |
| resolved | The entry matches nothing, so the problem is gone and the entry should be deleted |

Findings about a file's existence rather than its contents omit the fingerprint, since there is no content to hash.

The file also carries a `notes` section for things a person noticed that no check looks for — a transcript whose totals do not add up, prose that contradicts the command above it. Those suppress nothing and fail nothing; they exist so the observation survives to whoever revises the lesson next.

One case genuinely does not fit and keeps a ceiling: `driftBudget.staleImageRefs`. An entry expires when its content changes, which is right for a discrete bug and useless for a pinned digest that ages a day every day while the block itself never changes.

#### Why the file lives with the content, and why it is a dotfile

The content repository syncs with Skilljar in both directions, and a daily CI job pulls Skilljar into git. Anything recorded inside the lesson HTML is therefore at the mercy of a round-trip through a rich-text editor, which may silently drop HTML comments. Anything recorded in the tester's own config, meanwhile, does not travel with the content it describes.

A dotfile at the content root sits outside both paths. Syncjar never pushes it to Skilljar, and the GCS documentation export walks `[A-Z]*/lessons/`, so it is not swept up there either. Notes in it can be candid in a way that notes shipped to a learner's page source cannot.

### Every finding is described in exactly one place

The remediation text for a finding belongs next to the rule that detects it, not in the test that asserts on it, so `src/problems.js` holds the catalogue: for each check, what it looks for, why it matters, and what to do about it. The offline suite iterates that catalogue to generate its assertions, and `npm run inventory -- --problems` prints the same entries. A contributor sees identical wording whether the finding reaches them through a failing test or the CLI.

Each report answers three questions in the same order, because a finding without a location is not actionable and one without a remediation makes the reader guess:

```
! blocks labelled as output that contain a command (5)
  data-lang="ansi" means output only. These carry a shell prompt, usually a
  decorated one such as ❯ or ➜ rather than the $ used elsewhere, so the
  command a reader needs to run is buried in a block styled as a transcript.
  1. ❯ docker pull cgr.dev/chainguard/wolfi-base
     _local-mirror/courses/Crush-Your-CVEs/lessons/20-.../content-3chz.html:34:29
     https://courses.chainguard.dev/crush-your-cves/catching-cves-before-production
  Fix: Move the command into its own <pre data-lang="console"> block above
  the output, and use the "$ " prompt to match the rest of the content.
```

The count trails the title rather than leading it, so the line reads correctly at any number instead of producing "1 blocks with". Locations are `path:line:column`, which most editors will open directly, followed by the public lesson URL.

`src/report.js` handles colour, honouring `NO_COLOR` and `FORCE_COLOR` ahead of TTY detection. The two are not treated as equals: the test runner sets `NO_COLOR` on its workers whenever output is piped, so an explicit `FORCE_COLOR` has to win or paging a failure through `less -R` would lose its colour.

Reports are written to stderr and the assertion message is kept to one line. The runner strips ANSI from assertion messages and renders long ones inside a diff view that mangles the layout, so a report embedded in the assertion arrives unreadable.

## Test tiers

**Offline** (`tests/offline/`, no network) — extractor and pairing unit tests; every block has a known `data-lang`; JSON, YAML, Dockerfile and Terraform blocks parse or are recognized excerpts; shell prompt style is consistent; output blocks pair with a command and are never marked runnable; metadata paths match disk.

**Network** (`tests/network/`) — container image references resolve against the registry; images needing auth appear only in allowlisted courses; URLs that commands fetch are live; digest pins are checked for age.

Registry lookups retry with backoff before reporting a reference as broken. The registry rate-limits and both network files resolve references at once, so without it a run occasionally failed on connection trouble rather than on anything in the content, and a suite that fails at random gets ignored.

## What it currently finds

761 blocks across 29 of the 53 courses, in 121 files. The other 24 courses contain no code at all, which was verified against a raw scan for `<pre>` rather than assumed. All 68 container image references resolve.

### Fixed

Applied on the `chore/code-block-content-fixes` branch of the content repository:

- **A `<path_to_dockerfile>` placeholder that readers never saw.** `<pre>` is not a raw-text element, so the browser parsed the placeholder as an unknown tag and rendered nothing: the DFC help text showed `dfc` followed by blank space. A repository-wide scan for non-HTML tags confirmed it was the only one.
- **A YAML block indented with tabs**, in Custom Assembly through the Chainguard API. YAML forbids tab indentation, so copying it into `build.yaml` produced a parse error. Three other blocks contain tabs and were left alone: they are Go and JSON, where tabs are legal.
- **A `<pre>` with no `data-lang` and no `<code>` child**, the only one in a course whose other twelve blocks all follow the convention.
- **3 `ansi` blocks that opened with a command** behind a decorated `❯` prompt, split into a `console` command block and an `ansi` output block.
- **Editorial prose pasted inside a Grype transcript**, duplicated across two courses. Two sentences and two output lines sat inside the `<pre>`, and the same text follows immediately as real markup.
- **2 shell commands missing the `$` prompt** used by the command directly above them in the same list.
- **A prompt shown as a command.** A lesson says "you should receive a prompt" and shows `#` in a `console` block, which marks it as something to type. It is now `ansi`.

### Left for an author

- **A spliced Grype transcript**, in the AIML and Securing-the-AIML courses. It joins the tail of a scan of the PyTorch runtime image onto a second `grype pytorch/pytorch` run against `:latest`. The package and CVE counts quoted in the prose come from the second run, so untangling it means re-running Grype and restating those numbers.
- **Output captured from a different run**, in Getting Started With Chainguard Containers → How To Update Containers. The command runs `chainctl images diff` on valkey digests `ef876a…` and `a53bd8…`, the prose says "this responded with the following output", and the output reports `408e8f…` and `550bd0…` instead.
- **Every digest pin in the content is over a year old.** All 21 resolvable pins exceed the one-year threshold; the youngest is 525 days and five are over three years, the oldest built 2023-05-12. The package versions and CVE counts in the surrounding prose describe those builds.
- **2 unreferenced content files** in `Tailoring-the-Chainguard-Message`, placeholder lessons that no `lessons-meta.json` points at. Wiring them up or deleting them is an editorial decision.
- **3 output blocks with no command to attach to**, where the producing command is genuinely implicit: output of a build or an agent session driven by the block above.

### What running against the real repository changed in the tool

Two-thirds of the "promptless shell block" findings turned out to be the checker's fault, which is the kind of thing only real content surfaces:

- **A container prompt is a prompt.** Six blocks used `nginx:/#`, which is exactly what the reader sees after attaching to the container and is the point of the lesson. Asking an author to replace it with `$` would have made the content worse.
- **A script is not a transcript.** One block is a `#!/usr/bin/env bash` file to save, so it has no prompt by design.
- **`#` opens a comment, not a root shell.** All 21 of its occurrences introduce comments like `# Install (macOS)`, and reading them as root prompts invented 16 commands that no reader is meant to run.
- **A bare prompt is not a hidden command.** `#` on its own is a prompt being displayed, so the mislabelled-output rule now requires something to follow the marker.

Two conventions for showing output coexist: a separate `ansi` block (120 blocks) and output inline in the `console` block (42 blocks). Both are recognized; neither is treated as an error.

## Pointing at other content

`src/mirror.js` is the only module that knows the directory layout. The path comes from `contentRoot` in the config file, or `ERRATA_ROOT` at runtime. Swapping in [Syncjar](https://github.com/kallewesterling/syncjar) output should be a change to this one module.

```bash
ERRATA_ROOT=/path/to/courses npm test
```

## Inventory CLI

```bash
npm run inventory                        # summary counts, with a problem tally
npm run inventory -- --problems          # open findings, with locations and fixes
npm run inventory -- --problems --all    # add accepted findings, and why, plus notes
npm run inventory -- --problems --limit 0   # do not truncate long lists
npm run inventory -- --json              # full inventory as JSON
npm run inventory -- --lang console      # filter by data-lang
npm run inventory -- --flag has-placeholder
npm run inventory -- --anomalies         # only blocks with anomalies
npm run inventory -- --pairs             # commands beside their expected output
npm run inventory -- --warnings          # cross-reference discrepancies
```

`--problems` is the view for fixing content: it exits non-zero on any open finding, and on any known-issues entry that has gone stale or resolved, so it works as a pre-commit check. It also prints the key to paste into `.errata.yaml` when a finding is one you mean to accept. Add `--color` or `--no-color` to override the automatic detection.

The inventory is built in memory on each run; nothing is committed.

## Layout

```
errata.yaml   settings: paths, taxonomy, drift ceiling, allowlist
<content root>/../.errata.yaml   accepted findings and standing notes
src/
  config.js         loads and validates the YAML above
  known-issues.js   reads and validates the accepted-findings file
  mirror.js         source adapter: courses, lessons, public URLs
  extract.js        parse5 locate + raw slice, anomaly detection
  classify.js       kind mapping, shell splitting, image and URL detection
  pairing.js        links output blocks to the command that produced them
  warnings.js       offline rules comparing a command against its own output
  problems.js       the catalogue: what each check finds, why, and the fix
  report.js         colour and the what/where/fix problem layout
  drift.js          age of digest pins, measured against the registry
  parse-config.js   strict-then-fragment parsing for JSON/YAML/Dockerfile/HCL
  integrity.js      metadata-vs-disk path checks
  inventory.js      assembles the block records
  registry.js       anonymous registry manifest resolution
  links.js          URL liveness with HEAD-then-GET fallback
tests/helpers.js    assertions that print a full report on failure
tests/offline/      fast tier, runs on every commit
tests/network/      slower tier, needs network
```

## Next steps

- Extend link checking to prose `<a href>` links, which is where most real link rot lives.
- Execute `runnable` shell blocks in a container and compare against `expectedOutput` (475 blocks, 587 commands; 91 have recorded output to check against).
- Check the remaining facts in paired output — package versions, CVE identifiers, package counts — against what the command returns today. Unlike digests these cannot be resolved from registry metadata alone, so they need the execution tier.
- Read from Syncjar directly instead of a mirror.
