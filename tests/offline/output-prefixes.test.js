import { describe, expect, it } from "vitest";
import { censusPrefixes, findPromptedOutput } from "../../src/output-prefixes.js";

/**
 * A block as the inventory would build it, reduced to the fields this check
 * reads. Building these by hand rather than from a fixture keeps the census
 * legible: the whole point of the rule is what the rest of the corpus says,
 * so each test states its corpus outright.
 */
const shell = (id, commands, output = []) => ({
  id,
  fingerprint: `fp-${id}`,
  kind: "shell",
  code: [...commands.map((c) => `$ ${c}`), ...output].join("\n"),
  shell: { commands, output, hasPrompt: true },
  editorRef: `${id}.html:1:1`,
  url: null,
});

const ansi = (id, lines) => ({
  id,
  fingerprint: `fp-${id}`,
  kind: "output",
  code: lines.join("\n"),
  shell: null,
  editorRef: `${id}.html:1:1`,
  url: null,
});

const tokens = (blocks) => findPromptedOutput(blocks).map((f) => f.token);

describe("censusPrefixes", () => {
  it("counts a token heading an ansi block's lines as output", () => {
    const { asOutput } = censusPrefixes([ansi("a", ["fetch one", "fetch two"])]);
    expect(asOutput.get("fetch")).toBe(2);
  });

  it("counts unprompted lines inside a console block as output too", () => {
    // The content uses both conventions, so a census that read only ansi
    // blocks would miss half the evidence.
    const { asOutput } = censusPrefixes([shell("a", ["apk update"], ["fetch one"])]);
    expect(asOutput.get("fetch")).toBe(1);
  });

  it("counts the head of a command separately", () => {
    const { asCommand } = censusPrefixes([shell("a", ["apk update", "apk add curl"])]);
    expect(asCommand.get("apk")).toBe(2);
  });
});

describe("findPromptedOutput", () => {
  // The real case: `fetch` is what apk prints while it works, and it appears
  // unprompted elsewhere in the same corpus.
  it("flags a prompted line whose token the corpus knows as output", () => {
    const corpus = [
      ansi("a", ["fetch https://example.com/APKINDEX.tar.gz", "fetch again"]),
      shell("b", ["fetch https://example.com/APKINDEX.tar.gz"]),
    ];
    expect(tokens(corpus)).toEqual(["fetch"]);
  });

  it("says nothing when the token heads output only once", () => {
    // One sighting is coincidence. Measured on the content, this threshold is
    // what separates the two real findings from a site that was never a bug.
    const corpus = [ansi("a", ["fetch once"]), shell("b", ["fetch something"])];
    expect(tokens(corpus)).toEqual([]);
  });

  it("says nothing about a token that is mostly a command", () => {
    // Without this guard, a widely used command that also turns up in
    // captured output would be reported at every one of its call sites.
    const corpus = [
      ansi("a", ["docker pulled it", "docker did a thing"]),
      shell("b", ["docker build .", "docker run x", "docker ps"]),
      shell("c", ["docker images"]),
    ];
    expect(tokens(corpus)).toEqual([]);
  });

  it("leaves an ordinary command alone", () => {
    const corpus = [
      ansi("a", ["OK: 12 packages", "OK: done"]),
      shell("b", ["apk update"]),
    ];
    expect(tokens(corpus)).toEqual([]);
  });

  it("reports the evidence, so a reader can judge the call", () => {
    const corpus = [
      ansi("a", ["fetch one", "fetch two", "fetch three"]),
      shell("b", ["fetch https://example.com/x"]),
    ];
    const [found] = findPromptedOutput(corpus);
    expect(found.asOutput).toBe(3);
    expect(found.asCommand).toBe(1);
    expect(found.command).toBe("fetch https://example.com/x");
    expect(found.block.id).toBe("b");
  });

  it("handles a block with no shell section", () => {
    expect(tokens([ansi("a", ["fetch one", "fetch two"])])).toEqual([]);
  });
});
