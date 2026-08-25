# errata

Errata finds errors in the code examples inside published course content. It also keeps a dated record of the errors that you do not fix immediately.

An *erratum* is a mistake in work that is already published. The courses are live. The code in them was correct when an author wrote it. Some of it is not correct now.

Errata reads every `<pre data-lang="..."><code>` block in the lesson HTML. It links each block to its source file and to its public URL. It then checks what a machine can check. Errata also checks the links and the images in the lesson text.

Errata works next to [Syncjar](https://github.com/kallewesterling/syncjar), which puts the content into git.

## Requirements

- Node.js 20 or later.
- A content repository with an `errata.yaml` in it. See [Configure errata](#configure-errata).

## Quick start

Clone errata beside your content repository:

```
~/code/
  courses/    <- your content, with errata.yaml at its root
  errata/     <- this tool
```

Point errata at the content. It reads the settings that sit beside it.

```bash
cd ~/code/errata
npm install
export ERRATA_ROOT=~/code/courses/courses

npm test              # Offline checks. About one second. No network.
npm run test:network  # Registry, link, and image checks.
npm run test:all      # Both tiers.
```

Three more commands write a report for a person to read:

```bash
npm run inventory     # A summary of the code blocks, and the open findings.
npm run check:links   # Links and images that are dead, moved, or have a bad anchor.
npm run check:copies  # Lessons that are copies of each other, and have drifted.
```

## What errata checks

Errata makes an inventory of the content. It then runs the checks against that inventory.

| Area | Examples of what errata finds |
|---|---|
| Code blocks | A `<pre>` with no `data-lang`. A `<pre>` with no `<code>` child. |
| Config blocks | JSON, YAML, Dockerfile, and Terraform blocks that do not parse. |
| Commands and output | Output that contradicts the command above it. |
| Metadata | A path in `lessons-meta.json` that matches no file. |
| Container images | An image that does not resolve. An image that needs a login. |
| Links | A dead link. A moved link. A `#anchor` that no longer exists. |
| Images | An `<img src>` that does not load. |
| Copies | Two lessons that were identical, and now differ. |

For the reasons behind these checks, read [docs/design.md](docs/design.md).

## Configure errata

The settings describe your content, so they live with your content. Errata itself carries none. Copy [`errata.example.yaml`](errata.example.yaml) to the root of your content repository, name it `errata.yaml`, and edit it.

```
your-content-repo/
  errata.yaml     <- settings
  .errata.yaml    <- accepted findings
  courses/        <- the content itself
```

The file records:

- the content root
- the language taxonomy
- the registry prefixes, and the age limit for a pinned image
- the courses that may use private images
- the domains that errata trusts, and the links that it skips

`src/config.js` only loads this file and validates it.

### How errata finds the file

Errata takes the first of these that exists:

1. The path in `ERRATA_CONFIG`.
2. `errata.yaml` beside `ERRATA_ROOT`, or in the directory above it.
3. `errata.yaml` in the working directory, or in any directory above it.

Rule 2 means that pointing errata at content is enough. Rule 3 means that errata works with no environment variables when you run it inside the content repository.

If errata finds no file, it stops and lists every path that it tried.

```bash
ERRATA_ROOT=../courses/courses npm test           # Finds ../courses/errata.yaml.
ERRATA_CONFIG=/path/to/errata.yaml npm test       # Names the file directly.
```

A relative `contentRoot` resolves against the config file, not against errata.

### Validation is strict

You edit this file by hand. A key with a wrong name must not take a default value quietly, because the suite would then pass while it checked nothing. Errata stops at load time for an unknown setting, an unknown key, a negative limit, or an unknown language kind. The message gives the file path.

### Allow a private image

Most courses must use only images that a reader can pull without a login. A private image in another course usually means that somebody pasted a sample from internal material. The reader then gets a 401 error.

List the courses that teach with private images in `privateImages.allowedCourses`:

```yaml
privateImages:
  allowedCourses:
    # Builds and pulls a private package while it teaches packaging.
    - Build-Your-First-Container
```

Errata checks this list in two directions. A course on the list that uses no private image also fails. An entry cannot outlive its reason.

### Trust a domain

`links.ownedDomains` lists the domains that you control. Errata rewrites a moved link only when the domain is on this list. A redirect from your own site is a decision by a person you can ask. A redirect from another site can be a URL shortener, a test, or a consent page.

Errata matches the registrable domain. Every subdomain of `example.com` qualifies. The domain `notexample.com` does not.

`links.ownedDomains` is not the same setting as `primaryDomain`. `primaryDomain` names the one site that supplies the public lesson URLs.

## Accept a finding that you cannot fix now

Every check must come out clean. If you cannot fix a finding now, record it in `.errata.yaml`. This file is at the root of the **content** repository, not in errata.

Each entry names one finding:

- which check found it
- which instance the entry covers
- why you did not fix it
- the date of the decision

An entry without a reason fails. Errata accepts nothing without a reason.

Each entry also stores a fingerprint. The fingerprint is a hash of the code block. If somebody edits the block, errata opens the finding again. An entry therefore cannot excuse content that nobody has read since.

Errata reports three states. All three fail:

| State | Meaning | What to do |
|---|---|---|
| open | No entry covers this finding. | Fix the content, or add an entry. |
| stale | The block changed after you wrote the entry. | Read the finding again. Update or delete the entry. |
| resolved | The entry covers no finding. | Delete the entry. |

The file also has a `notes` section. Use it for an observation that no check looks for. A note suppresses nothing and fails nothing. It survives for the next person who edits the lesson.

One check keeps a numeric limit instead: `driftBudget.staleImageRefs`. A pinned digest gets one day older every day, but the block itself never changes, so a fingerprint cannot expire the entry.

## Commands

### Inventory

```bash
npm run inventory                          # Summary counts, and a tally of findings.
npm run inventory -- --problems            # Open findings, with locations and repairs.
npm run inventory -- --problems --all      # Add the accepted findings and the notes.
npm run inventory -- --problems --limit 0  # Do not shorten long lists.
npm run inventory -- --json                # The full inventory as JSON.
npm run inventory -- --lang console        # Filter by data-lang.
npm run inventory -- --flag has-placeholder
npm run inventory -- --anomalies           # Only the blocks that have anomalies.
npm run inventory -- --pairs               # Commands beside their expected output.
npm run inventory -- --warnings            # Discrepancies between a command and its output.
```

Use `--problems` when you repair content. It exits with a non-zero code for an open finding, and for an entry that is stale or resolved. You can therefore run it before a commit. It also prints the key to copy into `.errata.yaml`.

Add `--color` or `--no-color` to override the automatic detection.

Errata builds the inventory in memory on each run. It commits nothing.

### Links and images

```bash
npm run check:links                # Check every link and every image.
npm run check:links -- --owned     # Check only the domains that you own.
npm run check:links -- --json      # Machine-readable output.
npm run check:links -- --markdown  # A body for a pull request.
npm run fix:links                  # Rewrite the links that moved permanently.
npm run fix:links -- --dry-run     # Show the changes, but write nothing.
```

`fix:links` changes a link only when all of these are true:

- The check that has only now run confirmed that the page moved permanently.
- The old URL maps to exactly one new URL.
- The domain is in `links.ownedDomains`.

`fix:links` edits the `href` text where it stands. It does not write the HTML document again. These files go back to Skilljar, and a regenerated document gives you a diff that nobody can review.

Both commands exit with a non-zero code only for a finding that needs a person.

### Copies

```bash
npm run check:copies             # Drifted pairs, with the differences.
npm run check:copies -- --map    # Where else the same code appears.
npm run check:copies -- --all    # Include the pairs that still agree.
npm run check:copies -- --json   # Machine-readable output.
```

`check:copies` always exits with zero. Drift is a question for an author, and the map is not a finding.

## Test tiers

**Offline** (`tests/offline/`) needs no network. It runs in about one second. It checks that:

- the extractor and the pairing work
- every block has a known `data-lang`
- each config block parses, or is a recognized excerpt
- the prompt style is consistent
- each output block pairs with a command
- the metadata paths match the disk

This tier also reports the lessons that are copies of each other. It never fails because of them.

**Network** (`tests/network/`) needs the internet. It checks that:

- every container image reference resolves
- an image that needs a login appears only in an allowlisted course
- the URLs that commands fetch are live
- every prose link resolves, and its anchor exists
- every image loads
- each pinned digest is inside the age limit

The link tier fails only for a finding that a person must repair: a dead link, or a missing anchor. A moved link is a real problem, but errata can repair it, so the tier reports it and leaves it to `npm run fix:links`.

Registry lookups retry after a delay before errata reports an image as broken. The registry limits the request rate, and both network test files resolve images at the same time. Without the retry, a run sometimes failed because of the connection and not because of the content. People ignore a suite that fails at random.

## Use errata with Syncjar

Syncjar moves content between Skilljar and git. Errata reads the content that arrives in git. Errata never connects to Skilljar.

The two tools share one directory of courses. Syncjar calls it `COURSE_CONTENT_PATH`. Errata calls it `ERRATA_ROOT`.

Point both tools at the same directory. The loop is pull, check, fix, check, push.

```bash
# 1. Bring the Skilljar content into git.
cd ~/syncjar
COURSE_CONTENT_PATH=~/courses npm run pull

# 2. Check what arrived. Only the last two commands need the network.
cd ~/errata
export ERRATA_ROOT=~/courses/courses
npm run test:offline          # Structure, parsing, pairing, and metadata.
npm run check:copies          # Lessons that are copies, and have drifted.
npm run check:links           # Every link and image, against the live web.

# 3. Repair. Some of the work is mechanical.
npm run fix:links -- --dry-run
npm run fix:links

# 4. Check again, then send the content back.
npm run test:offline
cd ~/syncjar
COURSE_CONTENT_PATH=~/courses npm run push -- --dry-run
COURSE_CONTENT_PATH=~/courses npm run push
```

`ERRATA_ROOT` points one level deeper than `COURSE_CONTENT_PATH`. It points at the `courses/` directory inside the content repository. This is the layout of this content repository, and neither tool requires it. `contentRoot` in `errata.yaml` records it.

Setting `ERRATA_ROOT` is also how errata finds its settings. It looks beside that directory and in the directory above it, which is where `errata.yaml` sits.

### Check the content before you push it

Skilljar is the published site. An error that reaches Skilljar stays in front of learners until the next round trip. Errata works on local files, so the check is cheap between `pull` and `push`.

This also matters for `fix:links`. It edits the `href` text where it stands, so `npm run push -- --dry-run` shows you 159 changed URLs instead of 51 files of reformatted markup. Syncjar shows you that diff before it uploads anything.

### Record notes in .errata.yaml, not in the HTML

The content goes through the Skilljar editor, and the editor can change the markup. An HTML comment in a lesson can disappear.

Keep your notes in `.errata.yaml` at the content root instead. Syncjar never uploads that file. The documentation export reads only `[A-Z]*/lessons/`, so the export does not collect it either. The file survives the round trip in both directions.

### Edit a shared lesson

Courses reuse lessons, so a change often belongs in more than one file. Before you edit a lesson, find the other copies of the text:

```bash
npm run check:copies -- --map
```

After you edit the lesson, run `npm run check:copies`. It tells you whether the copies that you did not edit have drifted from the copy that you did edit.

### Run errata in CI

The daily sync job opens a pull request with the title "Sync Skilljar content" on the `chore/sync-skilljar` branch. Run errata on that pull request. It is the moment when content enters git, and the last moment before somebody builds on it.

Run the link check on its own weekly schedule. Links break on the schedule of the web, not on the schedule of an author.

## What errata replaces

Errata replaces three scripts. Each of them checks whether a URL answers.

| Script | Where it lives | Why errata replaces it |
|---|---|---|
| `tools/chainlink` | Content repository | See the table below. |
| `tools/check-course-image-urls` | Content repository | It checks the image manifest. Errata checks the images that the lessons show. |
| `check:links` | Syncjar | It reads a gitignored copy of the same lessons. It misses moved links and bad anchors. |

These are the differences from `chainlink`:

| Case | chainlink | errata |
|---|---|---|
| A request times out | Records it as a 404 | Reports it separately, as unreachable |
| A page moved | Reports it as healthy | Rewrites it, or holds it for a person |
| A `#anchor` is missing | Does not see it | Reports it |
| Output | An issue that lists URLs | A pull request with the repairs applied |
| A skipped link | A bare regular expression in `ignore.json` | A pattern with a reason that you must give |

Every entry in `links.skip` needs a `why`. A skip with no reason looks the same as a broken link that somebody gave up on. Nothing in that file expires, so the reason must be there from the start.

## Project layout

Errata holds no settings of its own. Both files below live in the content repository.

```
errata.example.yaml              A template to copy into your content repository.
<content repo>/errata.yaml       Settings: paths, taxonomy, limits, allowlists.
<content repo>/.errata.yaml      Accepted findings and standing notes.
src/
  config.js         Loads and validates errata.yaml.
  known-issues.js   Reads and validates the accepted-findings file.
  mirror.js         Source adapter: courses, lessons, and public URLs.
  extract.js        Finds the code blocks. Detects anomalies.
  prose-links.js    Reads <a href> and <img src> from the source text.
  duplication.js    Visible text, shingles, and drift between copies.
  classify.js       Language kinds, shell splitting, image and URL detection.
  pairing.js        Links an output block to the command that produced it.
  warnings.js       Offline rules that compare a command with its own output.
  problems.js       The catalog: what each check finds, why, and the repair.
  report.js         Color, and the what/where/repair layout.
  drift.js          The age of each pinned digest, measured at the registry.
  parse-config.js   Parses JSON, YAML, Dockerfile, and HCL blocks.
  integrity.js      Compares the metadata with the disk.
  inventory.js      Assembles the block records.
  registry.js       Resolves registry manifests without a login.
  links.js          URL liveness, redirects, and anchor validation.
  link-health.js    Decides which redirects are safe to apply.
scripts/            The three command-line tools.
tests/helpers.js    Assertions that print a full report when they fail.
tests/offline/      Fast tier. Run it on every commit.
tests/network/      Slower tier. Needs the network.
```

## Next steps

- Run the shell blocks in a container, and compare the result with the recorded output. The content has 478 runnable blocks and 634 commands. 95 of the blocks have recorded output.
- Check the other facts in paired output: package versions, CVE identifiers, and package counts. A registry lookup cannot supply these, so they need the execution tier.
- Read from Syncjar directly, instead of from a mirror.
