import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const CONFIG_NAME = "errata.config.yaml";

/**
 * The name this file used before 0.2.0.
 *
 * It was one leading dot away from the accepted-findings file beside it, then
 * called `.errata.yaml`, so a sentence naming either one had to be read twice.
 * Both config names still work, because a content repository belongs to
 * somebody else and a release here should not stop their checks running until
 * they rename a file. The old one is looked for second within each directory
 * rather than after the whole search, so a repository that has adopted the new
 * name is never answered by a stale copy of the old one left next to it.
 */
const LEGACY_CONFIG_NAME = "errata.yaml";

const EXAMPLE_NAME = "errata.config.example.yaml";

/**
 * Locate the config file.
 *
 * The settings describe a body of content, not this tool, so the file belongs
 * with the content. errata itself ships only `errata.config.example.yaml`; a
 * checkout of errata on its own has nothing to check and no opinion about what
 * correct means, so there is no default to fall back to.
 *
 * Search order, first hit wins:
 *
 *   1. ERRATA_CONFIG, when set. An explicit path is taken as given, whatever
 *      the file is called.
 *   2. Beside ERRATA_ROOT, then in its parent. Pointing at content is enough
 *      to find the settings that go with it.
 *   3. Walking up from the working directory, which finds it when you run
 *      errata from inside the content repository.
 *
 * @returns {string}
 */
function discoverConfig() {
  if (process.env.ERRATA_CONFIG) return path.resolve(process.env.ERRATA_CONFIG);

  const tried = [];
  const lookIn = (dir) => {
    tried.push(path.join(dir, CONFIG_NAME));
    tried.push(path.join(dir, LEGACY_CONFIG_NAME));
  };

  if (process.env.ERRATA_ROOT) {
    const root = path.resolve(process.env.ERRATA_ROOT);
    lookIn(root);
    lookIn(path.dirname(root));
  }
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    lookIn(dir);
    if (path.dirname(dir) === dir) break;
  }

  const found = tried.find((file) => fs.existsSync(file));
  if (found) {
    if (path.basename(found) === LEGACY_CONFIG_NAME) {
      process.emitWarning(
        `${found} uses the old config filename. Rename it to ${CONFIG_NAME}. ` +
          `${LEGACY_CONFIG_NAME} still works, but it reads too much like the ` +
          `accepted-findings file beside it.`,
        "DeprecationWarning",
      );
    }
    return found;
  }

  throw new Error(
    `No ${CONFIG_NAME} found. It belongs with the content it describes, not ` +
      `with errata.\n\nCopy ${path.join(repoRoot, EXAMPLE_NAME)} to ` +
      `the root of your content repository and edit it, or set ERRATA_CONFIG ` +
      `to an existing file.\n\nLooked in:\n${tried.map((f) => `  ${f}`).join("\n")}`,
  );
}

const configPath = discoverConfig();

const TOP_LEVEL_KEYS = new Set([
  "contentRoot",
  "knownIssuesFile",
  "primaryDomain",
  "registryPrefixes",
  "nonImageNamespaces",
  "staleImageDays",
  "languages",
  "privateImages",
  "anomalies",
  "links",
  "driftBudget",
  "duplication",
  "terminology",
]);

/** Settings that may be omitted, with the value used when they are. */
const OPTIONAL_KEYS = new Map([
  ["nonImageNamespaces", []],
  ["terminology", []],
]);

const TERM_KEYS = new Set(["from", "to", "since", "alsoInCode"]);

const LINK_KEYS = new Set(["ownedDomains", "skip", "scriptLinks"]);
const SCRIPT_LINK_KEYS = new Set(["keys", "textKey"]);

/** A year, or a year and month: when a name was retired. */
const SINCE = /^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/;

const KINDS = new Set(["shell", "output", "config", "source"]);
const PARSERS = new Set(["json", "yaml", "dockerfile", "hcl"]);

const REQUIRED_DRIFT_BUDGETS = ["staleImageRefs"];

function fail(message) {
  throw new Error(`${configPath}: ${message}`);
}

