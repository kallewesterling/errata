import { afterEach, describe, expect, it } from "vitest";
import {
  colorEnabled,
  formatProblem,
  setColorEnabled,
  style,
} from "../../src/report.js";

afterEach(() => setColorEnabled(false));

const problem = (overrides = {}) => ({
  title: "things that are wrong",
  why: "Because they are wrong.",
  items: [{ summary: "the first thing" }],
  fix: "Make them right.",
  ...overrides,
});

describe("color detection", () => {
  const tty = { isTTY: true };
  const pipe = { isTTY: false };

  it("honours NO_COLOR", () => {
    expect(colorEnabled({ NO_COLOR: "1" }, tty)).toBe(false);
  });

  it("honours FORCE_COLOR when output is not a terminal", () => {
    expect(colorEnabled({ FORCE_COLOR: "1" }, pipe)).toBe(true);
  });

  /**
   * The runner sets NO_COLOR on its workers whenever output is piped, so an
   * explicit FORCE_COLOR has to win or paging a failure loses its color.
   */
  it("lets an explicit FORCE_COLOR override an ambient NO_COLOR", () => {
    expect(colorEnabled({ NO_COLOR: "1", FORCE_COLOR: "1" }, pipe)).toBe(true);
  });

  it("treats FORCE_COLOR=0 as a request for no color", () => {
    expect(colorEnabled({ FORCE_COLOR: "0" }, tty)).toBe(false);
  });

  it("stays plain in CI, where logs are read as text", () => {
    expect(colorEnabled({ CI: "true" }, tty)).toBe(false);
  });

  it("falls back to whether the stream is a terminal", () => {
    expect(colorEnabled({}, tty)).toBe(true);
    expect(colorEnabled({}, pipe)).toBe(false);
  });
});

describe("styling", () => {
  it("emits no escape codes when color is off", () => {
    setColorEnabled(false);
    expect(style.bad("boom")).toBe("boom");
    expect(formatProblem(problem())).not.toContain("\u001B[");
  });

  it("wraps text in escape codes when color is on", () => {
    setColorEnabled(true);
    expect(style.bad("boom")).toBe("\u001B[31mboom\u001B[0m");
  });

  it("leaves the text readable once codes are stripped", () => {
    setColorEnabled(true);
    const stripped = formatProblem(problem()).replaceAll(
      /\u001B\[\d+m/g,
      "",
    );
    setColorEnabled(false);
    expect(stripped).toBe(formatProblem(problem()));
  });
});

describe("problem formatting", () => {
  it("leads with the title and the count", () => {
    const out = formatProblem(
      problem({ items: [{ summary: "a" }, { summary: "b" }] }),
    );
    expect(out.split("\n")[1]).toBe("x things that are wrong (2)");
  });

  /** "1 blocks with ..." would be the alternative. */
  it("reads correctly with a single instance", () => {
    expect(formatProblem(problem()).split("\n")[1]).toBe(
      "x things that are wrong (1)",
    );
  });

  it("says how many instances are already accepted", () => {
    const out = formatProblem(problem({ accepted: 3 }));
    expect(out.split("\n")[1]).toBe("x things that are wrong (1, 3 already accepted)");
  });

  it("omits the accepted count when nothing is accepted", () => {
    expect(formatProblem(problem({ accepted: 0 })).split("\n")[1]).toBe(
      "x things that are wrong (1)",
    );
  });

  it("always ends with a remediation", () => {
    expect(formatProblem(problem())).toContain("Fix: Make them right.");
  });

  it("wraps a long detail value under its own column", () => {
    const out = formatProblem(
      problem({
        items: [{ summary: "a", details: [["note", "word ".repeat(40).trim()]] }],
      }),
    );
    const lines = out.split("\n").filter((l) => l.includes("word"));
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(84);
  });

  it("marks warnings differently from errors", () => {
    expect(formatProblem(problem({ severity: "warning" })).split("\n")[1]).toMatch(
      /^! /,
    );
  });

  it("shows where each instance is", () => {
    const out = formatProblem(
      problem({
        items: [
          {
            summary: "a",
            locations: [
              {
                editorRef: "courses/Foo/lessons/10/content-abc.html:12:4",
                url: "https://example.com/foo",
              },
            ],
          },
        ],
      }),
    );
    expect(out).toContain("courses/Foo/lessons/10/content-abc.html:12:4");
    expect(out).toContain("https://example.com/foo");
  });

  it("aligns detail labels so values line up", () => {
    const out = formatProblem(
      problem({
        items: [
          {
            summary: "a",
            details: [
              ["declared", "Foo/Bar"],
              ["on disk", "foo/bar"],
            ],
          },
        ],
      }),
    );
    const [declared, disk] = out
      .split("\n")
      .filter((line) => line.includes("Foo/Bar") || line.includes("foo/bar"));
    expect(declared.indexOf("Foo/Bar")).toBe(disk.indexOf("foo/bar"));
  });

  /** A wall of a thousand instances is not more useful than a dozen. */
  it("truncates long lists and says how many were held back", () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ summary: `item ${i}` }));
    const out = formatProblem(problem({ items, limit: 10 }));
    expect(out).toContain("item 9");
    expect(out).not.toContain("item 10");
    expect(out).toContain("... and 15 more");
  });

  it("does not truncate when everything fits", () => {
    const items = Array.from({ length: 3 }, (_, i) => ({ summary: `item ${i}` }));
    expect(formatProblem(problem({ items }))).not.toContain("more");
  });

  it("wraps prose rather than emitting one long line", () => {
    const out = formatProblem(problem({ why: "word ".repeat(60) }));
    for (const line of out.split("\n")) expect(line.length).toBeLessThan(100);
  });

  it("works without optional parts", () => {
    const out = formatProblem({
      title: "bare findings",
      items: [{ summary: "one" }],
      fix: "Do the thing.",
    });
    expect(out).toContain("x bare findings (1)");
    expect(out).toContain("Fix: Do the thing.");
  });
});
