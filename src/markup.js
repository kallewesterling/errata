/**
 * Small checks on the markup of a code block itself, as opposed to the
 * correctness of the code inside it.
 *
 * What these have in common is that the block renders, parses and reads
 * correctly, and is still wrong for the reader: a comment the browser drops,
 * a character that survives the clipboard but not the shell, a language label
 * that does not describe the contents.
 */

/**
 * The first HTML comment inside a block, or null.
 *
 * A comment in a code block is either invisible instructions to the reader or
 * a note that escaped review, and it is invisible in both cases. The lesson
 * that prompted this shows a command followed by
 * `<!-- TODO: insert output here -->`, so the reader gets a command and an
 * empty box while the prose below promises "you should see two dependencies".
 *
 * Scoped to `<pre>` deliberately. 52 files in the content carry an HTML
 * comment somewhere, and outside a code block that is ordinary.
 *
 * @param {string} rawCode  Block contents as they appear in the file.
 */
export function htmlCommentIn(rawCode) {
  const match = rawCode.match(/<!--[\s\S]*?-->/);
  return match ? match[0].replace(/\s+/g, " ").trim() : null;
}

/**
 * Characters that are correct in prose and defects in code.
 *
 * A code block gets pasted into a shell, so anything that survives the
 * clipboard but not the shell is a defect. `&nbsp;` indentation in one lesson
 * put U+00A0 into the reader's terminal.
 *
 * Keyed by the decoded character rather than by the entity, because the entity
 * and the literal character are the same defect and the inventory decodes
 * entities for us. Measured across the content, the two forms occur in exactly
 * the same eight blocks.
 */
const TYPOGRAPHY = new Map([
  ["…", "an ellipsis character, where ... was meant"],
  [" ", "a non-breaking space, which lands in the reader's terminal"],
  ["‘", "a curly opening quote, which the shell will not accept"],
  ["’", "a curly closing quote, which the shell will not accept"],
  ["“", "a curly opening double quote, which the shell will not accept"],
  ["”", "a curly closing double quote, which the shell will not accept"],
  ["–", "an en dash, where a hyphen was meant"],
  ["—", "an em dash, where a hyphen was meant"],
]);

/**
 * @typedef {object} Typography
 * @property {string} char  The offending character.
 * @property {string} what  Why it does not belong in a code block.
 */

/**
 * Every typographic character in a block, at most one finding per character.
 *
 * @param {string} code  Block contents, entity-decoded.
 * @returns {Typography[]}
 */
export function typographyIn(code) {
  const found = [];
  for (const [char, what] of TYPOGRAPHY) {
    if (code.includes(char)) found.push({ char, what });
  }
  return found;
}

/**
 * True when a block's contents are a Dockerfile.
 *
 * The test is that the block *opens* with `FROM`, or with `ARG` before it, and
 * that is what makes it safe. Looking for `FROM` anywhere would also match a
 * SQL statement that puts its `FROM` clause on its own line; nothing that is
 * not a Dockerfile begins with one.
 *
 * Measured against the content, this finds the 20 blocks that were labelled
 * `docker` or `markup` before the content normalized them, and nothing after.
 *
 * @param {string} code
 */
export function opensAsDockerfile(code) {
  const lines = code
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (lines.length === 0) return false;
  if (!/^(?:FROM|ARG)\s+\S/.test(lines[0])) return false;
  return lines.some((line) => /^FROM\s+\S/.test(line));
}