/**
 * Validate the parsed config.
 *
 * Thresholds and allowlists are the parts of this project people edit by hand,
 * so a mistyped key must be an error rather than a silent fallback: a setting
 * that quietly defaulted would make the suite pass while checking nothing.
 */
function validate(raw) {
  if (!raw || typeof raw !== "object") fail("expected a YAML mapping at the top level");

  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      fail(`unknown setting "${key}". Expected one of: ${[...TOP_LEVEL_KEYS].join(", ")}`);
    }
  }
  for (const key of TOP_LEVEL_KEYS) {
    if (raw[key] !== undefined) continue;
    if (OPTIONAL_KEYS.has(key)) {
      raw[key] = structuredClone(OPTIONAL_KEYS.get(key));
      continue;
    }
    fail(`missing required setting "${key}"`);
  }

  if (typeof raw.contentRoot !== "string") fail("contentRoot must be a string");
  if (typeof raw.knownIssuesFile !== "string") fail("knownIssuesFile must be a string");
  if (typeof raw.primaryDomain !== "string") fail("primaryDomain must be a string");
  if (!Array.isArray(raw.registryPrefixes) || raw.registryPrefixes.length === 0) {
    fail("registryPrefixes must be a non-empty list");
  }
  if (
    !Array.isArray(raw.nonImageNamespaces) ||
    raw.nonImageNamespaces.some((n) => typeof n !== "string")
  ) {
    fail("nonImageNamespaces must be a list of path segments");
  }
  if (!Number.isFinite(raw.staleImageDays) || raw.staleImageDays <= 0) {
    fail("staleImageDays must be a positive number of days");
  }

  for (const [lang, entry] of Object.entries(raw.languages ?? {})) {
    if (!entry || !KINDS.has(entry.kind)) {
      fail(`languages.${lang}.kind must be one of: ${[...KINDS].join(", ")}`);
    }
    if (entry.parser !== undefined && !PARSERS.has(entry.parser)) {
      fail(`languages.${lang}.parser must be one of: ${[...PARSERS].join(", ")}`);
    }
  }

  const allowed = raw.privateImages?.allowedCourses;
  if (!Array.isArray(allowed) || allowed.some((c) => typeof c !== "string")) {
    fail("privateImages.allowedCourses must be a list of course directory names");
  }

  if (!Array.isArray(raw.anomalies) || raw.anomalies.some((a) => typeof a !== "string")) {
    fail("anomalies must be a list of anomaly names");
  }

  const owned = raw.links?.ownedDomains;
  if (!Array.isArray(owned) || owned.length === 0 || owned.some((d) => typeof d !== "string")) {
    fail("links.ownedDomains must be a non-empty list of domain names");
  }

  if (!raw.links || typeof raw.links !== "object") fail("links must be a mapping");
  for (const key of Object.keys(raw.links)) {
    if (!LINK_KEYS.has(key)) {
      fail(`unknown setting "links.${key}". Expected one of: ${[...LINK_KEYS].join(", ")}`);
    }
  }

  if (!Array.isArray(raw.links?.skip)) fail("links.skip must be a list");
  for (const [i, entry] of raw.links.skip.entries()) {
    if (!entry || typeof entry.pattern !== "string" || typeof entry.why !== "string") {
      fail(`links.skip[${i}] must have a "pattern" and a "why"`);
    }
    try {
      new RegExp(entry.pattern);
    } catch (err) {
      fail(`links.skip[${i}].pattern is not a valid regular expression: ${err.message}`);
    }
  }

  const scripted = raw.links.scriptLinks;
  if (scripted !== undefined) {
    if (!scripted || typeof scripted !== "object" || Array.isArray(scripted)) {
      fail("links.scriptLinks must be a mapping");
    }
    for (const key of Object.keys(scripted)) {
      if (!SCRIPT_LINK_KEYS.has(key)) {
        fail(
          `links.scriptLinks has unknown key "${key}". Expected one of: ` +
            [...SCRIPT_LINK_KEYS].join(", "),
        );
      }
    }
    if (
      !Array.isArray(scripted.keys) ||
      scripted.keys.length === 0 ||
      scripted.keys.some((k) => typeof k !== "string" || !k)
    ) {
      fail("links.scriptLinks.keys must be a non-empty list of property names");
    }
    if (scripted.textKey !== undefined && (typeof scripted.textKey !== "string" || !scripted.textKey)) {
      fail("links.scriptLinks.textKey must be a property name");
    }
  }

  for (const key of REQUIRED_DRIFT_BUDGETS) {
    const value = raw.driftBudget?.[key];
    if (!Number.isInteger(value) || value < 0) {
      fail(`driftBudget.${key} must be a non-negative integer`);
    }
  }
  for (const key of Object.keys(raw.driftBudget ?? {})) {
    if (!REQUIRED_DRIFT_BUDGETS.includes(key)) fail(`unknown budget "driftBudget.${key}"`);
  }

  const dup = raw.duplication;
  if (!dup || typeof dup !== "object") fail("duplication must be a mapping");
  if (!Number.isInteger(dup.minWords) || dup.minWords <= 0) {
    fail("duplication.minWords must be a positive integer");
  }
  if (!Number.isInteger(dup.shingleSize) || dup.shingleSize < 2) {
    fail("duplication.shingleSize must be an integer of at least 2");
  }
  if (!Number.isFinite(dup.threshold) || dup.threshold <= 0 || dup.threshold > 1) {
    fail("duplication.threshold must be a number above 0 and at most 1");
  }
  if (
    !Array.isArray(dup.ignoreElements) ||
    dup.ignoreElements.some((e) => typeof e !== "string")
  ) {
    fail("duplication.ignoreElements must be a list of element names");
  }

  if (!Array.isArray(raw.terminology)) fail("terminology must be a list");
  const retired = new Set();
  for (const [i, term] of raw.terminology.entries()) {
    const at = `terminology[${i}]`;
    if (!term || typeof term !== "object") fail(`${at} must be a mapping`);
    for (const key of Object.keys(term)) {
      if (!TERM_KEYS.has(key)) {
        fail(`${at} has unknown key "${key}". Expected one of: ${[...TERM_KEYS].join(", ")}`);
      }
    }
    if (typeof term.from !== "string" || !term.from.trim()) {
      fail(`${at}.from must be the retired name`);
    }
    if (typeof term.to !== "string" || !term.to.trim()) {
      fail(`${at}.to must be the current name`);
    }
    // YAML reads `since: 2026` as a number and `since: 2026-03` as a string,
    // and both mean what they say.
    if (typeof term.since === "number") term.since = String(term.since);
    if (term.since !== undefined && !SINCE.test(term.since)) {
      fail(`${at}.since must be a year or a year and month, such as 2026-03`);
    }
    if (term.alsoInCode !== undefined && typeof term.alsoInCode !== "boolean") {
      fail(`${at}.alsoInCode must be true or false`);
    }
    // Matching ignores case, so two entries differing only in case would
    // report every instance twice with possibly different replacements.
    const name = term.from.trim().toLowerCase().replace(/\s+/g, " ");
    if (retired.has(name)) fail(`${at}.from repeats "${term.from}"`);
    retired.add(name);
  }

  return raw;
}

