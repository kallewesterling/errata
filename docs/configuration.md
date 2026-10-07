# Configuring errata

The settings describe your content, so they live with your content. Errata itself carries none.

For what to do with a finding once errata reports one, read [findings.md](findings.md). For running errata in CI, read [ci.md](ci.md).

## The file

Copy [`errata.config.example.yaml`](../errata.config.example.yaml) to the root of your content repository, name it `errata.config.yaml`, and edit it.

```
your-content-repo/
  errata.config.yaml     <- settings
  .errata-accepted.yaml  <- accepted findings
  courses/               <- the content itself
```

The file records:

- the content root
- the language taxonomy
- the registry prefixes, and the age limit for a pinned image
- the courses that may use private images
- the domains that errata trusts, and the links that it skips

`src/config.js` only loads this file and validates it.

## How errata finds the file

Errata takes the first of these that exists:

1. The path in `ERRATA_CONFIG`.
2. `errata.config.yaml` beside `ERRATA_ROOT`, or in the directory above it.
3. `errata.config.yaml` in the working directory, or in any directory above it.

Rule 2 means that pointing errata at content is enough. Rule 3 means that errata works with no environment variables when you run it inside the content repository.

If errata finds no file, it stops and lists every path that it tried.

```bash
ERRATA_ROOT=../courses/courses npm test             # Finds ../courses/errata.config.yaml.
ERRATA_CONFIG=/path/to/errata.config.yaml npm test  # Names the file directly.
```

A relative `contentRoot` resolves against the config file, not against errata.

### The name used before 0.2.0

Rules 2 and 3 also accept `errata.yaml`. It is tried second in each directory, so a repository that has adopted the new name is never answered by an old copy left beside it; directory order still dominates, and the nearest config wins. Reading one prints a deprecation warning. Rule 1 takes the path you give it, under any name.

The old name differed from the accepted-findings file beside it by a leading dot and nothing else. See [the design notes](design.md#the-settings-file-is-named-apart-from-the-findings-file) for why that was worth changing.

## Validation is strict

You edit this file by hand. A key with a wrong name must not take a default value quietly, because the suite would then pass while it checked nothing. Errata stops at load time for an unknown setting, an unknown key, a negative limit, or an unknown language kind. The message gives the file path.

## Allow a private image

Most courses must use only images that a reader can pull without a login. A private image in another course usually means that somebody pasted a sample from internal material. The reader then gets a 401 error.

List the courses that teach with private images in `privateImages.allowedCourses`:

```yaml
privateImages:
  allowedCourses:
    # Builds and pulls a private package while it teaches packaging.
    - Example-Packaging-Course
```

Errata checks this list in two directions. A course on the list that uses no private image also fails. An entry cannot outlive its reason.

## Retire a product name

When a product is renamed, list the old name in `terminology`. Errata then reports the old name wherever a reader sees it:

```yaml
terminology:
  - from: Chainguard Images
    to: Chainguard Containers
    since: 2026-03
  - from: Chainguard Image
    to: Chainguard Container
  - from: chainctl images
    to: chainctl containers
    alsoInCode: true
```

- `from` is the old name. Errata ignores case and the line breaks in the HTML. It does not match a singular inside its plural, so list both forms if both were renamed.
- `to` is the new name.
- `since` is optional. It is a year, or a year and month, and appears in the report.
- `alsoInCode` is optional. Without it, errata does not read code blocks or `<code>` for this name.

Errata reads the lesson prose, the course title and descriptions, and the lesson titles. These findings are `defect`.

Errata does not read code by default, because a name in code is usually an identifier. The GitHub organisation `chainguard-images` is in every `cosign verify` command, and it must match what signed the artifact. Set `alsoInCode` only when a command really changed.

A published URL slug that carries the old name is reported as `stale`. Do not rename the slug. Every link to the old URL would break. Accept the finding in `.errata-accepted.yaml`.

A sentence that is true as dated, such as "In 2025 these were called Chainguard Images", is correct. Accept it in `.errata-accepted.yaml`. The key of the finding contains the sentence, so the entry shows what it accepts.

`npm run fix:terminology` renames the open findings in lesson prose. See [commands.md](commands.md#product-names).

## Trust a domain

`links.ownedDomains` lists the domains that you control. Errata rewrites a moved link only when the domain is on this list. A redirect from your own site is a decision by a person you can ask. A redirect from another site can be a URL shortener, a test, or a consent page.

Errata matches the registrable domain. Every subdomain of `example.com` qualifies. The domain `notexample.com` does not.

`links.ownedDomains` is not the same setting as `primaryDomain`. `primaryDomain` names the one site that supplies the public lesson URLs.
