/**
 * Detection of placeholders the HTML parser already ate.
 *
 * A `<pre>` is not a raw-text element, so a literal `<organization>` written
 * into a code block is parsed as an unknown tag and dropped without trace. The
 * `unescaped-markup` anomaly catches the case where the tag is still in the
 * source. This module catches the destructive one, where it is already gone
 * and only the hole is left:
 *
 *     written:  chainctl auth pull-token --name x --parent <organization> --ttl 30m
 *     stored:   chainctl auth pull-token --name x --parent  --ttl 30m
 *
 * Nothing in the file records that anything was lost, which is why this has to
 * be inferred from the shape of what remains.
 *
 * These are heuristics and they will have false positives. They are reported
 * as suspected, and the known-issues file absorbs the legitimate ones. The
 * signal is strong enough to be worth the noise: in the content this was
 * written against, every shape below was a true positive except empty string
 * fields in a sample JSON payload.
 */

/**
 * Where the rules are allowed to look.
 *
 * Source code is excluded, and that exclusion is doing real work rather than
 * saving time. `return ""` in Go and `print("".join(parts))` in Python are
 * ordinary code that trips the empty-value rules, while placeholder residue is
 * a defect of command documentation. Restricting the population removes the
 * largest class of false positive without weakening any rule.
 */
export const RESIDUE_KINDS = new Set(["shell", "output", "config"]);

/**
 * The shapes a swallowed placeholder leaves behind.
 *
 * Each `what` completes the sentence "this looks like residue because it is".
 *
 * @type {{id: string, what: string, pattern: RegExp}[]}
 */
export const RESIDUE_RULES = [
  {
    id: "dangling-flag",
    what: "a long-form flag followed by two or more spaces",
    // `--parent  --ttl 30m`, where the value between them was eaten.
    pattern: /(?:^|\s)--[a-z][a-z0-9-]*\s{2,}(?=\S)/im,
  },
  {
    id: "empty-flag-value",
    what: "a flag given an empty string",
    // `--username ""`
    pattern: /(?:^|\s)--[a-z][a-z0-9-]*[= ]\s*(?:""|'')/im,
  },
  {
    id: "empty-quoted-value",
    what: "a bare word followed by an empty string",
    // `identity ""` in output, where the identity should have been named.
    pattern: /[a-z][a-z0-9_-]*\s+(?:""|'')/i,
  },
  {
    id: "empty-key-value",
    what: "a key left with trailing space and no value",
    // `identity: ` in a workflow YAML.
    //
    // The trailing space is the whole signal, and the rule is confined to it.
    // A key introducing nested content is written `plugins:` and is correct,
    // so matching any key at the end of a line reports every parent key in
    // every YAML block. Matching `key: ""` as well is no better: `source: ""`
    // and `endoflife: ""` are ordinary empty values in a sample config, and
    // including that form took the rule from 2 findings to 8 while adding
    // nothing real.
    pattern: /^[ \t]*(?:"[^"]+"|[A-Za-z][\w.-]*)[ \t]*:[ \t]+$/m,
  },
  {
    id: "eaten-before-slash",
    what: "a flag whose value starts at a path separator",
    // `--github-repo='/.*'`, written as `='<organization>/.*'`.
    //
    // Anchored to a long-form flag with no spaces around the `=`. Matching any
    // `= "/` reports `destination = "/tests"` and every other absolute path in
    // a Terraform block, which is 11 findings of nothing.
    pattern: /--[a-z][a-z0-9-]*=["']\//i,
  },
];

/**
 * One shape from the original request is deliberately not implemented.
 *
 * `Creating role "x" under location .` is real residue, but no rule for it
 * survives contact with the corpus: a full stop after a word is also how
 * `docker build .` and `docker build -t name .` end, and those are correct.
 * Measured across the content, the rule found 51 sites of which 2 were real.
 * Telling the two apart needs to know which tokens are commands and which
 * arguments are paths, which is a command taxonomy errata does not have.
 *
 * The other shape left out is a subcommand missing its required argument,
 * such as `chainctl iam role-bindings delete`, for the same reason: it cannot
 * be recognized without knowing the command's signature.
 */
export const UNIMPLEMENTED_SHAPES = Object.freeze([
  "a full stop with nothing before it",
  "a subcommand missing its required argument",
]);

/**
 * @typedef {object} Residue
 * @property {string} rule   Which shape matched.
 * @property {string} what   Why that shape is suspicious.
 * @property {string} match  The matched text, trimmed.
 * @property {string} line   The whole line it sat on, for recognizing it.
 */

/**
 * Every residue shape present in a piece of text.
 *
 * At most one finding per rule, because a block that lost three placeholders
 * to the same cause is one repair, and reporting it three times would push the
 * other blocks off the end of the report.
 *
 * @param {string} text
 * @returns {Residue[]}
 */
export function findResidue(text) {
  const found = [];

  for (const rule of RESIDUE_RULES) {
    const match = text.match(rule.pattern);
    if (!match) continue;

    const before = text.slice(0, match.index);
    const lineStart = before.lastIndexOf("\n") + 1;
    const lineEnd = text.indexOf("\n", match.index);

    found.push({
      rule: rule.id,
      what: rule.what,
      match: match[0].trim(),
      line: text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim(),
    });
  }

  return found;
}

/**
 * True when a `<code>` element's text ends in a space.
 *
 * The highest-confidence rule of the set, and the only one with no false
 * positives to weigh: there is no reason to write `<code>--parent </code>`
 * unless something used to follow the flag.
 *
 * @param {string} text  The element's text, exactly as stored.
 */
export function endsInSpace(text) {
  return text.length > 0 && text.trimEnd() !== text;
}
