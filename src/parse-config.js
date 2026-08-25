import { DockerfileParser } from "dockerfile-ast";
import { parse as parseYaml } from "yaml";

/**
 * Markers authors use to abbreviate sample output. A block containing one is
 * an excerpt by construction and can never parse strictly.
 */
const ELISION = /^\s*(?:[.\u2026]{3}|\u2026|\[\.{3}\]|#\s*\.{3}|\/\/\s*\.{3})\s*,?\s*$/m;

export function hasElision(code) {
  return ELISION.test(code) || /\u2026/.test(code);
}

/**
 * Documentation quotes fragments of config files constantly: one element of an
 * array, the body of an object, a single stanza. Those are correct as written
 * and must not be reported as syntax errors, so each parser gets a strict pass
 * and then a fragment pass before a block is called invalid.
 *
 * @typedef {{ status: "valid"|"excerpt"|"invalid", error: string|null }} ParseResult
 */

/** @returns {ParseResult} */
export function checkJson(code) {
  try {
    JSON.parse(code);
    return { status: "valid", error: null };
  } catch (err) {
    if (hasElision(code)) return { status: "excerpt", error: null };

    // An excerpt is typically one array element or a run of object members,
    // often still carrying the trailing comma from its parent document.
    const trimmed = code.trim().replace(/,\s*$/, "");
    for (const [open, close] of [
      ["{", "}"],
      ["[", "]"],
    ]) {
      try {
        JSON.parse(`${open}${trimmed}${close}`);
        return { status: "excerpt", error: null };
      } catch {
        // fall through to the next shape
      }
    }
    return { status: "invalid", error: err.message };
  }
}

/** @returns {ParseResult} */
export function checkYaml(code) {
  try {
    parseYaml(code);
    return { status: "valid", error: null };
  } catch (err) {
    if (hasElision(code)) return { status: "excerpt", error: null };
    return { status: "invalid", error: err.message.split("\n")[0] };
  }
}

/** @returns {ParseResult} */
export function checkDockerfile(code) {
  const instructions = DockerfileParser.parse(code).getInstructions();
  if (instructions.length > 0) return { status: "valid", error: null };
  if (hasElision(code)) return { status: "excerpt", error: null };
  return { status: "invalid", error: "no parseable instruction" };
}

/**
 * Terraform has no lightweight parser in this toolchain, so this is a brace
 * and quote balance check rather than real HCL validation.
 * @returns {ParseResult}
 */
export function checkTerraform(code) {
  if (hasElision(code)) return { status: "excerpt", error: null };
  const stripped = code.replace(/#[^\n]*/g, "").replace(/"(?:\\.|[^"\\])*"/g, '""');
  let depth = 0;
  for (const char of stripped) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth < 0) return { status: "invalid", error: "unbalanced closing brace" };
  }
  if (depth !== 0) return { status: "excerpt", error: null };
  const quotes = (stripped.match(/"/g) ?? []).length;
  if (quotes % 2 !== 0) return { status: "invalid", error: "unbalanced quote" };
  return { status: "valid", error: null };
}

const CHECKERS = {
  json: checkJson,
  yaml: checkYaml,
  dockerfile: checkDockerfile,
  hcl: checkTerraform,
};

/**
 * @param {string|null} parser
 * @param {string} code
 * @returns {ParseResult|null} null when the language has no checker.
 */
export function checkConfig(parser, code) {
  const checker = CHECKERS[parser];
  return checker ? checker(code) : null;
}
