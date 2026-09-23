# Working on errata

Notes for changing the tool itself. To use it against your content, read the
[README](README.md); for why each check works the way it does, read
[docs/design.md](docs/design.md).

## Run the suite

Errata carries no configuration, so its own tests have to be pointed at a
content repository like any other caller:

```bash
ERRATA_CONFIG=tests/fixtures/content/errata.yaml npm run test:offline
npm run typecheck
```

That is what CI runs. A bare `npm test` discovers whatever `errata.yaml` is
nearest, which on a development machine is usually a real content checkout, so
it reports real findings in that content rather than failures in your change.
Both are useful. Only the first tells you whether the change is sound.

Run `npm run typecheck` **after** writing tests, not before. The tests are
type-checked too, and a hand-built fixture object that does not satisfy a
typedef is the most common way to get a clean local run and a red CI one.

### Run it against real content, and read the output

The fixtures prove the tool behaves. Only real content tells you whether it
behaves *usefully*, and that is a different question. The fixtures are written
by whoever wrote the check, so they encode the same assumptions the check does.

This is not a nicety. Most of the improvements to errata came from pointing it
at a real checkout and reading what it said, rather than from the test suite:

- A rule for a full stop with nothing before it was dropped for reporting 51
  sites of which 2 were real — then restored, because the 49 were all
  commands and the 2 were all output, and scoping it to output lines made it
  exact. The measurement said "bad rule"; reading the output said "right rule,
  wrong population".
- The `user-content-` anchor false positive was 7 of 13 findings in one run,
  and every one of them looked like a correct finding until the pages were
  opened.
- Reporting a retitled lesson as a resolved one, and advising deletion, was
  found by following that advice and noticing it contradicted a note in the
  same file.

None of those would have surfaced from a fixture. When a check is new, run it
against a real checkout, read every finding it produces, and open the ones you
believe as well as the ones you doubt. A check that is right for the wrong
reason is worse than one that is wrong, because nothing will catch it later.

## Adding a check

A check earns its place by being measured, not by being reasonable. Every rule
in `src/` was run against a real content checkout twice: once before that
content's own repair pass and once after.

The reasoning is that a rule worth having finds the defects and then goes
quiet. If the count barely moves once the defects are fixed, whatever it is
counting is not the defect. Applied to the checks here, that test:

- dropped a rule reporting 51 sites of which 2 were real
- rescoped that same rule to output lines only, where it reports 2 and 0
- narrowed two others that were finding an order of magnitude more noise than
  signal
- confirmed the rest, which go to zero exactly as the defects are repaired

Write the measurement into the commit message. A later reader needs to know
which numbers a threshold came from, and a threshold with no number behind it
is indistinguishable from a guess.

Where a shape cannot be detected precisely, say so in the source rather than
leaving it out silently. `UNIMPLEMENTED_SHAPES` in `src/residue.js` is the
pattern.

## There are two fixtures, and they assert opposite things

Both stand in for a real content repository in CI, where the real courses are
not available.

`tests/fixtures/content/` is **clean**. The checks must come out empty against
it. So you cannot demonstrate a new finding by adding a defect to it, and you
should not try: what belongs there is a case that must **not** be reported. An
adjudicated case — a container prompt, a shebang block — goes there precisely
because the fixture asserts silence, and `tests/offline/adjudications.test.js`
names each one.

`tests/fixtures/dirty/` is **broken on purpose**, one instance of each finding,
and `tests/pinned/dirty/dirty.test.js` asserts the exact set.

Adding a check means adding to both:

- a defect in the dirty fixture, and a line in that test's `PLANTED` table
- if the check has an adjudicated exception, a block in the clean fixture

## Some tests are pinned to a fixture

Tests under `tests/pinned/` are about errata's own behaviour, so they need
known content and each project pins its own `ERRATA_CONFIG`:

| project | content | asserts |
|---|---|---|
| `offline` | whatever the run is pointed at | the detectors, and that the content is clean |
| `pinned-clean` | `tests/fixtures/content/` | the adjudicated cases stay silent |
| `pinned-dirty` | `tests/fixtures/dirty/` | each check reaches a report |