function load() {
  let text;
  try {
    text = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(
        `Configuration file not found at ${configPath}. ` +
          `Set ERRATA_CONFIG to point at one.`,
      );
    }
    throw err;
  }

  try {
    return validate(parseYaml(text));
  } catch (err) {
    if (err.message.startsWith(configPath)) throw err;
    fail(err.message);
  }
}

const config = load();

/**
 * Root of the content source. `ERRATA_ROOT` wins over the config file so a
 * different tree can be checked without editing anything.
 *
 * A relative `contentRoot` is resolved against the config file, not against
 * errata, because the two now live in different repositories.
 */
export const contentRoot = process.env.ERRATA_ROOT
  ? path.resolve(process.env.ERRATA_ROOT)
  : path.resolve(path.dirname(configPath), config.contentRoot);

/** Domain whose published slugs are used to build public lesson URLs. */
export const primaryDomain = config.primaryDomain;

/** @see errata.config.yaml for what `kind` and `parser` mean. */
export const langTaxonomy = config.languages;

export const knownLangs = Object.freeze(Object.keys(langTaxonomy));

/** Registry namespaces whose image references are worth resolving. */
export const registryPrefixes = config.registryPrefixes;

/**
 * Path segments under a registry host that are not container repositories.
 *
 * A registry often serves more than images from the same hostname, and a bare
 * host-prefix match picks those up as if they were repositories. Resolving one
 * returns a misleading 401. The OCI paths `v2` and `token` are excluded
 * always; this setting names whatever else a given registry hosts.
 */
