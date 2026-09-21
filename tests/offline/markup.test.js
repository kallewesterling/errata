import { describe, expect, it } from "vitest";
import { htmlCommentIn, opensAsDockerfile, typographyIn } from "../../src/markup.js";
import { findProseDefects, maskCode } from "../../src/prose-defects.js";

describe("htmlCommentIn", () => {
  it("finds the comment that renders as nothing", () => {
    expect(htmlCommentIn("$ cat package.json\n<!-- TODO: insert output here -->")).toBe(
      "<!-- TODO: insert output here -->",
    );
  });

  it("flattens a comment spanning lines, so it fits a report", () => {
    expect(htmlCommentIn("<!-- one\n   two -->")).toBe("<!-- one two -->");
  });

  it("is null for an ordinary block", () => {
    expect(htmlCommentIn("$ docker build .")).toBe(null);
  });

  it("is null for a shell comment, which is not an HTML comment", () => {
    expect(htmlCommentIn("# Install (macOS)\n$ brew install cosign")).toBe(null);
  });
});

describe("typographyIn", () => {
  it("finds a character that survives the clipboard but not the shell", () => {
    expect(typographyIn("$ echo ‘hello’").map((f) => f.char)).toEqual(["‘", "’"]);
  });

  it("finds a non-breaking space used for indentation", () => {
    expect(typographyIn("key:\n  value").map((f) => f.char)).toEqual([" "]);
  });

  it("reports each character once, however often it appears", () => {
    expect(typographyIn("… … …")).toHaveLength(1);
  });

  it("leaves plain ASCII alone", () => {
    expect(typographyIn("$ docker run -it --rm alpine sh -c 'echo \"hi\"'")).toEqual([]);
  });

  it("leaves three full stops alone, which is the correct elision", () => {
    expect(typographyIn("$ docker run ... alpine")).toEqual([]);
  });
});

describe("opensAsDockerfile", () => {
  it("recognizes a Dockerfile", () => {
    expect(opensAsDockerfile("FROM cgr.dev/chainguard/go\nRUN go build ./...")).toBe(true);
  });

  it("recognizes one that declares a build argument first", () => {
    expect(opensAsDockerfile("ARG VERSION=latest\nFROM alpine:${VERSION}")).toBe(true);
  });

  it("looks past a leading comment", () => {
    expect(opensAsDockerfile("# build stage\nFROM alpine")).toBe(true);
  });

  // The whole reason the test is "opens with FROM" rather than "contains
  // FROM": nothing that is not a Dockerfile begins with one.
  it("does not mistake a SQL FROM clause for a Dockerfile", () => {
    expect(opensAsDockerfile("SELECT name, version\nFROM packages\nWHERE x = 1")).toBe(
      false,
    );
  });

  it("does not fire on a block that merely mentions FROM", () => {
    expect(opensAsDockerfile("$ grep FROM Dockerfile")).toBe(false);
  });

  it("is false for an empty block", () => {
    expect(opensAsDockerfile("")).toBe(false);
  });
});

describe("maskCode", () => {
  it("blanks a code region without moving anything after it", () => {
    const html = "<p>a</p><pre><code>`x`</code></pre><p>b</p>";
    const masked = maskCode(html);
    expect(masked).toHaveLength(html.length);
    expect(masked.indexOf("<p>b</p>")).toBe(html.indexOf("<p>b</p>"));
    expect(masked).not.toContain("`");
  });

  it("blanks inline code and scripts too", () => {
    expect(maskCode("<p>see <code>`x`</code> and</p><script>'`'</script>")).not.toContain(
      "`",
    );
  });
});

describe("findProseDefects", () => {
  const found = (html) => findProseDefects(html, "lesson.html");

  it("finds a Markdown backtick the reader can see", () => {
    const [defect] = found("<p>Pass the `--platform` flag.</p>");
    expect(defect.kind).toBe("markdown");
    expect(defect.rule).toBe("backtick");
  });

  // Settled once already: inside a <pre> a backtick is command substitution,
  // ASCII art, or captured output.
  it("leaves a backtick inside a code block alone", () => {
    expect(found("<pre><code>$ echo `date`</code></pre>")).toEqual([]);
  });

  it("reports one finding per rule per file, not one per occurrence", () => {
    const html = "<p>`a` and `b` and `c`</p>";
    expect(found(html).filter((d) => d.rule === "backtick")).toHaveLength(1);
  });

  it("finds a command flattened into a paragraph", () => {
    const [defect] = found("<p>Run chainctl auth login --org example.com to start.</p>");
    expect(defect.kind).toBe("flattened-command");
  });

  it("finds one flattened into a list item", () => {
    expect(found("<li>use --parent example.com here</li>")).toHaveLength(1);
  });

  // Prose naming a tool is ordinary and common; prose carrying a flag and its
  // value is a block that lost its <pre>.
  it("leaves prose that merely names a tool alone", () => {
    expect(found("<p>The chainctl command manages your organization.</p>")).toEqual([]);
  });

  it("leaves a flag already wrapped in code alone", () => {
    expect(found("<p>Pass <code>--org example.com</code> to it.</p>")).toEqual([]);
  });

  it("points at the line the defect is on", () => {
    const [defect] = found("<p>one</p>\n<p>two</p>\n<p>the `flag` here</p>");
    expect(defect.source.line).toBe(3);
  });
});
