import { describe, expect, it } from "vitest";
import { extractScriptEntities } from "../../src/scripts.js";

/** Entities found in one HTML string, in document order. */
const entities = (html) =>
  extractScriptEntities(html, "lesson.html").map((f) => f.entity);

describe("extractScriptEntities", () => {
  it("finds a named entity inside a script", () => {
    expect(entities("<script>const a = 'x &amp; y';</script>")).toEqual(["&amp;"]);
  });

  it("finds every entity in one script, in order", () => {
    const html = "<script>const a = '&lsquo;x&rsquo;'; const b = 'p &amp; q';</script>";
    expect(entities(html)).toEqual(["&lsquo;", "&rsquo;", "&amp;"]);
  });

  it("finds entities across several scripts", () => {
    const html = "<script>'&amp;'</script><p>x</p><script>'&rsquo;'</script>";
    expect(entities(html)).toEqual(["&amp;", "&rsquo;"]);
  });

  // The defect written a different way. Catching only the named form would
  // send an author to replace &amp; with &#38; and call it fixed.
  it("finds numeric and hex entities", () => {
    expect(entities("<script>'&#38;'</script>")).toEqual(["&#38;"]);
    expect(entities("<script>'&#x26;'</script>")).toEqual(["&#x26;"]);
  });

  // The rule inverts at the script boundary: these are correct as written.
  it("ignores entities outside a script", () => {
    const html = "<p>Chainguard&rsquo;s registry</p><pre><code>a &amp;&amp; b</code></pre>";
    expect(entities(html)).toEqual([]);
  });

  it("ignores a bare ampersand, which is not an entity", () => {
    expect(entities("<script>const a = x && y;</script>")).toEqual([]);
  });

  it("ignores an ampersand followed by a space", () => {
    expect(entities("<script>const a = 'fish & chips';</script>")).toEqual([]);
  });

  it("has nothing to read in a script with a src and no body", () => {
    expect(entities('<script src="/app.js"></script>')).toEqual([]);
  });

  it("reports the entity's own line and column, not the script's", () => {
    const html = "<script>\nconst a = 1;\nconst b = 'x &amp; y';\n</script>";
    const [found] = extractScriptEntities(html, "lesson.html");
    expect(found.source.line).toBe(3);
    expect(html.slice(found.source.startOffset, found.source.endOffset)).toBe("&amp;");
  });

  it("quotes the surrounding source, so a finding names something actionable", () => {
    const html =
      "<script>const r = {link: 'https://youtu.be/abc?list=xyz&amp;t=2691s'};</script>";
    const [found] = extractScriptEntities(html, "lesson.html");
    expect(found.context).toContain("t=2691s");
  });

  // Fixing one entity should reopen every finding in the script it lived in,
  // because the other entries were accepted against a body that has changed.
  it("fingerprints the script body, so entities in one script share a hash", () => {
    const [a, b] = extractScriptEntities("<script>'&amp;' + '&rsquo;'</script>", "x.html");
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("gives separate scripts separate fingerprints", () => {
    const [a, b] = extractScriptEntities(
      "<script>'&amp;'</script><script>'&rsquo;'</script>",
      "x.html",
    );
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it("numbers findings across the file, so each has its own identity", () => {
    const found = extractScriptEntities(
      "<script>'&amp;'</script><script>'&rsquo;'</script>",
      "x.html",
    );
    expect(found.map((f) => f.ordinal)).toEqual([0, 1]);
    expect(found.map((f) => f.scriptOrdinal)).toEqual([0, 1]);
  });
});
