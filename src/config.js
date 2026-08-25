import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const configPath =
  process.env.ERRATA_CONFIG ?? path.join(repoRoot, "errata.yaml");

const TOP_LEVEL_KEYS = new Set([
  "contentRoot",
  "knownIssuesFile",
  "primaryDomain",
  "registryPrefixes",
  "staleImageDays",
  "languages",
  "privateImages",
  "anomalies",
  "links",
  "driftBudget",
]);

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
    if (raw[key] === undefined) fail(`missing required setting "${key}"`);
  }

  if (typeof raw.contentRoot !== "string") fail("contentRoot must be a string");
  if (typeof raw.knownIssuesFile !== "string") fail("knownIssuesFile must be a string");
  if (typeof raw.primaryDomain !== "string") fail("primaryDomain must be a string");
  if (!Array.isArray(raw.registryPrefixes) || raw.registryPrefixes.length === 0) {
    fail("registryPrefixes must be a non-empty list");
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

  for (const key of REQUIRED_DRIFT_BUDGETS) {
    const value = raw.driftBudget?.[key];
    if (!Number.isInteger(value) || value < 0) {
      fail(`driftBudget.${key} must be a non-negative integer`);
    }
  }
  for (const key of Object.keys(raw.driftBudget ?? {})) {
    if (!REQUIRED_DRIFT_BUDGETS.includes(key)) fail(`unknown budget "driftBudget.${key}"`);
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
 */
export const contentRoot = process.env.ERRATA_ROOT
  ? path.resolve(process.env.ERRATA_ROOT)
  : path.resolve(repoRoot, config.contentRoot);

/** Domain whose published slugs are used to build public lesson URLs. */
export const primaryDomain = config.primaryDomain;

/** @see errata.yaml for what `kind` and `parser` mean. */
export const langTaxonomy = config.languages;

export const knownLangs = Object.freeze(Object.keys(langTaxonomy));

/** Registry namespaces whose image references are worth resolving. */
export const registryPrefixes = config.registryPrefixes;

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
 * Compared on labels rather than with a suffix test, so `notchainguard.dev`
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
 * The known-issues file, resolved against the content root rather than this
 * repository, because it describes the content and travels with it. Keeping it
 * relative means `ERRATA_ROOT` moves both together.
 */
export const knownIssuesPath = path.resolve(contentRoot, config.knownIssuesFile);

/** Where the settings came from, for error messages and the CLI. */
export const configFile = configPath;
