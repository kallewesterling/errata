# errata

Errata finds errors in the code examples inside published course content. It also keeps a dated record of the errors that you do not fix immediately.

An *erratum* is a mistake in work that is already published. The courses are live. The code in them was correct when an author wrote it. Some of it is not correct now.

Errata reads every `<pre data-lang="..."><code>` block in the lesson HTML. It links each block to its source file and to its public URL. It then checks what a machine can check. Errata also checks the links, the images, the page scripts, and the prose.

Errata works next to [Syncjar](https://github.com/kallewesterling/syncjar), which puts the content into git.

## Requirements

- Node.js 20 or later.
- A content repository with an `errata.yaml` in it. See [Configuring errata](docs/configuration.md).

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
| Code blocks | A `<pre>` with no `data-lang`. A `<pre>` with no `<code>` child. An HTML comment the browser drops. |
| Placeholders | A value the parser ate, leaving a dangling flag or an empty string. |
| Config blocks | JSON, YAML, Dockerfile, and Terraform blocks that do not parse. |
| Commands and output | Output that contradicts the command above it. An output line wearing a `$` prompt. |
| Metadata | A path in `lessons-meta.json` that matches no file. A `data-lang` nothing uses. |
| Pasted code | A curly quote or non-breaking space that breaks in a shell. |
| Prose | Markdown that never rendered. A command flattened into a sentence. |
| Page scripts | An HTML entity inside a `<script>`, which never decodes. |
| Container images | An image that does not resolve. An image that needs a login. |
| Links | A dead link. A moved link. A `#anchor` that no longer exists. |
| Images | An `<img src>` that does not load. |
| Copies | Two lessons that were identical, and now differ. A finding in one copy but not its twin. |
| Unwritten | A lesson body that is still a placeholder. A description still reading `{Short description}`. |

## Every finding says what kind of work it needs

| Category | Meaning | Who fixes it |
|---|---|---|
| `defect` | Wrong now, and fixable from evidence already in the repository. | Whoever is doing a markup pass. |
| `stale` | Was right when written and has aged out. The evidence is outside the repository. | Somebody who can go and look. |
| `unwritten` | Never finished: a placeholder, a template value, a note where prose was meant to go. | The author who owns the course. |

Ask for one kind at a time:

```bash
npm run inventory -- --problems --category defect     # Everything fixable from the repository.
npm run inventory -- --problems --category unwritten  # Everything that needs an author.
```

This is the distinction that makes errata usable in CI: fail the build on `defect`, and report the other two without failing. See [Running errata in CI](docs/ci.md).

## Accept a finding that you cannot fix now

Every check must come out clean. If you cannot fix a finding now, record it in `.errata.yaml` at the root of the **content** repository, with a reason and a date. An entry without a reason fails, and an entry stops applying as soon as the content it describes is edited.

[Reading and accepting findings](docs/findings.md) covers the four states an entry can be in, and why `renamed` and `resolved` need opposite responses.

## Documentation

| | |
|---|---|
| [Configuring errata](docs/configuration.md) | The settings file, how errata finds it, and what each setting decides. |
| [Commands](docs/commands.md) | Every command and flag, and the two test tiers. |
| [Reading and accepting findings](docs/findings.md) | What to do with a finding, and how `.errata.yaml` works. |
| [Running errata in CI](docs/ci.md) | Three workflow shapes, all in production. |
| [Using errata with Syncjar](docs/syncjar.md) | The pull, check, fix, push loop. |
| [Design notes](docs/design.md) | Why each check works the way it does. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Changing errata itself. |

## Next steps

- Run the shell blocks in a container, and compare the result with the recorded output. The content has 478 runnable blocks and 634 commands. 95 of the blocks have recorded output.
- Check the other facts in paired output: package versions, CVE identifiers, and package counts. A registry lookup cannot supply these, so they need the execution tier.
- Read from Syncjar directly, instead of from a mirror.
