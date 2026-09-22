/**
 * Detection of an output line wearing a command prompt.
 *
 * The content's convention is that a `$ ` prefix means "type this". A line of
 * program output that picks up a prompt therefore invites a reader to run
 * something that is not a command:
 *
 *     <pre data-lang="console"><code>$ fetch https://packages.wolfi.dev/os/aarch64/APKINDEX.tar.gz
 *
 * `fetch` is what apk prints while it works. No reader has that command.
 *
 * No single-file rule can see this. The block has a prompt and mixed content,
 * which is also the shape of the sanctioned convention where output follows
 * the command inside one block, and `promptless-shell` looks for the opposite
 * defect. What gives it away is the rest of the corpus: the same token appears
 * unprompted, as output, in other lessons.
 *
 * So the evidence is a census rather than a pattern. A token seen repeatedly
 * at the head of an output line, and hardly ever at the head of a command, is
 * an output prefix wherever it turns up with a prompt in front of it.
 */

/**
 * How often a token must head an output line before that means anything.
 *
 * One sighting is coincidence. Measured across the content, raising this from
 * one to two is what separates the real findings from the noise: at one, the
 * rule still reports a site that survived the content's own repair pass; at
 * two, it reports exactly the two real defects and nothing else, and stays
 * there however far the other threshold moves.
 */
const MIN_OUTPUT_SIGHTINGS = 2;

/**
 * How often a token may head a command before it is simply a command.
 *
 * This guard is prudence rather than tuning. Nothing in the current content
 * exercises it — the findings are identical at one, two and three — but
 * without it a widely used command that also shows up in captured output
 * would be reported at every one of its call sites.
 */
const MAX_COMMAND_SIGHTINGS = 2;

/**
 * The part of a block this census reads.
 *
 * Declared structurally rather than as a `CodeBlock` so the rule states its
 * own inputs, and so a test can put a corpus together by hand. The whole
 * question here is what the rest of the content says about a token, which
 * makes a hand-written corpus the clearest way to write a test — and an
 * unreadable one if it has to carry twenty fields the rule never looks at.
 *
 * @typedef {object} CensusBlock
 * @property {string} id
 * @property {string} fingerprint
 * @property {string} kind
 * @property {string} code
 * @property {{commands: string[], output: string[]}|null} shell
 * @property {string} editorRef
 * @property {string|null} url
 */

/** The first whitespace-separated token of a line, or "" when there is none. */
const firstToken = (line) => line.trim().split(/\s+/)[0] ?? "";

/**
 * Count how often each token heads a command, and how often it heads output.
 *
 * Output is taken from two places, because the content uses both conventions:
 * a separate `ansi` block, and unprompted lines inside a `console` block.
 *
 * @param {CensusBlock[]} blocks
 */
export function censusPrefixes(blocks) {
  const asOutput = new Map();
  const asCommand = new Map();
  const bump = (map, token) => {
    if (token) map.set(token, (map.get(token) ?? 0) + 1);
  };

  for (const block of blocks) {
    if (block.kind === "output") {
      for (const line of block.code.split("\n")) bump(asOutput, firstToken(line));
    }
    for (const line of block.shell?.output ?? []) bump(asOutput, firstToken(line));
    for (const command of block.shell?.commands ?? []) {
      bump(asCommand, firstToken(command));
    }
  }

  return { asOutput, asCommand };
}

/**
 * @typedef {object} PromptedOutput
 * @property {CensusBlock} block
 * @property {string} command  The prompted line, as written.
 * @property {string} token    The token the census objected to.
 * @property {number} asOutput   Times it heads an output line in the corpus.
 * @property {number} asCommand  Times it heads a command in the corpus.
 */

/**
 * Every prompted line whose first token the corpus says is output.
 *
 * @param {CensusBlock[]} blocks
 * @returns {PromptedOutput[]}
 */
export function findPromptedOutput(blocks) {
  const { asOutput, asCommand } = censusPrefixes(blocks);
  const found = [];

  for (const block of blocks) {
    for (const command of block.shell?.commands ?? []) {
      const token = firstToken(command);
      if (!token) continue;

      const outputSightings = asOutput.get(token) ?? 0;
      const commandSightings = asCommand.get(token) ?? 0;
      if (outputSightings < MIN_OUTPUT_SIGHTINGS) continue;
      if (commandSightings > MAX_COMMAND_SIGHTINGS) continue;

      found.push({
        block,
        command,
        token,
        asOutput: outputSightings,
        asCommand: commandSightings,
      });
    }
  }

  return found;
}
