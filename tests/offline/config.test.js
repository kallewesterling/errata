import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  anomalies,
  configFile,
  driftBudget,
  duplication,
  knownIssuesPath,
  knownLangs,
  langTaxonomy,
  privateImageAllowlist,
  repoRoot,
  staleImageDays,
} from "../../src/config.js";

const written = [];

/**
 * Load a config in a child process, since src/config.js reads its file once at
 * import time. Returns stderr when loading fails.
 */
function loadConfig(yaml) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cct-")), "config.yaml");
  fs.writeFileSync(file, yaml);
  written.push(file);

  try {
    execFileSync(
      process.execPath,
      ["--input-type=module", "-e", "import('./src/config.js')"],
      { cwd: repoRoot, env: { ...process.env, ERRATA_CONFIG: file }, stdio: "pipe" },
    );
    return { ok: true, stderr: "" };
  } catch (err) {
    return { ok: false, stderr: String(err.stderr) };
  }
}

/**
 * Import src/config.js in a child process and report what it resolved.
 *
 * The suite itself runs with ERRATA_CONFIG set, so both variables are cleared
 * before the child's own environment is applied. Otherwise every discovery test
 * would be answered by the setting vitest passes down.
 *
 * @param {{env?: Record<string, string>, cwd?: string}} options
 */
