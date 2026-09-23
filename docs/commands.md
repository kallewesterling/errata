# Commands

Errata builds its inventory in memory on each run and commits nothing. Every command here needs to be pointed at content; see [configuration.md](configuration.md).


## Inventory

```bash
npm run inventory                          # Summary counts, and a tally of findings.
npm run inventory -- --problems            # Open findings, with locations and repairs.
npm run inventory -- --problems --all      # Add the accepted findings and the notes.
npm run inventory -- --problems --limit 0  # Do not shorten long lists.
npm run inventory -- --problems --category defect     # Only what this repo can fix.
npm run inventory -- --problems --category stale      # Only what needs an outside look.
npm run inventory -- --problems --category unwritten  # Only what needs an author.
npm run inventory -- --json                # The full inventory as JSON.
npm run inventory -- --lang console        # Filter by data-lang.
npm run inventory -- --flag has-placeholder
npm run inventory -- --anomalies           # Only the blocks that have anomalies.
npm run inventory -- --pairs               # Commands beside their expected output.
npm run inventory -- --warnings            # Discrepancies between a command and its output.
```

`--category` narrows the report to one kind of work, and is what makes errata
usable as a build gate: fail on `defect`, report the rest. An unknown category
name is rejected rather than silently matching nothing. See
[Running errata in CI](ci.md).

Use `--problems` when you repair content. It exits with a non-zero code for an open finding, and for an entry that is stale or resolved. You can therefore run it before a commit. It also prints the key to copy into `.errata.yaml`.

Add `--color` or `--no-color` to override the automatic detection.

Errata builds the inventory in memory on each run. It commits nothing.

## Links and images

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

## Copies

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

### The suite needs content, so CI carries a fixture

Errata holds no settings of its own, so its own suite must be pointed at a content repository. On your machine, that is a real checkout under `_local-mirror/`. That directory is git-ignored, and the courses are private, so CI has neither.

`tests/fixtures/content/` is a synthetic content repository that stands in for one. It holds a config, an empty accepted-findings file, and one course with two lessons. The whole offline tier passes against it, so every check runs on every pull request, including the checks that walk a content tree.

To use it yourself:

```bash
ERRATA_CONFIG=tests/fixtures/content/errata.yaml npm run test:offline
```

The fixture proves that the checks work. It says nothing about the real content. Run the suite against a real checkout for that.

Keep the fixture clean. A finding in it fails the suite, the same as a finding in real content.
