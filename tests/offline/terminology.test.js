import { describe, expect, it } from "vitest";
import {
  applyRewrites,
  codeOf,
  compileTerms,
  findRetiredInSlug,
  findRetiredTerms,
  proseOf,
  replacementFor,
} from "../../src/terminology.js";

const TERMS = compileTerms([
  { from: "Chainguard Images", to: "Chainguard Containers", since: "2026-03" },
  { from: "Chainguard Image", to: "Chainguard Container" },
  { from: "chainctl images", to: "chainctl containers", alsoInCode: true },
]);

const found = (html) => findRetiredTerms(html, TERMS).map((f) => [f.where, f.match]);

describe("the blanked views keep every offset", () => {
  const html =
    '<p>Pull <strong>Chainguard</strong> Images.</p><!-- note --><pre data-lang="console"><code>$ chainctl images list</code></pre>';

  it("is the same length as the file, either way round", () => {
    expect(proseOf(html)).toHaveLength(html.length);
    expect(codeOf(html)).toHaveLength(html.length);
  });

  it("points a match at the characters it matched", () => {
    for (const f of findRetiredTerms(html, TERMS)) {
      expect(html.slice(f.offset, f.offset + f.match.length)).toBe(f.match);
    }
  });
});

describe("findRetiredTerms in prose", () => {
  it("finds a retired name", () => {
    expect(found("<p>Chainguard Images are minimal.</p>")).toEqual([
      ["prose", "Chainguard Images"],
    ]);
  });

  it("ignores case, since a lower-case retired name is still the retired name", () => {
    expect(found("<p>the free chainguard images</p>")).toEqual([["prose", "chainguard images"]]);
  });

  it("does not match a singular inside its plural, so each gets its own replacement", () => {
    expect(found("<p>One Chainguard Image, many Chainguard Images.</p>")).toEqual([
      ["prose", "Chainguard Image"],
      ["prose", "Chainguard Images"],
    ]);
  });

  it("reads through an inline tag and a line break", () => {
    expect(found("<p>Use <em>Chainguard</em>\n  Images here.</p>")).toHaveLength(1);
  });

  it("reads through a non-breaking space", () => {
    expect(found("<p>Chainguard&nbsp;Images</p>")).toEqual([["prose", "Chainguard&nbsp;Images"]]);
  });

  it("does not read across two elements", () => {
    expect(found("<li>Chainguard</li><li>Images</li>")).toEqual([]);
  });

  it("does not read across inline code, which the reader sees in the gap", () => {
    // From the content: "a Chainguard <code>-dev</code> image".
    expect(found("<p>a Chainguard <code>-dev</code> image</p>")).toEqual([]);
  });

  it("does not read a hyphenated identifier as the name", () => {
    expect(found("<p>See the chainguard-images organisation.</p>")).toEqual([]);
  });

  it("does not read attributes, comments or scripts", () => {
    expect(
      found(
        '<p title="Chainguard Images"><!-- Chainguard Images --></p><script>"Chainguard Images"</script>',
      ),
    ).toEqual([]);
  });

  it("finds nothing when no terms are configured", () => {
    expect(findRetiredTerms("<p>Chainguard Images</p>", [])).toEqual([]);
  });
});

describe("findRetiredTerms in code", () => {
  it("leaves code alone by default, because a name there is an identifier", () => {
    expect(found('<pre data-lang="console"><code># Chainguard Images\n$ ls</code></pre>')).toEqual([]);
  });

  it("leaves the cosign certificate identity alone, whatever the terms", () => {
    // The false positive that decides whether this check is usable: the
    // identity has to match what signed the artifact, so it must not change.
    const identity =
      '<pre data-lang="console"><code>$ cosign verify \\\n  --certificate-identity=https://github.com/chainguard-images/images/.github/workflows/release.yaml@refs/heads/main \\\n  cgr.dev/chainguard/node</code></pre>';
    const all = compileTerms([{ from: "Chainguard Images", to: "Chainguard Containers", alsoInCode: true }]);
    expect(findRetiredTerms(identity, all)).toEqual([]);
  });

  it("reads code for a term that asks for it", () => {
    expect(found('<pre data-lang="console"><code>$ chainctl images list</code></pre>')).toEqual([
      ["code", "chainctl images"],
    ]);
  });

  it("reads code through a highlighting span", () => {
    expect(found('<pre><code><span class="k">chainctl</span> images list</code></pre>')).toEqual([
      ["code", "chainctl</span> images"],
    ]);
  });

  it("does not join two code elements across the prose between them", () => {
    // From the content: <code>chainctl</code>, ... with its <code>images diff</code>.
    expect(
      found("<p><code>chainctl</code>, the CLI, has an <code>images diff</code> feature.</p>"),
    ).toEqual([]);
  });
});

