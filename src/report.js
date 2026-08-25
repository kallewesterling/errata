/**
 * Formatting for problem reports.
 *
 * Every report answers the same three questions in the same order: what is
 * wrong, where it is, and what to do about it. A finding without a location is
 * not actionable, and one without a remediation makes the reader guess, so
 * `where` and `fix` are part of the shape rather than optional extras.
 */

const CODES = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  dim: "\u001B[2m",
  red: "\u001B[31m",
  green: "\u001B[32m",
  yellow: "\u001B[33m",
  blue: "\u001B[34m",
  cyan: "\u001B[36m",
};

/**
 * Whether to emit ANSI codes.
 *
 * Environment variables are honoured ahead of TTY detection because test
 * runners capture output, so the stream a message is built on is usually not
 * the stream it is finally printed to.
 *
 * `FORCE_COLOR` outranks `NO_COLOR`, matching Node's own precedence. The two
 * are not equal in intent: the runner sets `NO_COLOR` on its workers whenever
 * output is piped, so treating it as final would quietly discard the colour a
 * reader asked for when paging through a failure with `less -R`.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {{ isTTY?: boolean } | undefined} [stream]
 */
export function colorEnabled(env = process.env, stream = process.stdout) {
  if (env.FORCE_COLOR) return env.FORCE_COLOR !== "0";
  if (env.NO_COLOR) return false;
  if (env.CI) return false;
  return Boolean(stream?.isTTY);
}

let enabled = colorEnabled();

/** Override colour detection; intended for tests and the CLI. */
export function setColorEnabled(value) {
  enabled = value;
}

function paint(style, text) {
  return enabled ? `${CODES[style]}${text}${CODES.reset}` : String(text);
}

export const style = {
  bad: (t) => paint("red", t),
  warn: (t) => paint("yellow", t),
  good: (t) => paint("green", t),
  path: (t) => paint("cyan", t),
  link: (t) => paint("blue", t),
  heading: (t) => paint("bold", t),
  muted: (t) => paint("dim", t),
};

const indent = (text, pad) =>
  String(text)
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");

/**
 * Wrap prose to a readable width. Long explanations are the part most likely
 * to be skipped, so they should not arrive as one unbroken line.
 */
function wrap(text, width = 76) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

/**
 * @typedef {object} Location
 * @property {string} editorRef  `path:line:column`, clickable in most editors.
 * @property {string|null} [url] Public lesson URL.
 */

/**
 * @typedef {object} ProblemItem
 * @property {string} summary            One line naming the specific instance.
 * @property {string} [key]              Identity, for matching known issues.
 * @property {string} [fingerprint]      Content hash, for expiring known issues.
 * @property {[string, string][]} [details]  Label/value rows, aligned.
 * @property {Location[]} [locations]    Where to go and look.
 */

/**
 * @param {object} options
 * @param {string} options.title       What is wrong, without the count.
 * @param {string} [options.why]       Why it matters, in prose.
 * @param {ProblemItem[]} options.items
 * @param {string} options.fix          What to do about it.
 * @param {number} [options.accepted]   Instances held by a known-issues entry.
 * @param {number} [options.limit]      Instances to show before truncating.
 * @param {"error"|"warning"} [options.severity]
 * @returns {string}
 */
export function formatProblem({
  title,
  why,
  items,
  fix,
  accepted = 0,
  limit = 10,
  severity = "error",
}) {
  const mark = severity === "warning" ? style.warn("!") : style.bad("x");
  const tint = severity === "warning" ? style.warn : style.bad;

  // The count trails the title so the line reads correctly at any number,
  // rather than producing "1 blocks with ...".
  const tally = accepted ? `${items.length}, ${accepted} already accepted` : `${items.length}`;
  const out = [`\n${mark} ${style.heading(tint(`${title} (${tally})`))}`];

  if (why) out.push(indent(style.muted(wrap(why)), "  "));

  const shown = items.slice(0, limit);
  for (const [index, item] of shown.entries()) {
    const number = style.muted(`${index + 1}.`.padStart(3));
    out.push(`${number} ${item.summary}`);

    if (item.details?.length) {
      const width = Math.max(...item.details.map(([label]) => label.length));
      const pad = " ".repeat(6 + width + 2);
      for (const [label, value] of item.details) {
        // A note explaining a decision can run to several sentences, so values
        // wrap and align under themselves rather than running off the screen.
        const [first, ...rest] = wrap(value, 76 - width).split("\n");
        out.push(`      ${style.muted(label.padEnd(width))}  ${style.path(first)}`);
        for (const line of rest) out.push(`${pad}${style.path(line)}`);
      }
    }
    for (const location of item.locations ?? []) {
      out.push(`      ${style.path(location.editorRef)}`);
      if (location.url) out.push(`      ${style.link(location.url)}`);
    }
  }

  if (items.length > shown.length) {
    out.push(style.muted(`   ... and ${items.length - shown.length} more`));
  }

  out.push(`  ${style.good("Fix:")} ${indent(wrap(fix), "  ").trimStart()}`);

  return `${out.join("\n")}\n`;
}

/** Location for a code block, for use in `formatProblem` items. */
export function blockLocation(block) {
  return { editorRef: block.editorRef, url: block.url };
}

/**
 * A problem item built straight from a code block.
 *
 * Identity travels with the item so a known-issues entry can name one specific
 * instance, and the fingerprint travels with it so that entry stops applying
 * once the block is edited.
 */
export function blockItem(block, summary) {
  return {
    summary: summary ?? style.muted(block.id),
    key: block.id,
    fingerprint: block.fingerprint,
    locations: [blockLocation(block)],
  };
}
