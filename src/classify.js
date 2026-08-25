import {
  langTaxonomy,
  nonImageNamespaces,
  registryPrefixes,
} from "./config.js";
import { checkConfig, hasElision } from "./parse-config.js";

/** @param {string} s */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Placeholders a reader is expected to substitute before running a command. */
const PLACEHOLDER_PATTERNS = [
  /\{[a-z][a-z0-9_.-]*\}/i, // {your_github_name}
  /<[a-z][a-z0-9_ .-]*>/i, // <package search term>
  /\bYOUR_[A-Z_]+\b/, // YOUR_TOKEN
  /\$\{\{[^}]+\}\}/, // ${{package.version}}, as used by GitHub Actions and others
];

/**
 * Prompt markers used to split commands from output inside a shell block.
 * Deliberately conservative: only the ASCII prompts the content actually uses
 * for commands, optionally behind a bracketed prefix such as `[sdk] `.
 *
 * `#` is excluded. It is the root prompt in principle, but every one of its
 * occurrences in this content introduces a comment (`# Install (macOS)`), and
 * reading those as commands invents steps a reader is never meant to run. A
 * genuine root prompt still matches through `HOST_PROMPT_RE`.
 */
const BARE_PROMPT_RE = /^\s*(?:\[[^\]]*\]\s*)?[$>](?:\s|$)/;

/** A comment inside a shell block: neither a command nor output. */
const COMMENT_RE = /^\s*#/;

/**
 * Prompts that name the host or container the command runs in, such as
 * `nginx:/# ps aux` or `root@builder:~$ ls`.
 *
 * These are not stylistic noise to be normalized away. The debugging lessons
 * attach an ephemeral container and then show `nginx:/#`, which is exactly the
 * prompt the reader is looking at, and which tells them the command runs
 * inside the target container rather than on their own machine.
 */
