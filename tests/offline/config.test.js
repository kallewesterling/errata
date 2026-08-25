import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  anomalies,
  configFile,
  driftBudget,
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

afterEach(() => {
  for (const file of written.splice(0)) fs.rmSync(path.dirname(file), { recursive: true });
});

const VALID = fs.readFileSync(configFile, "utf8");

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
});
