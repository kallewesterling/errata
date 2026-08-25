import { describe, expect, it } from "vitest";
import { extractBlocks, fingerprint } from "../../src/extract.js";
import { getInventory } from "../../src/inventory.js";

/**
 * Unit tests for the extractor itself. These use inline fixtures rather than
 * mirror content so they keep working when the content changes.
 */
describe("extractBlocks", () => {
  it("captures language, code and position", () => {
    const html = `<p>x</p>\n<pre data-lang="console"><code>$ echo hi</code></pre>`;
    const [block] = extractBlocks(html, "f.html");

    expect(block.lang).toBe("console");
    expect(block.code).toBe("$ echo hi");
    expect(block.source.line).toBe(2);
    expect(block.anomalies).toEqual([]);
  });

  it("decodes entities without touching the raw capture", () => {
    const html = `<pre data-lang="console"><code>apk search &lt;term&gt; &amp;&amp; echo ok</code></pre>`;
    const [block] = extractBlocks(html, "f.html");

    expect(block.code).toBe("apk search <term> && echo ok");
    expect(block.rawCode).toBe("apk search &lt;term&gt; &amp;&amp; echo ok");
  });

  it("preserves unescaped markup that textContent would delete", () => {
    // The whole reason extraction slices raw source instead of reading the
    // parsed tree: <pre> is not a raw-text element, so an unescaped tag is
    // parsed as markup and silently dropped from textContent.
    const html = `<pre data-lang="dockerfile"><code>dfc <path_to_dockerfile></code></pre>`;
    const [block] = extractBlocks(html, "f.html");

    expect(block.code).toBe("dfc <path_to_dockerfile>");
    expect(block.anomalies).toContain("unescaped-markup");
  });

  it("handles a bare <pre> with no <code> child", () => {
    const html = `<pre>$ docker run --rm alpine</pre>`;
    const [block] = extractBlocks(html, "f.html");

    expect(block.code).toBe("$ docker run --rm alpine");
    expect(block.anomalies).toEqual(
      expect.arrayContaining(["missing-lang", "missing-code-element"]),
    );
  });

  it("drops the newline HTML eats after a <pre> start tag", () => {
    const html = `<pre>\nline one\nline two</pre>`;
    const [block] = extractBlocks(html, "f.html");

    expect(block.code).toBe("line one\nline two");
  });

  it("numbers blocks by document order within a file", () => {
    const html = `<pre data-lang="json"><code>{}</code></pre>\n<pre data-lang="yaml"><code>a: 1</code></pre>`;
    const blocks = extractBlocks(html, "f.html");

    expect(blocks.map((b) => b.ordinal)).toEqual([0, 1]);
    expect(blocks.map((b) => b.lang)).toEqual(["json", "yaml"]);
  });

  it("locates code that byte offsets can round-trip", () => {
    const html = `<p>lead</p>\n<pre data-lang="yaml"><code>package:\n  name: jq</code></pre>`;
    const [block] = extractBlocks(html, "f.html");

    expect(html.slice(block.source.startOffset, block.source.endOffset)).toBe(
      block.rawCode,
    );
  });
});

describe("fingerprint", () => {
  it("ignores trailing whitespace and line-ending style", () => {
    expect(fingerprint("a\r\nb  \n")).toBe(fingerprint("a\nb"));
  });

  it("distinguishes different code", () => {
    expect(fingerprint("apk add jq")).not.toBe(fingerprint("apk add yq"));
  });
});

describe("inventory", () => {
  const blocks = getInventory();

  it("finds code blocks across the content tree", () => {
    expect(blocks.length).toBeGreaterThan(0);
  });

  it("gives every block a unique id", () => {
    const ids = blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every block a source location that resolves to real code", () => {
    for (const block of blocks) {
      expect(block.source.line, block.id).toBeGreaterThan(0);
      expect(block.editorRef, block.id).toMatch(/:\d+:\d+$/);
    }
  });

  it("links every block to its course and lesson", () => {
    for (const block of blocks) {
      expect(block.course.dir, block.id).toBeTruthy();
      expect(block.lesson.slug, block.id).toBeTruthy();
      expect(block.contentItem.id, block.id).toBeTruthy();
    }
  });
});