describe("the context around a match", () => {
  const contextOf = (html) => findRetiredTerms(html, TERMS)[0].context;

  it("is flattened and decoded, so re-wrapping the source does not change it", () => {
    expect(contextOf("<p>Pull\n   Chainguard Images&rsquo; tags</p>")).toBe(
      "Pull Chainguard Images’ tags",
    );
  });

  it("stops at the element it sits in", () => {
    expect(contextOf("<h5>Priced by Chainguard Images</h5><p>Catalog pricing is based on</p>")).toBe(
      "Priced by Chainguard Images",
    );
  });

  it("is cut at a word boundary in a long paragraph", () => {
    const words = "word ".repeat(30);
    const context = contextOf(`<p>${words}Chainguard Images ${words}</p>`);
    expect(context).toMatch(/^(?:word )+Chainguard Images(?: word)+$/);
    expect(context.length).toBeLessThan(100);
  });
});

describe("findRetiredInSlug", () => {
  const slug = (s) => findRetiredInSlug(s, TERMS).map((f) => f.term.from);

  it("finds the hyphenated form of a name", () => {
    expect(slug("getting-started-with-chainguard-images")).toEqual(["Chainguard Images"]);
  });

  it("finds it in a lesson slug, whatever its case", () => {
    expect(slug("20-The-philosophy-of-Chainguard-images")).toEqual(["Chainguard Images"]);
  });

  it("does not match a singular inside its plural", () => {
    expect(slug("40-How-to-build-with-Chainguard-Image-variants")).toEqual(["Chainguard Image"]);
  });

  it("finds nothing in an unrelated slug", () => {
    expect(slug("chainguard-containers-crash-course")).toEqual([]);
  });
});

describe("replacementFor", () => {
  const images = { from: "Chainguard Images", to: "Chainguard Containers" };

  it("writes the new name as configured, since its casing is part of it", () => {
    expect(replacementFor("chainguard images", images)).toBe("Chainguard Containers");
  });

  it("keeps a non-breaking space and a line break where they stood", () => {
    expect(replacementFor("Chainguard&nbsp;Images", images)).toBe("Chainguard&nbsp;Containers");
    expect(replacementFor("Chainguard\n  Images", images)).toBe("Chainguard\n  Containers");
  });

  it("keeps an inline tag on the word it belonged to", () => {
    expect(replacementFor("Chainguard</em> Images", images)).toBe("Chainguard</em> Containers");
  });

  it("joins a longer name with the separator the match used", () => {
    expect(replacementFor("Developer&nbsp;tier", { from: "Developer tier", to: "Catalog Starter plan" })).toBe(
      "Catalog&nbsp;Starter&nbsp;plan",
    );
  });

  it("leaves markup for a person when the word counts differ", () => {
    expect(replacementFor("Developer <b>tier", { from: "Developer tier", to: "Catalog Starter plan" })).toBe(null);
  });

  it("escapes the new name for HTML", () => {
    expect(replacementFor("Old Name", { from: "Old Name", to: "Q&A <Tool>" })).toBe("Q&amp;A &lt;Tool&gt;");
  });
});

describe("applyRewrites", () => {
  const html = "<p>Chainguard Images, and more Chainguard Images.</p>";
  const at = (offset) => ({ offset, match: "Chainguard Images", replacement: "Chainguard Containers" });

  it("replaces exactly the characters matched, and nothing else", () => {
    const { html: out, applied } = applyRewrites(html, [at(3), at(html.lastIndexOf("Chainguard"))]);
    expect(out).toBe("<p>Chainguard Containers, and more Chainguard Containers.</p>");
    expect(applied).toHaveLength(2);
  });

  it("refuses an edit computed against a different copy of the file", () => {
    const { html: out, refused } = applyRewrites(html, [at(4)]);
    expect(out).toBe(html);
    expect(refused).toHaveLength(1);
  });

  it("refuses an edit overlapping one already made", () => {
    const { applied, refused } = applyRewrites(html, [
      at(3),
      { offset: 14, match: "Images", replacement: "Containers" },
    ]);
    expect(applied.map((e) => e.offset)).toEqual([14]);
    expect(refused.map((e) => e.offset)).toEqual([3]);
  });
});
