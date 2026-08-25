import { describe, expect, it } from "vitest";
import { classifyHref, extractLinks } from "../../src/prose-links.js";

const wrap = (body) => `<div>\n${body}\n</div>`;

describe("classifyHref", () => {
  it("recognizes the schemes that can be fetched", () => {
    expect(classifyHref("https://example.com")).toBe("http");
    expect(classifyHref("http://example.com")).toBe("http");
    expect(classifyHref("HTTPS://EXAMPLE.COM")).toBe("http");
  });

  it("separates the schemes that cannot", () => {
    expect(classifyHref("mailto:a@b.c")).toBe("mailto");
    expect(classifyHref("#section")).toBe("anchor");
    expect(classifyHref("ftp://example.com")).toBe("other");
    expect(classifyHref("/docs/page")).toBe("relative");
    expect(classifyHref("../page")).toBe("relative");
  });

  it("ignores surrounding whitespace", () => {
    expect(classifyHref("  https://example.com  ")).toBe("http");
  });
});

describe("extractLinks", () => {
  it("finds links and records their text", () => {
    const links = extractLinks(
      wrap('<p>See <a href="https://example.com/docs">the docs</a> first.</p>'),
      "lesson.html",
    );
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe("https://example.com/docs");
    expect(links[0].text).toBe("the docs");
    expect(links[0].scheme).toBe("http");
  });

  it("numbers links in document order", () => {
    const links = extractLinks(
      wrap('<a href="https://a.example">a</a><a href="https://b.example">b</a>'),
      "lesson.html",
    );
    expect(links.map((l) => l.ordinal)).toEqual([0, 1]);
    expect(links.map((l) => l.url)).toEqual(["https://a.example", "https://b.example"]);
  });

  it("records a source location pointing at the link", () => {
    const links = extractLinks(
      '<p>one</p>\n<p>two</p>\n<p><a href="https://example.com">x</a></p>',
      "lesson.html",
    );
    expect(links[0].source.file).toBe("lesson.html");
    expect(links[0].source.line).toBe(3);
  });

  it("decodes entities in the href", () => {
    const links = extractLinks(
      wrap('<a href="https://example.com/?a=1&amp;b=2">x</a>'),
      "lesson.html",
    );
    expect(links[0].url).toBe("https://example.com/?a=1&b=2");
  });

  /** The raw form is what the rewriter has to match against the file. */
  it("keeps the raw href alongside the decoded one", () => {
    const links = extractLinks(
      wrap('<a href="https://example.com/?a=1&amp;b=2">x</a>'),
      "lesson.html",
    );
    expect(links[0].rawHref).toBe("https://example.com/?a=1&amp;b=2");
  });

  it("collapses whitespace in link text", () => {
    const links = extractLinks(
      wrap('<a href="https://example.com">the\n   long   name</a>'),
      "lesson.html",
    );
    expect(links[0].text).toBe("the long name");
  });

  it("reads text through nested markup", () => {
    const links = extractLinks(
      wrap('<a href="https://example.com"><strong>bold</strong> tail</a>'),
      "lesson.html",
    );
    expect(links[0].text).toBe("bold tail");
  });

  it("skips anchors that have no href", () => {
    const links = extractLinks(wrap('<a name="here">x</a>'), "lesson.html");
    expect(links).toHaveLength(0);
  });

  it("returns nothing for a document with no links", () => {
    expect(extractLinks(wrap("<p>plain prose</p>"), "lesson.html")).toEqual([]);
  });

  /**
   * URLs inside code blocks are a different population, checked separately and
   * on different terms, so they must not be picked up here.
   */
  it("does not treat a URL in a code block as a link", () => {
    const links = extractLinks(
      wrap('<pre data-lang="console"><code>$ curl https://example.com</code></pre>'),
      "lesson.html",
    );
    expect(links).toHaveLength(0);
  });
});
