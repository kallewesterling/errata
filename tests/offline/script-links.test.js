import { describe, expect, it } from "vitest";
import { extractScriptLinks } from "../../src/scripts.js";

const OPTIONS = { keys: ["link"], textKey: "title" };
const links = (html, options = OPTIONS) => extractScriptLinks(html, "lesson.html", options);
const urls = (html, options) => links(html, options).map((l) => l.url);
const script = (body) => `<p>Before.</p>\n<script>${body}</script>\n<p>After.</p>`;

describe("extractScriptLinks", () => {
  it("reads each card in a flat resources array", () => {
    const found = links(
      script(`
  const resources = {
    resources: [
      { title: "Getting started guide", link: "https://docs.example.com/start", tags: ["intro"] },
      { title: "Configuration reference", link: "https://docs.example.com/config" },
    ],
  };`),
    );
    expect(found.map((l) => [l.url, l.text])).toEqual([
      ["https://docs.example.com/start", "Getting started guide"],
      ["https://docs.example.com/config", "Configuration reference"],
    ]);
    expect(found.every((l) => l.attr === "script" && l.scheme === "http")).toBe(true);
  });

  it("reads groups held as an object of named arrays", () => {
    const found = links(
      script(`
  const resources = {
    groups: {
      "basics": [{ title: "Overview", link: "https://example.com/overview" }],
      "advanced": [
        { title: "Tuning", link: "https://example.com/tuning" },
        { title: "Scaling", link: "https://example.com/scaling" },
      ],
    },
  };`),
    );
    expect(found.map((l) => l.url)).toEqual([
      "https://example.com/overview",
      "https://example.com/tuning",
      "https://example.com/scaling",
    ]);
  });

  it("reads groups held as an array of named groups", () => {
    expect(
      urls(
        script(`const resources = { groups: [
          { name: "Basics", resources: [{ title: "Overview", link: "https://example.com/overview" }] },
        ] };`),
      ),
    ).toEqual(["https://example.com/overview"]);
  });

  it("gives cards in one array the same group, and cards in another array a different one", () => {
    const found = links(
      script(`const resources = { groups: {
        "a": [{ title: "One", link: "https://example.com/1" }, { title: "Two", link: "https://example.com/2" }],
        "b": [{ title: "Three", link: "https://example.com/3" }],
      } };`),
    );
    const [one, two, three] = found.map((l) => l.script?.group);
    expect(one).toBeTruthy();
    expect(one).toBe(two);
    expect(three).not.toBe(one);
  });

  it("ignores a template object commented out in a block comment", () => {
    // The shape that rules out a regex: a dead object, with line comments
    // inside the block comment, beside a live one carrying its own.
    const found = urls(
      script(`
  const resources = {
    /*
    resources: [
      {
        title: "title",
        link: "https://example.com/placeholder",
        addUTM: true, // keep true
      }
    ]
    */
    resources: [
      { title: "Real card", link: "https://example.com/real", addUTM: true }, // a live comment
    ],
  };`),
    );
    expect(found).toEqual(["https://example.com/real"]);
  });

  it("ignores a card commented out with line comments", () => {
    expect(
      urls(
        script(`const resources = { resources: [
          // { title: "Old", link: "https://example.com/old" },
          { title: "New", link: "https://example.com/new" },
        ] };`),
      ),
    ).toEqual(["https://example.com/new"]);
  });

  it("does not read a URL that only appears in a string or another key", () => {
    expect(
      urls(
        script(`const resources = { resources: [
          { title: "See link: \\"https://example.com/in-a-string\\"", url: "https://example.com/other-key",
            link: "https://example.com/card" },
        ] };`),
      ),
    ).toEqual(["https://example.com/card"]);
  });

  it("reads a quoted key, single quotes and a plain template literal", () => {
    expect(
      urls(
        script(`const resources = { resources: [
          { "title": "Quoted", "link": "https://example.com/quoted" },
          { title: 'Single', link: 'https://example.com/single' },
          { title: \`Template\`, link: \`https://example.com/template\` },
        ] };`),
      ),
    ).toEqual([
      "https://example.com/quoted",
      "https://example.com/single",
      "https://example.com/template",
    ]);
  });

  it("skips a template literal with an expression, which has no fixed value", () => {
    expect(
      urls(script("const base = 'https://example.com'; const resources = { resources: [{ title: 'Built', link: `${base}/built` }] };")),
    ).toEqual([]);
  });

  it("reads whichever keys are configured", () => {
    const html = script(`const resources = { resources: [
      { title: "A", link: "https://example.com/a", href: "https://example.com/b" },
    ] };`);
    expect(urls(html, { keys: ["href"], textKey: "title" })).toEqual(["https://example.com/b"]);
    expect(urls(html, { keys: ["link", "href"], textKey: "title" })).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("leaves the text empty when the card has no text key", () => {
    expect(links(script(`const r = [{ link: "https://example.com/a" }];`))[0].text).toBe("");
  });

  it("does not decode an entity, because a script is raw text", () => {
    const [found] = links(script(`const r = [{ title: "Talk", link: "https://example.com/watch?v=abc&amp;t=60s" }];`));
    expect(found.url).toBe("https://example.com/watch?v=abc&amp;t=60s");
    expect(found.rawHref).toBe("https://example.com/watch?v=abc&amp;t=60s");
  });

  it("keeps the value as written beside the value the reader gets", () => {
    const [found] = links(script(`const r = [{ title: "T", link: "https:\\/\\/example.com\\/escaped" }];`));
    expect(found.url).toBe("https://example.com/escaped");
    expect(found.rawHref).toBe("https:\\/\\/example.com\\/escaped");
  });

  it("points at the literal, and at the key it belongs to", () => {
    const html = script(`const r = [{ title: "T", link:  "https://example.com/a" }];`);
    const [found] = links(html);
    expect(html.slice(found.source.startOffset, found.source.endOffset)).toBe('"https://example.com/a"');
    expect(html.slice(found.script?.keyOffset, found.source.endOffset)).toBe('link:  "https://example.com/a"');
    expect(found.script?.quote).toBe('"');
    expect(found.source.line).toBe(2);
  });

  it("skips a script it cannot parse, and keeps reading the next", () => {
    const html =
      `<script>const broken = { link: "https://example.com/broken" </script>` +
      `<script>const r = [{ title: "T", link: "https://example.com/fine" }];</script>`;
    expect(urls(html)).toEqual(["https://example.com/fine"]);
  });

  it("skips a script loaded from elsewhere, and one that is not JavaScript", () => {
    const html =
      `<script src="https://example.com/widget.js"></script>` +
      `<script type="application/ld+json">{"link": "https://example.com/json"}</script>`;
    expect(urls(html)).toEqual([]);
  });

  it("numbers links within the file, across scripts", () => {
    const html =
      `<script>const a = [{ link: "https://example.com/1" }];</script>` +
      `<script>const b = [{ link: "https://example.com/2" }];</script>`;
    expect(links(html).map((l) => l.ordinal)).toEqual([0, 1]);
  });
});
