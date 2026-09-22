# Running errata in CI

Errata is a separate repository from the content it checks. So a CI job checks
out both, side by side, and points errata at the content.

Three shapes cover most of it. All three are in production against a real
course catalogue; the YAML below is that code with the names generalised.

## Pointing errata at content

One variable does both jobs:

```yaml
env:
  ERRATA_ROOT: ${{ github.workspace }}/courses
```

Errata carries no settings, so it looks for `errata.yaml` beside that path and
in the directory above it, which finds the one at the root of the content
repository. That file's `contentRoot` is then overridden by the same variable,
so the tool runs against this checkout rather than wherever the config says.
The known-issues file resolves relative to the content root, which also lands
it here.

## 1. A gate on every content pull request

The offline tier takes about a second and touches no network, so it belongs on
every pull request that changes content. This is the moment content enters
git, and the last moment before somebody builds on it.

```yaml
name: Check course content

on:
  pull_request:
    paths:
      - 'courses/**'
      - 'errata.yaml'
      - '.errata.yaml'

permissions: {}

jobs:
  check-content:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false

      # errata is public, so this needs no token. Pin it: see "Pinning" below.
      - uses: actions/checkout@v5
        with:
          repository: kallewesterling/errata
          ref: <commit sha>
          path: .errata-tool
          persist-credentials: false

      - uses: actions/setup-node@v5
        with:
          node-version: '24'
          cache: npm
          cache-dependency-path: .errata-tool/package-lock.json

      # --ignore-scripts: nothing errata runs needs an install-time script,
      # so there is no reason to let a locked package run one.
      - run: npm ci --ignore-scripts
        working-directory: .errata-tool

      - name: Fail on anything fixable from this repository
        working-directory: .errata-tool
        env:
          ERRATA_ROOT: ${{ github.workspace }}/courses
        run: node scripts/inventory.js --problems --category defect --no-color
```

### Fail on `defect`, report the rest

The `--category defect` is the part that makes this usable, and leaving it out
is the most likely way to end up with a check nobody trusts.

A `defect` is wrong now and fixable from evidence already in the repository, so
failing on one is fair: whoever opened the pull request can act on it. A
`stale` finding needs a look at something outside the repository, and an
`unwritten` one needs an author on a different schedule. Neither should stop a
branch merging, and a gate that fails on them is red permanently.

Report those two instead of failing on them, so they are visible without being
blocking:

```yaml
      - name: Report what needs a person, without failing on it
        working-directory: .errata-tool
        env:
          ERRATA_ROOT: ${{ github.workspace }}/courses
        run: |
          {
            echo '### Stale — the evidence is outside this repository'
            echo '```'
            node scripts/inventory.js --problems --category stale --no-color || true
            echo '```'
            echo '### Unwritten — needs an author, not an editor'
            echo '```'
            node scripts/inventory.js --problems --category unwritten --no-color || true
            echo '```'
          } >> "$GITHUB_STEP_SUMMARY"
```

Problems with `.errata.yaml` itself fail whatever category you filter to. An
entry that no longer describes reality is a defect in the file, and the one to
watch is `renamed`: retitling a lesson changes its slug, which silently
detaches every acceptance against it.

## 2. A scheduled link check that opens the repairs

The network tier fails for reasons unrelated to any one change — a host is
slow, a site is down — so it does not belong on a pull request. Links break on
the schedule of the web, not on the schedule of an author.

Most of what it finds is mechanically fixable, so the useful output is a pull
request rather than an issue:

```yaml
on:
  schedule:
    - cron: "0 0 * * SUN"

# ... checkout content, checkout errata, setup node, npm ci ...

      - name: Check links and apply the safe fixes
        working-directory: .errata-tool
        env:
          ERRATA_ROOT: ${{ github.workspace }}/courses
        run: |
          set -o pipefail
          node scripts/links.js --fix --markdown --no-color > "${RUNNER_TEMP}/pr-body.md"

      - uses: peter-evans/create-pull-request@v8
        with:
          branch: automated/link-fixes
          body-path: ${{ runner.temp }}/pr-body.md
          # Without this the action stages every change, which would mistake
          # the errata checkout in the workspace for a content change.
          add-paths: courses
```

`--fix` rewrites only a link the run has just confirmed moved permanently,
whose old URL maps to exactly one new one, on a domain in `links.ownedDomains`.
Everything else is described in `--markdown` output for a person to judge. See
[commands.md](commands.md).

Two details worth copying:

- **Scope the commit to the content directory.** The errata checkout sits in
  the workspace and will otherwise be committed as a content change.
- **Use one long-lived branch.** A weekly job that opens a new pull request
  each week produces a stack nobody reads.

## 3. Watch the pin

Pin errata to a commit SHA rather than a branch. A pin is what stops an
upstream change altering what your CI does without anybody deciding.

The cost is that a pin goes stale silently, and a stale checker is not neutral:
it keeps reporting findings that upstream has already fixed. Dependabot does
not help here, because its `github-actions` ecosystem updates `uses:` lines and
this is a `with: ref:` input to `actions/checkout`, which it does not parse.

So check it on a schedule. Compare the pinned SHA against errata's default
branch and open an issue when they differ:

```bash
head=$(gh api repos/kallewesterling/errata/commits/main --jq .sha)
for file in .github/workflows/*.yaml; do
  grep -q "repository: kallewesterling/errata" "$file" || continue
  pin=$(grep -A 3 "repository: kallewesterling/errata" "$file" \
        | grep -oE 'ref: [0-9a-f]{40}' | head -1 | cut -d' ' -f2)
  [ "$pin" = "$head" ] || echo "$file pins ${pin:0:12}, upstream is ${head:0:12}"
done
```

Scan for the checkout rather than listing the workflows that have one today.
The catalogue this was written against had two callers and its author knew
about one.

Open an issue rather than a pull request. Bumping the pin means reading what
changed upstream and deciding whether to take it, which is the entire reason
for pinning; an automatic bump is a slower way of not pinning at all. Open one
at a time, or a pin left alone for a month collects four identical issues and
stops being read.

## Where the two tiers belong

| | Offline | Network |
|---|---|---|
| Runs in | about a second | minutes |
| Fails because of | the change under review | the change, or the weather |
| Put it on | every pull request | a schedule |

Running the network tier on pull requests is the fastest way to teach people to
merge through a red check.
