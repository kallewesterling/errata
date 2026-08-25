import { describe, expect, it } from "vitest";
import { getInventory } from "../../src/inventory.js";
import { linkBlocks } from "../../src/pairing.js";

/**
 * Minimal block for exercising the linking rules without parsing HTML.
 * @param {string} id
 * @param {string} kind
 * @returns {import("../../src/pairing.js").PairableBlock}
 */
function block(id, kind) {
  return { id, kind, flags: [], expectedOutput: [], respondsTo: null, outputHops: null };
}

describe("linkBlocks", () => {
  it("attaches an output block to the command before it", () => {
    const cmd = block("cmd", "shell");
    const out = block("out", "output");
    linkBlocks([cmd, out]);

    expect(out.respondsTo).toBe("cmd");
    expect(out.outputHops).toBe(0);
    expect(cmd.expectedOutput).toEqual(["out"]);
  });

  it("walks back through a run of output blocks to reach the command", () => {
    // A single command's output is often split across several `ansi` blocks
    // with explanatory prose in between.
    const cmd = block("cmd", "shell");
    const first = block("out1", "output");
    const second = block("out2", "output");
    linkBlocks([cmd, first, second]);

    expect(second.respondsTo).toBe("cmd");
    expect(second.outputHops).toBe(1);
    expect(cmd.expectedOutput).toEqual(["out1", "out2"]);
  });

  it("does not pair output that follows a config block", () => {
    const cfg = block("cfg", "config");
    const out = block("out", "output");
    linkBlocks([cfg, out]);

    expect(out.respondsTo).toBeNull();
    expect(out.flags).toContain("unpaired-output");
  });

  it("does not pair output that opens a lesson", () => {
    const out = block("out", "output");
    linkBlocks([out]);

    expect(out.respondsTo).toBeNull();
    expect(out.flags).toContain("unpaired-output");
  });

  it("attributes each output run to its own command", () => {
    const one = block("cmd1", "shell");
    const outOne = block("out1", "output");
    const two = block("cmd2", "shell");
    const outTwo = block("out2", "output");
    linkBlocks([one, outOne, two, outTwo]);

    expect(one.expectedOutput).toEqual(["out1"]);
    expect(two.expectedOutput).toEqual(["out2"]);
    expect(outTwo.outputHops).toBe(0);
  });

  it("leaves commands with no following output unpaired", () => {
    const cmd = block("cmd", "shell");
    linkBlocks([cmd]);

    expect(cmd.expectedOutput).toEqual([]);
  });
});

describe("command and output pairing across the content", () => {
  const blocks = getInventory();
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const outputs = blocks.filter((b) => b.kind === "output");

  it("pairs the great majority of output blocks", () => {
    const paired = outputs.filter((b) => b.respondsTo);
    expect(paired.length / outputs.length).toBeGreaterThan(0.9);
  });

  it("resolves every pairing reference in both directions", () => {
    for (const out of outputs) {
      if (!out.respondsTo) continue;
      const command = byId.get(out.respondsTo);
      expect(command, `${out.id} points at a missing block`).toBeDefined();
      expect(command.kind, `${out.id} points at a non-command`).toBe("shell");
      expect(command.expectedOutput, `${command.id} is missing the back-reference`).toContain(
        out.id,
      );
    }

    for (const command of blocks.filter((b) => b.expectedOutput.length > 0)) {
      for (const id of command.expectedOutput) {
        expect(byId.get(id)?.respondsTo, `${id} is missing the back-reference`).toBe(
          command.id,
        );
      }
    }
  });

  it("keeps a paired output block in the same lesson as its command", () => {
    for (const out of outputs) {
      if (!out.respondsTo) continue;
      const command = byId.get(out.respondsTo);
      expect(command.contentItem.id, out.id).toBe(out.contentItem.id);
      expect(command.source.startOffset, out.id).toBeLessThan(out.source.startOffset);
    }
  });
});