The pinning is not tidiness. Running the suite against a real checkout is
something this file tells you to do, and a fixture-shaped test that inherits
the run's content fails there for reasons that have nothing to do with your
change. That happened: the adjudications tests lived in `offline/` for two
days and produced six spurious failures against real content, which is the
fastest way to teach somebody to ignore a red suite.

If a test names a lesson, a block or a count, it belongs under
`tests/pinned/`. If it would hold for any content, it belongs in `offline/`.

Also test the detector directly, on an HTML string in the test file. Most
checks here are a pure function over text, and a test that states its input
outright reads better than one that sends the reader to a fixture.

The two do different jobs and neither replaces the other. A unit test says the
detector works. The dirty fixture says the check reaches a report — that it is
wired to the right inventory, builds a key that does not collide, carries a
fingerprint and a location, and appears in `collectProblems` at all. A check
can pass every unit test in the suite while being wired to nothing.

## Project layout

Errata holds no settings of its own. Both files below live in the content
repository.

```
errata.example.yaml              A template to copy into your content repository.
<content repo>/errata.yaml       Settings: paths, taxonomy, limits, allowlists.
<content repo>/.errata.yaml      Accepted findings and standing notes.
```

`src/` splits into three layers. Extraction builds an inventory from the
files, detection decides what is wrong with it, and the catalogue says how to
report that. A new check almost always adds to the middle layer only.

```
src/
  Loading
    config.js         Loads and validates errata.yaml.
    known-issues.js   Reads .errata.yaml, and tells a rename from a repair.
    mirror.js         Source adapter: courses, lessons, and public URLs.
    categories.js     What kind of work a finding needs.

  Extraction
    extract.js        Finds the code blocks. Detects anomalies.
    inline-code.js    Reads the <code> elements that sit in prose.
    prose-links.js    Reads <a href> and <img src> from the source text.
    scripts.js        Reads the inline <script> elements.
    inventory.js      Assembles every record the checks read.
    classify.js       Language kinds, shell splitting, image and URL detection.
    pairing.js        Links an output block to the command that produced it.
    parse-config.js   Parses JSON, YAML, Dockerfile, and HCL blocks.
    integrity.js      Compares the metadata with the disk.

  Detection
    markup.js         Comments, typography, and mislabelled Dockerfiles.
    residue.js        Placeholders the HTML parser ate.
    prose-defects.js  Markdown that never rendered; commands lost in a sentence.
    unwritten.js      Content nobody has written yet.
    output-prefixes.js  An output line wearing a command prompt.
    warnings.js       Offline rules comparing a command with its own output.
    duplication.js    Visible text, shingles, and drift between copies.
    siblings.js       What a finding in one copy implies about its twin.
    registry.js       Resolves registry manifests without a login.
    links.js          URL liveness, redirects, and anchor validation.
    link-health.js    Decides which redirects are safe to apply.
    drift.js          The age of each pinned digest, measured at the registry.

  Reporting
    problems.js       The catalogue: what each check finds, why, and the repair.
    report.js         Colour, and the what/where/repair layout.

scripts/              The three command-line tools.
tests/offline/        Fast tier, against whatever content the run is pointed at.
tests/pinned/clean/   Against the clean fixture: adjudicated cases stay silent.
tests/pinned/dirty/   Against the broken fixture: each check reaches a report.
tests/network/        Slower tier. Needs the network.
tests/fixtures/       The two synthetic content repositories.
.github/workflows/    The offline and pinned tiers, on every pull request.
```

## Merging a stack

Dependent pull requests each based on the last need care, and getting it wrong
is quiet rather than loud.

GitHub retargets a dependent pull request onto `main` when its base branch is
merged **and deleted**. Keeping the branch means no retarget, and merging the
next one then merges it into its feature-branch base instead of into `main`.
Every pull request reports itself as merged and only the first has landed.

So do one of these:

- delete each branch as you merge it, and let the retarget happen; or
- retarget each dependent pull request onto `main` yourself before merging it.

Either way, check `git log origin/main` afterwards rather than trusting four
green MERGED badges. This has happened once already, and the recovery was a
pull request from the tip of the chain, which by then held all of the work.

Prefer not to stack in the first place where the changes are independent.