function probeConfig({ env = {}, cwd = repoRoot } = {}) {
  const base = { ...process.env };
  delete base.ERRATA_CONFIG;
  delete base.ERRATA_ROOT;

  try {
    const out = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import(${JSON.stringify(path.join(repoRoot, "src/config.js"))}).then((c) =>
           console.log(JSON.stringify({ config: c.configFile, contentRoot: c.contentRoot })))`,
      ],
      { cwd, env: { ...base, ...env }, stdio: "pipe" },
    );
    return { ok: true, ...JSON.parse(String(out)) };
  } catch (err) {
    return { ok: false, stderr: String(err.stderr) };
  }
}

/**
 * Compare two paths after resolving symlinks.
 *
 * The temporary directory is reached through /var on macOS, which is a symlink
 * to /private/var. `path.resolve` does not follow it, so the two sides can name
 * the same directory and still differ as strings.
 */
const samePath = (a, b) => expect(fs.realpathSync(a)).toBe(fs.realpathSync(b));

/** A content repository with a config at its root. */
function makeContentRepo(configYaml) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "errata-repo-"));
  fs.mkdirSync(path.join(root, "courses"));
  fs.writeFileSync(path.join(root, "errata.yaml"), configYaml);
  written.push(path.join(root, "errata.yaml"));
  return root;
}

afterEach(() => {
  for (const file of written.splice(0)) fs.rmSync(path.dirname(file), { recursive: true });
});

const VALID = fs.readFileSync(configFile, "utf8");

/** The checked-in config, repointed at a `courses` directory beside it. */
const PORTABLE = VALID.replace(/^contentRoot: .*$/m, "contentRoot: courses");

describe("configuration file", () => {
  it("loads the checked-in config", () => {
    expect(loadConfig(VALID).ok).toBe(true);
  });

  it("exposes the language taxonomy", () => {
    expect(knownLangs.length).toBeGreaterThan(0);
    expect(langTaxonomy.console.kind).toBe("shell");
    expect(langTaxonomy.ansi.kind).toBe("output");
    expect(langTaxonomy.json.parser).toBe("json");
  });

  it("exposes drift ceilings as numbers", () => {
    for (const [key, value] of Object.entries(driftBudget)) {
      expect(Number.isInteger(value), key).toBe(true);
    }
    expect(staleImageDays).toBeGreaterThan(0);
  });

  it("exposes the anomalies to report on", () => {
    expect(anomalies.length).toBeGreaterThan(0);
    for (const anomaly of anomalies) expect(typeof anomaly).toBe("string");
  });

  it("resolves the known-issues file against the content root", () => {
    expect(path.isAbsolute(knownIssuesPath)).toBe(true);
    expect(path.basename(knownIssuesPath)).toBe(".errata.yaml");
  });

  it("exposes the private image allowlist as a set of course names", () => {
    expect(privateImageAllowlist.size).toBeGreaterThan(0);
    for (const course of privateImageAllowlist) expect(typeof course).toBe("string");
  });
});

/**
 * The settings describe a body of content, so the file lives with the content.
 * errata carries none of its own, which is what makes it reusable.
 */
describe("finding the configuration file", () => {
  it("resolves a relative contentRoot against the config file, not against errata", () => {
    const root = makeContentRepo(PORTABLE);
    const result = probeConfig({ env: { ERRATA_CONFIG: path.join(root, "errata.yaml") } });

    expect(result.ok, result.stderr).toBe(true);
    samePath(result.contentRoot, path.join(root, "courses"));
  });

  it("finds the config in the parent of ERRATA_ROOT", () => {
    const root = makeContentRepo(PORTABLE);
    const result = probeConfig({ env: { ERRATA_ROOT: path.join(root, "courses") } });

    expect(result.ok, result.stderr).toBe(true);
    samePath(result.config, path.join(root, "errata.yaml"));
  });

  it("finds the config by walking up from the working directory", () => {
    const root = makeContentRepo(PORTABLE);
    const result = probeConfig({ cwd: path.join(root, "courses") });

    expect(result.ok, result.stderr).toBe(true);
    samePath(result.config, path.join(root, "errata.yaml"));
  });

  it("prefers ERRATA_CONFIG over anything it would otherwise discover", () => {
    const chosen = makeContentRepo(PORTABLE);
    const ignored = makeContentRepo(PORTABLE);
    const result = probeConfig({
      env: {
        ERRATA_CONFIG: path.join(chosen, "errata.yaml"),
        ERRATA_ROOT: path.join(ignored, "courses"),
      },
    });

    expect(result.ok, result.stderr).toBe(true);
    samePath(result.config, path.join(chosen, "errata.yaml"));
  });

  it("names the paths it tried when there is no config anywhere", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "errata-empty-"));
    const result = probeConfig({ cwd: empty, env: { ERRATA_ROOT: empty } });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("No errata.yaml found");
    expect(result.stderr).toContain("errata.example.yaml");
    expect(result.stderr).toContain(empty);
    fs.rmSync(empty, { recursive: true });
  });
});

/**
 * Thresholds and allowlists are edited by hand, so a mistyped key has to be an
 * error. A setting that quietly defaulted would let the suite pass while
 * checking nothing.
 */
describe("configuration validation", () => {
  it("rejects an unknown top-level setting", () => {
    const result = loadConfig(`${VALID}\nunknownSetting: true\n`);
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('unknown setting "unknownSetting"');
  });

  it("rejects a mistyped budget key", () => {
    const result = loadConfig(VALID.replace("staleImageRefs:", "staleImageRef:"));
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("driftBudget.staleImageRefs");
  });

  it("rejects a negative budget", () => {
    const result = loadConfig(VALID.replace(/staleImageRefs: \d+/, "staleImageRefs: -1"));
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("non-negative integer");
  });

  it("accepts a config that omits nonImageNamespaces", () => {
    const withoutIt = VALID.replace(/^nonImageNamespaces:\n(?:  - .*\n)+/m, "");
    expect(withoutIt).not.toContain("nonImageNamespaces");
    expect(loadConfig(withoutIt).ok).toBe(true);
  });

  it("rejects nonImageNamespaces that is not a list of strings", () => {
    const result = loadConfig(
      VALID.replace(/^nonImageNamespaces:\n(?:  - .*\n)+/m, "nonImageNamespaces: java\n"),
    );
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("nonImageNamespaces must be a list");
  });

  it("rejects an unknown language kind", () => {
    const result = loadConfig(VALID.replace("console: { kind: shell }", "console: { kind: runnable }"));
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("languages.console.kind");
  });

  it("rejects an unknown config parser", () => {
    const result = loadConfig(
      VALID.replace("json: { kind: config, parser: json }", "json: { kind: config, parser: json5 }"),
    );
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("languages.json.parser");
  });

  it("rejects an allowlist that is not a list of names", () => {
    const result = loadConfig(
      VALID.replace(
        /privateImages:[\s\S]*?\n(?=# Structural problems)/,
        "privateImages:\n  allowedCourses: true\n\n",
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("privateImages.allowedCourses");
  });

  it("rejects a missing top-level setting", () => {
    const result = loadConfig(
      VALID.replace(/^staleImageDays: \d+$/m, "# removed"),
    );
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('missing required setting "staleImageDays"');
  });

  it("reports a missing file rather than falling back to defaults", () => {
    let error = "";
    try {
      execFileSync(
        process.execPath,
        ["--input-type=module", "-e", "import('./src/config.js')"],
        {
          cwd: repoRoot,
          env: { ...process.env, ERRATA_CONFIG: "/nonexistent/config.yaml" },
          stdio: "pipe",
        },
      );
    } catch (err) {
      error = String(err.stderr);
    }
    expect(error).toContain("Configuration file not found");
  });

  it("rejects malformed YAML", () => {
    const result = loadConfig("contentRoot: [unclosed\n");
    expect(result.ok).toBe(false);
  });

  it("exposes the duplication settings, with ignoreElements as a set", () => {
    expect(duplication.minWords).toBeGreaterThan(0);
    expect(duplication.threshold).toBeGreaterThan(0);
    expect(duplication.threshold).toBeLessThanOrEqual(1);
    expect(duplication.shingleSize).toBeGreaterThanOrEqual(2);
    expect(duplication.ignoreElements.has("script")).toBe(true);
  });

  it("rejects a similarity threshold outside zero to one", () => {
    const result = loadConfig(VALID.replace(/threshold: [\d.]+/, "threshold: 1.5"));
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("duplication.threshold");
  });

  it("rejects a shingle size too small to be evidence", () => {
    const result = loadConfig(VALID.replace(/shingleSize: \d+/, "shingleSize: 1"));
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("duplication.shingleSize");
  });

  it("rejects a non-positive minimum word count", () => {
    const result = loadConfig(VALID.replace(/minWords: \d+/, "minWords: 0"));
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("duplication.minWords");
  });

  it("rejects ignoreElements that is not a list of element names", () => {
    const result = loadConfig(
      VALID.replace(/ignoreElements:\n(\s+- \w+\n)+/, "ignoreElements: true\n"),
    );
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("duplication.ignoreElements");
  });
});
