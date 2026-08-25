# Design notes

This document records the decisions behind the checks in errata. The [README](../README.md) tells you how to use the tool. This document tells you why each check works as it does.

## How errata reads the content

### The settings live with the content, not with the tool

Errata contains no configuration. It ships `errata.example.yaml` as a template, and nothing else.

The settings answer questions about one body of content: which registry hosts its images, which courses may use a private image, which domains it owns. None of those are facts about errata. A default inside the tool would therefore be one project's answers, presented to every other project as a starting point.

This also keeps the tool honest. A check cannot quietly grow a rule that only suits one content repository, because there is nowhere in errata to put it. The registry namespaces that are not repositories were the last such rule, and they now sit in `nonImageNamespaces`.

The known-issues file already lived with the content, for the reasons under [Why .errata.yaml lives with the content](#why-erratayaml-lives-with-the-content-and-why-it-is-a-dotfile). The settings follow it, and for the same reason.

One consequence is worth stating. Errata on its own cannot run, because it has nothing to check and no opinion about what correct means. It fails at load time and lists every path it searched.

### Extraction and tests are separate layers

`src/` builds the inventory. `tests/` makes assertions about that inventory.

The two layers change for different reasons. Extraction changes when the source HTML changes. Tests change when you decide what "correct" means. If the layers were one layer, every new test would parse the HTML again.

### Errata locates a block with a parser, then reads it as raw text

`src/extract.js` uses parse5 with `sourceCodeLocationInfo` to find each `<pre>` element. It then reads the code as a raw substring of the file, between the start tag and the end tag.

The `textContent` property gives the wrong answer here. A `<pre>` element is not an HTML raw-text element. The parser therefore reads unescaped markup inside a block as real markup, and the markup disappears:

```
source:      <pre data-lang="dockerfile"><code>dfc <path_to_dockerfile></code></pre>
textContent: "dfc "                    <- the argument is gone
raw slice:   "dfc <path_to_dockerfile>"
```

The content contains this exact case. The parser gives correct block boundaries and line numbers. The raw substring gives content that matches the file byte for byte.

### Identity and location are different things

Each block carries three references, because they answer three different questions.

| Field | Question it answers | It stays the same when |
|---|---|---|
| `id` | Which block is this? | Somebody edits the text around it |
| `fingerprint` | Did the code change? | Somebody changes only the whitespace |
| `editorRef` and `url` | Where do I go to fix it? | — |

The `id` field is a composite locator: `course-dir/lesson-slug/content-item-id#ordinal`. Errata builds it from `lessons-meta.json`, so it survives an edit elsewhere in the file.

The `fingerprint` field is a hash of the normalized code. It changes when the content of the block changes, and at no other time.

Errata records line numbers for navigation only. It never uses a line number as an identity, because an edit above a block changes the number.

### The kind drives the tests, not data-lang

The values `console` and `ansi` both describe terminal text, but a reader must run only one of them.

`src/config.js` maps each `data-lang` value onto a kind: `shell`, `output`, `config`, or `source`. The tests then dispatch on the kind.

Blocks also carry advisory flags, such as `has-placeholder`, `multi-command`, `elided`, `excerpt`, and `has-image-ref`. Errata does not remove a flagged block from the inventory. Nothing becomes invisible.

### An ansi block pairs with the command above it

The content uses `data-lang="ansi"` for the output of the command before it. Explanatory text often sits between the two blocks.

`src/pairing.js` records that relationship. An output block gets a `respondsTo` field. The command gets an `expectedOutput` field. Without the pairing, errata would treat 116 blocks as isolated text.

The output of one command is often split across several `ansi` blocks. The search therefore walks back through a run of consecutive output blocks to reach the command at the head of the run. 115 of the 116 output blocks pair with a command. 20 of them pair through such a run.

```
$ cosign verify ... cgr.dev/chainguard/pytorch | jq     <- the command
Verification for cgr.dev/chainguard/pytorch:latest --   <- the expected output
```

Errata pairs blocks inside one content item only. A command and its output always sit in the same lesson body.

The pairing also makes an execution tier possible later. A command with recorded output is a test case. A command on its own is only a syntax check.

The convention gives errata one more check. An `ansi` block means output, so a prompt inside one means that the block has the wrong label.

### An excerpt is not an error

Documentation quotes fragments all the time: one element of an array, the body of an object, or output that is shortened with `...`. A strict parser rejects these fragments, but they are correct as written.

`src/parse-config.js` gives each config block a strict parse first, then a fragment parse. It reports the block as invalid only when both parses fail. Without the second pass, about half of the JSON blocks look broken.

## How errata checks links and images

### Errata checks only the URLs that a command fetches

Most URLs inside a code block are data, not links. Examples include OIDC issuer identities, SBOM document namespaces, APK repository roots, and API endpoints in sample output. A request to one of these produces a false result that looks reliable.

The network tier therefore checks only a URL that a command passes to a fetch. It also skips `localhost`.

The same rule applies to image references. A registry host usually serves its own HTTP API, and often language-package endpoints beside it, so `src/classify.js` removes those before errata resolves anything. Which paths those are is a property of the registry, so it is the `nonImageNamespaces` setting rather than a rule in the code.

### A prose link is a different population from a URL in code

An `<a href>` in the lesson text is a promise to the reader. Something must exist at the other end. Every prose link is therefore worth a check, and a URL in a code block is not.

`src/prose-links.js` extracts links with the same care that `src/extract.js` gives to code. It locates each link with the parser, then reads the `href` value from the source text.

The source text matters here. The parser decodes entities. A rewriter that received `?a=1&b=2` would search the file for that string and never find `?a=1&amp;b=2`.

### Errata checks the images against the page, not against a manifest

Errata extracts `<img src>` in the same pass, because an image is a stronger promise than a link. A reader can decline to follow a link. An image is part of the page. When its source is gone, the lesson shows a hole where a screenshot used to be.

The content repository already had `tools/check-course-image-urls`. That script checks that every asset in `course-images/image-manifest.json` is reachable on the bucket. It answers a related question, but not the same one.

The manifest records what a migration uploaded. The HTML records what a reader loads. The two agree today: 226 unique images on each side, and no drift in either direction. But the manifest is a finished build artifact, and authors keep editing the HTML through Skilljar. The manifest cannot know about the first image that somebody adds in the Skilljar editor. The HTML is the file that breaks, so errata checks the HTML.

A bucket asset does not move in a meaningful way. Images therefore take the same liveness path and redirect path as links. Errata reports them as a separate finding, and names each one by its alt text, because the bucket names its assets by hash.

### A link can break in three ways

A check that reads only the status code answers the first question. This is how links decay while every automated check passes.

| What is wrong | What a 404-only check sees |
|---|---|
| The page is gone. | It catches this. |
| The page moved, and answers with a 301. | The link looks healthy. |
| The page is fine, but the `#anchor` is gone. | The link looks healthy. |

The second case is usually the common one. In the courses this was built against, it accounted for just under half of all links to domains the project owned, and the previous checker reported none of them.

Two details make this harder than it looks.

First, a browser never sends a fragment to a server, so a response URL can never carry one. A comparison that keeps the fragment reports every fragment link as moved.

Second, the same fact means that a naive rewrite deletes every `#section` that it touches. The link still resolves, but the sentence around it promises a section that the reader never reaches. The `comparable()` function handles the first problem. The `rewriteTarget()` function handles the second.

### Which redirects errata applies without a person

A 301 response tells you where a page went. But not every 301 response describes a page move. Sites also use a 301 to sweep a retired section onto a landing page. If errata follows one of those, it turns a precise reference into a vague one, and it reports success. That result is worse than no change at all.

`src/link-health.js` applies a redirect only when the page keeps its own name. That is, the last path segment does not change.

A section often gets a new name while the page inside it stays the same. Those are the moves that are safe to apply in bulk.

When the name does change, errata holds the link back if the destination is an ancestor of another page that errata has seen. This is how errata tells a section index from a page, without any hardcoded knowledge of the site.

Errata does not count how many links share a destination. After a site reorganization, several old addresses correctly resolve to one new page. An earlier version treated that as suspicious, and it held back the links that most needed a repair.

On the current content, errata rewrites 101 links and holds 8 for a person. Each of those 8 is a real decision. They include:

- a retired comparison page, swept into its section index
- a blog post, collapsed onto the blog index
- one page that redirects to the root of the site

## How errata compares lessons

### Repetition is the design, so drift is the finding

The courses are assembled from shared lessons. Painless Vulnerability Management is built from lessons that belong to four other courses. Securing the AI/ML Supply Chain bundles the AI/ML modules.

Of the 631 lessons that are long enough to compare, 29 pairs are identical word for word. A check that reported duplicates would report several dozen editorial decisions.

The useful finding is the pair that used to match and no longer does. That is what an edit looks like when it reaches one copy and misses the other. There are 23 such pairs, and a person can read a list of that size.

Errata compares lessons by Jaccard similarity over shingles of five words. A shingle is a group of consecutive words. Jaccard similarity is the size of the intersection of two sets, divided by the size of their union.

The size of the shingle matters. Single words rank any two lessons about CVEs as the same, because they share a vocabulary. Whole documents catch only exact copies. Five words in the same order rarely coincide by chance, and a small edit disturbs only the shingles that overlap it.

The comparison is exhaustive and quadratic. At 631 documents that is about 199,000 set intersections, and about one second of work. MinHash and LSH are the standard answer to this shape of problem. Here they would only add a sampling error to hide.

Two details are important:

- **Errata excludes `<script>` elements.** 557 of the 745 content files carry a related-resources widget inside a `<script>` element, and the widget names sibling courses. It differs in every copy by design. If errata keeps it, it dominates every comparison that includes it.
- **Block boundaries survive normalization.** A command with no full stop after it must not run into the sentence that follows it. Without this rule, a changed command and a rewritten paragraph arrive as one unit.

### Drift never fails a run

A lesson that stands alone opens differently from the same lesson inside a learning path. One says "in this course" where the other says "in this module". That difference is correct, and a machine cannot tell it apart from a repair that landed on one side only.

Errata therefore reports drift and stops there. This matches the treatment of `moved-link-review`.

One distinction is worth drawing. Errata checks whether a difference touches something that a reader runs. Two copies with different text are usually fine. Two copies with different commands are the least likely to differ on purpose, and the most expensive for a reader to meet. Errata names those, and still does not fail.

### The linkage map

Errata groups identical code across courses. This answers a question that is otherwise hard to ask: if this command is wrong, where else is it wrong? 104 block texts appear in more than one course.

A block earns a place in the map when it carries detail that can rot. It must have more than one line, or one line long enough to hold a URL or a pinned version.

The command `$ apk update` appears in four courses and does not matter, because it holds nothing that can get out of date. The command `$ curl -o chainctl "https://dl.enforce.dev/chainctl/latest/..."` appears in three courses and matters a lot.

## How errata reports

### A warning is not a failure

The pairing makes a third class of problem visible: a command whose recorded output contradicts it. Errata reports these as warnings. A hit is a real inconsistency, but sometimes an author made it on purpose.

Each block therefore carries three separate fields. Keep them apart.

| Field | Meaning | Example |
|---|---|---|
| `anomalies` | The HTML itself is malformed. | A `<pre>` with no `<code>` child |
| `flags` | A neutral description. | `has-placeholder`, `multi-command` |
| `warnings` | Probably a content bug, possibly deliberate. | Output contradicts its command |

`src/warnings.js` holds the offline rules: `digest-mismatch`, `image-mismatch`, and `tag-mismatch`. These rules compare the content with itself, so they give the same result every time.

Each rule stays quiet unless both sides make a claim and the claims disagree. Output that lists extra layer digests beside the pinned one triggers nothing.

### Staleness is age, not difference

`src/drift.js` compares the digests pinned in the content with the registry.

The obvious check has no value here. It asks whether a pin still matches what the tag serves. These images rebuild continuously, so 21 of the 23 pins are behind their tag, and that fact says nothing.

The useful measure is the distance behind. `src/registry.js` reads the build date from the image config blob. Errata can then report a pin as "built 2024-01-30, 412 days old" instead of a boolean with no meaning. Errata flags anything older than `staleImageDays`, which is one year, and ranks the report by age.

This is a warning, not a failure, for a second reason. A few lessons pin an old image on purpose, to show a difference against a newer one. A pin that stops resolving is a different matter, and the reference tests fail for it.

### Known issues are named and dated, not counted

The suite started work against content that already had problems.

The first version held each problem at a count, and failed when the count grew. That was the wrong shape. A number tells you only how many instances somebody tolerated. It cannot tell you which instance, or why. It also cannot see one instance repaired while another appears, because the total stays the same.

`.errata.yaml` records each accepted finding on its own: which check, which instance, why it is unfixed, and the date of that decision.

The fingerprint keeps the file current. An entry stores the hash of the block that it covers. An edit to that block opens the finding again, so an entry cannot excuse content that nobody has read since.

A finding about the existence of a file has no fingerprint, because there is no content to hash.

### Why .errata.yaml lives with the content, and why it is a dotfile

The content repository syncs with Skilljar in both directions. A daily CI job pulls Skilljar into git. Anything inside the lesson HTML must therefore survive a round trip through a rich-text editor. That editor can drop an HTML comment without a warning.

A note in the config file of errata has the opposite problem. It does not travel with the content that it describes.

A dotfile at the content root avoids both paths. Syncjar never pushes it to Skilljar. The GCS documentation export walks `[A-Z]*/lessons/`, so the export does not collect it. A note in this file can also be more direct than a note that ships inside the page source of a learner's browser.

### Every finding has exactly one description

The repair text for a finding belongs beside the rule that detects it. It does not belong in the test that asserts on it.

`src/problems.js` holds the catalog. For each check it records what the check looks for, why it matters, and what to do about it. The offline suite reads that catalog to generate its assertions, and `npm run inventory -- --problems` prints the same entries. A contributor sees the same words from a failing test and from the command line.

Each report answers three questions in this order. A finding without a location is not actionable. A finding without a repair makes the reader guess.

```
! blocks labelled as output that contain a command (5)
  data-lang="ansi" means output only. These carry a shell prompt, usually a
  decorated one such as > or ->, rather than the $ used elsewhere, so the
  command a reader needs to run is buried in a block styled as a transcript.
  1. > docker pull registry.example.com/base/alpine
     courses/Example-Course/lessons/20-Getting-Started/content-3chz.html:34:29
     https://courses.example.com/example-course/getting-started
  Fix: Move the command into its own <pre data-lang="console"> block above
  the output, and use the "$ " prompt to match the rest of the content.
```

The count follows the title. It does not lead the title, because "1 blocks with" is wrong at one. Each location is `path:line:column`, which most editors open directly, and the public lesson URL follows it.

`src/report.js` handles color. It reads `NO_COLOR` and `FORCE_COLOR` before it looks for a TTY. The two variables are not equal in weight. The test runner sets `NO_COLOR` on its workers when output goes to a pipe, so `FORCE_COLOR` must win. Otherwise a failure that you page through `less -R` loses its color.

Errata writes each report to stderr and keeps the assertion message to one line. The runner strips ANSI codes from an assertion message, and renders a long message inside a diff view that breaks the layout.

## What errata finds in real content

The findings for a given body of content belong with that content, not here.
They are dated, they change whenever an author edits a lesson, and they are
about one project rather than about the tool.

For the courses this was built against, that record is `docs/errata-findings.md`
in the content repository. To produce your own, run `npm run inventory --
--problems --all`, `npm run check:links` and `npm run check:copies`.

Two results are worth keeping here, because they changed errata itself rather
than the content:

- **A container prompt is a prompt.** Blocks that use `nginx:/#` show exactly
  what a reader sees after attaching to a container. Reporting those as
  promptless would have made the content worse to fix than to leave.
- **The `#` character opens a comment, not a root shell.** Reading `# Install
  (macOS)` as a root prompt invented commands that no reader is meant to run.

Two thirds of the first "promptless shell block" findings were faults in errata,
not in the content. Only real content shows that.


## Why errata replaces the check:links script in Syncjar

Syncjar has a script with the same name. It does not check a different population. The directory `public/courses/` is a copy of the same lessons. The command `npm run generate:courses` writes it from the same `lessons-meta.json`. It is the same set of links, read from a gitignored copy that exists only after a preview build.

That script cannot see the findings that matter most here:

- It follows a redirect but does not record it. The 101 moved links in this content all answer with a 200 response, so they look healthy.
- It never fetches a page body. An `#anchor` that points at a heading that no longer exists stays invisible.
- It sends only a HEAD request. A host that refuses HEAD is reported as broken.
- It collapses every exception into `status: 'ERROR'`. A timeout looks the same as a domain that no longer resolves.

The script also passes `timeout: 5000` to `node-fetch`. That option belongs to version 2. The dependency is `^3.3.2`, where the key is ignored, so an unresponsive host has no deadline at all.

The report goes to `public/data/link-report.json`, which is gitignored. Nothing in the repository reads it.

Use the check in errata instead. If the preview UI needs a report, `npm run check:links -- --json` writes one.
