import { describe, expect, it } from "vitest";
import { partitionUnmatched } from "../../src/known-issues.js";

/** A known-issues entry, reduced to what the partition reads. */
const entry = (problem, key) => ({
  problem,
  key,
  note: "because",
  added: "2026-01-01",
});

/** An open finding nothing covers. */
const finding = (problem, key) => ({ problem, key });

describe("telling a retitled lesson apart from a repaired one", () => {
  // The real case: two lesson slugs were re-cased when their titles took the
  // colon form, which detached both acceptances at once. errata called them
  // resolved and advised deleting them, which would have thrown away two
  // recorded decisions and reopened findings for somebody to "fix".
  it("recognizes a slug that changed case", () => {
    const { renamed, resolved } = partitionUnmatched(
      [entry("unpaired-output", "Course-A/60-Set-Up-The-Toolchain/m7ssafa6bse3#7")],
      [finding("unpaired-output", "Course-A/60-Set-up-the-toolchain/m7ssafa6bse3#7")],
    );
    expect(resolved).toEqual([]);
    expect(renamed).toHaveLength(1);
    expect(renamed[0].from).toBe("60-Set-Up-The-Toolchain");
    expect(renamed[0].to).toBe("60-Set-up-the-toolchain");
  });

  it("recognizes a slug that was retitled outright", () => {
    const { renamed } = partitionUnmatched(
      [entry("promptless-shell", "Course-A/30-Old-Title/item9#2")],
      [finding("promptless-shell", "Course-A/30-A-Completely-New-Title/item9#2")],
    );
    expect(renamed).toHaveLength(1);
  });

  it("carries the suffix through, so a sub-finding still matches", () => {
    const { renamed } = partitionUnmatched(
      [entry("cross-reference", "Course-A/70-How-To-Update/kz5g9uy6vohi#5::digest-mismatch")],
      [finding("cross-reference", "Course-A/70-How-to-update/kz5g9uy6vohi#5::digest-mismatch")],
    );
    expect(renamed).toHaveLength(1);
    expect(renamed[0].key).toContain("::digest-mismatch");
  });

  it("reports a genuinely repaired finding as resolved, as before", () => {
    const { renamed, resolved } = partitionUnmatched(
      [entry("promptless-shell", "Course-A/10-A-Lesson/item1#0")],
      [],
    );
    expect(renamed).toEqual([]);
    expect(resolved).toHaveLength(1);
  });
});

describe("what it refuses to call a rename", () => {
  it("does not match across checks", () => {
    // A different defect in the same block is not the same finding.
    const { renamed, resolved } = partitionUnmatched(
      [entry("promptless-shell", "Course-A/10-Old/item1#0")],
      [finding("empty-blocks", "Course-A/10-New/item1#0")],
    );
    expect(renamed).toEqual([]);
    expect(resolved).toHaveLength(1);
  });

  it("does not match across courses", () => {
    const { renamed } = partitionUnmatched(
      [entry("promptless-shell", "Course-A/10-Lesson/item1#0")],
      [finding("promptless-shell", "Course-B/10-Lesson/item1#0")],
    );
    expect(renamed).toEqual([]);
  });

  it("does not match a different content item", () => {
    // The item id is the anchor. Without this the rule would pair up two
    // unrelated findings in two unrelated lessons of the same course.
    const { renamed } = partitionUnmatched(
      [entry("promptless-shell", "Course-A/10-Old/item1#0")],
      [finding("promptless-shell", "Course-A/10-New/item2#0")],
    );
    expect(renamed).toEqual([]);
  });

  it("does not match a different block in the same lesson", () => {
    const { renamed } = partitionUnmatched(
      [entry("promptless-shell", "Course-A/10-Old/item1#0")],
      [finding("promptless-shell", "Course-A/10-New/item1#4")],
    );
    expect(renamed).toEqual([]);
  });

  it("does not call an unchanged key a rename", () => {
    // Belt and braces: an entry that matched would never reach here, but the
    // rule must not invent a rename out of an identical slug.
    const { renamed, resolved } = partitionUnmatched(
      [entry("promptless-shell", "Course-A/10-Lesson/item1#0")],
      [finding("promptless-shell", "Course-A/10-Lesson/item1#0")],
    );
    expect(renamed).toEqual([]);
    expect(resolved).toHaveLength(1);
  });
});

describe("keys that are not lesson-shaped", () => {
  // A language name, a pair of lesson ids, a bare path. These simply do not
  // participate rather than being force-fitted into course/slug/rest.
  for (const key of ["terraform", "shared-block:abc123", "Course-A/details.json#x"]) {
    it(`leaves ${JSON.stringify(key)} alone`, () => {
      const { renamed, resolved } = partitionUnmatched(
        [entry("unused-lang", key)],
        [finding("unused-lang", "Course-A/10-Other/item1#0")],
      );
      expect(renamed).toEqual([]);
      expect(resolved).toHaveLength(1);
    });
  }

  it("handles an empty open list", () => {
    const { resolved } = partitionUnmatched([entry("x", "a/b/c")], []);
    expect(resolved).toHaveLength(1);
  });

  it("handles nothing unmatched", () => {
    expect(partitionUnmatched([], [finding("x", "a/b/c")])).toEqual({
      renamed: [],
      resolved: [],
    });
  });
});
