import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexIssues, loadKnownIssues, validate } from "../../src/known-issues.js";

const dirs = [];

function withFile(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cct-issues-"));
  dirs.push(dir);
  const file = path.join(dir, ".errata.yaml");
  fs.writeFileSync(file, text);
  return file;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true });
});

const ENTRY = {
  problem: "unpaired-output",
  key: "Course/lesson/item#1",
  fingerprint: "sha256:abc",
  note: "Waiting on the author.",
  added: "2026-08-25",
};

const asYaml = (entries) =>
  `issues:\n${entries
    .map(
      (e) =>
        Object.entries(e)
          .map(([k, v], i) => `${i === 0 ? "  - " : "    "}${k}: ${JSON.stringify(v)}`)
          .join("\n"),
    )
    .join("\n")}\n`;

describe("reading the known-issues file", () => {
  it("reads a well-formed entry", () => {
    const { issues } = loadKnownIssues(withFile(asYaml([ENTRY])));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject(ENTRY);
  });

  /**
   * A missing file must mean nothing is accepted. The opposite default would
   * turn a wrong path into a silently passing suite.
   */
  it("treats a missing file as nothing accepted", () => {
    expect(loadKnownIssues("/nonexistent/.errata.yaml")).toEqual({
      issues: [],
      notes: [],
    });
  });

  it("treats an empty file as nothing accepted", () => {
    expect(loadKnownIssues(withFile("")).issues).toEqual([]);
    expect(loadKnownIssues(withFile("issues:\n")).issues).toEqual([]);
  });

  it("accepts a date written as a bare YAML date", () => {
    const { issues } = loadKnownIssues(
      withFile("issues:\n  - problem: p\n    key: k\n    note: n\n    added: 2026-08-25\n"),
    );
    expect(issues[0].added).toBe("2026-08-25");
  });

  it("keeps the fingerprint optional, for findings about a file's existence", () => {
    const { fingerprint, ...rest } = ENTRY;
    const { issues } = loadKnownIssues(withFile(asYaml([rest])));
    expect(issues[0].fingerprint).toBeUndefined();
  });
});

/**
 * Notes carry knowledge no check can find, so they are recorded but never
 * allowed to suppress or fail anything.
 */
describe("observations no check covers", () => {
  const NOTE = { where: "Course/lesson", note: "Totals do not add up.", added: "2026-08-25" };

  it("reads a well-formed note", () => {
    const { notes } = validate({ notes: [NOTE] });
    expect(notes).toEqual([NOTE]);
  });

  it("keeps notes separate from issues", () => {
    const parsed = validate({ issues: [ENTRY], notes: [NOTE] });
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.notes).toHaveLength(1);
  });

  it("requires a location and a body", () => {
    expect(() => validate({ notes: [{ note: "x", added: "2026-08-25" }] })).toThrow(
      "notes[0].where",
    );
    expect(() => validate({ notes: [{ where: "x", added: "2026-08-25" }] })).toThrow(
      "notes[0].note",
    );
  });

  it("rejects an unknown field", () => {
    expect(() => validate({ notes: [{ ...NOTE, owner: "someone" }] })).toThrow(
      'unknown field "notes[0].owner"',
    );
  });
});

/**
 * The file is edited by hand and its whole purpose is to suppress findings, so
 * a malformed entry has to be loud. One that quietly failed to parse would
 * hide a real problem behind a typo.
 */
describe("validating the known-issues file", () => {
  const rejects = (raw, message) => {
    expect(() => validate(raw)).toThrow(message);
  };

  it("rejects an unknown top-level key", () => {
    rejects({ suppressions: [] }, 'unknown setting "suppressions"');
  });

  it("rejects a note list where a mapping belongs", () => {
    rejects({ notes: "see the wiki" }, "notes must be a list");
  });

  it("rejects an unknown field on an entry", () => {
    rejects({ issues: [{ ...ENTRY, until: "2027-01-01" }] }, 'unknown field "issues[0].until"');
  });

  it("requires a note, so nothing is accepted without a reason", () => {
    const { note, ...rest } = ENTRY;
    rejects({ issues: [rest] }, "issues[0].note must be a non-empty string");
  });

  it("rejects a blank note", () => {
    rejects({ issues: [{ ...ENTRY, note: "   " }] }, "issues[0].note");
  });

  it("requires a date in ISO form", () => {
    rejects({ issues: [{ ...ENTRY, added: "25 Aug 2026" }] }, "issues[0].added");
  });

  it("rejects two entries for the same finding", () => {
    rejects(
      { issues: [ENTRY, { ...ENTRY, note: "different reason" }] },
      "duplicates an earlier entry",
    );
  });

  it("allows the same key under a different problem", () => {
    expect(
      validate({ issues: [ENTRY, { ...ENTRY, problem: "mislabeled-output" }] }).issues,
    ).toHaveLength(2);
  });

  it("rejects a list where a mapping belongs", () => {
    rejects({ issues: ["unpaired-output"] }, "issues[0] must be a mapping");
  });
});

describe("indexing entries for lookup", () => {
  it("keys on problem and instance together", () => {
    const index = indexIssues(validate({ issues: [ENTRY] }).issues);
    expect(index.get(`unpaired-output\u0000${ENTRY.key}`)).toMatchObject(ENTRY);
    expect(index.get(`mislabeled-output\u0000${ENTRY.key}`)).toBeUndefined();
  });
});