const HOST_PROMPT_RE = /^\s*[\w.-]+(?:@[\w.-]+)?:\S*[$#](?:\s|$)/;

const PROMPT_RE = new RegExp(
  `(?:${BARE_PROMPT_RE.source})|(?:${HOST_PROMPT_RE.source})`,
);

/** Strip whichever prompt form a line carries. */
const stripPrompt = (line) =>
  line
    .replace(/^\s*(?:\[[^\]]*\]\s*)?[$>]\s?/, "")
    .replace(/^\s*[\w.-]+(?:@[\w.-]+)?:\S*[$#]\s?/, "");

/**
 * A block that opens with a shebang is a file the reader saves, not a session
 * they type, so prompts would be wrong rather than missing.
 */
const isScript = (code) => /^\s*#!/.test(code);

/**
 * Prompt markers that betray a command inside a block labelled as output.
 *
 * By convention `data-lang="ansi"` holds output only, so any prompt in one
 * means the block is mislabelled. This set includes the decorated prompts
 * (`\u276f`, `\u279c`) that shells like fish and oh-my-zsh render, which occur in the
 * content exclusively inside output blocks. `>` is excluded because it is
 * genuinely ambiguous in output, where it also marks quoting and continuation.
 *
 * Something must follow the marker. A lesson that shows the bare prompt a tool
 * hands back (`#`, on its own) is displaying output, not hiding a command, and
 * flagging it would send an author looking for a command that is not there.
 */
const OUTPUT_PROMPT_RE = /^\s*(?:\[[^\]]*\]\s*)?[$#\u276f\u279c\u00bb]\s+\S/m;

/** True when a block labelled as output nonetheless contains a command prompt. */
export function hasCommandPrompt(code) {
  return OUTPUT_PROMPT_RE.test(code);
}

/**
 * Split a shell block into the commands it contains.
 *
 * Prompt-prefixed lines start a command; subsequent lines are either its
 * continuation (when the previous line ends in a backslash) or interleaved
 * output. Blocks with no prompts at all are treated as a single command.
 *
 * A script is returned whole: splitting it on the `#` of a comment line would
 * turn its comments into commands.
 *
 * @param {string} code
 * @returns {{ commands: string[], output: string[], hasPrompt: boolean, script: boolean }}
 */
export function splitShell(code) {
  if (isScript(code)) {
    return {
      commands: [code.trim()].filter(Boolean),
      output: [],
      hasPrompt: false,
      script: true,
    };
  }

  const lines = code.split("\n");
  const commands = [];
  const output = [];
  let current = null;
  let continuing = false;

  for (const line of lines) {
    if (continuing && current !== null) {
      current += `\n${line}`;
      continuing = /\\\s*$/.test(line);
      if (!continuing) {
        commands.push(current);
        current = null;
      }
      continue;
    }

    if (COMMENT_RE.test(line) && !HOST_PROMPT_RE.test(line)) continue;

    if (PROMPT_RE.test(line)) {
      const stripped = stripPrompt(line);
      if (/\\\s*$/.test(stripped)) {
        current = stripped;
        continuing = true;
      } else {
        commands.push(stripped);
      }
    } else if (line.trim() !== "") {
      output.push(line);
    }
  }

  if (current !== null) commands.push(current);

  const hasPrompt = commands.length > 0 && lines.some((l) => PROMPT_RE.test(l));
  return {
    commands: hasPrompt ? commands : [code.trim()].filter(Boolean),
    output: hasPrompt ? output : [],
    hasPrompt,
    script: false,
  };
}

/**
 * Namespaces under a registry host that are not container repositories.
 *
 * `v2` and `token` are the OCI distribution API and its auth endpoint, so they
 * are excluded for every registry. Anything else a particular registry serves
 * from the same host is named in `nonImageNamespaces`.
 */
const NON_IMAGE_NAMESPACES = new RegExp(
  `^(?:v2|token${nonImageNamespaces.map((n) => `|${escapeRe(n)}`).join("")})(?:/|$)`,
);

/** Organization stand-ins a reader is meant to replace with their own. */
const PLACEHOLDER_ORGS =
  /^(?:ORG|ORGANIZATION|my-org|your-org|myorg|yourorg|example)$/i;

/**
 * Container image references worth resolving against a registry.
 *
 * A registry host usually serves more than images, so a bare host-prefix match
 * picks up plenty of strings that are not references. Resolving those produces
 * misleading 401s, so they are filtered out here rather than explained away in
 * the test output.
 */
export function findImageRefs(code) {
  const refs = new Set();
  for (const prefix of registryPrefixes) {
    const re = new RegExp(
      `${prefix.replace(/[.\\]/g, "\\$&")}[A-Za-z0-9._/-]+(?::[A-Za-z0-9._-]+)?(?:@sha256:[a-f0-9]{64})?`,
      "g",
    );
    for (const match of code.matchAll(re)) {
      const ref = match[0];
      const path = ref.slice(ref.indexOf("/") + 1);

      if (NON_IMAGE_NAMESPACES.test(path)) continue;
      if (/\.(?:json|whl|tar\.gz|tgz|sig|sbom)$/.test(ref)) continue;
      if (/\.{3}|\u2026/.test(ref)) continue;
      if (!path.includes("/")) continue; // host/repo with no namespace
      if (PLACEHOLDER_ORGS.test(path.split("/")[0])) continue;

      refs.add(ref.replace(/\/$/, ""));
    }
  }
  return [...refs];
}

/**
 * HTTP(S) URLs appearing inside a code block, with trailing punctuation and
 * shell quoting stripped. Templated and abbreviated URLs are skipped, since
 * they are patterns rather than addresses.
 */
export function findUrls(code) {
  const urls = new Set();
  for (const match of code.matchAll(/https?:\/\/[^\s"'`<>\\)\]}]+/g)) {
    const url = match[0].replace(/[.,;:]+$/, "");
    if (/[{}]|\$\(|<[a-z]/i.test(url)) continue; // ${VAR}, $(cmd), <placeholder>
    if (/\.{3}|\u2026/.test(url)) continue; // .../ elided path segment
    if (/^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::|\/|$)/.test(url)) {
      continue; // a service the reader runs, not a public address
    }
    urls.add(url);
  }
  return [...urls];
}

/** Commands that actually retrieve the URL they are given. */
const FETCH_COMMANDS = /(^|[|;&]\s*)(curl|wget|http|https)\b/;

/**
 * URLs a command in this block would actually retrieve.
 *
 * Most URLs inside code blocks are data, not links: OIDC issuer identities,
 * SBOM document namespaces, APK repository roots, API endpoints printed in
 * sample output. Fetching those produces confident-looking false positives,
 * so liveness checks are limited to URLs passed to a fetching command.
 *
 * @param {{ commands: string[] }|null} shell
 */
export function findFetchUrls(shell) {
  if (!shell) return [];
  const urls = new Set();
  for (const command of shell.commands) {
    if (!FETCH_COMMANDS.test(command)) continue;
    for (const url of findUrls(command)) urls.add(url);
  }
  return [...urls];
}

/**
 * Assign the `kind` tests dispatch on, plus advisory flags.
 * @param {import("./extract.js").RawBlock} block
 */
export function classify(block) {
  const entry = langTaxonomy[block.lang];
  const kind = entry?.kind ?? "unknown";
  const flags = [];

  if (!entry && block.lang) flags.push("unknown-lang");
  if (PLACEHOLDER_PATTERNS.some((re) => re.test(block.code))) {
    flags.push("has-placeholder");
  }

  let shell = null;
  if (kind === "shell") {
    shell = splitShell(block.code);
    if (shell.script) flags.push("script");
    if (!shell.hasPrompt && !shell.script) flags.push("no-prompt");
    if (shell.commands.length > 1) flags.push("multi-command");
    // Output inline in the command block is the alternative to the `ansi`
    // convention; both appear in the content.
    if (shell.output.length > 0) flags.push("has-inline-output");
  }

  if (kind === "output" && hasCommandPrompt(block.code)) {
    flags.push("mislabeled-output");
  }

  const parser = entry?.parser ?? null;
  const parse = parser ? checkConfig(parser, block.code) : null;
  if (parse?.status === "excerpt") flags.push("excerpt");
  if (hasElision(block.code)) flags.push("elided");

  const imageRefs = findImageRefs(block.code);
  if (imageRefs.length > 0) flags.push("has-image-ref");
  const urls = findUrls(block.code);
  if (urls.length > 0) flags.push("has-url");
  const fetchUrls = findFetchUrls(shell);
  if (fetchUrls.length > 0) flags.push("has-fetch-url");
  if (block.code.trim() === "") flags.push("empty");

  return {
    kind,
    parser,
    parse,
    flags,
    shell,
    imageRefs,
    urls,
    fetchUrls,
    /**
     * Executable only when it is shell, has nothing left to fill in, and is
     * not an abbreviated excerpt.
     */
    runnable:
      kind === "shell" &&
      !flags.includes("has-placeholder") &&
      !flags.includes("elided"),
  };
}
