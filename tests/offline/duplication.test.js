import { describe, expect, it } from "vitest";
import {
  drifted,
  inSync,
  normalizeCode,
  pairFingerprint,
  pairKey,
  sentences,
  sharedGroups,
  shingles,
  similarPairs,
  similarity,
  touchesCode,
  visibleText,
  words,
  worthTracking,
} from "../../src/duplication.js";

describe("visibleText", () => {
  it("skips elements whose text a reader never compares", () => {
    const html = "<p>Real prose.</p><script>const resources = { a: 1 };</script>";
    expect(visibleText(html)).toBe("Real prose.");
  });

  it("keeps a line break at block boundaries", () => {
    const text = visibleText("<pre><code>$ docker run x</code></pre><p>Then this.</p>");
    expect(text.split("\n")).toEqual(["$ docker run x", "Then this."]);
  });

  it("collapses runs of spaces without merging lines", () => {
    expect(visibleText("<p>a    b</p><p>c</p>")).toBe("a b\nc");
  });

  it("reads text through nested markup", () => {
    expect(visibleText("<p>See <strong>the <em>docs</em></strong> now.</p>")).toBe(
      "See the docs now.",
    );
  });

  it("honours a caller's own ignore list", () => {
    const html = "<p>keep</p><aside>drop</aside>";
    expect(visibleText(html, new Set(["aside"]))).toBe("keep");
  });
});

describe("words", () => {
  it("drops case and punctuation, which are not drift", () => {
    expect(words("Hello, World!")).toEqual(["hello", "world"]);
  });

  it("returns nothing for text with no word characters", () => {
    expect(words("--- ??? ---")).toEqual([]);
  });
});

describe("shingles", () => {
  it("produces overlapping n-grams", () => {
    expect([...shingles(["a", "b", "c", "d"], 2)]).toEqual(["a b", "b c", "c d"]);
  });

  it("produces nothing when the text is shorter than the window", () => {
    expect(shingles(["a", "b"], 5).size).toBe(0);
  });
});

