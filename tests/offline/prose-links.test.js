import { describe, expect, it } from "vitest";
import { classifyHref, extractImages, extractLinks } from "../../src/prose-links.js";

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

describe("extractImages", () => {
  it("finds images and records the attribute they came from", () => {
    const images = extractImages(
      wrap('<p><img src="https://cdn.example.com/a.png" alt="A diagram"></p>'),
      "lesson.html",
    );
    expect(images).toHaveLength(1);
    expect(images[0].url).toBe("https://cdn.example.com/a.png");
    expect(images[0].attr).toBe("src");
    expect(images[0].scheme).toBe("http");
  });

  it("uses alt text to name the image", () => {
    const images = extractImages(
      wrap('<img src="https://cdn.example.com/a.png" alt="  The   build   output ">'),
      "lesson.html",
    );
    expect(images[0].text).toBe("The build output");
  });

  it("reports an image with no alt text as unnamed rather than skipping it", () => {
    const images = extractImages(
      wrap('<img src="https://cdn.example.com/a.png">'),
      "lesson.html",
    );
    expect(images).toHaveLength(1);
    expect(images[0].text).toBe("");
  });

  it("ignores an img with no src", () => {
    const images = extractImages(wrap('<img alt="broken">'), "lesson.html");
    expect(images).toHaveLength(0);
  });

  it("does not confuse links with images", () => {
    const html = wrap(
      '<a href="https://example.com/page">text</a>' +
        '<img src="https://cdn.example.com/a.png" alt="pic">',
    );
    const links = extractLinks(html, "lesson.html");
    const images = extractImages(html, "lesson.html");
    expect(links).toHaveLength(1);
    expect(links[0].attr).toBe("href");
    expect(images).toHaveLength(1);
    expect(images[0].attr).toBe("src");
  });

  it("records a source location pointing at the src attribute", () => {
    const images = extractImages(
      '<div>\n<p>text</p>\n<img src="https://cdn.example.com/a.png" alt="x">\n</div>',
      "lesson.html",
    );
    expect(images[0].source.file).toBe("lesson.html");
    expect(images[0].source.line).toBe(3);
  });

  it("keeps the raw src so a rewriter can match the file", () => {
    const images = extractImages(
      wrap('<img src="https://cdn.example.com/a.png?w=1&amp;h=2" alt="x">'),
      "lesson.html",
    );
    expect(images[0].url).toBe("https://cdn.example.com/a.png?w=1&h=2");
    expect(images[0].rawHref).toBe("https://cdn.example.com/a.png?w=1&amp;h=2");
  });
});
