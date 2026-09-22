import { describe, expect, it } from "vitest";
import { getInventory } from "../../src/inventory.js";
import { collectProblems } from "../../src/problems.js";

/**
 * Cases that were settled once and must not come back as findings.
 *
 * Each of these looks like a defect to a rule that has not been told
 * otherwise, and each was adjudicated against a real body of content. The
 * reasoning lives in `docs/design.md` and in the content's own style guide;
 * what lives here is the part that fails a run when somebody disagrees with
 * it by accident.
 *
 * The fixture lesson carrying them is
 * `courses/Example-Course/lessons/30-Cases-That-Are-Not-Findings/`. Two things
 * are asserted about it: that each individual rule stays quiet on the block it
 * would have reported, and that the catalogue as a whole reports nothing from
 * the lesson. The first says why; the second catches a rule nobody thought of
 * when writing this file.
 */

const LESSON = "30-Cases-That-Are-Not-Findings";

const blocks = getInventory().filter((block) => block.lesson.slug === LESSON);

/** The one block in the lesson whose code contains `text`. */
const blockWith = (text) => {
  const found = blocks.filter((block) => block.code.includes(text));
  expect(found, `exactly one block containing ${JSON.stringify(text)}`).toHaveLength(1);
  return found[0];
};

describe("the adjudications fixture is intact", () => {
  // Without this, deleting the lesson would make every test below pass by
  // having nothing to check.
  // Seven, not six: the bare-prompt transcript needs a command above it, or
  // it would be orphaned output and a finding for a different reason.
  it("carries a block for each adjudicated case", () => {
    expect(blocks).toHaveLength(7);
  });
});

describe("a container prompt is a prompt", () => {
  // Replacing `nginx:/#` with `$` would hide what the lesson is teaching:
  // that the command runs inside the container rather than on the reader's
  // own machine.
  const block = () => blockWith("nginx:/# ps aux");

  it("is not reported as a shell block with no prompt", () => {
    expect(block().flags).not.toContain("no-prompt");
  });

  it("has its commands extracted with the prompt stripped", () => {
    expect(block().shell.commands).toEqual(["ps aux", "cat /etc/os-release"]);
  });
});

describe("a hash opens a comment, not a root shell", () => {
  // Reading a leading hash as a root prompt invents commands that no reader
  // is meant to run. Two thirds of the first promptless-shell findings on
  // real content were this.
  const block = () => blockWith("# Install on a machine");

  it("does not turn the comment into a command", () => {
    expect(block().shell.commands).toEqual(["example-tool plugins add linter"]);
  });

  it("is not reported as promptless, because the real command has a prompt", () => {
    expect(block().flags).not.toContain("no-prompt");
  });
});

describe("a script is not a transcript", () => {
  // A file the reader saves has no prompt by design, so the absence of one is
  // correct rather than missing.
  const block = () => blockWith("#!/usr/bin/env bash");

  it("is recognized as a script", () => {
    expect(block().flags).toContain("script");
  });

  it("is not reported as a shell block with no prompt", () => {
    expect(block().flags).not.toContain("no-prompt");
  });
});

describe("a bare prompt on its own is a prompt on display", () => {
  // The lesson is showing what the terminal looks like, not giving the reader
  // something to type, so the block is a transcript and stays one.
  const block = () => blocks.find((b) => b.code.trim() === "#");

  it("is present, and is an output block", () => {
    expect(block()).toBeDefined();
    expect(block().kind).toBe("output");
  });

  it("is not reported as output containing a command", () => {
    expect(block().anomalies).not.toContain("mislabeled-output");
    expect(block().flags).not.toContain("mislabeled-output");
  });

  it("is paired with the command above it, so it is not orphaned output", () => {
    expect(block().respondsTo).not.toBe(null);
  });
});

describe("both ways of showing output are correct", () => {
  it("accepts output kept inside the command block", () => {
    const block = blockWith("added formatter 0.4.1");
    expect(block.kind).toBe("shell");
    expect(block.shell.commands).toEqual([
      "example-tool plugins add formatter",
      "example-tool plugins list --enabled",
    ]);
    expect(block.shell.output).toEqual(["added formatter 0.4.1", "linter", "formatter"]);
  });

  it("accepts output in a block of its own", () => {
    // The other convention, from the lesson that opens the fixture course.
    const separate = getInventory().find(
      (b) => b.kind === "output" && b.code.startsWith("example-tool 1.4.0"),
    );
    expect(separate.respondsTo).not.toBe(null);
  });
});

describe("backticks inside a code block are not stray markup", () => {
  // They are command substitution, ASCII art, or captured output. Only
  // backticks outside a <pre> are a Markdown leftover.
  it("does not report command substitution as Markdown", () => {
    const markdown = collectProblems()
      .find((problem) => problem.id === "markdown-in-prose")
      .items.filter((item) => item.key.includes(LESSON));
    expect(markdown).toEqual([]);
  });

  it("keeps the backticks in the extracted command", () => {
    expect(blockWith("date --iso-8601").shell.commands[0]).toBe(
      'echo "built at `date --iso-8601=seconds`"',
    );
  });
});

describe("the whole catalogue is silent on this lesson", () => {
  // The per-rule tests above say why each case is allowed. This one catches a
  // rule that nobody thought to exempt when adding it.
  it("reports nothing from the adjudications lesson", () => {
    const reported = collectProblems().flatMap((problem) =>
      problem.items
        .filter((item) => String(item.key ?? "").includes(LESSON))
        .map((item) => `${problem.id}: ${item.key}`),
    );
    expect(reported).toEqual([]);
  });
});
