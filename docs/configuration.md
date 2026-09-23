# Configuring errata

The settings describe your content, so they live with your content. Errata itself carries none.

For what to do with a finding once errata reports one, read [findings.md](findings.md). For running errata in CI, read [ci.md](ci.md).

## The file

Copy [`errata.example.yaml`](../errata.example.yaml) to the root of your content repository, name it `errata.yaml`, and edit it.

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

## How errata finds the file

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

## Trust a domain

`links.ownedDomains` lists the domains that you control. Errata rewrites a moved link only when the domain is on this list. A redirect from your own site is a decision by a person you can ask. A redirect from another site can be a URL shortener, a test, or a consent page.

Errata matches the registrable domain. Every subdomain of `example.com` qualifies. The domain `notexample.com` does not.

`links.ownedDomains` is not the same setting as `primaryDomain`. `primaryDomain` names the one site that supplies the public lesson URLs.