export const nonImageNamespaces = Object.freeze([
  ...config.nonImageNamespaces,
]);

/** Age at which a pinned digest is treated as misleading rather than behind. */
export const staleImageDays = config.staleImageDays;

/** Courses permitted to reference images that require authentication. */
export const privateImageAllowlist = Object.freeze(
  new Set(config.privateImages.allowedCourses),
);

/** Structural anomalies worth reporting on. Any instance is a finding. */
export const anomalies = config.anomalies;

/** Domains whose redirects are trusted enough to rewrite content against. */
export const ownedDomains = Object.freeze([...config.links.ownedDomains]);

/**
 * Which properties of an inline script's object literals hold a URL the page
 * renders as a link, or null when the content has no such widget.
 *
 * Off unless configured, because which property a theme turns into a link is
 * a fact about one theme, and reading every string in every script as a URL
 * would report data, not links.
 *
 * @type {{keys: readonly string[], textKey: string}|null}
 */
export const scriptLinks = config.links.scriptLinks
  ? Object.freeze({
      keys: Object.freeze([...config.links.scriptLinks.keys]),
      textKey: config.links.scriptLinks.textKey ?? "title",
    })
  : null;

/** Links that cannot be checked, each paired with the reason. */
export const linkSkips = Object.freeze(
  config.links.skip.map((entry) => ({
    pattern: entry.pattern,
    why: entry.why,
    re: new RegExp(entry.pattern),
  })),
);

/**
 * True when a URL sits on a domain we control, including any subdomain.
 *
 * Compared on labels rather than with a suffix test, so `notexample.com`
 * cannot pass by ending in the same characters.
 *
 * @param {string} url
 */
export function isOwnedDomain(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return ownedDomains.some(
    (domain) => host === domain.toLowerCase() || host.endsWith(`.${domain.toLowerCase()}`),
  );
}

/** The skip entry matching this URL, or undefined when it should be checked. */
export function skipReason(url) {
  return linkSkips.find((entry) => entry.re.test(url));
}

/**
 * Ceilings for measurements that drift on their own.
 *
 * Unlike a discrete content bug, a pinned digest ages every day without anyone
 * touching the content, so there is nothing stable to record as accepted. Those
 * checks keep a ceiling; everything else is itemized in the known-issues file.
 */
export const driftBudget = config.driftBudget;

/**
 * Settings for finding lessons that are copies of each other.
 *
 * Reuse is intended here, so these tune a report rather than a pass/fail line:
 * what counts as long enough to compare, how similar is similar, and which
 * elements hold text a reader never compares.
 */
export const duplication = Object.freeze({
  ...config.duplication,
  ignoreElements: Object.freeze(new Set(config.duplication.ignoreElements)),
});

/**
 * Product names the content should no longer use, and what replaced them.
 *
 * The list belongs to the content, like `privateImages.allowedCourses`: which
 * names a product retired is a fact about one catalogue, not about errata.
 *
 * @type {readonly import("./terminology.js").Term[]}
 */
export const terminology = Object.freeze(
  config.terminology.map((term) => Object.freeze({ ...term })),
);

/**
 * The known-issues file, resolved against the content root rather than this
 * repository, because it describes the content and travels with it. Keeping it
 * relative means `ERRATA_ROOT` moves both together.
 */
export const knownIssuesPath = path.resolve(contentRoot, config.knownIssuesFile);

/** Where the settings came from, for error messages and the CLI. */
export const configFile = configPath;
