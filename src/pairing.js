/**
 * Links output blocks to the command that produced them.
 *
 * Course content uses `data-lang="ansi"` by convention for the output of the
 * preceding command, with explanatory prose in between. Treating those blocks
 * as isolated text throws that relationship away; pairing them turns a command
 * and its expected output into a single testable unit.
 *
 * A command's output is sometimes split across several `ansi` blocks with
 * prose between them, so the search walks back through a run of consecutive
 * output blocks to reach the command at its head.
 */

/**
 * The fields pairing touches. Kept narrower than `CodeBlock` so the linking
 * rules can be tested without constructing a full inventory record.
 *
 * @typedef {object} PairableBlock
 * @property {string} id
 * @property {string} kind
 * @property {string[]} flags
 * @property {string[]} expectedOutput
 * @property {string|null} respondsTo
 * @property {number|null} outputHops
 */

/**
 * @param {PairableBlock[]} blocks
 *   Blocks from a single content item, in document order.
 */
export function linkBlocks(blocks) {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.kind !== "output") continue;

    let j = i - 1;
    let hops = 0;
    while (j >= 0 && blocks[j].kind === "output") {
      j -= 1;
      hops += 1;
    }

    const command = j >= 0 ? blocks[j] : null;
    if (!command || command.kind !== "shell") {
      block.flags.push("unpaired-output");
      continue;
    }

    block.respondsTo = command.id;
    block.outputHops = hops;
    command.expectedOutput.push(block.id);
  }
}

/** Group blocks by the content item they came from, preserving order. */
export function groupByContentItem(blocks) {
  const groups = new Map();
  for (const block of blocks) {
    const key = `${block.course.dir}/${block.lesson.slug}/${block.contentItem.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(block);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.source.startOffset - b.source.startOffset);
  }
  return groups;
}
