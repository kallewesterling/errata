# Using errata with Syncjar

For running either tool in CI rather than by hand, read [ci.md](ci.md).

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

`ERRATA_ROOT` points one level deeper than `COURSE_CONTENT_PATH`. It points at the `courses/` directory inside the content repository. This is the layout of this content repository, and neither tool requires it. `contentRoot` in `errata.config.yaml` records it.

Setting `ERRATA_ROOT` is also how errata finds its settings. It looks beside that directory and in the directory above it, which is where `errata.config.yaml` sits.

## Check the content before you push it

Skilljar is the published site. An error that reaches Skilljar stays in front of learners until the next round trip. Errata works on local files, so the check is cheap between `pull` and `push`.

This also matters for `fix:links`. It edits the `href` text where it stands, so `npm run push -- --dry-run` shows you 159 changed URLs instead of 51 files of reformatted markup. Syncjar shows you that diff before it uploads anything.

## Record notes in .errata-accepted.yaml, not in the HTML

The content goes through the Skilljar editor, and the editor can change the markup. An HTML comment in a lesson can disappear.

Keep your notes in `.errata-accepted.yaml` at the content root instead. Syncjar never uploads that file. The documentation export reads only `[A-Z]*/lessons/`, so the export does not collect it either. The file survives the round trip in both directions.

## Edit a shared lesson

Courses reuse lessons, so a change often belongs in more than one file. Before you edit a lesson, find the other copies of the text:

```bash
npm run check:copies -- --map
```

After you edit the lesson, run `npm run check:copies`. It tells you whether the copies that you did not edit have drifted from the copy that you did edit.
