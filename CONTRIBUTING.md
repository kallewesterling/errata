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

## The fixture must stay clean

`tests/fixtures/content/` is a synthetic content repository that stands in for
a real one in CI, where the real courses are not available. The content checks
must come out **empty** against it.

That has a consequence worth knowing before you add a check: you cannot
demonstrate a new finding by adding a defect to the fixture, because the suite
asserts there are none. Two things follow.

Test the detector directly, on an HTML string in the test file. Most checks
here are a pure function over text, and a test that states its input outright
reads better than one that sends the reader to a fixture.

Add to the fixture when the case is something that must **not** be reported.
An adjudicated case — a container prompt, a shebang block — belongs there
precisely because the fixture asserts silence.

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