describe("similarity", () => {
  it("is 1 for identical sets and 0 for disjoint ones", () => {
    expect(similarity(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
    expect(similarity(new Set(["a"]), new Set(["b"]))).toBe(0);
  });

  it("is the shared share of the union", () => {
    expect(similarity(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
  });

  it("treats an empty side as no evidence rather than a perfect match", () => {
    expect(similarity(new Set(), new Set())).toBe(0);
    expect(similarity(new Set(), new Set(["a"]))).toBe(0);
  });
});

describe("sentences", () => {
  it("splits on terminators and on line breaks", () => {
    expect(sentences("The first one here. The second one here.")).toHaveLength(2);
    expect(sentences("$ docker run alpine\nThen read the output carefully.")).toHaveLength(2);
  });

  it("drops fragments too short to be worth reporting", () => {
    expect(sentences("Yes. No.")).toEqual([]);
  });
});

/** A document as similarPairs expects it, with only the fields it reads. */
const doc = (id, text) => ({
  id,
  label: id,
  course: id.split("/")[0],
  lesson: id,
  editorRef: `${id}:1:1`,
  lessonUrl: null,
  text,
  sentences: sentences(text),
  words: words(text).length,
  shingles: shingles(words(text)),
});

const LONG =
  "Chainguard containers are minimal images built from Wolfi and they carry " +
  "far fewer packages than a general purpose base image does, which reduces " +
  "the number of vulnerabilities a scanner will report against them daily.";

describe("similarPairs", () => {
  it("pairs documents that are copies of each other", () => {
    const pairs = similarPairs([doc("a/one", LONG), doc("b/two", LONG)], 0.8);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].score).toBe(1);
  });

  it("ignores documents that merely share a subject", () => {
    const other =
      "Kubernetes schedules workloads across a cluster of machines and it " +
      "handles restarts, scaling and service discovery on your behalf too.";
    expect(similarPairs([doc("a/one", LONG), doc("b/two", other)], 0.8)).toHaveLength(0);
  });

  it("reports the sentences that differ, on the side they appear", () => {
    const edited = `${LONG} An extra sentence appears only in the second copy.`;
    const [pair] = similarPairs([doc("a/one", LONG), doc("b/two", edited)], 0.5);
    expect(pair.onlyA).toEqual([]);
    expect(pair.onlyB).toEqual(["An extra sentence appears only in the second copy."]);
  });

  it("does not call punctuation or case a difference", () => {
    const [pair] = similarPairs(
      [doc("a/one", LONG), doc("b/two", LONG.replace("Wolfi", "wolfi"))],
      0.5,
    );
    expect(pair.onlyA).toEqual([]);
    expect(pair.onlyB).toEqual([]);
  });

  it("sorts the most similar first", () => {
    const pairs = similarPairs(
      [doc("a/one", LONG), doc("b/two", LONG), doc("c/three", `${LONG} A trailing sentence here.`)],
      0.5,
    );
    expect(pairs[0].score).toBe(1);
    expect(pairs[0].score).toBeGreaterThanOrEqual(pairs[1].score);
  });
});

describe("inSync and drifted", () => {
  const pairs = similarPairs(
    [doc("a/one", LONG), doc("b/two", LONG), doc("c/three", `${LONG} A trailing sentence here.`)],
    0.5,
  );

  it("separates perfect copies from copies that have moved apart", () => {
    expect(inSync(pairs)).toHaveLength(1);
    expect(drifted(pairs).length).toBeGreaterThan(0);
    expect(drifted(pairs).every((p) => p.score < 1)).toBe(true);
  });
});

describe("touchesCode", () => {
  it("recognizes a differing shell command", () => {
    const a = doc("a/one", `${LONG}\n$ docker debug -it nginx`);
    const b = doc("b/two", `${LONG}\n$ docker debug nginx`);
    const [pair] = similarPairs([a, b], 0.5);
    expect(touchesCode(pair)).toBe(true);
  });

  it("does not fire on prose alone", () => {
    const [pair] = similarPairs(
      [doc("a/one", LONG), doc("b/two", `${LONG} A purely editorial sentence.`)],
      0.5,
    );
    expect(touchesCode(pair)).toBe(false);
  });
});

describe("pairKey and pairFingerprint", () => {
  const a = doc("a/one", LONG);
  const b = doc("b/two", LONG);

  it("identify a pair the same way whichever side comes first", () => {
    const [one] = similarPairs([a, b], 0.5);
    const [two] = similarPairs([b, a], 0.5);
    expect(pairKey(one)).toBe(pairKey(two));
    expect(pairFingerprint(one)).toBe(pairFingerprint(two));
  });

  it("change the fingerprint when either side is edited", () => {
    const [before] = similarPairs([a, b], 0.5);
    const [after] = similarPairs([a, doc("b/two", `${LONG} Now edited here.`)], 0.5);
    expect(pairFingerprint(after)).not.toBe(pairFingerprint(before));
    expect(pairKey(after)).toBe(pairKey(before));
  });
});

describe("worthTracking", () => {
  it("keeps blocks carrying detail that can rot", () => {
    expect(worthTracking("$ curl -o chainctl https://dl.enforce.dev/chainctl/latest/x")).toBe(true);
    expect(worthTracking("FROM cgr.dev/x\nRUN apk add y")).toBe(true);
  });

  it("drops a short one-line command with nothing in it to get out of step", () => {
    expect(worthTracking("$ apk update")).toBe(false);
    expect(worthTracking("   ")).toBe(false);
  });
});

describe("sharedGroups", () => {
  const blocks = [
    { code: "same", course: "A" },
    { code: "same", course: "B" },
    { code: "same", course: "A" },
    { code: "lonely", course: "A" },
  ];

  it("keeps only values that span more than one owner", () => {
    const groups = sharedGroups(blocks, (b) => b.code, (b) => b.course);
    expect(groups).toHaveLength(1);
    expect(groups[0].value).toBe("same");
    expect(groups[0].owners).toEqual(["A", "B"]);
    expect(groups[0].group).toHaveLength(3);
  });

  it("ranks the most widely shared first", () => {
    const wide = [
      ...blocks,
      { code: "wide", course: "A" },
      { code: "wide", course: "B" },
      { code: "wide", course: "C" },
    ];
    const groups = sharedGroups(wide, (b) => b.code, (b) => b.course);
    expect(groups[0].value).toBe("wide");
  });
});

describe("normalizeCode", () => {
  it("ignores indentation and blank lines", () => {
    expect(normalizeCode("  a\n\n   b  \n")).toBe("a\nb");
  });
});
